// ============================================================
// SERVICIO DE TELEMETRÍA — server/servicios/telemetria/index.js
// FASE 8. Junta los eventos de una petición y los envía en UN solo
// llamado al final (public.telemetria_registrar, solo service_role).
//
// - Empresa y usuario viajan como seudónimo: HMAC-SHA256 con la sal
//   TELEMETRIA_SAL (variable de entorno), recortado a 16 caracteres.
//   Sin la sal no se puede saber a qué empresa corresponde un hash.
// - Sin TELEMETRIA_SAL la telemetría queda apagada (no falla nada).
// - Nunca bloquea ni rompe una respuesta: cualquier error solo va al log.
// ============================================================
const crypto = require('node:crypto');
const { EVENTOS, filtrarPropiedades } = require('./catalogo');
const log = require('../../seguridad/log');

const SAL = process.env.TELEMETRIA_SAL || '';
const ACTIVA = SAL.length >= 16 && process.env.TELEMETRIA_ACTIVA !== 'false';
let avisado = false;

function seudonimo(id) {
  if (!id) return null;
  return crypto.createHmac('sha256', SAL).update(String(id)).digest('hex').slice(0, 16);
}

// Arma un evento limpio. Devuelve null si no está en el catálogo.
function construirEvento(nombre, { empresaId, usuarioId, rol, modulo, resultado, duracionMs, propiedades, origen } = {}) {
  if (!EVENTOS[nombre]) return null;
  return {
    nombre,
    empresa_hash: seudonimo(empresaId),
    usuario_hash: seudonimo(usuarioId),
    rol: rol || null,
    modulo: modulo && /^[a-z_-]{1,40}$/.test(modulo) ? modulo : null,
    resultado: resultado || null,
    duracion_ms: Number.isFinite(duracionMs) ? Math.max(0, Math.min(Math.round(duracionMs), 600000)) : null,
    propiedades: filtrarPropiedades(nombre, propiedades),
    origen: origen === 'navegador' ? 'navegador' : 'servidor'
  };
}

function enviar(eventos) {
  if (!ACTIVA) {
    if (!avisado) { log.info('[telemetria] Apagada: falta TELEMETRIA_SAL (mínimo 16 caracteres)'); avisado = true; }
    return;
  }
  const lote = (eventos || []).filter(Boolean).slice(0, 50);
  if (!lote.length) return;
  try {
    // Se requiere aquí para usar siempre el cliente base de service_role
    const { supabaseAdminBase } = require('../../supabase/cliente');
    Promise.resolve(supabaseAdminBase.rpc('telemetria_registrar', { p_eventos: lote }))
      .then(r => { if (r && r.error) log.warn('[telemetria] No se pudo registrar', r.error); })
      .catch(err => log.warn('[telemetria] No se pudo registrar', err));
  } catch (err) {
    log.warn('[telemetria] No se pudo registrar', err);
  }
}

module.exports = { construirEvento, enviar, seudonimo, estaActiva: () => ACTIVA };
