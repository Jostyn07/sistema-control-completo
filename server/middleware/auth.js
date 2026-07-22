// ============================================================
// MIDDLEWARE DE AUTENTICACIÓN — server/middleware/auth.js
// Se aplica a toda ruta de /api/* excepto /api/auth/*.
// Lee el token "Bearer" del encabezado Authorization, lo valida
// contra Supabase, y adjunta req.usuarioId para que cada ruta
// filtre automáticamente solo los datos de ese usuario.
// ============================================================
const supabase = require('../supabase/cliente');

async function requiereAutenticacion(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Debes iniciar sesión' });
  }

  try {
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Sesión inválida o expirada, inicia sesión de nuevo' });
    }
    req.usuarioId = data.user.id;
    req.usuarioEmail = data.user.email;
    next();
  } catch (err) {
    res.status(401).json({ error: 'No se pudo verificar la sesión' });
  }
}

module.exports = requiereAutenticacion;