// ============================================================
// ERRORES DEL NAVEGADOR — server/rutas/errores.js  (/api/errores-navegador)
// FASE 9. El navegador NO habla directo con Sentry (la llave queda
// en el servidor y todo pasa por el mismo sanitizador). Cuerpo:
//   { mensaje, pantalla, tipo: 'error' | 'promesa' }
// Límite: 20 reportes por usuario cada 10 minutos. Responde 204.
// ============================================================
const express = require('express');
const { capturarErrorNavegador } = require('../servicios/sentry');
const { sanitizarTexto } = require('../seguridad/sanitize');
const { PANTALLAS } = require('../servicios/telemetria/catalogo');
const router = express.Router();

const VENTANA_MS = 10 * 60 * 1000;
const MAXIMO = 20;
const conteos = new Map(); // usuario → { desde, n }   (en memoria: suficiente como freno básico)

function superaLimite(usuarioId) {
  const ahora = Date.now();
  const c = conteos.get(usuarioId);
  if (!c || ahora - c.desde > VENTANA_MS) { conteos.set(usuarioId, { desde: ahora, n: 1 }); return false; }
  c.n += 1;
  return c.n > MAXIMO;
}

router.post('/', async (req, res) => {
  const { mensaje, pantalla, tipo } = req.body || {};
  if (typeof mensaje !== 'string' || !mensaje.trim()) return res.status(400).json({ error: 'Formato inválido' });
  if (!superaLimite(req.usuarioId)) {
    await capturarErrorNavegador({
      mensaje: sanitizarTexto(mensaje).slice(0, 300),
      pantalla: PANTALLAS.includes(pantalla) ? pantalla : 'otra',
      tipo: tipo === 'promesa' ? 'promesa' : 'error'
    }, req);
  }
  res.status(204).end();
});

module.exports = router;
module.exports._reiniciarLimite = () => conteos.clear();
