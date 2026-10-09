// ============================================================
// BORDE (Cloudflare) — server/seguridad/borde.js
// FASE 10. Lo que el servidor hace detrás de Cloudflare:
//  - ipCliente(req): la IP real del visitante (CF-Connecting-IP).
//  - exigirBorde: si CLOUDFLARE_SECRETO está definido, rechaza las
//    peticiones que no traen el encabezado x-fincil-borde con ese
//    valor (lo agrega una regla de Cloudflare). Así nadie se salta
//    el WAF entrando directo por *.vercel.app.
//  - encabezadosSeguridad: cabeceras HTTP de seguridad básicas.
//  - limitarTasa(): freno por IP para rutas sensibles (login, etc.).
//    Es un respaldo en memoria; el límite fuerte lo pone Cloudflare.
// Sin CLOUDFLARE_SECRETO todo funciona igual que antes (local, previews).
// ============================================================
const { timingSafeEqual } = require('node:crypto');

function ipCliente(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return String(cf).trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket?.remoteAddress || 'desconocida';
}

function iguales(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

function exigirBorde(req, res, next) {
  const secreto = process.env.CLOUDFLARE_SECRETO;
  if (!secreto) return next();
  const recibido = req.headers['x-fincil-borde'];
  if (recibido && iguales(recibido, secreto)) return next();
  res.status(403).type('text/plain').send('Acceso no permitido');
}

function encabezadosSeguridad(req, res, next) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(self)');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.removeHeader('X-Powered-By');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
}

// limitarTasa({ ventanaMs, maximo, nombre }) → middleware
function limitarTasa({ ventanaMs = 15 * 60 * 1000, maximo = 10, nombre = 'general' } = {}) {
  const conteos = new Map();
  const mw = (req, res, next) => {
    const ahora = Date.now();
    const clave = nombre + ':' + ipCliente(req);
    let c = conteos.get(clave);
    if (!c || ahora - c.desde > ventanaMs) { c = { desde: ahora, n: 0 }; conteos.set(clave, c); }
    c.n += 1;
    if (conteos.size > 5000) { for (const [k, v] of conteos) if (ahora - v.desde > ventanaMs) conteos.delete(k); }
    if (c.n > maximo) {
      res.setHeader('Retry-After', Math.ceil((c.desde + ventanaMs - ahora) / 1000));
      return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos y vuelve a intentarlo.' });
    }
    next();
  };
  mw._reiniciar = () => conteos.clear();
  return mw;
}

module.exports = { ipCliente, exigirBorde, encabezadosSeguridad, limitarTasa };