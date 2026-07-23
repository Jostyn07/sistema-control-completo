// ============================================================
// CONFIGURACIÓN DE PRODUCCIÓN  (/api/configuracion)
// - GET /produccion   precio de hora actual
// - PUT /produccion   lo actualiza y recalcula TODOS los productos
//                     (así el cambio se refleja en todas las fichas
//                     técnicas de inmediato, sin tocarlas una por una)
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { recalcularTodosLosProductos } = require('../servicios/costos');
const router = express.Router();

// GET /api/configuracion/produccion
router.get('/produccion', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('configuracion_produccion')
      .select('*')
      .eq('usuario_id', req.usuarioId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    res.json(data || { costo_hora_mano_obra: 0 });
  } catch (err) { next(err); }
});

// PUT /api/configuracion/produccion — cuerpo: { costo_hora_mano_obra }
router.put('/produccion', async (req, res, next) => {
  try {
    const { costo_hora_mano_obra } = req.body;
    if (costo_hora_mano_obra == null || isNaN(costo_hora_mano_obra) || Number(costo_hora_mano_obra) < 0)
      return res.status(400).json({ error: 'El precio por hora debe ser un número mayor o igual a 0' });

    const { data, error } = await supabase
      .from('configuracion_produccion')
      .upsert({
        usuario_id: req.usuarioId,
        costo_hora_mano_obra: Number(costo_hora_mano_obra),
        actualizado_en: new Date().toISOString()
      })
      .select().single();
    if (error) throw new Error(error.message);

    const productosRecalculados = await recalcularTodosLosProductos(req.usuarioId);
    res.json({ ...data, productos_recalculados: productosRecalculados });
  } catch (err) { next(err); }
});

module.exports = router;