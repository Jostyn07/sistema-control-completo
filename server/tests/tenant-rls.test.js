// ============================================================
// server/tests/tenant-rls.test.js — modo RLS (cliente con JWT del usuario).
// Va en archivo aparte: node --test corre cada archivo en un proceso
// nuevo, así arranca limpio con SUPABASE_RLS_ACTIVO=true en Windows y Linux.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { arrancar, pedir, registro, consultasDe } = require('./_simulador');

test('con SUPABASE_RLS_ACTIVO=true las rutas consultan con el JWT del usuario', async (t) => {
  const srv = await arrancar({ SUPABASE_RLS_ACTIVO: 'true' });
  t.after(() => srv.close());
  registro.length = 0;
  const r = await pedir(srv, 'GET', '/api/categorias');
  assert.equal(r.status, 200);
  assert.equal(consultasDe('empresa_usuarios')[0].llave, 'SERVICE', 'la membresía se valida con service_role');
  assert.equal(consultasDe('categorias_productos')[0].llave, 'ANON', 'los datos de negocio van con el cliente del usuario');
});

