// ============================================================
// server/tests/seguridad.test.js — FASE 6: datos sensibles.
// Ocultar costos al operador, sanitización de textos y objetos, y
// errores de base de datos que no llegan crudos al cliente.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { arrancar, pedir, estado } = require('./_simulador');

test('Fase 6 — API', async (t) => {
  const srv = await arrancar({});
  t.after(() => srv.close());

  const fila = { id: 'c1', nombre: 'Arepas', costo_calculado: 24200, margen_pct: 30.9,
                 detalle: { costo_unitario: 4000, cantidad: 2, utilidad_mes: 10 }, precio_venta: 35000 };

  await t.test('operador no recibe costos, márgenes ni utilidades (a ninguna profundidad)', async () => {
    estado.rol = 'operador'; estado.datos = [fila];
    const r = await pedir(srv, 'GET', '/api/categorias');
    estado.rol = 'propietario'; estado.datos = null;
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, [{ id: 'c1', nombre: 'Arepas', detalle: { cantidad: 2 }, precio_venta: 35000 }]);
  });

  await t.test('supervisor y propietario sí reciben costos', async () => {
    for (const rol of ['supervisor', 'propietario']) {
      estado.rol = rol; estado.datos = [fila];
      const r = await pedir(srv, 'GET', '/api/categorias');
      assert.equal(r.json[0].costo_calculado, 24200, rol);
    }
    estado.rol = 'propietario'; estado.datos = null;
  });

  await t.test('error de base de datos → mensaje genérico con referencia, sin valores', async () => {
    estado.error = 'duplicate key value violates unique constraint "x" Key (nit)=(900123456) already exists';
    const errores = []; const original = console.error; console.error = (...a) => errores.push(a.join(' '));
    const r = await pedir(srv, 'GET', '/api/categorias');
    console.error = original; estado.error = null;
    assert.equal(r.status, 500);
    assert.match(r.json.error, /error inesperado/);
    assert.match(r.json.referencia, /^[0-9a-f]{8}$/);
    assert.ok(!JSON.stringify(r.json).includes('900123456'), 'el cliente no ve el NIT');
    const linea = errores.join('\n');
    assert.ok(linea.includes(r.json.referencia), 'el log tiene la referencia');
    assert.ok(!linea.includes('900123456'), 'el log no tiene el NIT');
  });
});

test('Fase 6 — sanitize.js', () => {
  const { sanitizarTexto, sanitizarObjeto, esErrorInterno } = require('../seguridad/sanitize');
  const t = sanitizarTexto('Key (nit)=(900123456) ya existe; escribir a ana.perez@mail.com o al 300 123 4567, token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghij');
  assert.ok(!/900123456|ana\.perez|300 123 4567|eyJhbGci/.test(t), t);
  assert.equal(esErrorInterno('null value in column "nombre" violates not-null constraint'), true);
  assert.equal(esErrorInterno('La cantidad entregada debe ser un número mayor a 0'), false);
  const o = sanitizarObjeto({ nombre: 'Ramo', nit: '900', correo: 'a@b.co', costo_unitario: 5, cantidad: 3, token: 'x', items: [{ telefono: '300' }] });
  assert.deepEqual(o, { nombre: 'Ramo', nit: '[oculto]', correo: '[oculto]', costo_unitario: '[oculto]', cantidad: 3, token: '[oculto]', items: [{ telefono: '[oculto]' }] });
});

test('Fase 7 — auditoría desde el backend', async (t) => {
  const { arrancar, pedir, registro, consultasDe, estado, EMP_A, USR } = require('./_simulador');
  const srv = await arrancar({});
  t.after(() => srv.close());

  await t.test('un intento denegado queda registrado (sin bloquear la respuesta)', async () => {
    registro.length = 0; estado.rol = 'operador';
    const r = await pedir(srv, 'GET', '/api/finanzas/resumen');
    estado.rol = 'propietario';
    assert.equal(r.status, 403);
    await new Promise(res => setTimeout(res, 10));
    const llamada = consultasDe('rpc:registrar_denegado')[0];
    assert.ok(llamada, 'se llamó registrar_denegado');
    assert.deepEqual(llamada.payload, { p_empresa_id: EMP_A, p_usuario_id: USR, p_modulo: 'finanzas', p_permiso: 'finanzas.ver' });
  });

  await t.test('las consultas con service_role llevan el actor para la auditoría', async () => {
    registro.length = 0;
    await pedir(srv, 'GET', '/api/categorias');
    assert.equal(consultasDe('categorias_productos')[0].actor, USR);
  });

  await t.test('solo propietario y administrador leen la auditoría', async () => {
    for (const [rol, esperado] of [['propietario', 200], ['administrador', 200], ['supervisor', 403], ['operador', 403]]) {
      estado.rol = rol;
      const r = await pedir(srv, 'GET', '/api/auditoria');
      assert.equal(r.status, esperado, rol);
    }
    estado.rol = 'propietario';
  });
});
