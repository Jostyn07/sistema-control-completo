// ============================================================
// MÓDULO 6 — FINANZAS Y PUNTO DE EQUILIBRIO  (/api/finanzas)
// Requiere sesión. Todo se filtra por req.usuarioId.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const router = express.Router();

function inicioDeMes(fecha) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
}
function claveMes(fecha) {
  const f = new Date(fecha);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
}

async function obtenerCostosFijosMensuales(usuarioId) {
  const { data, error } = await supabase
    .from('costos_fijos').select('*').eq('usuario_id', usuarioId).eq('activo', true).order('nombre');
  if (error) throw new Error(error.message);
  const total = (data || []).reduce((s, c) => s + Number(c.valor_mensual), 0);
  return { lista: data || [], total: Math.round(total * 100) / 100 };
}

// GET /api/finanzas/resumen
router.get('/resumen', async (req, res, next) => {
  try {
    const ahora = new Date();
    const desdeMes = inicioDeMes(ahora).toISOString();

    const { data: ventasMes, error: eMes } = await supabase
      .from('ventas').select('total, costo_total').eq('usuario_id', req.usuarioId).gte('fecha', desdeMes);
    if (eMes) throw new Error(eMes.message);

    const ingresosMes = (ventasMes || []).reduce((s, v) => s + Number(v.total), 0);
    const costosVariablesMes = (ventasMes || []).reduce((s, v) => s + Number(v.costo_total), 0);

    const costosFijos = await obtenerCostosFijosMensuales(req.usuarioId);
    const utilidadMes = ingresosMes - costosVariablesMes - costosFijos.total;

    let puntoEquilibrio = null;
    let margenContribucion = null;
    let notaEquilibrio = null;
    if (ingresosMes > 0) {
      margenContribucion = (ingresosMes - costosVariablesMes) / ingresosMes;
      if (margenContribucion > 0) {
        puntoEquilibrio = Math.round((costosFijos.total / margenContribucion) * 100) / 100;
      } else {
        notaEquilibrio = 'El mix vendido este mes no deja margen de contribución positivo: se vende por debajo del costo variable.';
      }
    } else {
      notaEquilibrio = 'Aún no hay ventas este mes; el punto de equilibrio se calcula con el mix real de lo vendido.';
    }

    const { data: todasVentas, error: eTodas } = await supabase
      .from('ventas').select('total, costo_total, fecha').eq('usuario_id', req.usuarioId).order('fecha', { ascending: true });
    if (eTodas) throw new Error(eTodas.message);

    let utilidadAcumulada = 0;
    let mesesTranscurridos = 0;
    if (todasVentas && todasVentas.length > 0) {
      const margenAcumulado = todasVentas.reduce((s, v) => s + (Number(v.total) - Number(v.costo_total)), 0);
      const primera = inicioDeMes(new Date(todasVentas[0].fecha));
      const actual = inicioDeMes(ahora);
      mesesTranscurridos = (actual.getFullYear() - primera.getFullYear()) * 12
                         + (actual.getMonth() - primera.getMonth()) + 1;
      utilidadAcumulada = margenAcumulado - costosFijos.total * mesesTranscurridos;
    }

    const { data: capital, error: eCap } = await supabase
      .from('capital_invertido').select('valor').eq('usuario_id', req.usuarioId);
    if (eCap) throw new Error(eCap.message);
    const capitalTotal = (capital || []).reduce((s, c) => s + Number(c.valor), 0);

    let roiAcumulado = null;
    let notaRoi = null;
    if (capitalTotal > 0) {
      roiAcumulado = Math.round((utilidadAcumulada / capitalTotal) * 1000) / 10;
    } else {
      notaRoi = 'Registra el capital invertido para calcular el ROI.';
    }

    res.json({
      mes: claveMes(ahora),
      ingresos_mes: Math.round(ingresosMes * 100) / 100,
      costos_variables_mes: Math.round(costosVariablesMes * 100) / 100,
      costos_fijos_mes: costosFijos.total,
      utilidad_mes: Math.round(utilidadMes * 100) / 100,
      margen_contribucion_ponderado: margenContribucion != null ? Math.round(margenContribucion * 1000) / 10 : null,
      punto_equilibrio: puntoEquilibrio,
      falta_para_equilibrio: puntoEquilibrio != null ? Math.max(0, Math.round((puntoEquilibrio - ingresosMes) * 100) / 100) : null,
      nota_equilibrio: notaEquilibrio,
      utilidad_acumulada: Math.round(utilidadAcumulada * 100) / 100,
      meses_operando: mesesTranscurridos,
      capital_invertido: Math.round(capitalTotal * 100) / 100,
      roi_acumulado: roiAcumulado,
      nota_roi: notaRoi,
      ventas_del_mes: (ventasMes || []).length
    });
  } catch (err) { next(err); }
});

