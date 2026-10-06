// ============================================================
// server/tests/telemetria.test.js — FASE 8: telemetría sin datos
// del negocio. Revisa lo que se ENVIARÍA a public.telemetria_registrar.
// ============================================================
const test = require('node:test');
const assert = require('node:assert');
const { arrancar, pedir, registro, consultasDe, estado, EMP_A, USR } = require('./_simulador');

const SAL = 'sal-de-prueba-de-32-caracteres!!';
const esperar = (ms) => new Promise(r => setTimeout(r, ms));
const lotes = () => consultasDe('rpc:telemetria_registrar').map(q => q.payload.p_eventos).flat();

test('Fase 8 — telemetría', async (t) => {
  const srv = await arrancar({ TELEMETRIA_SAL: SAL });
  t.after(() => srv.close());

  await t.test('una acción exitosa genera api.solicitud + evento de negocio, sin contenido', async () => {
    registro.length = 0;
    const r = await pedir(srv, 'POST', '/api/materiales', {
      cuerpo: { nombre: 'Queso costeño secreto', costo_unitario: 20000, proveedor: 'Lácteos El Prado', unidad: 'kg' }
    });
    await esperar(20);
    const eventos = lotes();
    const nombres = eventos.map(e => e.nombre);
    assert.ok(nombres.includes('api.solicitud'), 'registra la solicitud');
    assert.equal(r.status, 201, 'el material se crea');
    assert.ok(nombres.includes('material.creado'), 'registra el evento de negocio');

    const texto = JSON.stringify(eventos);
    for (const prohibido of ['Queso', '20000', 'Lácteos', EMP_A, USR]) {
      assert.ok(!texto.includes(prohibido), `no debe contener ${prohibido}`);
    }
    const sol = eventos.find(e => e.nombre === 'api.solicitud');
    assert.match(sol.empresa_hash, /^[0-9a-f]{16}$/);
    assert.match(sol.usuario_hash, /^[0-9a-f]{16}$/);
    assert.equal(sol.modulo, 'materiales');
    assert.deepEqual(Object.keys(sol.propiedades).sort(), ['estado', 'metodo', 'ruta']);
    assert.equal(sol.propiedades.ruta, '/api/materiales/');
  });

  await t.test('las rutas con ID se registran como patrón, nunca con el ID', async () => {
    registro.length = 0;
    const id = '33333333-3333-4333-8333-333333333333';
    await pedir(srv, 'GET', `/api/materiales/${id}/historial`);
    await esperar(20);
    const texto = JSON.stringify(lotes());
    assert.ok(!texto.includes(id), 'sin el ID');
  });

  await t.test('un error de servidor queda como error_servidor y sin evento de negocio', async () => {
    registro.length = 0; estado.error = 'fallo simulado';
    await pedir(srv, 'GET', '/api/categorias');
    estado.error = null;
    await esperar(20);
    const sol = lotes().find(e => e.nombre === 'api.solicitud');
    assert.equal(sol.resultado, 'error_servidor');
    assert.equal(sol.propiedades.estado, 500);
  });

  await t.test('navegador: solo eventos y propiedades del catálogo', async () => {
    registro.length = 0;
    const r = await pedir(srv, 'POST', '/api/telemetria/eventos', { cuerpo: { eventos: [
      { nombre: 'pantalla.abierta', propiedades: { pantalla: 'ventas', cliente: 'Doña Rosa', total: 280000 } },
      { nombre: 'pantalla.abierta', propiedades: { pantalla: '<script>' } },
      { nombre: 'venta.creada', propiedades: {} },            // es del servidor: el navegador no lo puede mandar
      { nombre: 'evento.inventado', propiedades: { x: 1 } }
    ] } });
    await esperar(20);
    assert.equal(r.status, 204);
    const nav = lotes().filter(e => e.origen === 'navegador');
    assert.equal(nav.length, 2);
    assert.deepEqual(nav[0].propiedades, { pantalla: 'ventas' });
    assert.deepEqual(nav[1].propiedades, {});
    assert.ok(!JSON.stringify(nav).includes('Rosa'));
  });

  await t.test('formato inválido → 400', async () => {
    const r = await pedir(srv, 'POST', '/api/telemetria/eventos', { cuerpo: { eventos: 'hola' } });
    assert.equal(r.status, 400);
  });
});

test('sin TELEMETRIA_SAL la telemetría queda apagada y la app sigue igual', async (t) => {
  delete process.env.TELEMETRIA_SAL;
  const srv = await arrancar({ TELEMETRIA_SAL: '' });
  t.after(() => srv.close());
  registro.length = 0;
  const r = await pedir(srv, 'GET', '/api/categorias');
  await esperar(20);
  assert.equal(r.status, 200);
  assert.equal(consultasDe('rpc:telemetria_registrar').length, 0);
});
