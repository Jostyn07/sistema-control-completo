// ============================================================
// ACCESO A LA IA — server/servicios/ia/acceso.js
// - Solo planes con incluye_importacion_ia (Pro; también durante la
//   prueba gratis, que usa el plan más completo).
// - Límite mensual por empresa (IA_LIMITE_MES, por defecto 50).
// - Registra cada uso en ia_usos (tokens, para ver el costo).
// ============================================================
const { supabaseAdmin: supabase } = require('../../supabase/cliente');
const log = require('../../seguridad/log');

const LIMITE_MES = () => Math.max(1, Number(process.env.IA_LIMITE_MES || 50));

function errorAcceso(mensaje, status, extra = {}) {
  return Object.assign(new Error(mensaje), { status, ...extra });
}

async function verificarAcceso(empresaId) {
  const { data: sub, error } = await supabase
    .from('suscripciones')
    .select('estado, planes_suscripcion(nombre, incluye_importacion_ia)')
    .eq('empresa_id', empresaId).maybeSingle();
  if (error) throw new Error(error.message);
  const plan = sub && sub.planes_suscripcion;
  if (!sub || !['activa', 'prueba', 'cancelada'].includes(sub.estado) || !plan || !plan.incluye_importacion_ia) {
    throw errorAcceso('La importación con IA está disponible en el plan Pro.', 403, { requiere_plan: 'pro' });
  }

  const inicioMes = new Date(); inicioMes.setUTCDate(1); inicioMes.setUTCHours(0, 0, 0, 0);
  const { count, error: eCount } = await supabase
    .from('ia_usos').select('id', { count: 'exact', head: true })
    .eq('empresa_id', empresaId).gte('creado_en', inicioMes.toISOString());
  if (eCount) throw new Error(eCount.message);
  const usados = count || 0;
  if (usados >= LIMITE_MES()) {
    throw errorAcceso(`Ya usaste los ${LIMITE_MES()} análisis con IA de este mes. Se renuevan el día 1.`, 429);
  }
  return { usados, limite: LIMITE_MES() };
}

async function registrarUso({ empresaId, usuarioId, modulo, uso, exito }) {
  const { error } = await supabase.from('ia_usos').insert({
    empresa_id: empresaId, usuario_id: usuarioId, modulo,
    modelo: uso && uso.modelo, tokens_entrada: (uso && uso.tokensEntrada) || 0,
    tokens_salida: (uso && uso.tokensSalida) || 0, exito: !!exito
  });
  if (error) log.error('[ia_usos] No se pudo registrar el uso:', error);
}

module.exports = { verificarAcceso, registrarUso, LIMITE_MES };
