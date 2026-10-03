// ============================================================
// server/tests/tenant-rls.test.js — modo RLS (cliente con JWT del usuario).
// Va en archivo aparte: node --test corre cada archivo en un proceso
// nuevo, así arranca limpio con SUPABASE_RLS_ACTIVO=true en Windows y Linux.
// Usa el mismo Supabase simulado que tenant.test.js.
// Simula @supabase/supabase-js: registra cada consulta (tabla, filtros,
// payload, y con qué llave se creó el cliente) y responde datos fijos.
// Correr:  npm test   (o: node --test server/tests/tenant.test.js)
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
  for (const k of Object.keys(require.cache)) if (/[\\/]server[\\/]/.test(k)) delete require.cache[k]; // Windows usa \, Linux /
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

test('con SUPABASE_RLS_ACTIVO=true las rutas consultan con el JWT del usuario', async (t) => {
  const srv = await arrancar({ SUPABASE_RLS_ACTIVO: 'true' });
  t.after(() => srv.close());
  registro.length = 0;
  const r = await pedir(srv, 'GET', '/api/categorias');
  assert.equal(r.status, 200);
  assert.equal(consultasDe('empresa_usuarios')[0].llave, 'SERVICE', 'la membresía se valida con service_role');
  assert.equal(consultasDe('categorias_productos')[0].llave, 'ANON', 'los datos de negocio van con el cliente del usuario');
});