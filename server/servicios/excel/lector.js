// ============================================================
// LECTOR DE EXCEL — server/servicios/excel/lector.js
// Convierte el .xlsx que el usuario sube (un buffer) en filas de
// texto simples. La mayoría de módulos solo tiene una hoja de
// datos ("Datos"), pero algunos —como Procesos— traen más de una
// tabla en el mismo archivo, así que también se puede leer
// cualquier hoja por su nombre.
// ============================================================
const XLSX = require('xlsx');
const { HOJA_DATOS } = require('./generador');

class ErrorLecturaExcel extends Error {}

function parsear(buffer) {
  let libro;
  try {
    libro = XLSX.read(buffer, { type: 'buffer' });
  } catch (err) {
    throw new ErrorLecturaExcel('El archivo no parece ser un Excel válido (.xlsx)');
  }
  if (!libro.SheetNames || libro.SheetNames.length === 0) {
    throw new ErrorLecturaExcel('El archivo de Excel está vacío');
  }
  return libro;
}

// Devuelve un arreglo de objetos { "Encabezado tal cual": "valor" }
// usando la primera fila de la hoja como encabezados.
// - defval: '' evita "undefined" en celdas vacías.
// - raw: false hace que todo llegue como texto (igual a como se ve
//   en Excel), para no tener que adivinar tipos de celda después.
// - blankrows: false ignora filas completamente vacías.
// - opcional: true → si la hoja no existe, devuelve [] en vez de fallar
//   (útil para hojas secundarias que el usuario puede dejar sin tocar).
function leerHoja(buffer, nombreHoja, { opcional = false } = {}) {
  const libro = parsear(buffer);
  const hoja = libro.Sheets[nombreHoja];
  if (!hoja) {
    if (opcional) return [];
    throw new ErrorLecturaExcel(`No se encontró la hoja "${nombreHoja}" en el archivo`);
  }
  return XLSX.utils.sheet_to_json(hoja, { defval: '', raw: false, blankrows: false });
}

// Compatibilidad con los módulos de una sola hoja: lee "Datos", o la
// última hoja del archivo si alguien la renombró por error.
function leerFilas(buffer) {
  const libro = parsear(buffer);
  const nombreHoja = libro.SheetNames.includes(HOJA_DATOS)
    ? HOJA_DATOS
    : libro.SheetNames[libro.SheetNames.length - 1];
  return leerHoja(buffer, nombreHoja);
}

module.exports = { leerFilas, leerHoja, ErrorLecturaExcel };