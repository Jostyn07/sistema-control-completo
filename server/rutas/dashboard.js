// ============================================================
// MÓDULO — DASHBOARD ANALÍTICO  (/api/dashboard)
// Requiere sesión. Todo se filtra por req.usuarioId.
// Varios endpoints específicos, NO uno monolítico: si uno falla,
// los demás bloques de Inicio siguen funcionando (misma resiliencia
// que ya tenía Promise.all en inicio.js).
//
// - GET /ventas   KPIs de ventas del período + comparación con el
//                 período anterior equivalente. Primer endpoint del
//                 plan de evolución del dashboard (puntos 2, 3 y 4).
// - GET /inventario  KPIs de inventario (Valor, Materiales, Stock bajo,
//                 Agotados). No toca servicios/inventario.js: reutiliza
//                 obtenerInventarioMateriales() tal cual la usan hoy
//                 Inventario y Compras, y solo agrega el conteo encima.
// - GET /serie-ventas-utilidad  Serie temporal para el gráfico de
//                 líneas, agrupada por día/semana/mes según el
//                 tamaño del período (mismo periodo.js de siempre).
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { calcularRango, variacion } = require('../servicios/periodo');
const { obtenerInventarioMateriales } = require('../servicios/inventario');
const router = express.Router();

async function totalesDelRango(usuarioId, desde, hasta) {
  const { data, error } = await supabase
    .from('ventas')
    .select('total, costo_total')
    .eq('usuario_id', usuarioId)
    .gte('fecha', desde.toISOString())
    .lte('fecha', hasta.toISOString());
  if (error) throw new Error(error.message);

  const pedidos = (data || []).length;
  const ventasTotal = (data || []).reduce((s, v) => s + Number(v.total), 0);
  const costoTotal = (data || []).reduce((s, v) => s + Number(v.costo_total), 0);
  const margenBrutoPct = ventasTotal > 0
    ? Math.round(((ventasTotal - costoTotal) / ventasTotal) * 1000) / 10
    : null;
  const ticketPromedio = pedidos > 0 ? Math.round((ventasTotal / pedidos) * 100) / 100 : 0;

  return { pedidos, ventasTotal, costoTotal, margenBrutoPct, ticketPromedio };
}

// GET /api/dashboard/ventas?periodo=7d|30d|mes|3m|6m|1y  (o &desde=&hasta=)
router.get('/ventas', async (req, res, next) => {
  try {
    const rango = calcularRango(req.query);

    const [actual, anterior] = await Promise.all([
      totalesDelRango(req.usuarioId, rango.desde, rango.hasta),
      totalesDelRango(req.usuarioId, rango.desdeAnterior, rango.hastaAnterior)
    ]);

    res.json({
      periodo: {
        desde: rango.desde.toISOString(),
        hasta: rango.hasta.toISOString(),
        dias: rango.dias,
        agrupacion: rango.agrupacion
      },
      // Si el período anterior no tuvo ni un solo pedido, no hay con qué
      // comparar de verdad — mostrar "+100%" o "nuevo" en cada tarjeta no
      // aporta nada y además, con pocos datos, termina viéndose como una
      // copia de "Indicadores del mes" de abajo. El frontend usa esta
      // bandera para mostrar un estado vacío en su lugar.
      comparable: anterior.pedidos > 0,
      ventas: {
        valor: Math.round(actual.ventasTotal * 100) / 100,
        variacion: variacion(actual.ventasTotal, anterior.ventasTotal)
      },
      pedidos: {
        valor: actual.pedidos,
        variacion: variacion(actual.pedidos, anterior.pedidos)
      },
      ticket_promedio: {
        valor: actual.ticketPromedio,
        variacion: variacion(actual.ticketPromedio, anterior.ticketPromedio)
      },
      margen_bruto_pct: {
        valor: actual.margenBrutoPct,
        variacion: (actual.margenBrutoPct != null && anterior.margenBrutoPct != null)
          ? variacion(actual.margenBrutoPct, anterior.margenBrutoPct)
          : { pct: null, texto: 'sin datos suficientes' }
      }
    });
  } catch (err) { next(err); }
});

