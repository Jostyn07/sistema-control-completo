// ============================================================
// MÓDULO DE AUTENTICACIÓN (/api/auth) — PÚBLICO, sin middleware.
// - POST /registro   crea una cuenta nueva (nombre, correo, contraseña)
// - POST /login       inicia sesión y devuelve el token de acceso
// - GET  /yo          confirma quién es el dueño del token actual
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const router = express.Router();

// POST /api/auth/registro
router.post('/registro', async (req, res, next) => {
  try {
    const { nombre, correo, contrasena } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });
    if (!correo || !correo.trim()) return res.status(400).json({ error: 'El correo es obligatorio' });
    if (!contrasena || contrasena.length < 6)
      return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });

    const { data, error } = await supabase.auth.admin.createUser({
      email: correo.trim().toLowerCase(),
      password: contrasena,
      email_confirm: true, // no exige verificación por correo; es una herramienta interna
      user_metadata: { nombre: nombre.trim() }
    });
    if (error) {
      const mensaje = error.message.includes('already registered')
        ? 'Ya existe una cuenta con ese correo'
        : error.message;
      return res.status(400).json({ error: mensaje });
    }

    res.status(201).json({ creado: true, usuario_id: data.user.id });
  } catch (err) { next(err); }
});

// POST /api/auth/login
router.post('/login', async (req, res, next) => {
  try {
    const { correo, contrasena } = req.body;
    if (!correo || !contrasena) return res.status(400).json({ error: 'Correo y contraseña son obligatorios' });

    const { data, error } = await supabase.auth.signInWithPassword({
      email: correo.trim().toLowerCase(),
      password: contrasena
    });
    if (error) return res.status(401).json({ error: 'Correo o contraseña incorrectos' });

    res.json({
      token: data.session.access_token,
      usuario: {
        id: data.user.id,
        correo: data.user.email,
        nombre: data.user.user_metadata?.nombre || ''
      }
    });
  } catch (err) { next(err); }
});

// GET /api/auth/yo — usado por el frontend para confirmar la sesión al cargar
router.get('/yo', async (req, res, next) => {
  try {
    const encabezado = req.headers.authorization || '';
    const token = encabezado.startsWith('Bearer ') ? encabezado.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesión' });

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: 'Sesión inválida' });

    res.json({
      id: data.user.id,
      correo: data.user.email,
      nombre: data.user.user_metadata?.nombre || ''
    });
  } catch (err) { next(err); }
});

// GET /api/auth/configuracion-publica — datos NO secretos que el navegador
// necesita para hablar directo con Supabase solo durante el login con Google
// (es el único paso que lo requiere: implica redirigir a Google y volver).
// SUPABASE_ANON_KEY es la llave pública (Publishable), segura de exponer;
// nunca se usa aquí la llave secreta.
router.get('/configuracion-publica', (req, res) => {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return res.status(500).json({ error: 'Falta configurar SUPABASE_ANON_KEY en el servidor' });
  }
  res.json({ url: process.env.SUPABASE_URL, anonKey: process.env.SUPABASE_ANON_KEY });
});

module.exports = router;