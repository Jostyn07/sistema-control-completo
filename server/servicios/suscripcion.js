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
  if (!planPrueba) return; // aún no hay planes configurados; no bloquea el registro

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
}

// Si la prueba o el plan pagado ya vencieron, lo marca como "vencida".
// Se llama cada vez que se consulta el estado, así siempre está al día
// sin depender de un proceso programado aparte.
async function sincronizarEstadoSuscripcion(usuarioId) {
  const { data, error } = await supabase
    .from('suscripciones').select('estado, fecha_vencimiento').eq('usuario_id', usuarioId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const vencida = data.fecha_vencimiento && new Date(data.fecha_vencimiento) < new Date();
  if (vencida && (data.estado === 'prueba' || data.estado === 'activa')) {
    const { error: eUpd } = await supabase
      .from('suscripciones')
      .update({ estado: 'vencida', actualizado_en: new Date().toISOString() })
      .eq('usuario_id', usuarioId);
    if (eUpd) throw new Error(eUpd.message);
    data.estado = 'vencida';
  }
  return data;
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
  tienePagoAceptadoPrevio,
  DIAS_PRUEBA_GRATIS
};