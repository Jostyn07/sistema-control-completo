// ============================================================
// MÓDULO — EMPRESAS Y EQUIPO  (/api/empresas)
// FASE 3. Va después de middleware/tenant.js (req.empresa ya existe).
// - GET    /                       mis empresas + empresa activa + mis permisos
// - PUT    /predeterminada         { empresa_id } empresa que abre al iniciar sesión
// - PATCH  /actual                 { nombre } renombra la empresa activa
// - GET    /miembros               equipo de la empresa activa
// - POST   /miembros               { correo, rol } agrega a alguien ya registrado
// - PATCH  /miembros/:usuarioId    { rol?, estado? } cambia rol o suspende
// - DELETE /miembros/:usuarioId    lo saca de la empresa
//
// Las membresías se escriben con service_role (no hay políticas de
// escritura para usuarios), por eso TODA regla se valida aquí.
// ============================================================
const express = require('express');
const { supabaseAdmin } = require('../supabase/cliente');
const requierePermiso = require('../middleware/permissions');
const { ROLES } = require('../seguridad/permisos');
const router = express.Router();

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLES_ASIGNABLES = ROLES.filter(r => r !== 'propietario'); // la propiedad no se regala por aquí
const ESTADOS_ASIGNABLES = ['activo', 'suspendido'];

// GET /api/empresas
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('empresa_usuarios')
      .select('empresa_id, rol, es_predeterminada, empresas!inner(nombre, estado)')
      .eq('usuario_id', req.usuarioId)
      .eq('estado', 'activo')
      .eq('empresas.estado', 'activa');
    if (error) throw new Error('No se pudieron cargar tus empresas');

    res.json({
      activa: { id: req.empresa.id, rol: req.empresa.rol, permisos: req.empresa.permisos },
      empresas: data.map(m => ({
        id: m.empresa_id,
        nombre: m.empresas.nombre,
        rol: m.rol,
        es_predeterminada: m.es_predeterminada
      }))
    });
  } catch (err) { next(err); }
});

// PUT /api/empresas/predeterminada — cuerpo: { empresa_id }
// (tenant.js borra empresa_id del body; por eso se lee como "id")
router.put('/predeterminada', async (req, res, next) => {
  try {
    const id = req.body.id;
    if (!UUID.test(id || '')) return res.status(400).json({ error: 'Empresa inválida' });

    const { data: membresia } = await supabaseAdmin
      .from('empresa_usuarios').select('empresa_id')
      .eq('usuario_id', req.usuarioId).eq('empresa_id', id).eq('estado', 'activo').maybeSingle();
    if (!membresia) return res.status(403).json({ error: 'No tienes acceso a esta empresa' });

    // Primero se quita la marca anterior (índice único: una por usuario)
    const { error: e1 } = await supabaseAdmin
      .from('empresa_usuarios').update({ es_predeterminada: false })
      .eq('usuario_id', req.usuarioId).eq('es_predeterminada', true);
    if (e1) throw new Error('No se pudo actualizar la empresa predeterminada');
    const { error: e2 } = await supabaseAdmin
      .from('empresa_usuarios').update({ es_predeterminada: true })
      .eq('usuario_id', req.usuarioId).eq('empresa_id', id);
    if (e2) throw new Error('No se pudo actualizar la empresa predeterminada');

    res.json({ predeterminada: id });
  } catch (err) { next(err); }
});

