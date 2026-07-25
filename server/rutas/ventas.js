// ============================================================
// MÓDULO 4 — VENTAS  (/api/ventas)
// Requiere sesión. Todo se filtra por req.usuarioId.
// - GET  /productos-disponibles  productos con capacidad producible actual
// - POST /                       registra la venta; descuenta materiales
// - GET  /                       historial con filtros (desde, hasta, estado)
// - PUT  /:id/estado             pendiente → en_produccion → listo → entregado
// - PUT  /:id/pago                confirmar/desconfirmar pago — independiente
//                                 del estado de entrega
// - PUT  /:id                     editar datos de contacto/fecha (NUNCA
//                                 productos/cantidades, para no arriesgar
//                                 la consistencia del inventario)
// - DELETE /:id                   elimina y revierte el stock consumido;
//                                 bloqueada si la venta ya está facturada
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { cifrar, descifrar } = require('../servicios/cifrado');
const router = express.Router();

const ESTADOS_VALIDOS = ['pendiente', 'en_produccion', 'listo', 'entregado'];

// GET /api/ventas/productos-disponibles
router.get('/productos-disponibles', async (req, res, next) => {
  try {
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, costo_calculado')
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .order('nombre');
    if (eProd) throw new Error(eProd.message);
    if (!productos || productos.length === 0) return res.json([]);

    const { data: fichas, error: eFichas } = await supabase
      .from('productos_materiales')
      .select('producto_id, cantidad, materiales(stock_actual)')
      .in('producto_id', productos.map(p => p.id));
    if (eFichas) throw new Error(eFichas.message);

    const fichasPorProducto = new Map();
    for (const f of fichas || []) {
      if (!fichasPorProducto.has(f.producto_id)) fichasPorProducto.set(f.producto_id, []);
      fichasPorProducto.get(f.producto_id).push(f);
    }

    res.json(productos.map(p => {
      const filas = fichasPorProducto.get(p.id) || [];
      let fabricables = 0;
      if (filas.length > 0) {
        fabricables = Math.min(...filas.map(f =>
          Math.floor(Number(f.materiales.stock_actual) / Number(f.cantidad))));
      }
      return { ...p, unidades_fabricables: fabricables };
    }));
  } catch (err) { next(err); }
});

