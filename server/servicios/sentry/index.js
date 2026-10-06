// ============================================================
// SENTRY — server/servicios/sentry/index.js
// FASE 9. Errores y rendimiento investigables SIN datos de clientes.
//
// Qué recibe Sentry:
//   - tipo de error, stack, mensaje SANITIZADO (sanitize.js)
//   - contexto técnico: entorno, versión, módulo, patrón de ruta
//     (/api/ventas/:id), método, código, rol, referencia del error
//   - empresa como SEUDÓNIMO (el mismo hash de la telemetría)
// Qué NUNCA recibe:
//   - body, query, cookies, headers (incluido Authorization)
//   - correos, IP, nombres, NIT, cédulas, teléfonos, montos
//   - URLs de Supabase con filtros (?nombre=ilike.Queso…)
// Sin SENTRY_DSN todo esto queda apagado y la app funciona igual.
// ============================================================
const { sanitizarTexto, sanitizarObjeto } = require('../../seguridad/sanitize');

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

let Sentry = null;
let activo = false;

// /api/ventas/9f2...?x=1 → /api/ventas/:id   (sin query ni IDs)
function limpiarUrl(url) {
  if (!url || typeof url !== 'string') return url;
  let sinQuery = url.split('?')[0].split('#')[0];
  try {
    const u = new URL(sinQuery);
    sinQuery = `${u.protocol}//${u.host}${u.pathname}`;
  } catch (_) { /* era una ruta relativa */ }
  return sinQuery.replace(UUID, ':id').replace(/\/\d{4,}(?=\/|$)/g, '/:n');
}

function limpiarEvento(evento) {
  if (!evento) return evento;

  if (evento.request) {
    evento.request = {
      method: evento.request.method,
      url: limpiarUrl(evento.request.url)
    };
  }

  // Usuario: solo el seudónimo de la empresa (lo pone capturarErrorApi)
  if (evento.user) evento.user = evento.user.id ? { id: String(evento.user.id).slice(0, 16) } : undefined;

  if (evento.message) evento.message = sanitizarTexto(evento.message);
  if (evento.logentry && evento.logentry.message) evento.logentry.message = sanitizarTexto(evento.logentry.message);

  for (const ex of (evento.exception && evento.exception.values) || []) {
    if (ex.value) ex.value = sanitizarTexto(ex.value);
    for (const marco of (ex.stacktrace && ex.stacktrace.frames) || []) {
      delete marco.vars;          // variables locales: podrían tener datos
      delete marco.pre_context;
      delete marco.context_line;
      delete marco.post_context;
    }
  }

  evento.breadcrumbs = (evento.breadcrumbs || []).map(limpiarMigaja).filter(Boolean).slice(-30);
  if (evento.extra) evento.extra = sanitizarObjeto(evento.extra);
  if (evento.contexts) {
    const { trace, runtime, os, app, device } = evento.contexts;
    evento.contexts = { trace, runtime, os, app, device };   // fuera "response", "cloud_resource" con datos, etc.
  }
  delete evento.server_name;   // nombre de la máquina
  return evento;
}

function limpiarMigaja(migaja) {
  if (!migaja) return null;
  const limpia = { type: migaja.type, category: migaja.category, level: migaja.level, timestamp: migaja.timestamp };
  if (migaja.message) limpia.message = sanitizarTexto(migaja.message);
  if (migaja.data) {
    limpia.data = {};
    if (migaja.data.url) limpia.data.url = limpiarUrl(migaja.data.url);
    if (migaja.data.method) limpia.data.method = migaja.data.method;
    if (migaja.data.status_code) limpia.data.status_code = migaja.data.status_code;
  }
  return limpia;
}

function limpiarTransaccion(evento) {
  if (!evento) return evento;
  if (evento.transaction) evento.transaction = limpiarUrl(evento.transaction);
  if (evento.request) evento.request = { method: evento.request.method, url: limpiarUrl(evento.request.url) };
  delete evento.user;
  delete evento.server_name;
  for (const span of evento.spans || []) {
    if (span.description) span.description = limpiarUrl(span.description.replace(/^(\w+)\s+/, '$1 ')).slice(0, 200);
    if (span.data) {
      const { 'http.method': metodo, 'http.response.status_code': estado, 'http.request.method': metodo2 } = span.data;
      span.data = { 'http.method': metodo || metodo2, 'http.response.status_code': estado };
    }
  }
  evento.breadcrumbs = (evento.breadcrumbs || []).map(limpiarMigaja).filter(Boolean).slice(-30);
  return evento;
}

function iniciar() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn || activo) return activo;
  try {
    Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'local',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      sendDefaultPii: false,                          // sin IP, cookies ni usuario automático
      tracesSampleRate: Math.min(Math.max(Number(process.env.SENTRY_TRAZAS || 0.1), 0), 1),
      maxBreadcrumbs: 30,
      beforeSend: limpiarEvento,
      beforeSendTransaction: limpiarTransaccion,
      beforeBreadcrumb: limpiarMigaja
    });
    activo = true;
  } catch (err) {
    console.error('[sentry] No se pudo iniciar:', err.message);
  }
  return activo;
}

// Error 5xx de la API (lo llama el manejador de errores de index.js)
async function capturarErrorApi(err, req, referencia) {
  if (!activo) return;
  try {
    const { seudonimo } = require('../telemetria');
    const segmentos = (req.originalUrl || '').split('?')[0].split('/');
    const modulo = segmentos[2] || 'desconocido';
    Sentry.withScope((scope) => {
      scope.setTag('modulo', modulo);
      scope.setTag('ruta', req.route ? `/api/${modulo}${req.route.path}` : `/api/${modulo}`);
      scope.setTag('metodo', req.method);
      scope.setTag('referencia', referencia);
      if (req.empresa) {
        scope.setTag('rol', req.empresa.rol);
        const hash = seudonimo(req.empresa.id);
        if (hash) scope.setUser({ id: hash });
      }
      Sentry.captureException(err);
    });
    if (process.env.VERCEL) await Sentry.flush(2000);  // en Vercel la función se congela al responder
  } catch (_) { /* Sentry nunca afecta la respuesta */ }
}

// Error reportado por el navegador (ya validado en rutas/errores.js)
async function capturarErrorNavegador({ mensaje, pantalla, tipo }, req) {
  if (!activo) return;
  try {
    const { seudonimo } = require('../telemetria');
    Sentry.withScope((scope) => {
      scope.setLevel('error');
      scope.setTag('origen', 'navegador');
      scope.setTag('pantalla', pantalla);
      scope.setTag('tipo', tipo);
      if (req.empresa) {
        scope.setTag('rol', req.empresa.rol);
        const hash = seudonimo(req.empresa.id);
        if (hash) scope.setUser({ id: hash });
      }
      Sentry.captureMessage(`[navegador] ${mensaje}`);
    });
    if (process.env.VERCEL) await Sentry.flush(2000);
  } catch (_) { /* nunca afecta la respuesta */ }
}

module.exports = {
  iniciar, capturarErrorApi, capturarErrorNavegador,
  limpiarEvento, limpiarTransaccion, limpiarMigaja, limpiarUrl,
  estaActivo: () => activo
};
