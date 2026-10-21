// FASE 10 — pruebas del borde (Cloudflare)
const test = require('node:test');
const assert = require('node:assert');
const { ipCliente, exigirBorde, encabezadosSeguridad, limitarTasa } = require('../seguridad/borde');

function resFalso() {
  const r = { codigo: 200, cab: {}, cuerpo: null,
    status(c) { this.codigo = c; return this; }, type() { return this; },
    send(b) { this.cuerpo = b; return this; }, json(b) { this.cuerpo = b; return this; },
    setHeader(k, v) { this.cab[k] = v; }, removeHeader(k) { delete this.cab[k]; } };
  return r;
}

test('ipCliente prefiere CF-Connecting-IP', () => {
  assert.equal(ipCliente({ headers: { 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '2.2.2.2' } }), '1.1.1.1');
  assert.equal(ipCliente({ headers: { 'x-forwarded-for': '3.3.3.3, 4.4.4.4' } }), '3.3.3.3');
});

test('exigirBorde: sin secreto deja pasar; con secreto exige el encabezado', () => {
  delete process.env.CLOUDFLARE_SECRETO;
  let paso = false; exigirBorde({ headers: {} }, resFalso(), () => { paso = true; }); assert.ok(paso);

  process.env.CLOUDFLARE_SECRETO = 'abc123';
  const r = resFalso(); paso = false;
  exigirBorde({ headers: {} }, r, () => { paso = true; });
  assert.equal(paso, false); assert.equal(r.codigo, 403);

  const r2 = resFalso(); paso = false;
  exigirBorde({ headers: { 'x-fincil-borde': 'otro00' } }, r2, () => { paso = true; });
  assert.equal(paso, false);

  paso = false;
  exigirBorde({ headers: { 'x-fincil-borde': 'abc123' } }, resFalso(), () => { paso = true; });
  assert.ok(paso);
  delete process.env.CLOUDFLARE_SECRETO;
});

test('encabezadosSeguridad pone las cabeceras y no-store en /api', () => {
  const r = resFalso();
  encabezadosSeguridad({ path: '/api/ventas' }, r, () => {});
  assert.equal(r.cab['X-Content-Type-Options'], 'nosniff');
  assert.equal(r.cab['Cache-Control'], 'no-store');
  const r2 = resFalso();
  encabezadosSeguridad({ path: '/finanzas.html' }, r2, () => {});
  assert.equal(r2.cab['Cache-Control'], undefined);
});

test('limitarTasa bloquea al pasar el máximo, por IP', () => {
  const mw = limitarTasa({ nombre: 't', ventanaMs: 60000, maximo: 2 });
  const req = (ip) => ({ headers: { 'cf-connecting-ip': ip } });
  let pasos = 0;
  for (let i = 0; i < 3; i++) mw(req('9.9.9.9'), resFalso(), () => pasos++);
  assert.equal(pasos, 2);
  const r = resFalso(); mw(req('9.9.9.9'), r, () => pasos++);
  assert.equal(r.codigo, 429);
  mw(req('8.8.8.8'), resFalso(), () => pasos++);
  assert.equal(pasos, 3);
});
