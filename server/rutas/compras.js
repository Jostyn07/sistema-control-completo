// ============================================================
// MÓDULO 5 — COMPRAS  (/api/compras)
// Requiere sesión. Todo se filtra por req.usuarioId.
// - GET  /pendientes    materiales por debajo del punto de reorden
//                       (también muestra si ya hay un pedido en camino)
// - POST /              registra el PEDIDO — NO suma stock todavía;
//                       queda "pendiente" con fecha estimada de llegada
// - POST /:id/recibir   confirma la llegada manualmente y suma el stock
// - GET  /en-camino     pedidos hechos que aún no han llegado
// - GET  /historial     compras pasadas (con su estado) con filtros
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const servicioInventario = require('../servicios/inventario');
const { calcularFechaEstimada, recibirCompra, procesarComprasVencidas } = require('../servicios/compras');
const router = express.Router();

// GET /api/compras/pendientes
router.get('/pendientes', async (req, res, next) => {
  try {
    const inventario = await servicioInventario.obtenerInventarioMateriales(req.usuarioId);

    // Pedidos ya en camino, para no sugerir comprar algo que ya se pidió
    const { data: enCamino, error: eCamino } = await supabase
      .from('compras')
      .select('material_id, cantidad, fecha_estimada_llegada')
      .eq('usuario_id', req.usuarioId)
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

    res.json(pendientes);
  } catch (err) { next(err); }
});

// POST /api/compras — registra el PEDIDO. El stock se suma cuando llega.
router.post('/', async (req, res, next) => {
  try {
    const { material_id, proveedor, cantidad, precio_unitario, notas } = req.body;
    if (!material_id) return res.status(400).json({ error: 'Falta indicar el material' });
    if (!proveedor || !proveedor.trim()) return res.status(400).json({ error: 'El proveedor es obligatorio' });
    if (!cantidad || isNaN(cantidad) || Number(cantidad) <= 0)
      return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    if (precio_unitario == null || isNaN(precio_unitario) || Number(precio_unitario) < 0)
      return res.status(400).json({ error: 'El precio unitario debe ser un número mayor o igual a 0' });

    const { data: material, error: eGet } = await supabase
      .from('materiales').select('*').eq('id', material_id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !material) return res.status(404).json({ error: 'Material no encontrado' });

    const fechaEstimada = calcularFechaEstimada(material.tiempo_entrega_dias);

    const { data: compra, error: eCompra } = await supabase
      .from('compras')
      .insert({
        usuario_id: req.usuarioId,
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

    // El precio pagado se guarda en el historial de todas formas (es
    // información del costo, independiente de si ya llegó físicamente)
    const precioDiferente = Number(precio_unitario) !== Number(material.costo_unitario);
    if (precioDiferente) {
      const { error: eHist } = await supabase.from('materiales_historial_precio').insert({
        usuario_id: req.usuarioId,
        material_id,
        costo_anterior: material.costo_unitario,
        costo_nuevo: Number(precio_unitario),
        origen: 'compra'
      });
      if (eHist) throw new Error(eHist.message);
    }

    res.status(201).json({
      ...compra,
      mensaje: `Pedido registrado. Se espera que llegue el ${fechaEstimada}. El stock se sumará automáticamente ese día, o puedes marcarlo como "Llegó" antes si llega primero.`,
      precio_diferente: precioDiferente,
      sugerencia: precioDiferente
        ? `Pagaste un precio distinto al costo registrado (${material.costo_unitario}). Si este es el nuevo precio normal, actualízalo en la pestaña Materiales.`
        : null
    });
  } catch (err) { next(err); }
});

// POST /api/compras/:id/recibir — confirma la llegada manualmente (llegó antes de lo previsto)
router.post('/:id/recibir', async (req, res, next) => {
  try {
    const compra = await recibirCompra(req.params.id, req.usuarioId);
    res.json({ ...compra, mensaje: 'Llegada confirmada. El stock ya se sumó.' });
  } catch (err) { next(err); }
});

// GET /api/compras/en-camino — pedidos hechos que aún no llegan
router.get('/en-camino', async (req, res, next) => {
  try {
    await procesarComprasVencidas(req.usuarioId); // pone al día los que ya se vencieron
    const { data, error } = await supabase
      .from('compras')
      .select('*, materiales(nombre, unidad)')
      .eq('usuario_id', req.usuarioId)
      .eq('estado', 'pendiente')
      .order('fecha_estimada_llegada', { ascending: true });
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/compras/historial?proveedor=...&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
router.get('/historial', async (req, res, next) => {
  try {
    await procesarComprasVencidas(req.usuarioId);

    let consulta = supabase
      .from('compras')
      .select('*, materiales(nombre, unidad)')
      .eq('usuario_id', req.usuarioId)
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
      .from('compras').select('*').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !compra) return res.status(404).json({ error: 'Compra no encontrada' });

    let stockRevertido = false;
    if (compra.estado === 'recibida') {
      const { data: material, error: eMat } = await supabase
        .from('materiales').select('stock_actual, unidad').eq('id', compra.material_id).eq('usuario_id', req.usuarioId).single();
      if (eMat || !material) throw new Error('El material de esta compra ya no existe');

      const stockAnterior = Number(material.stock_actual);
      const stockNuevo = Math.max(0, Math.round((stockAnterior - Number(compra.cantidad)) * 100) / 100);

      const { error: eStock } = await supabase
        .from('materiales')
        .update({ stock_actual: stockNuevo, actualizado_en: new Date().toISOString() })
        .eq('id', compra.material_id)
        .eq('usuario_id', req.usuarioId);
      if (eStock) throw new Error(eStock.message);

      const { error: eAjuste } = await supabase.from('inventario_ajustes').insert({
        usuario_id: req.usuarioId,
        material_id: compra.material_id,
        stock_anterior: stockAnterior,
        stock_nuevo: stockNuevo,
        motivo: `Compra eliminada (${compra.cantidad} ${material.unidad} de ${compra.proveedor}): ${motivo.trim()}`,
        usuario: req.usuarioEmail || null
      });
      if (eAjuste) throw new Error(eAjuste.message);
      stockRevertido = true;
    }

    const { error: eDel } = await supabase.from('compras').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (eDel) throw new Error(eDel.message);

    res.json({ eliminado: true, stock_revertido: stockRevertido });
  } catch (err) { next(err); }
});

module.exports = router;