// POST /api/ventas
router.post('/', async (req, res, next) => {
  try {
    const { cliente, cliente_telefono, cliente_cedula, fecha_entrega, items, forzar } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
    for (const item of items) {
      if (!item.producto_id || !item.cantidad || Number(item.cantidad) <= 0)
        return res.status(400).json({ error: 'Cada producto de la venta necesita una cantidad mayor a 0' });
    }

    const productoIds = items.map(i => i.producto_id);
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, costo_calculado, activo')
      .eq('usuario_id', req.usuarioId)
      .in('id', productoIds);
    if (eProd) throw new Error(eProd.message);
    const productoPorId = new Map((productos || []).map(p => [p.id, p]));
    for (const item of items) {
      const p = productoPorId.get(item.producto_id);
      if (!p) return res.status(404).json({ error: 'Uno de los productos ya no existe o no te pertenece' });
      if (!p.activo) return res.status(400).json({ error: `"${p.nombre}" está desactivado y no se puede vender` });
    }

    const { data: fichas, error: eFichas } = await supabase
      .from('productos_materiales')
      .select('producto_id, material_id, cantidad, materiales(id, nombre, unidad, stock_actual)')
      .in('producto_id', productoIds);
    if (eFichas) throw new Error(eFichas.message);

    const requeridoPorMaterial = new Map();
    for (const item of items) {
      const filasDelProducto = (fichas || []).filter(f => f.producto_id === item.producto_id);
      for (const f of filasDelProducto) {
        const previo = requeridoPorMaterial.get(f.material_id) || { material: f.materiales, requerido: 0 };
        previo.requerido += Number(f.cantidad) * Number(item.cantidad);
        requeridoPorMaterial.set(f.material_id, previo);
      }
    }

    const faltantes = [];
    for (const { material, requerido } of requeridoPorMaterial.values()) {
      if (Number(material.stock_actual) < requerido) {
        faltantes.push({
          material: material.nombre,
          unidad: material.unidad,
          stock_actual: Number(material.stock_actual),
          requerido: Math.round(requerido * 100) / 100
        });
      }
    }
    if (faltantes.length > 0 && !forzar) {
      return res.status(409).json({
        error: 'No hay material suficiente para esta venta',
        faltantes,
        puede_forzar: true,
        mensaje: 'Puedes forzar el registro (por ejemplo, si el conteo del sistema está desactualizado) y luego corregir con un ajuste de inventario.'
      });
    }

    let total = 0, costoTotal = 0;
    const filasItems = items.map(item => {
      const p = productoPorId.get(item.producto_id);
      const cantidad = Number(item.cantidad);
      total += Number(p.precio_venta) * cantidad;
      costoTotal += Number(p.costo_calculado) * cantidad;
      return {
        producto_id: item.producto_id,
        cantidad,
        precio_unitario: Number(p.precio_venta),
        costo_unitario: Number(p.costo_calculado)
      };
    });
    total = Math.round(total * 100) / 100;
    costoTotal = Math.round(costoTotal * 100) / 100;

    const { data: venta, error: eVenta } = await supabase
      .from('ventas')
      .insert({
        usuario_id: req.usuarioId,
        cliente: (cliente || '').trim() || null,
        cliente_telefono_cifrado: cifrar(cliente_telefono),
        cliente_cedula_cifrada: cifrar(cliente_cedula),
        fecha_entrega: fecha_entrega || null,
        total, costo_total: costoTotal, estado: 'pendiente'
      })
      .select().single();
    if (eVenta) throw new Error(eVenta.message);

    const { error: eItems } = await supabase
      .from('ventas_items')
      .insert(filasItems.map(f => ({ ...f, venta_id: venta.id })));
    if (eItems) throw new Error(eItems.message);

    for (const [materialId, { material, requerido }] of requeridoPorMaterial) {
      const stockAnterior = Number(material.stock_actual);
      const nuevoStock = Math.max(0, Math.round((stockAnterior - requerido) * 100) / 100);
      const { error: eStock } = await supabase
        .from('materiales')
        .update({ stock_actual: nuevoStock, actualizado_en: new Date().toISOString() })
        .eq('id', materialId)
        .eq('usuario_id', req.usuarioId);
      if (eStock) throw new Error(eStock.message);

      // Bitácora (Fase 2 del plan de dashboard) — si esto falla, no se
      // revierte la venta ni el stock: la bitácora es "buena, no
      // perfecta", como quedó documentado en el plan.
      const { error: eMov } = await supabase.from('inventario_movimientos').insert({
        usuario_id: req.usuarioId,
        material_id: materialId,
        tipo: 'venta',
        cantidad: -requerido,
        stock_anterior: stockAnterior,
        stock_nuevo: nuevoStock,
        referencia_id: venta.id
      });
      if (eMov) console.error('[inventario_movimientos] No se pudo registrar el movimiento de venta:', eMov.message);
    }

    res.status(201).json({
      ...venta,
      forzada: faltantes.length > 0,
      faltantes: faltantes.length > 0 ? faltantes : undefined,
      facturable: true
    });
  } catch (err) { next(err); }
});

