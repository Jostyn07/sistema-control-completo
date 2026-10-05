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
  error: (etiqueta, detalle, contexto) => console.error(formatear('ERROR', etiqueta, detalle, contexto)),
  warn:  (etiqueta, detalle, contexto) => console.warn(formatear('AVISO', etiqueta, detalle, contexto)),
  info:  (etiqueta, detalle, contexto) => console.log(formatear('INFO', etiqueta, detalle, contexto))
};
