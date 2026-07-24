// ============================================================
// server/servicios/periodo.js — selector de período compartido
// Traduce ?periodo=7d|30d|mes|3m|6m|1y (o ?desde=&hasta=, rango
// personalizado) en un rango de fechas + su rango anterior
// equivalente, para que TODOS los endpoints de /api/dashboard
// usen exactamente la misma ventana temporal y el mismo criterio
// de comparación. Este archivo no es un endpoint: lo importan
// las rutas de server/rutas/dashboard.js.
// ============================================================

const PERIODOS_VALIDOS = ['7d', '30d', 'mes', '3m', '6m', '1y'];

function inicioDelDia(fecha) {
  const f = new Date(fecha);
  f.setHours(0, 0, 0, 0);
  return f;
}
function finDelDia(fecha) {
  const f = new Date(fecha);
  f.setHours(23, 59, 59, 999);
  return f;
}

// Calcula { desde, hasta, desdeAnterior, hastaAnterior, dias, agrupacion }
// a partir de req.query.periodo, o de req.query.desde/hasta (YYYY-MM-DD)
// si el usuario pidió un rango personalizado.
function calcularRango(query = {}) {
  const hoy = new Date();
  let desde;
  let hasta = finDelDia(hoy);

  if (query.desde && query.hasta) {
    desde = inicioDelDia(new Date(query.desde));
    hasta = finDelDia(new Date(query.hasta));
  } else {
    const periodo = PERIODOS_VALIDOS.includes(query.periodo) ? query.periodo : '30d';
    switch (periodo) {
      case '7d':
        desde = inicioDelDia(new Date(hoy));
        desde.setDate(desde.getDate() - 6);
        break;
      case 'mes':
        desde = new Date(hoy.getFullYear(), hoy.getMonth(), 1);
        break;
      case '3m':
        desde = new Date(hoy.getFullYear(), hoy.getMonth() - 2, 1);
        break;
      case '6m':
        desde = new Date(hoy.getFullYear(), hoy.getMonth() - 5, 1);
        break;
      case '1y':
        desde = new Date(hoy.getFullYear() - 1, hoy.getMonth(), 1);
        break;
      case '30d':
      default:
        desde = inicioDelDia(new Date(hoy));
        desde.setDate(desde.getDate() - 29);
        break;
    }
  }

  const duracionMs = hasta.getTime() - desde.getTime();
  // El rango anterior termina justo un instante antes de que empiece
  // el actual, y dura exactamente lo mismo — así "período anterior"
  // siempre es una comparación de igual longitud, sin importar el rango.
  const hastaAnterior = new Date(desde.getTime() - 1);
  const desdeAnterior = new Date(hastaAnterior.getTime() - duracionMs);

  const dias = Math.max(1, Math.round(duracionMs / 86400000));
  // Agrupación sugerida para series temporales: por día si el rango es
  // corto, por semana si es mediano, por mes si es largo — para no
  // graficar 365 puntos individuales en un rango de un año.
  let agrupacion = 'dia';
  if (dias > 90) agrupacion = 'mes';
  else if (dias > 31) agrupacion = 'semana';

  return { desde, hasta, desdeAnterior, hastaAnterior, dias, agrupacion };
}

// Variación porcentual entre dos números, con los casos borde resueltos
// de forma explícita (nunca Infinity ni NaN llegando al frontend).
function variacion(actual, anterior) {
  if (anterior === 0) {
    if (actual === 0) return { pct: 0, texto: 'sin cambios' };
    return { pct: null, texto: 'nuevo (sin datos del período anterior)' };
  }
  const pct = Math.round(((actual - anterior) / Math.abs(anterior)) * 1000) / 10;
  return { pct, texto: `${pct >= 0 ? '+' : ''}${pct}% vs período anterior` };
}

module.exports = { PERIODOS_VALIDOS, calcularRango, variacion };