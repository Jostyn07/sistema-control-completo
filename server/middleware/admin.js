// ============================================================
// MIDDLEWARE DE PLATAFORMA — server/middleware/admin.js
// Se aplica SOLO a /api/admin/*. Exige ser platform_owner: estar en
// la tabla plataforma_admins (migración 001). No es un rol de
// empresa: ve salud y métricas agregadas de toda la plataforma.
//
// Transición: mientras plataforma_admins esté vacía se acepta
// ADMIN_USUARIO_ID del .env. Inserta tu usuario en la tabla y quita
// la variable cuando lo confirmes:
//   INSERT INTO public.plataforma_admins (usuario_id) VALUES ('<tu uuid>');
// ============================================================
const { supabaseAdmin } = require('../supabase/cliente');

const log = require('../seguridad/log');
async function exigirAdmin(req, res, next) {
  try {
    const { data, error } = await supabaseAdmin
      .from('plataforma_admins').select('usuario_id').eq('usuario_id', req.usuarioId).maybeSingle();
    if (error) throw new Error('No se pudo verificar el acceso de plataforma');

    if (data) return next();

    if (process.env.ADMIN_USUARIO_ID && req.usuarioId === process.env.ADMIN_USUARIO_ID) {
      log.warn('[admin] Acceso por ADMIN_USUARIO_ID (modo transición): registra este usuario en plataforma_admins');
      return next();
    }

    res.status(403).json({ error: 'No tienes acceso a esta sección' });
  } catch (err) { next(err); }
}

module.exports = exigirAdmin;
