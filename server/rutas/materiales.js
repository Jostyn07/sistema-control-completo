// ============================================================
// MÓDULO 1 — MATERIALES  (/api/materiales)
// Requiere sesión (ver server/middleware/auth.js). Cada consulta
// se filtra por req.usuarioId, y cada creación guarda ese dueño.
// - GET    /                    lista con stock actual (solo del usuario)
// - POST   /                    crear material
// - PUT    /:id                 editar; si cambia el costo: guarda historial
//                               y recalcula el costo de los productos que lo usan
// - DELETE /:id                 eliminar solo si ninguna ficha técnica lo usa
// - GET    /:id/historial-precio
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const router = express.Router();

// Campos obligatorios y sus validaciones básicas
function validarMaterial(datos) {
  const errores = [];
  if (!datos.nombre || !datos.nombre.trim()) errores.push('El nombre es obligatorio');
  if (!datos.unidad || !datos.unidad.trim()) errores.push('La unidad es obligatoria');
  if (datos.costo_unitario == null || isNaN(datos.costo_unitario) || Number(datos.costo_unitario) < 0)
    errores.push('El costo unitario debe ser un número mayor o igual a 0');
  if (!datos.proveedor || !datos.proveedor.trim()) errores.push('El proveedor es obligatorio');
  if (datos.tiempo_entrega_dias != null && (isNaN(datos.tiempo_entrega_dias) || Number(datos.tiempo_entrega_dias) < 0))
    errores.push('El tiempo de entrega debe ser un número de días válido');
  return errores;
}

// Recalcula costo_calculado de los productos (del mismo usuario) que usan un material.
// Costo producto = suma(cantidad × costo material) + minutos × costo_minuto_mano_obra
async function recalcularProductosQueUsan(materialId, usuarioId) {
  const { data: filas, error: e1 } = await supabase
    .from('productos_materiales')
    .select('producto_id, productos!inner(usuario_id)')
    .eq('material_id', materialId)
    .eq('productos.usuario_id', usuarioId);
  if (e1) throw new Error(e1.message);
  const productoIds = [...new Set((filas || []).map(f => f.producto_id))];
  if (productoIds.length === 0) return 0;

  for (const productoId of productoIds) {
    const { data: producto, error: e2 } = await supabase
      .from('productos')
      .select('id, minutos_fabricacion, costo_minuto_mano_obra')
      .eq('id', productoId)
      .eq('usuario_id', usuarioId)
      .single();
    if (e2) throw new Error(e2.message);

    const { data: mats, error: e3 } = await supabase
      .from('productos_materiales')
      .select('cantidad, materiales(costo_unitario)')
      .eq('producto_id', productoId);
    if (e3) throw new Error(e3.message);

    const costoMateriales = (mats || []).reduce(
      (suma, m) => suma + Number(m.cantidad) * Number(m.materiales.costo_unitario), 0);
    const costoManoObra = Number(producto.minutos_fabricacion) * Number(producto.costo_minuto_mano_obra);
    const costoTotal = Math.round((costoMateriales + costoManoObra) * 100) / 100;

    const { error: e4 } = await supabase
      .from('productos')
      .update({ costo_calculado: costoTotal, actualizado_en: new Date().toISOString() })
      .eq('id', productoId)
      .eq('usuario_id', usuarioId);
    if (e4) throw new Error(e4.message);
  }
  return productoIds.length;
}

// GET /api/materiales — solo los del usuario que hace la petición
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('materiales')
      .select('*')
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .order('nombre');
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/materiales — crear, asignado al usuario de la sesión
router.post('/', async (req, res, next) => {
  try {
    const errores = validarMaterial(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const nuevo = {
      usuario_id: req.usuarioId,
      nombre: req.body.nombre.trim(),
      unidad: req.body.unidad.trim(),
      costo_unitario: Number(req.body.costo_unitario),
      proveedor: req.body.proveedor.trim(),
      tiempo_entrega_dias: Number(req.body.tiempo_entrega_dias || 1),
      stock_actual: Number(req.body.stock_actual || 0),
      stock_seguridad: Number(req.body.stock_seguridad || 0)
    };
    const { data, error } = await supabase.from('materiales').insert(nuevo).select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PUT /api/materiales/:id — editar (con historial y recálculo si cambia el costo)
router.put('/:id', async (req, res, next) => {
  try {
    const errores = validarMaterial(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const { data: actual, error: eGet } = await supabase
      .from('materiales').select('*').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !actual) return res.status(404).json({ error: 'Material no encontrado' });

    const costoNuevo = Number(req.body.costo_unitario);
    const costoCambio = Number(actual.costo_unitario) !== costoNuevo;

    const cambios = {
      nombre: req.body.nombre.trim(),
      unidad: req.body.unidad.trim(),
      costo_unitario: costoNuevo,
      proveedor: req.body.proveedor.trim(),
      tiempo_entrega_dias: Number(req.body.tiempo_entrega_dias || actual.tiempo_entrega_dias),
      stock_seguridad: Number(req.body.stock_seguridad ?? actual.stock_seguridad),
      actualizado_en: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('materiales').update(cambios).eq('id', req.params.id).eq('usuario_id', req.usuarioId).select().single();
    if (error) throw new Error(error.message);

    let productosRecalculados = 0;
    if (costoCambio) {
      const { error: eHist } = await supabase.from('materiales_historial_precio').insert({
        usuario_id: req.usuarioId,
        material_id: req.params.id,
        costo_anterior: actual.costo_unitario,
        costo_nuevo: costoNuevo,
        origen: 'edicion'
      });
      if (eHist) throw new Error(eHist.message);
      productosRecalculados = await recalcularProductosQueUsan(req.params.id, req.usuarioId);
    }

    res.json({ ...data, productos_recalculados: productosRecalculados });
  } catch (err) { next(err); }
});

// DELETE /api/materiales/:id — solo si no está en ninguna ficha técnica ni tiene compras registradas
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: material, error: eGet } = await supabase
      .from('materiales').select('id').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !material) return res.status(404).json({ error: 'Material no encontrado' });

    const { count, error: eRef } = await supabase
      .from('productos_materiales')
      .select('id', { count: 'exact', head: true })
      .eq('material_id', req.params.id);
    if (eRef) throw new Error(eRef.message);

    if (count > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: este material está en ${count} ficha(s) técnica(s). Quítalo de esos productos primero.`
      });
    }

    // También hay que revisar compras: si ya se compró este material alguna
    // vez, borrarlo dejaría ese historial de compras sin material asociado
    // (la base de datos lo bloquea con una restricción de llave foránea).
    const { count: countCompras, error: eCompras } = await supabase
      .from('compras')
      .select('id', { count: 'exact', head: true })
      .eq('material_id', req.params.id);
    if (eCompras) throw new Error(eCompras.message);

    if (countCompras > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: este material tiene ${countCompras} compra(s) registradas en su historial. En vez de eliminarlo, puedes dejarlo en 0 de stock o cambiarle el nombre a "(descontinuado)".`
      });
    }

    const { error } = await supabase.from('materiales').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);
    res.json({ eliminado: true });
  } catch (err) { next(err); }
});

// GET /api/materiales/:id/historial-precio
router.get('/:id/historial-precio', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('materiales_historial_precio')
      .select('*')
      .eq('material_id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;