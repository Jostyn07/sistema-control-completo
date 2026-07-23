// ============================================================
// SERVICIO DE SUSCRIPCIÓN — server/servicios/suscripcion.js
// - crearPruebaGratis()          se llama al registrarse
// - sincronizarEstadoSuscripcion() pone "vencida" si ya pasó la
//   fecha (revisión perezosa, mismo patrón que usamos con las
//   compras que llegan solas — no hace falta un proceso aparte)
// - tienePagoAceptadoPrevio()    decide si aplica el 50% del
//   primer mes (solo la primera vez que alguien paga de verdad)
// ============================================================
const supabase = require('../supabase/cliente');

const DIAS_PRUEBA_GRATIS = 7;
const DIAS_GRACIA = 3; // días de solo-lectura extra después de vencer, antes de bloquear la edición
const ESTADOS_ACEPTADOS = ['Aceptada', 'Aceptado'];

// Al registrarse, cualquier usuario nuevo arranca con el plan más
// completo disponible (para que pueda ver todo el valor del sistema
// durante la prueba), sin necesidad de pagar nada todavía.
async function crearPruebaGratis(usuarioId) {
  const { data: planPrueba, error: ePlan } = await supabase
    .from('planes_suscripcion')
    .select('id')
    .eq('activo', true)
    .order('precio_mensual', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (ePlan) throw new Error(ePlan.message);
  if (!planPrueba) {
    console.warn('[crearPruebaGratis] No hay ningún plan activo configurado; no se creó la prueba para', usuarioId);
    return;
  }

  const ahora = new Date();
  const vencimiento = new Date(ahora);
  vencimiento.setDate(vencimiento.getDate() + DIAS_PRUEBA_GRATIS);

  const { error } = await supabase.from('suscripciones').insert({
    usuario_id: usuarioId,
    plan_id: planPrueba.id,
    estado: 'prueba',
    fecha_inicio: ahora.toISOString(),
    fecha_vencimiento: vencimiento.toISOString()
  });
  if (error) throw new Error(error.message);
  console.log('[crearPruebaGratis] Prueba de 7 días creada para', usuarioId, 'con el plan', planPrueba.id);
}

// Si la prueba, el plan pagado, o una cancelación ya vencieron, lo marca
// como "vencida". Se llama cada vez que se consulta el estado, así
// siempre está al día sin depender de un proceso programado aparte.
// Incluye "cancelada" a propósito: cancelar solo significa "no renueves",
// pero una vez pasa la fecha ya pagada, debe tratarse igual que vencida.
async function sincronizarEstadoSuscripcion(usuarioId) {
  const { data, error } = await supabase
    .from('suscripciones').select('estado, fecha_vencimiento').eq('usuario_id', usuarioId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const vencida = data.fecha_vencimiento && new Date(data.fecha_vencimiento) < new Date();
  if (vencida && ['prueba', 'activa', 'cancelada'].includes(data.estado)) {
    const { error: eUpd } = await supabase
      .from('suscripciones')
      .update({ estado: 'vencida', actualizado_en: new Date().toISOString() })
      .eq('usuario_id', usuarioId);
    if (eUpd) throw new Error(eUpd.message);
    data.estado = 'vencida';
  }
  return data;
}

// Calcula si a una suscripción vencida ya se le acabó el período de
// gracia (solo-lectura) y debe bloquearse la edición. Lo usa tanto el
// middleware de bloqueo como la pantalla de Suscripción, para que
// ambos midan exactamente lo mismo.
function calcularBloqueo(sub) {
  if (!sub || sub.estado !== 'vencida') {
    return { vencida: false, enGracia: false, bloqueada: false, diasGraciaRestantes: null };
  }
  const diasVencida = sub.fecha_vencimiento
    ? (Date.now() - new Date(sub.fecha_vencimiento).getTime()) / 86400000
    : Infinity;
  const bloqueada = diasVencida >= DIAS_GRACIA;
  const diasGraciaRestantes = bloqueada ? 0 : Math.max(0, Math.ceil(DIAS_GRACIA - diasVencida));
  return { vencida: true, enGracia: !bloqueada, bloqueada, diasGraciaRestantes };
}

// ¿Ya pagó alguna vez de verdad? Si nunca ha tenido un pago aceptado,
// su primer pago real es elegible para el 50% de descuento.
async function tienePagoAceptadoPrevio(usuarioId) {
  const { count, error } = await supabase
    .from('pagos_suscripcion')
    .select('id', { count: 'exact', head: true })
    .eq('usuario_id', usuarioId)
    .in('estado', ESTADOS_ACEPTADOS);
  if (error) throw new Error(error.message);
  return (count || 0) > 0;
}

module.exports = {
  crearPruebaGratis,
  sincronizarEstadoSuscripcion,
  calcularBloqueo,
  tienePagoAceptadoPrevio,
  DIAS_PRUEBA_GRATIS,
  DIAS_GRACIA
};