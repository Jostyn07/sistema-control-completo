// ============================================================
// MÓDULO 4 — VENTAS  (/api/ventas)
// - GET  /productos-disponibles  productos con capacidad producible actual
// - POST /                       registra la venta; descuenta materiales
//                                según ficha técnica; si falta stock avisa
//                                pero permite forzar (forzar: true)
// - GET  /                       historial con filtros (desde, hasta, estado)
// - PUT  /:id/estado             pendiente → en_produccion → listo → entregado
//
// Al confirmarse una venta:
// - Finanzas se alimenta sola (lee de estas mismas tablas, con el costo
//   congelado al momento de la venta).
// - La venta queda marcada como facturable (facturada = false) para que
//   el módulo 7 la ofrezca al generar factura electrónica.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const router = express.Router();

const ESTADOS_VALIDOS = ['pendiente', 'en_produccion', 'listo', 'entregado'];

// GET /api/ventas/productos-disponibles
// Productos activos con precio, costo actual y unidades fabricables ahora
// (para no vender algo que no se puede fabricar).
router.get('/productos-disponibles', async (req, res, next) => {
  try {
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, costo_calculado')
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
// Cuerpo: { cliente?, items: [{ producto_id, cantidad }], forzar?: boolean }
router.post('/', async (req, res, next) => {
  try {
    const { cliente, items, forzar } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
    for (const item of items) {
      if (!item.producto_id || !item.cantidad || Number(item.cantidad) <= 0)
        return res.status(400).json({ error: 'Cada producto de la venta necesita una cantidad mayor a 0' });
    }

    // Productos con precio y costo actuales (se congelan en la venta)
    const productoIds = items.map(i => i.producto_id);
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, costo_calculado, activo')
      .in('id', productoIds);
    if (eProd) throw new Error(eProd.message);
    const productoPorId = new Map((productos || []).map(p => [p.id, p]));
    for (const item of items) {
      const p = productoPorId.get(item.producto_id);
      if (!p) return res.status(404).json({ error: 'Uno de los productos ya no existe' });
      if (!p.activo) return res.status(400).json({ error: `"${p.nombre}" está desactivado y no se puede vender` });
    }

    // Materiales requeridos en total (sumando todas las fichas técnicas)
    const { data: fichas, error: eFichas } = await supabase
      .from('productos_materiales')
      .select('producto_id, material_id, cantidad, materiales(id, nombre, unidad, stock_actual)')
      .in('producto_id', productoIds);
    if (eFichas) throw new Error(eFichas.message);

    const requeridoPorMaterial = new Map(); // material_id -> { fila material, requerido }
    for (const item of items) {
      const filasDelProducto = (fichas || []).filter(f => f.producto_id === item.producto_id);
      for (const f of filasDelProducto) {
        const previo = requeridoPorMaterial.get(f.material_id) || { material: f.materiales, requerido: 0 };
        previo.requerido += Number(f.cantidad) * Number(item.cantidad);
        requeridoPorMaterial.set(f.material_id, previo);
      }
    }

    // Verificación de stock: si falta, avisa; solo procede con forzar: true
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

    // Totales congelados al momento de la venta
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

    // 1) Crear la venta
    const { data: venta, error: eVenta } = await supabase
      .from('ventas')
      .insert({ cliente: (cliente || '').trim() || null, total, costo_total: costoTotal, estado: 'pendiente' })
      .select().single();
    if (eVenta) throw new Error(eVenta.message);

    // 2) Items
    const { error: eItems } = await supabase
      .from('ventas_items')
      .insert(filasItems.map(f => ({ ...f, venta_id: venta.id })));
    if (eItems) throw new Error(eItems.message);

    // 3) Descontar inventario (si se forzó con faltantes, el stock queda en 0, nunca negativo)
    for (const [materialId, { material, requerido }] of requeridoPorMaterial) {
      const nuevoStock = Math.max(0, Math.round((Number(material.stock_actual) - requerido) * 100) / 100);
      const { error: eStock } = await supabase
        .from('materiales')
        .update({ stock_actual: nuevoStock, actualizado_en: new Date().toISOString() })
        .eq('id', materialId);
      if (eStock) throw new Error(eStock.message);
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
      .order('fecha', { ascending: false })
      .limit(200);

    if (req.query.desde) consulta = consulta.gte('fecha', req.query.desde);
    if (req.query.hasta) consulta = consulta.lte('fecha', req.query.hasta + 'T23:59:59');
    if (req.query.estado && ESTADOS_VALIDOS.includes(req.query.estado))
      consulta = consulta.eq('estado', req.query.estado);

    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id/estado — cuerpo: { estado }
router.put('/:id/estado', async (req, res, next) => {
  try {
    const { estado } = req.body;
    if (!ESTADOS_VALIDOS.includes(estado))
      return res.status(400).json({ error: `Estado inválido. Debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });

    const { data, error } = await supabase
      .from('ventas')
      .update({ estado })
      .eq('id', req.params.id)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;
