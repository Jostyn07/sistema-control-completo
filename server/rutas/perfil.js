// ============================================================
// MI PERFIL  (/api/perfil) — server/rutas/perfil.js
// Espacio PERSONAL del usuario: sus datos, su apariencia y su
// seguridad. Nada de aquí toca la empresa, los roles ni los permisos:
// todo vive en user_metadata del propio usuario en Supabase Auth.
//
//  GET  /                         perfil + preferencias de apariencia
//  PUT  /                         guarda datos del perfil
//  PUT  /apariencia               guarda tema, color de acento y fondo
//  POST /imagen?tipo=avatar|portada|fondo   sube una imagen (campo "imagen")
//  PUT  /contrasena               cambia la contraseña
//  POST /cerrar-otras-sesiones    cierra la sesión en los demás dispositivos
// ============================================================
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');
const { supabaseAdmin: supabase } = require('../supabase/cliente');
const router = express.Router();

const BUCKET = 'productos-fotos';           // bucket público ya existente
const TAMANO_MAXIMO = 5 * 1024 * 1024;      // 5 MB
const TIPOS_IMAGEN = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']; // sin SVG (puede llevar scripts)
const ESTADOS = ['disponible', 'ocupado', 'ausente', 'no_disponible'];
const TEMAS = ['claro', 'oscuro', 'auto'];
const DEGRADADOS = ['aurora', 'atardecer', 'oceano', 'bosque', 'lavanda', 'grafito'];
const HEX = /^#[0-9a-f]{6}$/i;

const CAMPOS_PERFIL = {
  nombre: 60, apellido: 60, nombre_visible: 60, cargo: 60, descripcion: 200, telefono: 30
};

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter: (req, file, cb) => {
    if (!TIPOS_IMAGEN.includes(file.mimetype)) return cb(new Error('Usa una imagen JPG, PNG, WEBP o GIF'));
    cb(null, true);
  }
});

async function leerUsuario(id) {
  const { data, error } = await supabase.auth.admin.getUserById(id);
  if (error || !data?.user) throw new Error('No se encontró tu usuario');
  return data.user;
}

// Une los cambios con lo que ya hay (nunca borra claves que no se mandan)
async function guardarMetadatos(id, cambios) {
  const usuario = await leerUsuario(id);
  const actual = usuario.user_metadata || {};
  const { data, error } = await supabase.auth.admin.updateUserById(id, {
    user_metadata: { ...actual, ...cambios }
  });
  if (error) throw new Error(error.message);
  return data.user;
}

// Solo URLs de nuestro propio almacenamiento (evita meter imágenes externas)
function esUrlPropia(url, usuarioId) {
  const base = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  return typeof url === 'string' && !!base &&
    url.startsWith(`${base}/storage/v1/object/public/${BUCKET}/usuarios/${usuarioId}/`);
}

function apariencia(meta) {
  const p = meta.preferencias_ui || {};
  return {
    tema: TEMAS.includes(p.tema) ? p.tema : null,
    acento: HEX.test(p.acento || '') ? p.acento : null,
    fondo: p.fondo && p.fondo.tipo ? p.fondo : { tipo: 'ninguno' }
  };
}

function respuestaPerfil(u) {
  const m = u.user_metadata || {};
  const identidades = (u.identities || []).map(i => i.provider);
  return {
    id: u.id,
    correo: u.email,
    nombre: m.nombre || m.full_name || m.name || '',
    apellido: m.apellido || '',
    nombre_visible: m.nombre_visible || '',
    cargo: m.cargo || '',
    descripcion: m.descripcion || '',
    telefono: m.telefono || '',
    estado: ESTADOS.includes(m.estado) ? m.estado : 'disponible',
    avatar_url: m.avatar_propio || '',
    portada_url: m.portada_url || '',
    creado_en: u.created_at,
    ultimo_ingreso: u.last_sign_in_at,
    tiene_contrasena: identidades.includes('email'),
    acceso_google: identidades.includes('google'),
    apariencia: apariencia(m)
  };
}

// GET /api/perfil
router.get('/', async (req, res, next) => {
  try { res.json(respuestaPerfil(await leerUsuario(req.usuarioId))); }
  catch (err) { next(err); }
});

