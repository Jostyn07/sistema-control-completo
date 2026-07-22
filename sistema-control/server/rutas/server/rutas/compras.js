// ============================================================
// MÓDULO 5 — COMPRAS  (/api/compras)
// - GET  /pendientes   cruza inventario vs punto de reorden y arma
//                      la lista sugerida (materiales en amarillo/rojo)
// - POST /             registra la compra, SUMA el stock del material
//                      y guarda el precio pagado en el historial de
//                      precios del material (origen: 'compra')
// - GET  /historial    compras pasadas con filtros proveedor/fecha
//
// Cantidad sugerida: lo necesario para quedar con el doble del punto
// de reorden (una cobertura cómoda sin inmovilizar capital de más):
//   sugerido = (punto_reorden × 2) − stock_actual   (mínimo 1)
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const servicioInventario = require('../servicios/inventario');
const router = express.Router();

// GET /api/compras/pendientes
router.get('/pendientes', async (req, res, next) => {
  try {
    const inventario = await servicioInventario.obtenerInventarioMateriales();

    const pendientes = inventario
      .filter(m => m.estado === 'rojo' || m.estado === 'amarillo')
      .map(m => {
        const objetivo = m.punto_reorden * 2;
        const sugerido = Math.max(1, Math.ceil(objetivo - m.stock_actual));
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
          costo_estimado: Math.round(sugerido * m.costo_unitario * 100) / 100
        };
      })
      // Rojo primero (lo urgente arriba)
      .sort((a, b) => (a.estado === 'rojo' ? 0 : 1) - (b.estado === 'rojo' ? 0 : 1));

    res.json(pendientes);
  } catch (err) { next(err); }
});

// POST /api/compras
// Cuerpo: { material_id, proveedor, cantidad, precio_unitario, notas? }
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
      .from('materiales').select('*').eq('id', material_id).single();
    if (eGet || !material) return res.status(404).json({ error: 'Material no encontrado' });

    // 1) Registrar la compra
    const { data: compra, error: eCompra } = await supabase
      .from('compras')
      .insert({
        material_id,
        proveedor: proveedor.trim(),
        cantidad: Number(cantidad),
        precio_unitario: Number(precio_unitario),
        notas: (notas || '').trim() || null
      })
      .select().single();
    if (eCompra) throw new Error(eCompra.message);

    // 2) Sumar el stock del material
    const nuevoStock = Math.round((Number(material.stock_actual) + Number(cantidad)) * 100) / 100;
    const { error: eStock } = await supabase
      .from('materiales')
      .update({ stock_actual: nuevoStock, actualizado_en: new Date().toISOString() })
      .eq('id', material_id);
    if (eStock) throw new Error(eStock.message);

    // 3) Guardar el precio pagado en el historial de precios del material
    const precioDiferente = Number(precio_unitario) !== Number(material.costo_unitario);
    if (precioDiferente) {
      const { error: eHist } = await supabase.from('materiales_historial_precio').insert({
        material_id,
        costo_anterior: material.costo_unitario,
        costo_nuevo: Number(precio_unitario),
        origen: 'compra'
      });
      if (eHist) throw new Error(eHist.message);
    }

    res.status(201).json({
      ...compra,
      stock_nuevo: nuevoStock,
      precio_diferente: precioDiferente,
      // El costo del material NO se cambia automáticamente: esa decisión
      // (y el recálculo de todos los productos) se hace conscientemente
      // desde la pestaña Materiales. Aquí solo se sugiere.
      sugerencia: precioDiferente
        ? `Pagaste un precio distinto al costo registrado (${material.costo_unitario}). Si este es el nuevo precio normal, actualízalo en la pestaña Materiales para que los costos de tus productos se recalculen.`
        : null
    });
  } catch (err) { next(err); }
});

// GET /api/compras/historial?proveedor=...&desde=YYYY-MM-DD&hasta=YYYY-MM-DD
router.get('/historial', async (req, res, next) => {
  try {
    let consulta = supabase
      .from('compras')
      .select('*, materiales(nombre, unidad)')
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

module.exports = router;