// GET /api/dashboard/inventario — foto del momento, no depende del
// selector de período (el valor de inventario es "ahora mismo", no
// tiene sentido compararlo contra un rango de fechas).
router.get('/inventario', async (req, res, next) => {
  try {
    const materiales = await obtenerInventarioMateriales(req.usuarioId);

    const valorInventario = materiales.reduce((s, m) => s + m.stock_actual * m.costo_unitario, 0);
    // "estado" ya lo calcula servicios/inventario.js igual que Inventario y
    // Compras (rojo/amarillo/verde). Agotado es un caso particular de rojo
    // (stock en 0) que ese servicio no separa — se distingue aquí, sin
    // tocar su lógica, para no arriesgar los otros dos módulos que la usan.
    const agotados = materiales.filter(m => m.stock_actual === 0);
    const stockBajo = materiales.filter(m => m.estado === 'rojo' && m.stock_actual > 0);

    res.json({
      valor_inventario: Math.round(valorInventario * 100) / 100,
      total_materiales: materiales.length,
      stock_bajo: stockBajo.length,
      agotados: agotados.length
    });
  } catch (err) { next(err); }
});

// Arma los "cajones" de fecha (día/semana/mes) que va a tener el
// gráfico, ANTES de mirar los datos — así un día/semana/mes sin
// ventas aparece con 0, no como un hueco en la gráfica (mismo
// principio del punto 17 del plan: nunca confundir "sin datos" con
// "cero real" en silencio).
function generarBuckets(desde, hasta, agrupacion) {
  const buckets = [];
  const formatoDia = { day: 'numeric', month: 'short' };

  if (agrupacion === 'dia') {
    const cursor = new Date(desde);
    while (cursor <= hasta) {
      const inicio = new Date(cursor); inicio.setHours(0, 0, 0, 0);
      const fin = new Date(cursor); fin.setHours(23, 59, 59, 999);
      buckets.push({ inicio, fin, etiqueta: inicio.toLocaleDateString('es-CO', formatoDia) });
      cursor.setDate(cursor.getDate() + 1);
    }
  } else if (agrupacion === 'semana') {
    const cursor = new Date(desde); cursor.setHours(0, 0, 0, 0);
    while (cursor <= hasta) {
      const inicio = new Date(cursor);
      let fin = new Date(cursor); fin.setDate(fin.getDate() + 6); fin.setHours(23, 59, 59, 999);
      if (fin > hasta) fin = new Date(hasta);
      buckets.push({ inicio, fin, etiqueta: `Sem. ${inicio.toLocaleDateString('es-CO', formatoDia)}` });
      cursor.setDate(cursor.getDate() + 7);
    }
  } else { // mes
    const cursor = new Date(desde.getFullYear(), desde.getMonth(), 1);
    while (cursor <= hasta) {
      const inicio = new Date(cursor);
      const finMes = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999);
      const fin = finMes > hasta ? new Date(hasta) : finMes;
      buckets.push({ inicio, fin, etiqueta: inicio.toLocaleDateString('es-CO', { month: 'short', year: '2-digit' }) });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }
  return buckets;
}

// GET /api/dashboard/serie-ventas-utilidad?periodo=...
router.get('/serie-ventas-utilidad', async (req, res, next) => {
  try {
    const rango = calcularRango(req.query);

    const { data, error } = await supabase
      .from('ventas')
      .select('total, costo_total, fecha')
      .eq('usuario_id', req.usuarioId)
      .gte('fecha', rango.desde.toISOString())
      .lte('fecha', rango.hasta.toISOString());
    if (error) throw new Error(error.message);

    const buckets = generarBuckets(rango.desde, rango.hasta, rango.agrupacion)
      .map(b => ({ ...b, ventas: 0, utilidad: 0 }));

    for (const v of (data || [])) {
      const fecha = new Date(v.fecha);
      const bucket = buckets.find(b => fecha >= b.inicio && fecha <= b.fin);
      if (bucket) {
        bucket.ventas += Number(v.total);
        bucket.utilidad += Number(v.total) - Number(v.costo_total);
      }
    }

    res.json({
      agrupacion: rango.agrupacion,
      puntos: buckets.map(b => ({
        etiqueta: b.etiqueta,
        ventas: Math.round(b.ventas * 100) / 100,
        utilidad: Math.round(b.utilidad * 100) / 100
      }))
    });
  } catch (err) { next(err); }
});

module.exports = router;