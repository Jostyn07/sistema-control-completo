// ============================================================
// MÓDULO 3 — INVENTARIO EN TIEMPO REAL  (/api/inventario)
// Requiere sesión. Todo se filtra por req.usuarioId.
// - GET  /materiales   stock, punto de reorden y estado (semáforo)
// - GET  /capacidad    cuántas unidades de cada producto se pueden
//                      fabricar ahora + cuál material es el limitante
// - POST /ajuste       ajuste manual tras un conteo físico (motivo obligatorio)
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const servicioInventario = require('../servicios/inventario');
const router = express.Router();

// GET /api/inventario/materiales
router.get('/materiales', async (req, res, next) => {
  try {
    const inventario = await servicioInventario.obtenerInventarioMateriales(req.usuarioId);
    res.json(inventario);
  } catch (err) { next(err); }
});

// GET /api/inventario/capacidad
router.get('/capacidad', async (req, res, next) => {
  try {
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, foto_url, precio_venta')
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .order('nombre');
    if (eProd) throw new Error(eProd.message);

    if (!productos || productos.length === 0) return res.json([]);

    const { data: fichas, error: eFichas } = await supabase
      .from('productos_materiales')
      .select('producto_id, cantidad, materiales(id, nombre, unidad, stock_actual)')
      .in('producto_id', productos.map(p => p.id));
    if (eFichas) throw new Error(eFichas.message);

    const fichasPorProducto = new Map();
    for (const fila of fichas || []) {
      if (!fichasPorProducto.has(fila.producto_id)) fichasPorProducto.set(fila.producto_id, []);
      fichasPorProducto.get(fila.producto_id).push(fila);
    }

    const resultado = productos.map(p => {
      const filas = fichasPorProducto.get(p.id) || [];
      if (filas.length === 0) {
        return { ...p, unidades_fabricables: 0, material_limitante: null,
                 detalle: 'Este producto no tiene materiales en su ficha técnica' };
      }
      let minimo = Infinity;
      let limitante = null;
      for (const fila of filas) {
        const posibles = Math.floor(Number(fila.materiales.stock_actual) / Number(fila.cantidad));
        if (posibles < minimo) {
          minimo = posibles;
          limitante = {
            material_id: fila.materiales.id,
            nombre: fila.materiales.nombre,
            unidad: fila.materiales.unidad,
            stock_actual: Number(fila.materiales.stock_actual),
            cantidad_por_unidad: Number(fila.cantidad)
          };
        }
      }
      return { ...p, unidades_fabricables: minimo === Infinity ? 0 : minimo, material_limitante: limitante };
    });

    res.json(resultado);
  } catch (err) { next(err); }
});

// POST /api/inventario/ajuste
router.post('/ajuste', async (req, res, next) => {
  try {
    const { material_id, cantidad_nueva, motivo } = req.body;
    if (!material_id) return res.status(400).json({ error: 'Falta indicar el material' });
    if (cantidad_nueva == null || isNaN(cantidad_nueva) || Number(cantidad_nueva) < 0)
      return res.status(400).json({ error: 'La cantidad nueva debe ser un número mayor o igual a 0' });
    if (!motivo || !motivo.trim())
      return res.status(400).json({ error: 'El motivo del ajuste es obligatorio (para trazabilidad)' });

    const { data: material, error: eGet } = await supabase
      .from('materiales').select('id, stock_actual').eq('id', material_id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !material) return res.status(404).json({ error: 'Material no encontrado' });

    const { error: eAjuste } = await supabase.from('inventario_ajustes').insert({
      usuario_id: req.usuarioId,
      material_id,
      stock_anterior: material.stock_actual,
      stock_nuevo: Number(cantidad_nueva),
      motivo: motivo.trim(),
      usuario: req.usuarioEmail || null
    });
    if (eAjuste) throw new Error(eAjuste.message);

    const { data: actualizado, error: eUpd } = await supabase
      .from('materiales')
      .update({ stock_actual: Number(cantidad_nueva), actualizado_en: new Date().toISOString() })
      .eq('id', material_id)
      .eq('usuario_id', req.usuarioId)
      .select().single();
    if (eUpd) throw new Error(eUpd.message);

    res.json({ ajustado: true, stock_anterior: Number(material.stock_actual), stock_nuevo: Number(actualizado.stock_actual) });
  } catch (err) { next(err); }
});

// GET /api/inventario/ajustes — historial de ajustes manuales
router.get('/ajustes', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('inventario_ajustes')
      .select('*, materiales(nombre, unidad)')
      .eq('usuario_id', req.usuarioId)
      .order('fecha', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;