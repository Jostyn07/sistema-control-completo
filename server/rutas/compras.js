// ============================================================
// MÓDULO 5 — COMPRAS  (/api/compras)
// Requiere sesión. Todo se filtra por req.empresa.id.
// - GET  /pendientes    materiales por debajo del punto de reorden
//                       (también muestra si ya hay un pedido en camino)
// - POST /              registra el PEDIDO de un material o de un
//                       producto de reventa — NO suma stock todavía;
//                       queda "pendiente" con fecha estimada de llegada.
//                       Producto con dias_entrega 0: entra de una vez.
//                       Si el precio difiere del costo: decision_costo
//                       ('mantener' | 'nuevo' | 'promedio') o 409.
// - POST /:id/recibir   confirma la llegada manualmente y suma el stock
// - GET  /en-camino     pedidos hechos que aún no han llegado
// - GET  /historial     compras pasadas (con su estado) con filtros
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const servicioInventario = require('../servicios/inventario');
const { calcularFechaEstimada, recibirCompra, procesarComprasVencidas } = require('../servicios/compras');
const libro = require('../servicios/inventario/libro');
const costoCompra = require('../servicios/costo-compra');
const router = express.Router();

// Material o producto de la compra, para mostrar su nombre
const SELECT_ARTICULO = '*, materiales(nombre, unidad), productos(nombre)';

// GET /api/compras/pendientes
router.get('/pendientes', async (req, res, next) => {
  try {
    const inventario = await servicioInventario.obtenerInventarioMateriales(req.empresa.id);

    // Pedidos ya en camino, para no sugerir comprar algo que ya se pidió
    const { data: enCamino, error: eCamino } = await supabase
      .from('compras')
      .select('material_id, cantidad, fecha_estimada_llegada')
      .eq('empresa_id', req.empresa.id)
      .eq('estado', 'pendiente');
    if (eCamino) throw new Error(eCamino.message);

    const enCaminoPorMaterial = new Map();
    for (const c of enCamino || []) {
      const previo = enCaminoPorMaterial.get(c.material_id) || { cantidad: 0, fechaMasCercana: null };
      previo.cantidad += Number(c.cantidad);
      if (!previo.fechaMasCercana || c.fecha_estimada_llegada < previo.fechaMasCercana) {
        previo.fechaMasCercana = c.fecha_estimada_llegada;
      }
      enCaminoPorMaterial.set(c.material_id, previo);
    }

    const pendientes = inventario
      .filter(m => m.estado === 'rojo' || m.estado === 'amarillo')
      .map(m => {
        const objetivo = m.punto_reorden * 2;
        const sugerido = Math.max(1, Math.ceil(objetivo - m.stock_actual));
        const camino = enCaminoPorMaterial.get(m.id);
        return {
          material_id: m.id,
          nombre: m.nombre,
          unidad: m.unidad,
          estado: m.estado,
          stock_actual: m.stock_actual,
          punto_reorden: m.punto_reorden,
          proveedor_sugerido: m.proveedor,
          tiempo_entrega_dias: m.tiempo_entrega_dias,
          cantidad_sugerida: sugerido,
          costo_unitario_actual: m.costo_unitario,
          costo_estimado: Math.round(sugerido * m.costo_unitario * 100) / 100,
          ya_en_camino: camino ? camino.cantidad : 0,
          llega_aprox: camino ? camino.fechaMasCercana : null
        };
      })
      .sort((a, b) => (a.estado === 'rojo' ? 0 : 1) - (b.estado === 'rojo' ? 0 : 1));

    if (req.empresa.modelo && req.empresa.modelo.reventa) pendientes.push(...await productosPorReponer(req.empresa.id));
    res.json(pendientes);
  } catch (err) { next(err); }
});

