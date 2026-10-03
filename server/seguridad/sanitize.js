// ============================================================
// SANITIZACIÓN — server/seguridad/sanitize.js
// FASE 6. Todo texto u objeto que salga del servidor hacia un log,
// Sentry, telemetría o el propio cliente pasa por aquí primero.
// ============================================================
const { puedeSalirAExternos } = require('./pii');

const OCULTO = '[oculto]';

// Mensajes que delatan detalles internos de PostgreSQL / PostgREST.
// Si un error 500 trae uno de estos, al cliente le llega un mensaje
// genérico (con referencia) y el detalle solo queda en el log, limpio.
const PATRON_ERROR_INTERNO = new RegExp([
  'duplicate key', 'violates', 'constraint', 'relation ".*"', 'column ".*"', 'syntax error',
  'permission denied', 'row-level security', 'JWT', 'PGRST', 'invalid input syntax',
  'null value in column', 'foreign key', 'could not', 'does not exist', 'timeout',
  'ECONN', 'fetch failed', 'Failed to fetch', 'Key \\(', 'operator does not exist',
  'Supabase no está configurado', 'ENCRYPTION_KEY', 'SUPABASE_'
].join('|'), 'i');

function esErrorInterno(mensaje) {
  return PATRON_ERROR_INTERNO.test(String(mensaje || ''));
}

// Quita valores concretos de un texto: deja la forma del error, no los datos
function sanitizarTexto(texto) {
  if (texto == null) return texto;
  return String(texto)
    // PostgreSQL: Key (nit)=(900123456) already exists → Key (nit)=([oculto])
    .replace(/(Key \([^)]*\)=\()([^)]*)(\))/g, `$1${OCULTO}$3`)
    // Valores entre comillas en mensajes SQL: invalid input syntax for type uuid: "abc"
    .replace(/(:\s*)"[^"]{1,200}"/g, `$1"${OCULTO}"`)
    // Tokens JWT y llaves
    .replace(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[token]')
    .replace(/\b(sb_(?:secret|publishable)_[A-Za-z0-9_-]+|sk-[A-Za-z0-9_-]{10,})/g, '[llave]')
    // Correos
    .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[correo]')
    // Teléfonos, cédulas, NIT, tarjetas: secuencias de 6+ dígitos (con separadores)
    .replace(/\+?\d[\d\s.-]{5,}\d/g, '[número]')
    .slice(0, 500);
}

// Copia un objeto quitando cualquier campo clasificado como sensible
function sanitizarObjeto(valor, profundidad = 0) {
  if (valor == null || profundidad > 6) return valor;
  if (Array.isArray(valor)) return valor.slice(0, 20).map(v => sanitizarObjeto(v, profundidad + 1));
  if (valor instanceof Error) return { nombre: valor.name, mensaje: sanitizarTexto(valor.message), codigo: valor.code };
  if (typeof valor === 'object') {
    const limpio = {};
    for (const [clave, v] of Object.entries(valor)) {
      limpio[clave] = puedeSalirAExternos(clave) ? sanitizarObjeto(v, profundidad + 1) : OCULTO;
    }
    return limpio;
  }
  if (typeof valor === 'string') return sanitizarTexto(valor);
  return valor;
}

module.exports = { esErrorInterno, sanitizarTexto, sanitizarObjeto, OCULTO };
