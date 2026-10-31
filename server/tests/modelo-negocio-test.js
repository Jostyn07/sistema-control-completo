// Pruebas — fabricante/comerciante y decisión de costo al comprar
const test = require('node:test');
const assert = require('node:assert');
const { normalizarModelo, validarModelo } = require('../servicios/modelo-negocio');
const { resolverCosto } = require('../servicios/costo-compra');

test('modelo sin elegir se trata como fabricante y no definido', () => {
  assert.deepEqual(normalizarModelo({}), { fabricacion: true, reventa: false, definido: false });
  assert.deepEqual(normalizarModelo(null), { fabricacion: true, reventa: false, definido: false });
  assert.deepEqual(normalizarModelo({ modelo_negocio: { fabricacion: false, reventa: false } }).definido, false);
  assert.deepEqual(normalizarModelo({ modelo_negocio: { fabricacion: false, reventa: true } }), { fabricacion: false, reventa: true, definido: true });
});

test('validarModelo exige booleanos y al menos una opción', () => {
  assert.ok(validarModelo({ fabricacion: 'si', reventa: true }).error);
  assert.ok(validarModelo({ fabricacion: false, reventa: false }).error);
  assert.deepEqual(validarModelo({ fabricacion: true, reventa: true }).modelo, { fabricacion: true, reventa: true });
});

test('resolverCosto: mismo precio o sin costo previo no pregunta', () => {
  assert.equal(resolverCosto({ costoActual: 5000, stockActual: 10, cantidad: 5, precio: 5000 }).requiereDecision, false);
  const sinPrevio = resolverCosto({ costoActual: 0, stockActual: 0, cantidad: 5, precio: 4200 });
  assert.equal(sinPrevio.requiereDecision, false);
  assert.equal(sinPrevio.costo, 4200);
  assert.equal(sinPrevio.cambia, true);
});

test('resolverCosto: precio distinto pide decisión y calcula el promedio ponderado', () => {
  const r = resolverCosto({ costoActual: 5000, stockActual: 10, cantidad: 10, precio: 6000 });
  assert.equal(r.requiereDecision, true);
  assert.deepEqual(r.opciones, { costo_actual: 5000, costo_nuevo: 6000, costo_promedio: 5500 });
  assert.equal(resolverCosto({ costoActual: 5000, stockActual: 10, cantidad: 10, precio: 6000, decision: 'mantener' }).cambia, false);
  assert.equal(resolverCosto({ costoActual: 5000, stockActual: 10, cantidad: 10, precio: 6000, decision: 'nuevo' }).costo, 6000);
  assert.equal(resolverCosto({ costoActual: 5000, stockActual: 10, cantidad: 10, precio: 6000, decision: 'promedio' }).costo, 5500);
  // Stock negativo no distorsiona el promedio
  assert.equal(resolverCosto({ costoActual: 5000, stockActual: -4, cantidad: 2, precio: 6000, decision: 'promedio' }).costo, 6000);
  assert.equal(resolverCosto({ costoActual: 5000, stockActual: 1, cantidad: 1, precio: 6000, decision: 'otra' }).requiereDecision, true);
});

test('Excel de productos: Tipo y columnas de reventa', () => {
  const { _interno } = require('../servicios/importadores/productos');
  assert.equal(_interno.aTipo(''), '');
  assert.equal(_interno.aTipo(' Reventa '), 'reventa');
  assert.equal(_interno.aTipo('FABRICADO'), 'fabricado');
  assert.equal(_interno.aTipo('otro'), undefined);
  const base = { nombre: 'Cargador', precio_venta: 18000 };
  assert.deepEqual(_interno.validarFila({ ...base, tipo: 'REVENTA', costo_compra: 10000, existencias: 12 }), []);
  assert.ok(_interno.validarFila({ ...base, tipo: 'x' }).some(e => e.includes('Tipo')));
  assert.ok(_interno.validarFila({ ...base, existencias: -1 }).some(e => e.includes('Existencias')));
});
