// Mi perfil — validaciones de /api/perfil (Supabase simulado)
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const express = require('express');

process.env.SUPABASE_URL = 'https://demo.supabase.co';
let usuario;
function reiniciar() {
  usuario = { id: 'u1', email: 'a@b.co', identities: [{ provider: 'email' }], created_at: '2026-01-01',
    user_metadata: { nombre: 'Ana', preferencias_ui: { tema: 'oscuro' } } };
}
const simulado = {
  auth: { admin: {
    getUserById: async () => ({ data: { user: usuario }, error: null }),
    updateUserById: async (id, cambios) => {
      if (cambios.user_metadata) usuario.user_metadata = cambios.user_metadata;
      return { data: { user: usuario }, error: null };
    },
    signOut: async () => ({ error: null })
  } }
};
require.cache[path.resolve(__dirname, '../supabase/cliente.js')] = {
  id: 'x', filename: 'x', loaded: true, exports: { supabaseAdmin: simulado }
};
const rutas = require('../rutas/perfil');

async function llamar(metodo, ruta, cuerpo) {
  const app = express(); app.use(express.json());
  app.use((req, res, next) => { req.usuarioId = 'u1'; req.tokenAcceso = 't'; next(); });
  app.use('/api/perfil', rutas);
  app.use((err, req, res, next) => res.status(500).json({ error: err.message }));
  const srv = app.listen(0); const puerto = srv.address().port;
  try {
    const r = await fetch(`http://127.0.0.1:${puerto}${ruta}`, {
      method: metodo, headers: { 'Content-Type': 'application/json' }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    return { status: r.status, body: await r.json() };
  } finally { srv.close(); }
}

test('GET devuelve perfil y apariencia', async () => {
  reiniciar();
  const r = await llamar('GET', '/api/perfil');
  assert.equal(r.status, 200);
  assert.equal(r.body.nombre, 'Ana');
  assert.equal(r.body.apariencia.tema, 'oscuro');
  assert.equal(r.body.tiene_contrasena, true);
});

test('PUT guarda sin borrar otras claves y valida', async () => {
  reiniciar();
  let r = await llamar('PUT', '/api/perfil', { cargo: 'Vendedora', estado: 'ocupado' });
  assert.equal(r.status, 200);
  assert.equal(usuario.user_metadata.nombre, 'Ana');
  assert.equal(usuario.user_metadata.preferencias_ui.tema, 'oscuro');
  assert.equal(r.body.cargo, 'Vendedora');
  r = await llamar('PUT', '/api/perfil', { nombre: '' });           assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil', { estado: 'fiesta' });     assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil', { telefono: '<script>' }); assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil', { avatar_url: 'https://malo.com/x.png' }); assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil', { avatar_url: 'https://demo.supabase.co/storage/v1/object/public/productos-fotos/usuarios/OTRO/a.png' });
  assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil', { avatar_url: 'https://demo.supabase.co/storage/v1/object/public/productos-fotos/usuarios/u1/a.png' });
  assert.equal(r.status, 200);
});

test('PUT /apariencia valida tema, acento y fondo', async () => {
  reiniciar();
  let r = await llamar('PUT', '/api/perfil/apariencia', { acento: '#7C5CDB', fondo: { tipo: 'degradado', valor: 'aurora' } });
  assert.equal(r.status, 200);
  assert.equal(r.body.tema, 'oscuro');          // se conserva
  assert.equal(r.body.acento, '#7C5CDB');
  r = await llamar('PUT', '/api/perfil/apariencia', { acento: 'red; x' });               assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil/apariencia', { tema: 'rosado' });                 assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil/apariencia', { fondo: { tipo: 'imagen', valor: 'https://otro.com/a.jpg' } }); assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil/apariencia', { fondo: { tipo: 'solido', valor: 'url(x)' } }); assert.equal(r.status, 400);
});

test('contraseña: corta se rechaza; con contraseña exige la actual', async () => {
  reiniciar();
  let r = await llamar('PUT', '/api/perfil/contrasena', { nueva: '123' });          assert.equal(r.status, 400);
  r = await llamar('PUT', '/api/perfil/contrasena', { nueva: 'Segura12345' });      assert.equal(r.status, 400);
  assert.match(r.body.error, /actual/);
});
