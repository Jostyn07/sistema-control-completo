// Precios de suscripción: mensual / anual (30 %) y vencimientos
const test = require('node:test');
const assert = require('node:assert');
const p = require('../servicios/precios');

test('montos mensual y anual', () => {
  assert.equal(p.calcularMonto(10000, 'mensual', false), 5000);   // 50 % primer pago
  assert.equal(p.calcularMonto(10000, 'mensual', true), 10000);
  assert.equal(p.calcularMonto(10000, 'anual', false), 84000);    // 120.000 − 30 %
  assert.equal(p.calcularMonto(25000, 'anual', true), 210000);    // no se acumula con el 50 %
  assert.equal(p.calcularMonto(10000, 'otro', true), 10000);      // periodo raro → mensual
});

test('monto mínimo aceptable impide pagar mes y llevarse un año', () => {
  assert.ok(5000 < p.montoMinimoAceptable(10000, 'anual'));
  assert.equal(p.montoMinimoAceptable(10000, 'mensual'), 5000);
});

test('referencia con periodo y compatibilidad con las viejas', () => {
  const r = p.armarReferencia('emp-1', 'plan-1', 'anual');
  assert.deepEqual({ ...p.leerReferencia(r) }, { prefijo: 'SUB', empresaId: 'emp-1', planId: 'plan-1', periodo: 'anual' });
  assert.equal(p.leerReferencia('SUB_emp_plan_1712345678901').periodo, 'mensual');
});

test('vencimiento suma sobre los días que quedan', () => {
  const ahora = new Date('2026-10-10T12:00:00Z');
  const enDiez = new Date('2026-10-20T12:00:00Z');
  assert.equal(p.calcularVencimiento(enDiez, 'activa', 'anual', ahora).toISOString(), '2027-10-20T12:00:00.000Z');
  assert.equal(p.calcularVencimiento(enDiez, 'prueba', 'mensual', ahora).toISOString(), '2026-11-09T12:00:00.000Z');
  assert.equal(p.calcularVencimiento('2026-01-01', 'vencida', 'mensual', ahora).toISOString(), '2026-11-09T12:00:00.000Z');
});
