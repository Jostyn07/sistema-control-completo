// ============================================================
// API DE CONVERSIONES DE META (Conversions API / CAPI)
// Envía eventos a Meta desde el servidor, para que no se pierdan por
// bloqueadores de anuncios o restricciones del navegador (Safari, iOS).
//
// Funciona JUNTO con el pixel del navegador (public/js/meta-pixel.js):
// ambos mandan el mismo event_id y Meta cuenta el evento una sola vez.
//
// Variables de entorno:
//   META_PIXEL_ID         ID del pixel (el mismo de meta-pixel.js)
//   META_CAPI_TOKEN       token de acceso generado en el Administrador
//                         de eventos → Configuración → API de conversiones
//   META_TEST_EVENT_CODE  (opcional) código de "Probar eventos"; quitarlo
//                         en producción
//   APP_URL               (opcional) ej. https://fincil.cloud
//
// Nunca lanza errores: si Meta falla o no está configurado, solo lo
// registra en consola — un problema de analítica jamás debe romper un
// registro ni la activación de un pago.
// ============================================================
const crypto = require('crypto');

const VERSION_API = 'v21.0';
const TIEMPO_MAXIMO_MS = 4000;

function hash(valor) {
  if (!valor) return undefined;
  const limpio = String(valor).trim().toLowerCase();
  if (!limpio) return undefined;
  return crypto.createHash('sha256').update(limpio).digest('hex');
}

function leerCookie(req, nombre) {
  const cookies = req?.headers?.cookie;
  if (!cookies) return undefined;
  const par = cookies.split(';').map(c => c.trim()).find(c => c.startsWith(nombre + '='));
  return par ? decodeURIComponent(par.slice(nombre.length + 1)) : undefined;
}

// Extrae del request lo que ayuda a Meta a reconocer a la persona:
// IP, navegador y las cookies _fbp/_fbc que crea el pixel.
function datosDelNavegador(req) {
  if (!req) return {};
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '')
    .split(',')[0].trim() || undefined;
  return {
    ip,
    userAgent: req.headers['user-agent'],
    fbp: leerCookie(req, '_fbp'),
    fbc: leerCookie(req, '_fbc'),
    url: req.headers.referer
  };
}

/**
 * @param {object} p
 * @param {string} p.evento      'Subscribe', 'CompleteRegistration', ...
 * @param {string} p.eventId     igual al eventID que manda el navegador
 * @param {string} [p.email]
 * @param {string} [p.nombre]
 * @param {string} [p.usuarioId] se envía como external_id (hasheado)
 * @param {object} [p.req]       request de Express, si el evento nace de una acción del navegador
 * @param {object} [p.datos]     custom_data (value, currency, content_name...)
 */
async function enviarEventoMeta({ evento, eventId, email, nombre, usuarioId, req, datos }) {
  const pixelId = process.env.META_PIXEL_ID;
  const token = process.env.META_CAPI_TOKEN;
  if (!pixelId || !token) return; // no configurado: se omite en silencio

  try {
    const nav = datosDelNavegador(req);
    const [primerNombre, ...resto] = String(nombre || '').trim().split(/\s+/);

    const userData = {
      em: email ? [hash(email)] : undefined,
      fn: primerNombre ? [hash(primerNombre)] : undefined,
      ln: resto.length ? [hash(resto.join(' '))] : undefined,
      external_id: usuarioId ? [hash(usuarioId)] : undefined,
      country: [hash('co')],
      client_ip_address: nav.ip,
      client_user_agent: nav.userAgent,
      fbp: nav.fbp,
      fbc: nav.fbc
    };
    Object.keys(userData).forEach(k => userData[k] === undefined && delete userData[k]);

    const cuerpo = {
      data: [{
        event_name: evento,
        event_time: Math.floor(Date.now() / 1000),
        event_id: eventId,
        action_source: 'website',
        event_source_url: nav.url || process.env.APP_URL || undefined,
        user_data: userData,
        custom_data: datos || {}
      }]
    };
    if (process.env.META_TEST_EVENT_CODE) cuerpo.test_event_code = process.env.META_TEST_EVENT_CODE;

    const controlador = new AbortController();
    const temporizador = setTimeout(() => controlador.abort(), TIEMPO_MAXIMO_MS);
    const respuesta = await fetch(
      `https://graph.facebook.com/${VERSION_API}/${pixelId}/events?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cuerpo),
        signal: controlador.signal
      }
    ).finally(() => clearTimeout(temporizador));

    if (!respuesta.ok) {
      const detalle = await respuesta.text().catch(() => '');
      console.error(`[Meta CAPI] ${evento} rechazado (${respuesta.status}):`, detalle.slice(0, 500));
    }
  } catch (err) {
    console.error(`[Meta CAPI] No se pudo enviar ${evento}:`, err.message);
  }
}

// Atajo para el evento de suscripción pagada. Se llama tanto desde
// /confirmar-pago como desde el webhook de Wompi: como ambos usan el
// mismo event_id (sub_<id transacción>), Meta lo cuenta una sola vez.
async function enviarSuscripcionMeta({ transaccion, plan, usuarioId, email, nombre, req }) {
  await enviarEventoMeta({
    evento: 'Subscribe',
    eventId: 'sub_' + transaccion.id,
    email: email || transaccion.customer_email,
    nombre,
    usuarioId,
    req,
    datos: {
      value: Math.round(Number(transaccion.amount_in_cents) / 100),
      currency: transaccion.currency || 'COP',
      content_ids: plan?.id ? [plan.id] : undefined,
      content_name: plan?.nombre,
      content_type: 'product',
      order_id: transaccion.id
    }
  });
}

module.exports = { enviarEventoMeta, enviarSuscripcionMeta };