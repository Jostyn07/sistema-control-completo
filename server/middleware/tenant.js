// ============================================================
// MIDDLEWARE DE EMPRESA (TENANT) — server/middleware/tenant.js
// FASE 5. Va después de requiereAutenticacion. Decide en qué
// empresa trabaja la petición y la deja en:
//   req.empresa = { id, rol, permisos, total_empresas }
//
// Reglas:
// - La empresa activa llega en el encabezado X-Empresa-Id. Si no
//   llega, se usa la empresa predeterminada del usuario.
// - Se verifica SIEMPRE la membresía (activa, empresa activa). Un
//   empresa_id en el body o en la query NUNCA da acceso: se elimina.
// - Abre el contexto de la petición (contexto.js) para que todos los
//   servicios sepan la empresa y el autor sin recibir `req`.
// ============================================================
const { supabaseAdmin, crearClienteUsuario, RLS_ACTIVO } = require('../supabase/cliente');
const { ejecutarConContexto } = require('../contexto');
const { permisosDeRol } = require('../seguridad/permisos');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CAMPOS_PROTEGIDOS = ['empresa_id', 'usuario_id'];

// Quita empresa_id / usuario_id que vengan del cliente (objeto o lista de filas)
function limpiarCamposProtegidos(cuerpo) {
  if (!cuerpo || typeof cuerpo !== 'object') return;
  const filas = Array.isArray(cuerpo) ? cuerpo : [cuerpo];
  for (const fila of filas) {
    if (fila && typeof fila === 'object' && !Array.isArray(fila)) {
      for (const campo of CAMPOS_PROTEGIDOS) delete fila[campo];
    }
  }
}

async function resolverEmpresa(req, res, next) {
  try {
    const solicitada = req.get('X-Empresa-Id') || null;
    if (solicitada && !UUID.test(solicitada)) {
      return res.status(400).json({ error: 'Empresa inválida' });
    }

    // service_role a propósito: es la consulta que DECIDE el acceso,
    // y se filtra explícitamente por el usuario autenticado.
    const { data: membresias, error } = await supabaseAdmin
      .from('empresa_usuarios')
      .select('empresa_id, rol, es_predeterminada, empresas!inner(estado)')
      .eq('usuario_id', req.usuarioId)
      .eq('estado', 'activo')
      .eq('empresas.estado', 'activa');
    if (error) throw new Error('No se pudo verificar la empresa');

    if (!membresias || membresias.length === 0) {
      return res.status(403).json({ error: 'Tu usuario no pertenece a ninguna empresa activa', sin_empresa: true });
    }

    let membresia;
    if (solicitada) {
      membresia = membresias.find(m => m.empresa_id === solicitada);
      if (!membresia) {
        // Mismo mensaje exista o no la empresa: no revela UUIDs válidos
        return res.status(403).json({ error: 'No tienes acceso a esta empresa', empresa_invalida: true });
      }
    } else {
      membresia = membresias.find(m => m.es_predeterminada) || membresias[0];
    }

    req.empresa = Object.freeze({
      id: membresia.empresa_id,
      rol: membresia.rol,
      permisos: permisosDeRol(membresia.rol),
      total_empresas: membresias.length
    });

    limpiarCamposProtegidos(req.body);
    if (req.query) {
      delete req.query.empresa_id;
      delete req.query.usuario_id;
    }

    const contexto = {
      usuarioId: req.usuarioId,
      empresaId: req.empresa.id,
      rol: req.empresa.rol,
      supabase: RLS_ACTIVO ? crearClienteUsuario(req.tokenAcceso) : null
    };

    ejecutarConContexto(contexto, () => next());
  } catch (err) {
    next(err);
  }
}

module.exports = resolverEmpresa;
module.exports.limpiarCamposProtegidos = limpiarCamposProtegidos;
