// ============================================================
// MÓDULO 6 — FINANZAS Y PUNTO DE EQUILIBRIO  (/api/finanzas)
// - GET  /resumen           ingresos, costos, utilidad, punto de
//                           equilibrio y ROI (fórmulas del documento)
// - GET  /costos-fijos      lista editable
// - POST /costos-fijos      agrega o edita un costo fijo mensual
// - DELETE /costos-fijos/:id
// - GET  /capital           capital invertido registrado
// - POST /capital           registra un aporte de capital
// - GET  /historico-mensual?meses=N   para el gráfico
//
// Fórmulas (del documento):
//   ingresos_mes        = Σ ventas del mes
//   costos_variables_mes= Σ costo congelado de cada venta del mes
//   utilidad_mes        = ingresos − costos variables − costos fijos
//   punto_equilibrio    = costos fijos ÷ margen de contribución ponderado
//                         (margen según el mix real de productos vendidos)
//   roi_acumulado       = utilidad acumulada desde el inicio ÷ capital invertido
//
// Decisión documentada: la utilidad acumulada resta los costos fijos
// mensuales por cada mes transcurrido desde la primera venta (inclusive).
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

async function obtenerCostosFijosMensuales() {
  const { data, error } = await supabase
    .from('costos_fijos').select('*').eq('activo', true).order('nombre');
  if (error) throw new Error(error.message);
  const total = (data || []).reduce((s, c) => s + Number(c.valor_mensual), 0);
  return { lista: data || [], total: Math.round(total * 100) / 100 };
}

// GET /api/finanzas/resumen
router.get('/resumen', async (req, res, next) => {
  try {
    const ahora = new Date();
    const desdeMes = inicioDeMes(ahora).toISOString();

    // Ventas del mes actual
    const { data: ventasMes, error: eMes } = await supabase
      .from('ventas').select('total, costo_total').gte('fecha', desdeMes);
    if (eMes) throw new Error(eMes.message);

    const ingresosMes = (ventasMes || []).reduce((s, v) => s + Number(v.total), 0);
    const costosVariablesMes = (ventasMes || []).reduce((s, v) => s + Number(v.costo_total), 0);

    // Costos fijos
    const costosFijos = await obtenerCostosFijosMensuales();

    // Utilidad del mes
    const utilidadMes = ingresosMes - costosVariablesMes - costosFijos.total;

    // Punto de equilibrio: costos fijos ÷ margen de contribución ponderado.
    // El margen ponderado sale del mix REAL de lo vendido este mes:
    //   (ingresos − costos variables) ÷ ingresos
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

    // ROI acumulado: utilidad acumulada desde el inicio ÷ capital invertido
    const { data: todasVentas, error: eTodas } = await supabase
      .from('ventas').select('total, costo_total, fecha').order('fecha', { ascending: true });
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
      .from('capital_invertido').select('valor');
    if (eCap) throw new Error(eCap.message);
    const capitalTotal = (capital || []).reduce((s, c) => s + Number(c.valor), 0);

    let roiAcumulado = null;
    let notaRoi = null;
    if (capitalTotal > 0) {
      roiAcumulado = Math.round((utilidadAcumulada / capitalTotal) * 1000) / 10; // en %
    } else {
      notaRoi = 'Registra el capital invertido para calcular el ROI.';
    }

    res.json({
      mes: claveMes(ahora),
      ingresos_mes: Math.round(ingresosMes * 100) / 100,
      costos_variables_mes: Math.round(costosVariablesMes * 100) / 100,
      costos_fijos_mes: costosFijos.total,
      utilidad_mes: Math.round(utilidadMes * 100) / 100,
      margen_contribucion_ponderado: margenContribucion != null ? Math.round(margenContribucion * 1000) / 10 : null, // en %
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
    const costos = await obtenerCostosFijosMensuales();
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

    const fila = { nombre: nombre.trim(), valor_mensual: Number(valor_mensual) };
    let resultado;
    if (id) {
      resultado = await supabase.from('costos_fijos').update(fila).eq('id', id).select().single();
    } else {
      resultado = await supabase.from('costos_fijos').insert(fila).select().single();
    }
    if (resultado.error) throw new Error(resultado.error.message);
    res.status(id ? 200 : 201).json(resultado.data);
  } catch (err) { next(err); }
});

// DELETE /api/finanzas/costos-fijos/:id — desactiva (conserva el histórico)
router.delete('/costos-fijos/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('costos_fijos').update({ activo: false }).eq('id', req.params.id);
    if (error) throw new Error(error.message);
    res.json({ desactivado: true });
  } catch (err) { next(err); }
});

// GET /api/finanzas/capital
router.get('/capital', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('capital_invertido').select('*').order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    const total = (data || []).reduce((s, c) => s + Number(c.valor), 0);
    res.json({ lista: data || [], total: Math.round(total * 100) / 100 });
  } catch (err) { next(err); }
});

// POST /api/finanzas/capital — cuerpo: { concepto, valor }
router.post('/capital', async (req, res, next) => {
  try {
    const { concepto, valor } = req.body;
    if (!concepto || !concepto.trim()) return res.status(400).json({ error: 'El concepto es obligatorio' });
    if (valor == null || isNaN(valor) || Number(valor) === 0)
      return res.status(400).json({ error: 'El valor debe ser un número distinto de 0' });

    const { data, error } = await supabase
      .from('capital_invertido')
      .insert({ concepto: concepto.trim(), valor: Number(valor) })
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// GET /api/finanzas/historico-mensual?meses=N (por defecto 6)
router.get('/historico-mensual', async (req, res, next) => {
  try {
    const meses = Math.min(24, Math.max(1, Number(req.query.meses || 6)));
    const ahora = new Date();
    const desde = new Date(ahora.getFullYear(), ahora.getMonth() - (meses - 1), 1);

    const { data: ventas, error } = await supabase
      .from('ventas')
      .select('total, costo_total, fecha')
      .gte('fecha', desde.toISOString());
    if (error) throw new Error(error.message);

    const costosFijos = await obtenerCostosFijosMensuales();

    // Arma los N meses aunque no tengan ventas (para que el gráfico no salte meses)
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