// Productos de reventa en o por debajo de su mínimo (mismo formato que materiales)
async function productosPorReponer(empresaId) {
  const [{ data: productos, error: eP }, { data: stock, error: eS }, { data: camino, error: eC }] = await Promise.all([
    supabase.from('productos').select('id, nombre, costo_calculado').eq('empresa_id', empresaId).eq('tipo', 'reventa').eq('activo', true),
    supabase.from('inventario_productos').select('producto_id, stock_actual, stock_minimo').eq('empresa_id', empresaId).eq('controla_stock', true),
    supabase.from('compras').select('producto_id, cantidad, fecha_estimada_llegada').eq('empresa_id', empresaId).eq('estado', 'pendiente').not('producto_id', 'is', null)
  ]);
  if (eP || eS || eC) throw new Error((eP || eS || eC).message);
  const stockPorId = new Map((stock || []).map(s => [s.producto_id, s]));
  const caminoPorId = new Map();
  for (const c of camino || []) {
    const previo = caminoPorId.get(c.producto_id) || { cantidad: 0, fecha: null };
    previo.cantidad += Number(c.cantidad);
    if (!previo.fecha || c.fecha_estimada_llegada < previo.fecha) previo.fecha = c.fecha_estimada_llegada;
    caminoPorId.set(c.producto_id, previo);
  }
  const lista = [];
  for (const p of productos || []) {
    const s = stockPorId.get(p.id);
    if (!s) continue;
    const actual = Number(s.stock_actual);
    const minimo = Number(s.stock_minimo);
    if (actual > 0 && (minimo <= 0 || actual > minimo)) continue;
    const sugerido = Math.max(1, Math.ceil(Math.max(minimo, 1) * 2 - actual));
    const enCamino = caminoPorId.get(p.id);
    lista.push({
      producto_id: p.id, nombre: p.nombre, unidad: 'unidad',
      estado: actual <= 0 ? 'rojo' : 'amarillo',
      stock_actual: actual, punto_reorden: minimo,
      proveedor_sugerido: null, tiempo_entrega_dias: 0,
      cantidad_sugerida: sugerido,
      costo_unitario_actual: Number(p.costo_calculado || 0),
      costo_estimado: Math.round(sugerido * Number(p.costo_calculado || 0) * 100) / 100,
      ya_en_camino: enCamino ? enCamino.cantidad : 0,
      llega_aprox: enCamino ? enCamino.fecha : null
    });
  }
  return lista;
}

// Compra de un producto de reventa
async function comprarProducto(req, res) {
  const { producto_id, proveedor, cantidad, precio_unitario, notas, decision_costo } = req.body;
  const { data: producto, error: eGet } = await supabase.from('productos')
    .select('id, nombre, tipo, costo_calculado, activo').eq('id', producto_id).eq('empresa_id', req.empresa.id).maybeSingle();
  if (eGet || !producto) return res.status(404).json({ error: 'Producto no encontrado' });
  if (producto.tipo !== 'reventa') return res.status(400).json({ error: 'Solo se compran productos de reventa; los fabricados se producen' });

  const stock = await costoCompra.stockDeProducto(producto.id, req.empresa.id);
  const r = costoCompra.resolverCosto({
    costoActual: producto.costo_calculado, stockActual: stock,
    cantidad, precio: precio_unitario, decision: decision_costo
  });
  if (r.requiereDecision) return costoCompra.respuestaDecision(res, r.opciones, { articulo: producto.nombre });

  const dias = Math.max(0, Math.min(365, parseInt(req.body.dias_entrega, 10) || 0));
  const fechaEstimada = calcularFechaEstimada(dias);
  const { data: compra, error: eCompra } = await supabase.from('compras').insert({
    empresa_id: req.empresa.id, usuario_id: req.usuarioId,
    producto_id: producto.id,
    proveedor: proveedor.trim(),
    cantidad: Number(cantidad),
    precio_unitario: Number(precio_unitario),
    notas: (notas || '').trim() || null,
    estado: 'pendiente',
    fecha_estimada_llegada: fechaEstimada
  }).select().single();
  if (eCompra) throw new Error(eCompra.message);

  if (r.cambia) await costoCompra.aplicarCostoProducto({ productoId: producto.id, costo: r.costo, empresaId: req.empresa.id });

  let recibida = false;
  if (dias === 0) {
    await recibirCompra(compra.id, req.empresa.id);
    recibida = true;
  }
  res.status(201).json({
    ...compra, estado: recibida ? 'recibida' : compra.estado,
    costo_resultante: r.costo,
    mensaje: recibida ? 'Compra registrada. El stock ya se sumó.' : `Pedido registrado. Se espera que llegue el ${fechaEstimada}.`
  });
}

