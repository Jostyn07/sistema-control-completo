// Importación con IA: lectura, transformaciones y conversión (IA simulada)
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const XLSX = require('xlsx');

// Simula la respuesta de OpenAI: nunca sale a internet en las pruebas
let respuestaIA;
require.cache[path.resolve(__dirname, '../servicios/ia/openai.js')] = {
  id: 'x', filename: 'x', loaded: true,
  exports: { pedirJson: async () => ({ json: respuestaIA, modelo: 'simulado', tokensEntrada: 10, tokensSalida: 5 }), iaConfigurada: () => true }
};
const { convertirConIA, _interno } = require('../servicios/ia/convertidor');
const { leerFilas } = require('../servicios/excel/lector');

function libroDesordenado() {
  const libro = XLSX.utils.book_new();
  const hoja = XLSX.utils.aoa_to_sheet([
    ['INVENTARIO DE INSUMOS - FLORISTERÍA'],
    [],
    ['Insumo', 'Medida', 'Precio compra', 'Distribuidor', 'Hay'],
    ['Rosa roja', 'unidad', '$ 2.500', 'Flores SAS', '1.200'],
    ['Cinta satín', 'metro', '1.250,50', 'Mercería Ana', 30],
    ['', '', '', '', ''],
    ['TOTAL', '', '', '', '']
  ]);
  XLSX.utils.book_append_sheet(libro, hoja, 'Hoja1');
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

test('números en formato colombiano y otros', () => {
  const n = _interno.aNumeroTexto;
  assert.equal(n('$ 2.500'), '2500');
  assert.equal(n('1.250,50'), '1250.5');
  assert.equal(n('1,250.50'), '1250.5');
  assert.equal(n('3.5'), '3.5');
  assert.equal(n('1.234.567'), '1234567');
  assert.equal(n(42), '42');
});

test('fechas: serie de Excel, día/mes/año e ISO', () => {
  const f = _interno.aFechaTexto;
  assert.equal(f(46000), '2025-12-09');
  assert.equal(f('15/03/2026'), '2026-03-15');
  assert.equal(f('2026-03-15'), '2026-03-15');
  assert.equal(f('5-1-26'), '2026-01-05');
});

test('la muestra para la IA es limitada', () => {
  const hojas = _interno.leerLibroCrudo(libroDesordenado());
  const m = _interno.muestraParaIA(hojas);
  assert.equal(m[0].hoja, 'Hoja1');
  assert.ok(m[0].filas.length <= 26);
});

test('convierte un Excel cualquiera al formato de la plantilla (materiales)', async () => {
  respuestaIA = {
    modulo: 'materiales', confianza: 0.9, resumen: 'Lista de insumos', advertencias: [],
    hojas: [{
      hoja_destino: 'Datos', hoja_origen: 'Hoja1', fila_encabezado: 2, fila_inicio_datos: 3, // numeración de la muestra (sin filas vacías)
      columnas: [
        { clave: 'nombre', columna_indice: 0, encabezado_origen: 'Insumo', transformacion: 'ninguna', valor_fijo: '' },
        { clave: 'unidad', columna_indice: 1, encabezado_origen: 'Medida', transformacion: 'ninguna', valor_fijo: '' },
        { clave: 'costo_unitario', columna_indice: 2, encabezado_origen: 'Precio compra', transformacion: 'numero', valor_fijo: '' },
        { clave: 'proveedor', columna_indice: 3, encabezado_origen: 'Distribuidor', transformacion: 'ninguna', valor_fijo: '' },
        { clave: 'stock_actual', columna_indice: 4, encabezado_origen: 'Hay', transformacion: 'numero', valor_fijo: '' },
        { clave: 'inventada', columna_indice: 1, encabezado_origen: 'x', transformacion: 'ninguna', valor_fijo: '' }
      ]
    }]
  };
  const r = await convertirConIA({ buffer: libroDesordenado(), modulo: 'auto' });
  assert.equal(r.modulo, 'materiales');
  assert.equal(r.filas_convertidas, 3); // 2 insumos + fila TOTAL (la descarta el validador)
  const filas = leerFilas(r.buffer);
  assert.equal(filas[0]['Nombre'], 'Rosa roja');
  assert.equal(filas[0]['Costo unitario'], '2500');
  assert.equal(filas[1]['Costo unitario'], '1250.5');
  assert.equal(filas[0]['Stock actual'], '1200');
  assert.ok(!('inventada' in filas[0]));
  assert.ok(r.mapeo[0].columnas.some(c => c.destino === 'Nombre' && c.desde === 'Insumo'));
});

test('módulo elegido por el usuario manda sobre el de la IA', async () => {
  respuestaIA = { ...respuestaIA, modulo: 'productos' };
  const r = await convertirConIA({ buffer: libroDesordenado(), modulo: 'materiales' });
  assert.equal(r.modulo, 'materiales');
});

test('si no hay filas que correspondan, avisa en vez de importar vacío', async () => {
  respuestaIA = { modulo: 'materiales', confianza: 0.2, resumen: '', advertencias: [], hojas: [] };
  await assert.rejects(convertirConIA({ buffer: libroDesordenado(), modulo: 'materiales' }), /No se encontraron filas/);
});
