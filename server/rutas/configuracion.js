// ============================================================
// CONFIGURACIÓN DE PRODUCCIÓN Y VENTAS  (/api/configuracion)
// - GET /produccion       precio de hora y meta de ventas actuales
// - PUT /produccion       actualiza el precio de hora y recalcula
//                         TODOS los productos (sin tocar la meta)
// - PUT /meta-ventas      actualiza la meta de ventas del mes
//                         (sin tocar el precio de hora)
// Ambas rutas hacen actualizaciones PARCIALES (nunca sobrescriben
// la fila completa), porque comparten la misma tabla de una sola
// fila por usuario — así cambiar una cosa nunca borra la otra.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { recalcularTodosLosProductos } = require('../servicios/costos');
const router = express.Router();

async function obtenerConfiguracion(usuarioId) {
  const { data, error } = await supabase
    .from('configuracion_produccion').select('*').eq('usuario_id', usuarioId).maybeSingle();
  if (error) throw new Error(error.message);
  return data; // null si el usuario todavía no ha guardado nada
}

// GET /api/configuracion/produccion
router.get('/produccion', async (req, res, next) => {
  try {
    const data = await obtenerConfiguracion(req.usuarioId);
    res.json(data || { costo_hora_mano_obra: 0, meta_ventas_mensual: null });
  } catch (err) { next(err); }
});

// PUT /api/configuracion/produccion — cuerpo: { costo_hora_mano_obra }
router.put('/produccion', async (req, res, next) => {
  try {
    const { costo_hora_mano_obra } = req.body;
    if (costo_hora_mano_obra == null || isNaN(costo_hora_mano_obra) || Number(costo_hora_mano_obra) < 0)
      return res.status(400).json({ error: 'El precio por hora debe ser un número mayor o igual a 0' });

    const existente = await obtenerConfiguracion(req.usuarioId);
    let resultado;
    if (existente) {
      resultado = await supabase
        .from('configuracion_produccion')
        .update({ costo_hora_mano_obra: Number(costo_hora_mano_obra), actualizado_en: new Date().toISOString() })
        .eq('usuario_id', req.usuarioId)
        .select().single();
    } else {
      resultado = await supabase
        .from('configuracion_produccion')
        .insert({ usuario_id: req.usuarioId, costo_hora_mano_obra: Number(costo_hora_mano_obra) })
        .select().single();
    }
    if (resultado.error) throw new Error(resultado.error.message);

    const productosRecalculados = await recalcularTodosLosProductos(req.usuarioId);
    res.json({ ...resultado.data, productos_recalculados: productosRecalculados });
  } catch (err) { next(err); }
});

// PUT /api/configuracion/meta-ventas — cuerpo: { meta_ventas_mensual }
router.put('/meta-ventas', async (req, res, next) => {
  try {
    const { meta_ventas_mensual } = req.body;
    if (meta_ventas_mensual == null || isNaN(meta_ventas_mensual) || Number(meta_ventas_mensual) < 0)
      return res.status(400).json({ error: 'La meta debe ser un número mayor o igual a 0' });

    const existente = await obtenerConfiguracion(req.usuarioId);
    let resultado;
    if (existente) {
      resultado = await supabase
        .from('configuracion_produccion')
        .update({ meta_ventas_mensual: Number(meta_ventas_mensual), actualizado_en: new Date().toISOString() })
        .eq('usuario_id', req.usuarioId)
        .select().single();
    } else {
      resultado = await supabase
        .from('configuracion_produccion')
        .insert({ usuario_id: req.usuarioId, meta_ventas_mensual: Number(meta_ventas_mensual) })
        .select().single();
    }
    if (resultado.error) throw new Error(resultado.error.message);
    res.json(resultado.data);
  } catch (err) { next(err); }
});

module.exports = router;