// POST /api/compras — registra el PEDIDO. El stock se suma cuando llega.
router.post('/', async (req, res, next) => {
  try {
    const { material_id, producto_id, proveedor, cantidad, precio_unitario, notas, decision_costo } = req.body;
    if (!material_id && !producto_id) return res.status(400).json({ error: 'Falta indicar qué se compra' });
    if (material_id && producto_id) return res.status(400).json({ error: 'Una compra es de un material o de un producto, no de ambos' });
    if (!proveedor || !proveedor.trim()) return res.status(400).json({ error: 'El proveedor es obligatorio' });
    if (!cantidad || isNaN(cantidad) || Number(cantidad) <= 0)
      return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    if (precio_unitario == null || isNaN(precio_unitario) || Number(precio_unitario) < 0)
      return res.status(400).json({ error: 'El precio unitario debe ser un número mayor o igual a 0' });

    if (producto_id) return await comprarProducto(req, res);

    const { data: material, error: eGet } = await supabase
      .from('materiales').select('*').eq('id', material_id).eq('empresa_id', req.empresa.id).single();
    if (eGet || !material) return res.status(404).json({ error: 'Material no encontrado' });

    const r = costoCompra.resolverCosto({
      costoActual: material.costo_unitario, stockActual: material.stock_actual,
      cantidad, precio: precio_unitario, decision: decision_costo
    });
    if (r.requiereDecision) return costoCompra.respuestaDecision(res, r.opciones, { articulo: material.nombre, unidad: material.unidad });

    const fechaEstimada = calcularFechaEstimada(material.tiempo_entrega_dias);

    const { data: compra, error: eCompra } = await supabase
      .from('compras')
      .insert({
        empresa_id: req.empresa.id, usuario_id: req.usuarioId,
        material_id,
        proveedor: proveedor.trim(),
        cantidad: Number(cantidad),
        precio_unitario: Number(precio_unitario),
        notas: (notas || '').trim() || null,
        estado: 'pendiente',
        fecha_estimada_llegada: fechaEstimada
      })
      .select().single();
    if (eCompra) throw new Error(eCompra.message);

    // La persona decidió qué costo queda; si cambia, se recalculan sus productos
    const productosRecalculados = r.cambia
      ? await costoCompra.aplicarCostoMaterial({ material, costo: r.costo, empresaId: req.empresa.id, usuarioId: req.usuarioId })
      : 0;

    res.status(201).json({
      ...compra,
      costo_resultante: r.costo,
      productos_recalculados: productosRecalculados,
      mensaje: `Pedido registrado. Se espera que llegue el ${fechaEstimada}. El stock se sumará automáticamente ese día, o puedes marcarlo como "Llegó" antes si llega primero.`
    });
  } catch (err) { next(err); }
});

// POST /api/compras/:id/recibir — confirma la llegada manualmente (llegó antes de lo previsto)
router.post('/:id/recibir', async (req, res, next) => {
  try {
    const compra = await recibirCompra(req.params.id, req.empresa.id);
    res.json({ ...compra, mensaje: 'Llegada confirmada. El stock ya se sumó.' });
  } catch (err) { next(err); }
});

