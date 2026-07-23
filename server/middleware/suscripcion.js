// ============================================================
// MIDDLEWARE DE SUSCRIPCIÓN — server/middleware/suscripcion.js
// Se aplica a las rutas de negocio (materiales, productos, ventas...)
// DESPUÉS de exigir sesión. Nunca bloquea lecturas (GET) — así,
// aunque la cuenta esté vencida, la persona sigue viendo toda su
// información. Solo bloquea crear/editar/eliminar, y solo después
// de los días de gracia (DIAS_GRACIA en servicios/suscripcion.js).
// ============================================================
const { sincronizarEstadoSuscripcion, calcularBloqueo } = require('../servicios/suscripcion');

async function requiereSuscripcionActiva(req, res, next) {
  if (req.method === 'GET') return next(); // lectura siempre permitida

  try {
    const sub = await sincronizarEstadoSuscripcion(req.usuarioId);

    // Sin ninguna fila de suscripción (nunca se creó la prueba, por ejemplo)
    // se trata igual que vencida-sin-gracia: no se deja crear ni editar.
    if (!sub) {
      return res.status(403).json({
        error: 'No tienes ninguna suscripción registrada. Elige un plan en Suscripción para poder crear o editar información.',
        suscripcion_vencida: true
      });
    }

    const estado = calcularBloqueo(sub);
    if (!estado.bloqueada) return next();

    res.status(403).json({
      error: 'Tu suscripción venció y ya pasó el período de gracia. Puedes seguir viendo tu información, pero para crear o editar necesitas renovar en Suscripción.',
      suscripcion_vencida: true
    });
  } catch (err) { next(err); }
}

module.exports = requiereSuscripcionActiva;