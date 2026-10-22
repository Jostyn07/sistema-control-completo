// Medición de uso y encuestas (sin base de datos)
const test = require('node:test');
const assert = require('node:assert');
const { filtrarPropiedades, EVENTOS } = require('../servicios/telemetria/catalogo');
const { _interno } = require('../rutas/encuestas');

test('formularios: solo identificadores del código, nunca texto libre', () => {
  assert.deepEqual(filtrarPropiedades('formulario.cerrado', { pantalla: 'ventas', formulario: 'modalVenta', guardado: false, segundos: 12.6, texto: 'x' }),
    { pantalla: 'ventas', formulario: 'modalVenta', guardado: false, segundos: 13 });
  assert.deepEqual(filtrarPropiedades('formulario.abierto', { formulario: 'Juan Pérez 300 123' }), {});
  assert.deepEqual(filtrarPropiedades('formulario.abierto', { formulario: 'modal<script>' }), {});
  assert.ok(EVENTOS['formulario.abierto'].navegador && EVENTOS['ayuda.abierta'].navegador);
  assert.ok(!EVENTOS['suscripcion.pagada'].navegador, 'el pago solo lo informa el servidor');
});

test('encuesta de facilidad: puntaje 1–5, comentario recortado', () => {
  const { fila } = _interno.normalizar({ puntaje: 4, comentario: '  bien ' + 'x'.repeat(600), contexto: 'ventas' }, 'facilidad');
  assert.equal(fila.puntaje, 4);
  assert.equal(fila.comentario.length, 500);
  assert.equal(fila.contexto, 'ventas');
  assert.ok(_interno.normalizar({ puntaje: 9 }, 'facilidad').error);
  assert.equal(_interno.normalizar({ estado: 'respondida' }, 'facilidad').fila.estado, 'omitida', 'sin puntaje cuenta como omitida');
});

test('motivos y contextos cerrados', () => {
  assert.equal(_interno.normalizar({ motivo: 'no_entendi', contexto: 'productos:modalProducto' }, 'formulario').fila.motivo, 'no_entendi');
  assert.ok(_interno.normalizar({ motivo: 'cualquier cosa' }, 'formulario').error);
  assert.ok(_interno.normalizar({ contexto: 'productos:<b>' }, 'formulario').error);
  assert.equal(_interno.normalizar({ motivo: 'muy_caro' }, 'cancelacion').fila.motivo, 'muy_caro');
  assert.ok(_interno.normalizar({ motivo: 'no_entendi' }, 'cancelacion').error);
});
