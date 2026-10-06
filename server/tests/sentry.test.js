// ============================================================
// server/tests/sentry.test.js — FASE 9: Sentry sin datos de clientes.
// 1) Los limpiadores (beforeSend / beforeSendTransaction) aplicados a
//    eventos realistas con datos sensibles.
// 2) La API con un Sentry falso: qué se captura y qué no.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { arrancar, pedir, estado, EMP_A, USR } = require('./_simulador');

const SENSIBLES = ['900123456', 'ana@correo.com', 'Bearer eyJ', 'Doña Rosa', '3001234567', 'Queso', EMP_A, '35000', 'cookie-secreta'];
const contieneSensible = (obj) => SENSIBLES.filter(s => JSON.stringify(obj).includes(s));

test('Fase 9 — limpiadores', () => {
  const { limpiarEvento, limpiarTransaccion, limpiarUrl } = require('../servicios/sentry');

  const evento = limpiarEvento({
    message: 'Fallo al guardar NIT 900123456 de ana@correo.com',
    request: {
      method: 'POST',
      url: `https://www.fincil.cloud/api/ventas/${EMP_A}?cliente=Doña Rosa`,
      data: { cliente: 'Doña Rosa', telefono: '3001234567', total: 35000 },
      headers: { authorization: 'Bearer eyJhbGciOi.xxx.yyy', cookie: 'cookie-secreta' },
      cookies: { s: 'cookie-secreta' },
      query_string: 'cliente=Doña Rosa'
    },
    user: { id: 'abcdef0123456789', email: 'ana@correo.com', ip_address: '1.2.3.4' },
    exception: { values: [{ type: 'Error', value: 'Key (nit)=(900123456) already exists',
      stacktrace: { frames: [{ filename: 'ventas.js', vars: { cliente: 'Doña Rosa' }, context_line: 'const total = 35000' }] } }] },
    breadcrumbs: [{ category: 'http', data: { url: 'https://x.supabase.co/rest/v1/productos?nombre=ilike.Queso&empresa_id=eq.' + EMP_A, method: 'GET', status_code: 200 } },
                  { category: 'console', message: 'cliente ana@correo.com 3001234567' }],
    extra: { cuerpo: { cliente: 'Doña Rosa' }, cantidad: 2 },
    contexts: { response: { data: 'Doña Rosa' }, runtime: { name: 'node' } },
    server_name: 'maquina-de-jostyn'
  });
  assert.deepEqual(contieneSensible(evento), [], 'nada sensible en el evento');
  assert.equal(evento.request.url, 'https://www.fincil.cloud/api/ventas/:id');
  assert.deepEqual(evento.user, { id: 'abcdef0123456789' });
  assert.equal(evento.server_name, undefined);
  assert.equal(evento.breadcrumbs[0].data.url, 'https://x.supabase.co/rest/v1/productos');

  const trans = limpiarTransaccion({
    transaction: `GET /api/materiales/${EMP_A}`,
    user: { email: 'ana@correo.com' },
    spans: [{ description: `GET https://x.supabase.co/rest/v1/ventas?cliente=eq.Doña Rosa&empresa_id=eq.${EMP_A}`,
              data: { url: 'https://x.supabase.co/rest/v1/ventas?cliente=eq.Doña Rosa', 'http.request.method': 'GET', 'http.response.status_code': 200 } }]
  });
  assert.deepEqual(contieneSensible(trans), [], 'nada sensible en la transacción');
  assert.equal(trans.spans[0].description, 'GET https://x.supabase.co/rest/v1/ventas');
  assert.equal(limpiarUrl('/api/ventas/12345678/entregas?x=1'), '/api/ventas/:n/entregas');
});

test('Fase 9 — API con Sentry falso', async (t) => {
  const capturas = [];
  let alcance = {};
  estado.mocks['@sentry/node'] = {
    init: (op) => { estado.opcionesSentry = op; },
    withScope: (fn) => { alcance = { tags: {}, user: null }; fn({
      setTag: (k, v) => { alcance.tags[k] = v; }, setUser: (u) => { alcance.user = u; }, setLevel: () => {} }); },
    captureException: (err) => capturas.push({ tipo: 'excepcion', mensaje: err.message, ...alcance }),
    captureMessage: (m) => capturas.push({ tipo: 'mensaje', mensaje: m, ...alcance }),
    flush: async () => true
  };
  const srv = await arrancar({ SENTRY_DSN: 'https://clave@o0.ingest.sentry.io/0', TELEMETRIA_SAL: 'sal-de-prueba-de-32-caracteres!!' });
  t.after(() => { srv.close(); delete estado.mocks['@sentry/node']; });

  await t.test('se inicia sin PII y con los limpiadores', () => {
    assert.equal(estado.opcionesSentry.sendDefaultPii, false);
    assert.equal(typeof estado.opcionesSentry.beforeSend, 'function');
    assert.equal(typeof estado.opcionesSentry.beforeSendTransaction, 'function');
  });

  await t.test('un 500 se captura con contexto técnico y empresa seudónima', async () => {
    capturas.length = 0; estado.error = 'duplicate key value violates unique constraint Key (nit)=(900123456)';
    const r = await pedir(srv, 'GET', '/api/categorias');
    estado.error = null;
    assert.equal(r.status, 500);
    assert.equal(capturas.length, 1);
    const c = capturas[0];
    assert.equal(c.tags.modulo, 'categorias');
    assert.equal(c.tags.ruta, '/api/categorias/');
    assert.equal(c.tags.referencia, r.json.referencia);
    assert.match(c.user.id, /^[0-9a-f]{16}$/);
    assert.ok(!JSON.stringify(c.user).includes(EMP_A) && !JSON.stringify(c.user).includes(USR));
  });

  await t.test('un 4xx (validación) NO va a Sentry', async () => {
    capturas.length = 0;
    await pedir(srv, 'POST', '/api/materiales', { cuerpo: {} });
    assert.equal(capturas.length, 0);
  });

  await t.test('errores del navegador: se limpian, se validan y tienen límite', async () => {
    require('../rutas/errores')._reiniciarLimite();
    capturas.length = 0;
    const r = await pedir(srv, 'POST', '/api/errores-navegador', { cuerpo: {
      mensaje: 'TypeError en cliente ana@correo.com tel 3001234567', pantalla: 'ventas', tipo: 'error' } });
    assert.equal(r.status, 204);
    assert.equal(capturas.length, 1);
    assert.deepEqual(contieneSensible(capturas[0]), []);
    assert.equal(capturas[0].tags.pantalla, 'ventas');

    const r2 = await pedir(srv, 'POST', '/api/errores-navegador', { cuerpo: { mensaje: 'x', pantalla: '<script>' } });
    assert.equal(r2.status, 204);
    assert.equal(capturas[1].tags.pantalla, 'otra');

    for (let i = 0; i < 25; i++) await pedir(srv, 'POST', '/api/errores-navegador', { cuerpo: { mensaje: 'repetido ' + i } });
    assert.ok(capturas.length <= 20, `límite respetado (${capturas.length})`);

    const r3 = await pedir(srv, 'POST', '/api/errores-navegador', { cuerpo: {} });
    assert.equal(r3.status, 400);
  });
});
