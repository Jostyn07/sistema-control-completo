// ============================================================
// LOG SEGURO — server/seguridad/log.js
// FASE 6. Reemplaza console.error/console.warn en el servidor: todo
// lo que se registra pasa por sanitize.js. Nunca registra req.body,
// headers ni filas completas. Formato de una línea, fácil de buscar
// en los logs de Vercel.
// ============================================================
const { sanitizarTexto, sanitizarObjeto } = require('./sanitize');

function formatear(nivel, etiqueta, detalle, contexto) {
  const partes = [`[${nivel}]`, etiqueta];
  if (detalle instanceof Error) partes.push(sanitizarTexto(detalle.message));
  else if (detalle && typeof detalle === 'object') partes.push(sanitizarTexto(detalle.message || JSON.stringify(sanitizarObjeto(detalle))));
  else if (detalle != null) partes.push(sanitizarTexto(detalle));
  if (contexto) partes.push(JSON.stringify(sanitizarObjeto(contexto)));
  return partes.join(' ');
}

module.exports = {
  error: (etiqueta, detalle, contexto) => {
    const linea = formatear('ERROR', etiqueta, detalle, contexto);
    console.error(linea);
    // Los errores de la API ya los reporta el manejador (solo los 5xx);
    // el resto de errores internos también va a Sentry, ya limpio.
    if (etiqueta !== '[API]') {
      try { require('../servicios/sentry').capturarErrorInterno(etiqueta, linea.slice(`[ERROR] ${etiqueta} `.length)); } catch (_) { /* nunca falla */ }
    }
  },
  warn:  (etiqueta, detalle, contexto) => console.warn(formatear('AVISO', etiqueta, detalle, contexto)),
  info:  (etiqueta, detalle, contexto) => console.log(formatear('INFO', etiqueta, detalle, contexto))
};
