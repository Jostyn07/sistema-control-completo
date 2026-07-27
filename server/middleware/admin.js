// ============================================================
// MIDDLEWARE DE ADMINISTRADOR — server/middleware/admin.js
// Se aplica SOLO a /api/admin/*, después de requiereAutenticacion
// (necesita req.usuarioId ya puesto). No toca la base de datos —
// compara contra tu propio usuario_id guardado como variable de
// entorno (ADMIN_USUARIO_ID en Vercel / .env local).
// ============================================================
function exigirAdmin(req, res, next) {
  if (!process.env.ADMIN_USUARIO_ID) {
    return res.status(500).json({ error: 'Falta configurar ADMIN_USUARIO_ID en el servidor' });
  }
  if (req.usuarioId !== process.env.ADMIN_USUARIO_ID) {
    return res.status(403).json({ error: 'No tienes acceso a esta sección' });
  }
  next();
}

module.exports = exigirAdmin;