// GET /api/compras/en-camino — pedidos hechos que aún no llegan
router.get('/en-camino', async (req, res, next) => {
  try {
    await procesarComprasVencidas(req.empresa.id); // pone al día los que ya se vencieron
    const { data, error } = await supabase
      .from('compras')
      .select(SELECT_ARTICULO)
      .eq('empresa_id', req.empresa.id)
      .eq('estado', 'pendiente')
      .order('fecha_estimada_llegada', { ascending: true });
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/compras/historial?proveedor=...&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
router.get('/historial', async (req, res, next) => {
  try {
    await procesarComprasVencidas(req.empresa.id);

    let consulta = supabase
      .from('compras')
      .select(SELECT_ARTICULO)
      .eq('empresa_id', req.empresa.id)
      .order('fecha', { ascending: false })
      .limit(200);

    if (req.query.proveedor) consulta = consulta.ilike('proveedor', `%${req.query.proveedor}%`);
    if (req.query.desde) consulta = consulta.gte('fecha', req.query.desde);
    if (req.query.hasta) consulta = consulta.lte('fecha', req.query.hasta + 'T23:59:59');

    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/compras/:id — cuerpo: { motivo }
// Si la compra ya estaba "recibida" (su cantidad ya se sumó al stock),
// se revierte esa cantidad automáticamente antes de borrarla, y queda
// un rastro en el historial de ajustes explicando por qué.
router.delete('/:id', async (req, res, next) => {
  try {
    const { motivo } = req.body;
    if (!motivo || !motivo.trim())
      return res.status(400).json({ error: 'Escribe el motivo de la eliminación (para trazabilidad)' });

    const { data: compra, error: eGet } = await supabase
      .from('compras').select('*').eq('id', req.params.id).eq('empresa_id', req.empresa.id).single();
    if (eGet || !compra) return res.status(404).json({ error: 'Compra no encontrada' });

    // Si ya sumó stock, se devuelve desde el historial de esa compra.
    // Compras viejas (antes del historial por operación): se resta su cantidad.
    let stockRevertido = false;
    if (compra.estado === 'recibida') {
      const motivoTexto = `Compra eliminada (${compra.cantidad} de ${compra.proveedor}): ${motivo.trim()}`;
      const r = await libro.revertirOrigen({
        empresaId: req.empresa.id, usuarioId: req.usuarioId,
        origenTabla: 'compras', origenId: compra.id, motivo: motivoTexto, permitirNegativo: !!req.body.forzar
      });
      let resultado = r;
      if (r.encontradas === 0) {
        resultado = await libro.aplicarOperacion({
          empresaId: req.empresa.id, usuarioId: req.usuarioId,
          tipo: 'ajuste', origenTabla: 'compras', origenId: compra.id, motivo: motivoTexto,
          clave: `compra-eliminada:${compra.id}`,
          movimientos: [compra.producto_id
            ? { producto_id: compra.producto_id, cantidad: -Number(compra.cantidad) }
            : { material_id: compra.material_id, cantidad: -Number(compra.cantidad) }],
          permitirNegativo: !!req.body.forzar, detalleForzado: { confirmado: true }
        });
      }
      if (!resultado.ok) {
        return res.status(409).json({
          error: compra.producto_id
            ? 'Eliminar esta compra dejaría el producto en negativo (ya se vendió parte de lo comprado)'
            : 'Eliminar esta compra dejaría el material en negativo (ya se usó parte de lo comprado)',
          faltantes: libro.faltantesLegibles(resultado.faltantes), puede_forzar: true
        });
      }
      stockRevertido = true;
    }

    const { error: eDel } = await supabase.from('compras').delete().eq('id', req.params.id).eq('empresa_id', req.empresa.id);
    if (eDel) throw new Error(eDel.message);

    res.json({ eliminado: true, stock_revertido: stockRevertido });
  } catch (err) { next(err); }
});

module.exports = router;