// GET /api/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&estado=...
router.get('/', async (req, res, next) => {
  try {
    let consulta = supabase
      .from('ventas')
      .select('*, ventas_items(cantidad, precio_unitario, costo_unitario, productos(nombre))')
      .eq('usuario_id', req.usuarioId)
      .order('fecha', { ascending: false })
      .limit(200);

    if (req.query.desde) consulta = consulta.gte('fecha', req.query.desde);
    if (req.query.hasta) consulta = consulta.lte('fecha', req.query.hasta + 'T23:59:59');
    if (req.query.estado && ESTADOS_VALIDOS.includes(req.query.estado))
      consulta = consulta.eq('estado', req.query.estado);

    const { data, error } = await consulta;
    if (error) throw new Error(error.message);

    // Se descifra solo aquí, en el momento de responder al usuario dueño
    // de estos datos (la ruta ya exige sesión y filtra por usuario_id).
    const conDatosDescifrados = (data || []).map(v => ({
      ...v,
      cliente_telefono: descifrar(v.cliente_telefono_cifrado),
      cliente_cedula: descifrar(v.cliente_cedula_cifrada),
      cliente_telefono_cifrado: undefined,
      cliente_cedula_cifrada: undefined
    }));
    res.json(conDatosDescifrados);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id/estado
router.put('/:id/estado', async (req, res, next) => {
  try {
    const { estado } = req.body;
    if (!ESTADOS_VALIDOS.includes(estado))
      return res.status(400).json({ error: `Estado inválido. Debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });

    const { data, error } = await supabase
      .from('ventas')
      .update({ estado })
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id/pago — cuerpo: { pagado: boolean }
// Independiente del estado de entrega — se puede marcar como pagado en
// cualquier punto de la secuencia pendiente/en_produccion/listo/entregado.
router.put('/:id/pago', async (req, res, next) => {
  try {
    const { pagado } = req.body;
    if (typeof pagado !== 'boolean')
      return res.status(400).json({ error: '"pagado" debe ser true o false' });

    const { data, error } = await supabase
      .from('ventas')
      .update({ pagado, fecha_pago: pagado ? new Date().toISOString() : null })
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id/fecha-entrega — cuerpo: { fecha_entrega } (null para quitarla)
router.put('/:id/fecha-entrega', async (req, res, next) => {
  try {
    const { fecha_entrega } = req.body;
    const { data, error } = await supabase
      .from('ventas')
      .update({ fecha_entrega: fecha_entrega || null })
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id — editar SOLO datos de contacto y fecha de entrega.
// A propósito NO se pueden editar productos/cantidades acá: cambiar los
// items de una venta ya registrada obligaría a recalcular y revertir
// consumo de materiales de forma segura, que es justo lo que hace
// DELETE + una venta nueva. Mantenerlos separados evita inconsistencias
// silenciosas en el inventario.
router.put('/:id', async (req, res, next) => {
  try {
    const { cliente, cliente_telefono, cliente_cedula, fecha_entrega } = req.body;

    const cambios = {};
    if (cliente !== undefined) cambios.cliente = (cliente || '').trim() || null;
    if (cliente_telefono !== undefined) cambios.cliente_telefono_cifrado = cifrar(cliente_telefono);
    if (cliente_cedula !== undefined) cambios.cliente_cedula_cifrada = cifrar(cliente_cedula);
    if (fecha_entrega !== undefined) cambios.fecha_entrega = fecha_entrega || null;

    if (Object.keys(cambios).length === 0)
      return res.status(400).json({ error: 'No se mandó ningún campo para editar' });

    const { data, error } = await supabase
      .from('ventas')
      .update(cambios)
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });

    res.json({
      ...data,
      cliente_telefono: descifrar(data.cliente_telefono_cifrado),
      cliente_cedula: descifrar(data.cliente_cedula_cifrada),
      cliente_telefono_cifrado: undefined,
      cliente_cedula_cifrada: undefined
    });
  } catch (err) { next(err); }
});

// DELETE /api/ventas/:id — cuerpo: { motivo }
// Revierte el stock que la venta había consumido (recalculado con la
// ficha técnica actual de cada producto — misma limitación que ya
// existe hoy en Compras) y registra el reverso en inventario_ajustes
// e inventario_movimientos. Bloqueada si la venta ya está facturada:
// borrar una venta con factura generada es un problema legal, no solo
// de inventario.
router.delete('/:id', async (req, res, next) => {
  try {
    const { motivo } = req.body;
    if (!motivo || !motivo.trim())
      return res.status(400).json({ error: 'Escribe el motivo de la eliminación (para trazabilidad)' });

    const { data: venta, error: eGet } = await supabase
      .from('ventas').select('*, ventas_items(producto_id, cantidad)')
      .eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !venta) return res.status(404).json({ error: 'Venta no encontrada' });
    if (venta.facturada)
      return res.status(400).json({ error: 'Esta venta ya tiene factura generada — no se puede eliminar. Si necesitas anularla, hazlo desde Facturación.' });

    const productoIds = (venta.ventas_items || []).map(i => i.producto_id);
    const { data: fichas, error: eFichas } = await supabase
      .from('productos_materiales')
      .select('producto_id, material_id, cantidad, materiales(stock_actual)')
      .in('producto_id', productoIds.length ? productoIds : ['00000000-0000-0000-0000-000000000000']);
    if (eFichas) throw new Error(eFichas.message);

    const requeridoPorMaterial = new Map();
    for (const item of (venta.ventas_items || [])) {
      const filasDelProducto = (fichas || []).filter(f => f.producto_id === item.producto_id);
      for (const f of filasDelProducto) {
        const previo = requeridoPorMaterial.get(f.material_id) || { stockActual: Number(f.materiales.stock_actual), requerido: 0 };
        previo.requerido += Number(f.cantidad) * Number(item.cantidad);
        requeridoPorMaterial.set(f.material_id, previo);
      }
    }

    for (const [materialId, { stockActual, requerido }] of requeridoPorMaterial) {
      const stockNuevo = Math.round((stockActual + requerido) * 100) / 100;
      const { error: eStock } = await supabase
        .from('materiales')
        .update({ stock_actual: stockNuevo, actualizado_en: new Date().toISOString() })
        .eq('id', materialId).eq('usuario_id', req.usuarioId);
      if (eStock) throw new Error(eStock.message);

      await supabase.from('inventario_ajustes').insert({
        usuario_id: req.usuarioId,
        material_id: materialId,
        stock_anterior: stockActual,
        stock_nuevo: stockNuevo,
        motivo: `Venta eliminada (${venta.cliente || 'sin cliente'}): ${motivo.trim()}`,
        usuario: req.usuarioEmail || null
      });
      await supabase.from('inventario_movimientos').insert({
        usuario_id: req.usuarioId,
        material_id: materialId,
        tipo: 'ajuste',
        cantidad: requerido,
        stock_anterior: stockActual,
        stock_nuevo: stockNuevo,
        referencia_id: venta.id
      });
    }

    const { error: eDel } = await supabase
      .from('ventas').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (eDel) throw new Error(eDel.message);

    res.json({ eliminada: true, stock_revertido: requeridoPorMaterial.size > 0 });
  } catch (err) { next(err); }
});

// GET /api/ventas/por-entregar — pedidos con fecha de entrega, aún no entregados,
// ordenados por fecha (los más urgentes primero). Lo usa también el dashboard.
router.get('/por-entregar', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('ventas')
      .select('id, cliente, fecha_entrega, estado, total, ventas_items(cantidad, productos(nombre))')
      .eq('usuario_id', req.usuarioId)
      .neq('estado', 'entregado')
      .not('fecha_entrega', 'is', null)
      .order('fecha_entrega', { ascending: true });
    if (error) throw new Error(error.message);

    const hoy = new Date().toISOString().slice(0, 10);
    const conUrgencia = (data || []).map(v => ({
      ...v,
      vencido: v.fecha_entrega < hoy,
      es_hoy: v.fecha_entrega === hoy
    }));
    res.json(conUrgencia);
  } catch (err) { next(err); }
});

module.exports = router;