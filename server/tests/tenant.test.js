    // ============================================================
// server/tests/tenant.test.js — pruebas de Fase 3 y 5 sin base real.
// Simula @supabase/supabase-js: registra cada consulta (tabla, filtros,
// payload, y con qué llave se creó el cliente) y responde datos fijos.
// Correr:  node --test server/tests/
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const Module = require('node:module');

const EMP_A = '11111111-1111-4111-8111-111111111111';
const EMP_B = '22222222-2222-4222-8222-222222222222';
const USR = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

let ROL = 'propietario';
const registro = [];

function crearClienteFalso(llave) {
  function consulta(tabla) {
    const q = { tabla, llave, filtros: [], payload: null, op: 'select' };
    registro.push(q);
    const resolver = () => {
      if (tabla === 'empresa_usuarios' && q.op === 'select') {
        return { data: [{ empresa_id: EMP_A, rol: ROL, es_predeterminada: true, empresas: { estado: 'activa', nombre: 'A' } }], error: null };
      }
      if (tabla === 'suscripciones') {
        return { data: { estado: 'activa', fecha_vencimiento: new Date(Date.now() + 864e5).toISOString() }, error: null };
      }
      if (q.op === 'insert') return { data: { id: 'nuevo', ...q.payload }, error: null };
      if (q.unico) return { data: null, error: null };
      return { data: [], error: null, count: 0 };
    };
    const p = new Proxy({}, {
      get(_, k) {
        if (k === 'then') return (ok, ko) => Promise.resolve(resolver()).then(ok, ko);
        return (...args) => {
          if (['insert', 'update', 'upsert', 'delete'].includes(k)) { q.op = k; q.payload = args[0]; }
          if (['eq', 'ilike', 'in', 'neq'].includes(k)) q.filtros.push([k, ...args]);
          if (k === 'maybeSingle' || k === 'single') q.unico = true;
          return p;
        };
      }
    });
    return p;
  }
  return {
    from: consulta,
    auth: { getUser: async (t) => (t === 'tok' ? { data: { user: { id: USR, email: 'x@y.co' } }, error: null } : { data: {}, error: { message: 'no' } }) },
    storage: { from: () => ({}) }
  };
}

const original = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === '@supabase/supabase-js') return { createClient: (_url, llave) => crearClienteFalso(llave) };
  return original.apply(this, arguments);
};

function arrancar(env) {
  for (const k of Object.keys(require.cache)) if (k.includes('/server/')) delete require.cache[k];
  Object.assign(process.env, { SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'SERVICE', SUPABASE_ANON_KEY: 'ANON', SUPABASE_RLS_ACTIVO: 'false' }, env);
  const app = require('../index');
  return new Promise(r => { const s = http.createServer(app).listen(0, () => r(s)); });
}

function pedir(servidor, metodo, ruta, { token = 'tok', empresa, cuerpo } = {}) {
  return new Promise((ok, ko) => {
    const datos = cuerpo ? JSON.stringify(cuerpo) : null;
    const h = { 'Content-Type': 'application/json' };
    if (token) h.Authorization = `Bearer ${token}`;
    if (empresa) h['X-Empresa-Id'] = empresa;
    const r = http.request({ port: servidor.address().port, method: metodo, path: ruta, headers: h }, res => {
      let b = ''; res.on('data', c => (b += c)); res.on('end', () => ok({ status: res.statusCode, json: (() => { try { return JSON.parse(b); } catch { return b; } })() }));
    });
    r.on('error', ko); if (datos) r.write(datos); r.end();
  });
}

const consultasDe = (tabla) => registro.filter(q => q.tabla === tabla);

