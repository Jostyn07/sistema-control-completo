// ============================================================
// server/tests/tenant.test.js — pruebas de Fase 3 y 5 sin base real.
// Usa el Supabase simulado de _simulador.js.
// Correr:  npm test
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { arrancar, pedir, registro, consultasDe, estado, EMP_A, EMP_B, USR } = require('./_simulador');

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
    estado.rol = 'operador';
    assert.notEqual((await pedir(srv, 'GET', '/api/ventas')).status, 403);
    assert.equal((await pedir(srv, 'GET', '/api/finanzas/panel')).status, 403);
    assert.equal((await pedir(srv, 'DELETE', `/api/materiales/${EMP_B}`)).status, 403);
    assert.equal((await pedir(srv, 'GET', '/api/empresas/miembros')).status, 403);
    assert.notEqual((await pedir(srv, 'GET', '/api/configuracion/onboarding')).status, 403);
    assert.equal((await pedir(srv, 'PUT', '/api/configuracion/costo-hora', { cuerpo: { costo_hora_mano_obra: 1 } })).status, 403);
    estado.rol = 'propietario';
  });

  await t.test('administrador no puede pagar suscripción; propietario sí pasa el permiso', async () => {
    estado.rol = 'administrador';
    assert.equal((await pedir(srv, 'POST', '/api/suscripcion/cancelar')).status, 403);
    estado.rol = 'propietario';
    assert.notEqual((await pedir(srv, 'POST', '/api/suscripcion/cancelar')).status, 403);
  });

  await t.test('GET /api/empresas devuelve empresa activa y permisos', async () => {
    const r = await pedir(srv, 'GET', '/api/empresas');
    assert.equal(r.status, 200);
    assert.equal(r.json.activa.id, EMP_A);
    assert.ok(r.json.activa.permisos.includes('suscripcion.crear'));
  });
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