// PATCH /api/empresas/actual — cuerpo: { nombre }
router.patch('/actual', requierePermiso('configuracion', 'editar'), async (req, res, next) => {
  try {
    const nombre = String(req.body.nombre || '').trim();
    if (!nombre || nombre.length > 120) return res.status(400).json({ error: 'El nombre debe tener entre 1 y 120 caracteres' });
    const { data, error } = await supabaseAdmin
      .from('empresas').update({ nombre }).eq('id', req.empresa.id).select('id, nombre').single();
    if (error) throw new Error('No se pudo renombrar la empresa');
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/empresas/miembros
router.get('/miembros', requierePermiso('equipo', 'ver'), async (req, res, next) => {
  try {
    const { data, error } = await supabaseAdmin
      .from('empresa_usuarios')
      .select('usuario_id, rol, estado, creado_en')
      .eq('empresa_id', req.empresa.id)
      .order('creado_en');
    if (error) throw new Error('No se pudo cargar el equipo');

    const miembros = await Promise.all(data.map(async (m) => {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(m.usuario_id);
      return { ...m, correo: u?.user?.email || null };
    }));
    res.json(miembros);
  } catch (err) { next(err); }
});

// Busca un usuario registrado por correo (Supabase no tiene búsqueda
// directa por correo en la API admin: se recorre por páginas).
async function buscarUsuarioPorCorreo(correo) {
  const objetivo = correo.toLowerCase();
  for (let pagina = 1; pagina <= 20; pagina++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page: pagina, perPage: 200 });
    if (error) throw new Error('No se pudo buscar el usuario');
    const encontrado = data.users.find(u => (u.email || '').toLowerCase() === objetivo);
    if (encontrado) return encontrado;
    if (data.users.length < 200) return null;
  }
  return null;
}

// POST /api/empresas/miembros — cuerpo: { correo, rol }
router.post('/miembros', requierePermiso('equipo', 'administrar'), async (req, res, next) => {
  try {
    const correo = String(req.body.correo || '').trim();
    const rol = req.body.rol;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) return res.status(400).json({ error: 'Correo inválido' });
    if (!ROLES_ASIGNABLES.includes(rol)) return res.status(400).json({ error: 'Rol inválido' });
    if (rol === 'administrador' && req.empresa.rol !== 'propietario')
      return res.status(403).json({ error: 'Solo el propietario puede agregar administradores' });

    const usuario = await buscarUsuarioPorCorreo(correo);
    // Mensaje genérico: no confirma qué correos están registrados
    if (!usuario) return res.status(404).json({ error: 'Esa persona debe crear su cuenta en Fincil antes de agregarla' });

    const { data: existente } = await supabaseAdmin
      .from('empresa_usuarios').select('rol')
      .eq('empresa_id', req.empresa.id).eq('usuario_id', usuario.id).maybeSingle();
    if (existente) return res.status(409).json({ error: 'Esa persona ya es parte de la empresa' });

    const { error } = await supabaseAdmin.from('empresa_usuarios').insert({
      empresa_id: req.empresa.id,
      usuario_id: usuario.id,
      rol,
      estado: 'activo',
      es_predeterminada: false,
      invitado_por: req.usuarioId
    });
    if (error) throw new Error('No se pudo agregar a la persona');
    res.status(201).json({ usuario_id: usuario.id, rol, estado: 'activo' });
  } catch (err) { next(err); }
});

// Reglas comunes para cambiar/sacar a alguien
async function validarObjetivo(req, res) {
  const objetivoId = req.params.usuarioId;
  if (!UUID.test(objetivoId || '')) { res.status(400).json({ error: 'Usuario inválido' }); return null; }
  if (objetivoId === req.usuarioId) { res.status(400).json({ error: 'No puedes cambiar tu propia membresía' }); return null; }

  const { data: objetivo } = await supabaseAdmin
    .from('empresa_usuarios').select('usuario_id, rol')
    .eq('empresa_id', req.empresa.id).eq('usuario_id', objetivoId).maybeSingle();
  if (!objetivo) { res.status(404).json({ error: 'Esa persona no es parte de la empresa' }); return null; }
  if (objetivo.rol === 'propietario') { res.status(403).json({ error: 'No se puede modificar al propietario' }); return null; }
  if (objetivo.rol === 'administrador' && req.empresa.rol !== 'propietario') {
    res.status(403).json({ error: 'Solo el propietario puede modificar administradores' }); return null;
  }
  return objetivo;
}

// PATCH /api/empresas/miembros/:usuarioId — cuerpo: { rol?, estado? }
router.patch('/miembros/:usuarioId', requierePermiso('equipo', 'administrar'), async (req, res, next) => {
  try {
    const objetivo = await validarObjetivo(req, res);
    if (!objetivo) return;

    const cambios = {};
    if (req.body.rol !== undefined) {
      if (!ROLES_ASIGNABLES.includes(req.body.rol)) return res.status(400).json({ error: 'Rol inválido' });
      if (req.body.rol === 'administrador' && req.empresa.rol !== 'propietario')
        return res.status(403).json({ error: 'Solo el propietario puede nombrar administradores' });
      cambios.rol = req.body.rol;
    }
    if (req.body.estado !== undefined) {
      if (!ESTADOS_ASIGNABLES.includes(req.body.estado)) return res.status(400).json({ error: 'Estado inválido' });
      cambios.estado = req.body.estado;
    }
    if (!Object.keys(cambios).length) return res.status(400).json({ error: 'No hay cambios' });

    const { data, error } = await supabaseAdmin
      .from('empresa_usuarios').update(cambios)
      .eq('empresa_id', req.empresa.id).eq('usuario_id', objetivo.usuario_id)
      .select('usuario_id, rol, estado').single();
    if (error) throw new Error('No se pudo actualizar la membresía');
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/empresas/miembros/:usuarioId
router.delete('/miembros/:usuarioId', requierePermiso('equipo', 'administrar'), async (req, res, next) => {
  try {
    const objetivo = await validarObjetivo(req, res);
    if (!objetivo) return;
    const { error } = await supabaseAdmin
      .from('empresa_usuarios').delete()
      .eq('empresa_id', req.empresa.id).eq('usuario_id', objetivo.usuario_id);
    if (error) throw new Error('No se pudo quitar a la persona');
    res.json({ eliminado: true });
  } catch (err) { next(err); }
});

module.exports = router;
