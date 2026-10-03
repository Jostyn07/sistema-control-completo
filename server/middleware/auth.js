// ============================================================
// MIDDLEWARE DE AUTENTICACIÓN — server/middleware/auth.js
// Se aplica a toda ruta de /api/* excepto /api/auth/* y webhooks.
// Lee el token "Bearer", lo valida contra Supabase y adjunta:
//   req.usuarioId   → quién hace la acción (autoría)
//   req.tokenAcceso → para consultar como el usuario (RLS, fase 4)
// La empresa (dueña de los datos) la resuelve middleware/tenant.js.
// ============================================================
const { supabaseAdmin } = require('../supabase/cliente');

async function requiereAutenticacion(req, res, next) {
  const encabezado = req.headers.authorization || '';
  const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;

  if (!token) {
    return res.status(401).json({ error: 'Debes iniciar sesión' });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) {
      return res.status(401).json({ error: 'Sesión inválida o expirada, inicia sesión de nuevo' });
    }
    req.usuarioId = data.user.id;
    req.usuarioEmail = data.user.email;
    req.tokenAcceso = token;
    next();
  } catch (err) {
    res.status(401).json({ error: 'No se pudo verificar la sesión' });
  }
}

module.exports = requiereAutenticacion;