// PUT /api/perfil — { nombre, apellido, nombre_visible, cargo, descripcion, telefono, estado, avatar_url, portada_url }
router.put('/', async (req, res, next) => {
  try {
    const b = req.body || {};
    const cambios = {};
    for (const [campo, maximo] of Object.entries(CAMPOS_PERFIL)) {
      if (b[campo] === undefined) continue;
      const valor = String(b[campo] ?? '').trim();
      if (valor.length > maximo) return res.status(400).json({ error: `"${campo}" admite máximo ${maximo} caracteres` });
      cambios[campo] = valor;
    }
    if (cambios.nombre !== undefined && !cambios.nombre) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (cambios.telefono && !/^[0-9+()\s-]{5,30}$/.test(cambios.telefono))
      return res.status(400).json({ error: 'El teléfono solo puede tener números, espacios y + ( ) -' });
    if (b.estado !== undefined) {
      if (!ESTADOS.includes(b.estado)) return res.status(400).json({ error: 'Estado no válido' });
      cambios.estado = b.estado;
    }
    for (const [campo, clave] of [['avatar_url', 'avatar_propio'], ['portada_url', 'portada_url']]) {
      if (b[campo] === undefined) continue;
      if (b[campo] && !esUrlPropia(b[campo], req.usuarioId)) return res.status(400).json({ error: 'Imagen no válida' });
      cambios[clave] = b[campo] || '';
    }
    res.json(respuestaPerfil(await guardarMetadatos(req.usuarioId, cambios)));
  } catch (err) { next(err); }
});

// PUT /api/perfil/apariencia — { tema, acento, fondo: { tipo, valor } }
router.put('/apariencia', async (req, res, next) => {
  try {
    const { tema, acento, fondo } = req.body || {};
    const prefs = {};
    if (tema !== undefined) {
      if (!TEMAS.includes(tema)) return res.status(400).json({ error: 'Tema no válido' });
      prefs.tema = tema;
    }
    if (acento !== undefined) {
      if (acento !== null && !HEX.test(acento)) return res.status(400).json({ error: 'Color de acento no válido' });
      prefs.acento = acento;
    }
    if (fondo !== undefined) {
      const tipo = fondo && fondo.tipo;
      const valor = fondo && fondo.valor;
      const valido =
        tipo === 'ninguno' ||
        (tipo === 'solido' && HEX.test(valor || '')) ||
        (tipo === 'degradado' && DEGRADADOS.includes(valor)) ||
        (tipo === 'imagen' && esUrlPropia(valor, req.usuarioId));
      if (!valido) return res.status(400).json({ error: 'Fondo no válido' });
      prefs.fondo = tipo === 'ninguno' ? { tipo } : { tipo, valor };
    }
    const actual = (await leerUsuario(req.usuarioId)).user_metadata?.preferencias_ui || {};
    const u = await guardarMetadatos(req.usuarioId, { preferencias_ui: { ...actual, ...prefs } });
    res.json(apariencia(u.user_metadata || {}));
  } catch (err) { next(err); }
});

// POST /api/perfil/imagen?tipo=avatar|portada|fondo — campo "imagen"
router.post('/imagen', (req, res, next) => {
  const tipo = req.query.tipo;
  if (!['avatar', 'portada', 'fondo'].includes(tipo)) return res.status(400).json({ error: 'Tipo de imagen no válido' });
  subida.single('imagen')(req, res, async (errSubida) => {
    if (errSubida) {
      return res.status(400).json({
        error: errSubida.code === 'LIMIT_FILE_SIZE' ? 'La imagen no puede pesar más de 5 MB' : errSubida.message
      });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });
    try {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[req.file.mimetype];
      const ruta = `usuarios/${req.usuarioId}/${tipo}-${Date.now()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(ruta, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
      res.status(201).json({ url: data.publicUrl });
    } catch (err) { next(err); }
  });
});

// PUT /api/perfil/contrasena — { actual, nueva }
// Si la cuenta entró solo con Google (sin contraseña), puede crear una sin "actual".
router.put('/contrasena', async (req, res, next) => {
  try {
    const { actual, nueva } = req.body || {};
    if (!nueva || String(nueva).length < 8)
      return res.status(400).json({ error: 'La contraseña nueva debe tener al menos 8 caracteres' });

    const usuario = await leerUsuario(req.usuarioId);
    const tieneContrasena = (usuario.identities || []).some(i => i.provider === 'email');
    if (tieneContrasena) {
      if (!actual) return res.status(400).json({ error: 'Escribe tu contraseña actual' });
      // Cliente desechable: verificar la contraseña NO debe dejar una sesión
      // de usuario pegada al cliente compartido del servidor.
      const verificador = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
        { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
      const { error } = await verificador.auth.signInWithPassword({ email: usuario.email, password: actual });
      if (error) return res.status(400).json({ error: 'La contraseña actual no es correcta' });
      if (actual === nueva) return res.status(400).json({ error: 'La contraseña nueva debe ser distinta a la actual' });
    }
    const { error } = await supabase.auth.admin.updateUserById(req.usuarioId, { password: nueva });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ actualizada: true });
  } catch (err) { next(err); }
});

// POST /api/perfil/cerrar-otras-sesiones
router.post('/cerrar-otras-sesiones', async (req, res, next) => {
  try {
    const { error } = await supabase.auth.admin.signOut(req.tokenAcceso, 'others');
    if (error) return res.status(400).json({ error: error.message });
    res.json({ cerradas: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports._interno = { esUrlPropia, respuestaPerfil };