// GET /api/finanzas/costos-fijos
router.get('/costos-fijos', async (req, res, next) => {
  try {
    const costos = await obtenerCostosFijosMensuales(req.usuarioId);
    res.json(costos);
  } catch (err) { next(err); }
});

// POST /api/finanzas/costos-fijos — cuerpo: { id?, nombre, valor_mensual }
router.post('/costos-fijos', async (req, res, next) => {
  try {
    const { id, nombre, valor_mensual } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del costo es obligatorio' });
    if (valor_mensual == null || isNaN(valor_mensual) || Number(valor_mensual) < 0)
      return res.status(400).json({ error: 'El valor mensual debe ser un número mayor o igual a 0' });

    let resultado;
    if (id) {
      resultado = await supabase
        .from('costos_fijos')
        .update({ nombre: nombre.trim(), valor_mensual: Number(valor_mensual) })
        .eq('id', id)
        .eq('usuario_id', req.usuarioId)
        .select().single();
    } else {
      resultado = await supabase
        .from('costos_fijos')
        .insert({ usuario_id: req.usuarioId, nombre: nombre.trim(), valor_mensual: Number(valor_mensual) })
        .select().single();
    }
    if (resultado.error) throw new Error(resultado.error.message);
    res.status(id ? 200 : 201).json(resultado.data);
  } catch (err) { next(err); }
});

// DELETE /api/finanzas/costos-fijos/:id
router.delete('/costos-fijos/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('costos_fijos').update({ activo: false }).eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);
    res.json({ desactivado: true });
  } catch (err) { next(err); }
});

// GET /api/finanzas/capital
router.get('/capital', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('capital_invertido').select('*').eq('usuario_id', req.usuarioId).order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    const total = (data || []).reduce((s, c) => s + Number(c.valor), 0);
    res.json({ lista: data || [], total: Math.round(total * 100) / 100 });
  } catch (err) { next(err); }
});

// POST /api/finanzas/capital
router.post('/capital', async (req, res, next) => {
  try {
    const { concepto, valor } = req.body;
    if (!concepto || !concepto.trim()) return res.status(400).json({ error: 'El concepto es obligatorio' });
    if (valor == null || isNaN(valor) || Number(valor) === 0)
      return res.status(400).json({ error: 'El valor debe ser un número distinto de 0' });

    const { data, error } = await supabase
      .from('capital_invertido')
      .insert({ usuario_id: req.usuarioId, concepto: concepto.trim(), valor: Number(valor) })
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// GET /api/finanzas/historico-mensual?meses=N
router.get('/historico-mensual', async (req, res, next) => {
  try {
    const meses = Math.min(24, Math.max(1, Number(req.query.meses || 6)));
    const ahora = new Date();
    const desde = new Date(ahora.getFullYear(), ahora.getMonth() - (meses - 1), 1);

    const { data: ventas, error } = await supabase
      .from('ventas')
      .select('total, costo_total, fecha')
      .eq('usuario_id', req.usuarioId)
      .gte('fecha', desde.toISOString());
    if (error) throw new Error(error.message);

    const costosFijos = await obtenerCostosFijosMensuales(req.usuarioId);

    const historico = [];
    for (let i = meses - 1; i >= 0; i--) {
      const mesFecha = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      const clave = claveMes(mesFecha);
      const ventasDelMes = (ventas || []).filter(v => claveMes(v.fecha) === clave);
      const ingresos = ventasDelMes.reduce((s, v) => s + Number(v.total), 0);
      const variables = ventasDelMes.reduce((s, v) => s + Number(v.costo_total), 0);
      historico.push({
        mes: clave,
        ingresos: Math.round(ingresos * 100) / 100,
        costos_variables: Math.round(variables * 100) / 100,
        costos_fijos: costosFijos.total,
        costos_totales: Math.round((variables + costosFijos.total) * 100) / 100,
        utilidad: Math.round((ingresos - variables - costosFijos.total) * 100) / 100
      });
    }

    res.json(historico);
  } catch (err) { next(err); }
});

module.exports = router;