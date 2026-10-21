// Pruebas del servicio del núcleo de inventario (sin base: cliente simulado)
const test = require('node:test');
const assert = require('node:assert');
const { aplicarOperacion, revertirOperacion, _interno } = require('../servicios/inventario/nucleo');

function clienteFalso(respuesta) {
  const llamadas = [];
  return { llamadas, rpc: async (fn, args) => { llamadas.push({ fn, args }); return respuesta; } };
}
const base = { empresaId: 'e1', usuarioId: 'u1' };

test('envía los parámetros a la RPC y devuelve el resultado', async () => {
  const c = clienteFalso({ data: { ok: true, operacion_id: 'op1', repetida: false, movimientos: [] }, error: null });
  const r = await aplicarOperacion({ ...base, tipo: 'fabricacion', clave: 'k',
    movimientos: [{ producto_id: 'p1', cantidad: 3 }, { material_id: 'm1', cantidad: '-6' }] }, c);
  assert.equal(r.ok, true);
  assert.equal(r.operacionId, 'op1');
  assert.equal(c.llamadas[0].fn, 'inventario_aplicar_operacion');
  assert.deepEqual(c.llamadas[0].args.p_movimientos[1], { material_id: 'm1', cantidad: -6 });
  assert.equal(c.llamadas[0].args.p_detalle_forzado, null);
});

test('devuelve faltantes sin lanzar error', async () => {
  const c = clienteFalso({ data: { ok: false, faltantes: [{ producto_id: 'p1', falta: 2 }] }, error: null });
  const r = await aplicarOperacion({ ...base, tipo: 'venta', movimientos: [{ producto_id: 'p1', cantidad: -5 }] }, c);
  assert.equal(r.ok, false);
  assert.equal(r.faltantes[0].falta, 2);
});

test('rechaza movimientos mal formados antes de llamar a la base', async () => {
  assert.throws(() => _interno.normalizarMovimientos([{ material_id: 'm', producto_id: 'p', cantidad: 1 }]));
  assert.throws(() => _interno.normalizarMovimientos([{ material_id: 'm', cantidad: 0 }]));
  assert.throws(() => _interno.normalizarMovimientos([]));
  const c = clienteFalso({ data: {}, error: null });
  await assert.rejects(aplicarOperacion({ ...base, tipo: 'ajuste', movimientos: [{ material_id: 'm', cantidad: 1 }] }, c), /motivo/);
  await assert.rejects(aplicarOperacion({ ...base, tipo: 'robo', movimientos: [{ material_id: 'm', cantidad: 1 }] }, c), /Tipo/);
  assert.equal(c.llamadas.length, 0);
});

test('artículo de otra empresa → 403', async () => {
  const c = clienteFalso({ data: null, error: { code: '42501', message: 'x' } });
  await assert.rejects(aplicarOperacion({ ...base, tipo: 'venta', movimientos: [{ material_id: 'm', cantidad: -1 }] }, c),
    (e) => e.status === 403);
});

test('revertir exige motivo', async () => {
  const c = clienteFalso({ data: { ok: true, operacion_id: 'r1' }, error: null });
  await assert.rejects(revertirOperacion({ ...base, operacionId: 'op1', motivo: ' ' }, c), /motivo/);
  const r = await revertirOperacion({ ...base, operacionId: 'op1', motivo: 'Venta anulada' }, c);
  assert.equal(r.operacionId, 'r1');
  assert.equal(c.llamadas[0].fn, 'inventario_revertir_operacion');
});

// ---- libro.js (Fase 2)
const libro = require('../servicios/inventario/libro');

test('movimientosDeMateriales: signo, redondeo y costo', () => {
  const mapa = new Map([
    ['m1', { material: { costo_unitario: 1200 }, requerido: 0.1 * 3 }],
    ['m2', { material: {}, requerido: 0 }]
  ]);
  assert.deepEqual(libro.movimientosDeMateriales(mapa, -1), [{ material_id: 'm1', cantidad: -0.3, costo_unitario: 1200 }]);
  assert.equal(libro.movimientosDeMateriales(mapa, +1)[0].cantidad, 0.3);
});

test('faltantesLegibles conserva el formato que usan las pantallas', () => {
  const [f] = libro.faltantesLegibles([{ material_id: 'm1', nombre: 'Rosa roja', disponible: 4, requerido: 6, falta: 2 }],
    new Map([['m1', 'unidad']]));
  assert.equal(f.material, 'Rosa roja');
  assert.equal(f.stock_actual, 4);
  assert.equal(f.unidad, 'unidad');
  assert.equal(f.falta, 2);
});

test('claveDe solo acepta claves seguras', () => {
  const req = (clave, h) => ({ body: { clave }, get: () => h });
  assert.equal(libro.claveDe(req('abc12345-XYZ'), 'venta'), 'venta:abc12345-XYZ');
  assert.equal(libro.claveDe(req('corta'), 'venta'), null);
  assert.equal(libro.claveDe(req(undefined, "x'; drop"), 'venta'), null);
  assert.equal(libro.claveDe(req(undefined, 'encabezado-12345'), 'venta'), 'venta:encabezado-12345');
});

test('acepta stock_objetivo para ajustes y rechaza negativos', () => {
  assert.deepEqual(_interno.normalizarMovimientos([{ material_id: 'm', stock_objetivo: '7' }]), [{ material_id: 'm', stock_objetivo: 7 }]);
  assert.throws(() => _interno.normalizarMovimientos([{ material_id: 'm', stock_objetivo: -1 }]));
});

// ---- Fase 3: productos terminados
const { _interno: rutaProductos } = require('../rutas/inventario-productos');
test('semáforo de productos terminados', () => {
  assert.equal(rutaProductos.estadoStock(5, 0, false), 'sin_control');
  assert.equal(rutaProductos.estadoStock(0, 2, true), 'rojo');
  assert.equal(rutaProductos.estadoStock(-1, 0, true), 'rojo');
  assert.equal(rutaProductos.estadoStock(2, 2, true), 'amarillo');
  assert.equal(rutaProductos.estadoStock(3, 2, true), 'verde');
});