test('Fase 3 y 5', async (t) => {
  const srv = await arrancar({});
  t.after(() => srv.close());

  await t.test('sin token → 401', async () => {
    const r = await pedir(srv, 'GET', '/api/materiales', { token: null });
    assert.equal(r.status, 401);
  });

  await t.test('empresa ajena en X-Empresa-Id → 403', async () => {
    const r = await pedir(srv, 'GET', '/api/materiales', { empresa: EMP_B });
    assert.equal(r.status, 403);
    assert.equal(r.json.empresa_invalida, true);
  });

  await t.test('X-Empresa-Id con formato inválido → 400', async () => {
    const r = await pedir(srv, 'GET', '/api/materiales', { empresa: "x' or 1=1" });
    assert.equal(r.status, 400);
  });

  await t.test('GET categorías filtra por empresa, nunca por usuario', async () => {
    registro.length = 0;
    const r = await pedir(srv, 'GET', '/api/categorias');
    assert.equal(r.status, 200);
    const q = consultasDe('categorias_productos')[0];
    assert.deepEqual(q.filtros[0], ['eq', 'empresa_id', EMP_A]);
    assert.ok(!q.filtros.some(f => f[1] === 'usuario_id'));
  });

  await t.test('empresa_id del body se ignora; se usa la empresa validada', async () => {
    registro.length = 0;
    const r = await pedir(srv, 'POST', '/api/categorias', { cuerpo: { nombre: 'Flores', empresa_id: EMP_B, usuario_id: 'otro' } });
    assert.equal(r.status, 201);
    const ins = consultasDe('categorias_productos').find(q => q.op === 'insert');
    assert.equal(ins.payload.empresa_id, EMP_A);
    assert.equal(ins.payload.usuario_id, USR);
  });

  await t.test('con RLS apagado las consultas usan service_role', async () => {
    registro.length = 0;
    await pedir(srv, 'GET', '/api/categorias');
    assert.equal(consultasDe('categorias_productos')[0].llave, 'SERVICE');
  });

  await t.test('operador: puede vender, no ve finanzas, no borra materiales, no gestiona equipo', async () => {
    ROL = 'operador';
    assert.notEqual((await pedir(srv, 'GET', '/api/ventas')).status, 403);
    assert.equal((await pedir(srv, 'GET', '/api/finanzas/panel')).status, 403);
    assert.equal((await pedir(srv, 'DELETE', `/api/materiales/${EMP_B}`)).status, 403);
    assert.equal((await pedir(srv, 'GET', '/api/empresas/miembros')).status, 403);
    assert.notEqual((await pedir(srv, 'GET', '/api/configuracion/onboarding')).status, 403);
    assert.equal((await pedir(srv, 'PUT', '/api/configuracion/costo-hora', { cuerpo: { costo_hora_mano_obra: 1 } })).status, 403);
    ROL = 'propietario';
  });

  await t.test('administrador no puede pagar suscripción; propietario sí pasa el permiso', async () => {
    ROL = 'administrador';
    assert.equal((await pedir(srv, 'POST', '/api/suscripcion/cancelar')).status, 403);
    ROL = 'propietario';
    assert.notEqual((await pedir(srv, 'POST', '/api/suscripcion/cancelar')).status, 403);
  });

  await t.test('GET /api/empresas devuelve empresa activa y permisos', async () => {
    const r = await pedir(srv, 'GET', '/api/empresas');
    assert.equal(r.status, 200);
    assert.equal(r.json.activa.id, EMP_A);
    assert.ok(r.json.activa.permisos.includes('suscripcion.crear'));
  });
});

test('con SUPABASE_RLS_ACTIVO=true las rutas consultan con el JWT del usuario', async (t) => {
  const srv = await arrancar({ SUPABASE_RLS_ACTIVO: 'true' });
  t.after(() => srv.close());
  registro.length = 0;
  const r = await pedir(srv, 'GET', '/api/categorias');
  assert.equal(r.status, 200);
  assert.equal(consultasDe('empresa_usuarios')[0].llave, 'SERVICE', 'la membresía se valida con service_role');
  assert.equal(consultasDe('categorias_productos')[0].llave, 'ANON', 'los datos de negocio van con el cliente del usuario');
});

test('el contexto llega a los servicios sin pasar req', async () => {
  const { ejecutarConContexto, usuarioActual, empresaActual } = require('../contexto');
  await ejecutarConContexto({ usuarioId: USR, empresaId: EMP_A }, async () => {
    await new Promise(r => setTimeout(r, 5));
    assert.equal(usuarioActual(), USR);
    assert.equal(empresaActual(), EMP_A);
  });
  assert.equal(usuarioActual(), null);
});
