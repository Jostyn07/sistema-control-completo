// ============================================================
// GENERADOR DE EXCEL — server/servicios/excel/generador.js
// Construye los archivos .xlsx que el usuario descarga para
// cargar o exportar información masivamente. Todo archivo que
// sale de aquí tiene siempre una hoja "Instrucciones" y, además,
// una o más hojas de datos (la mayoría de módulos solo necesita
// una — "Datos" —, pero algunos, como Procesos, necesitan dos
// tablas relacionadas en el mismo archivo).
//
// Este archivo NO sabe nada de materiales, productos, etc. — solo
// arma el libro a partir de listas de columnas que le pasa cada
// exportador de server/servicios/exportadores/.
// ============================================================
const XLSX = require('xlsx');

const HOJA_INSTRUCCIONES = 'Instrucciones';
const HOJA_DATOS = 'Datos'; // nombre de la única hoja de datos en los módulos de una sola tabla

// hojas: [{ nombre, columnas: [{ clave, encabezado, obligatorio, descripcion, ejemplo }] }]
// Si hay más de una hoja, se agrupan bajo un encabezado "Hoja «nombre»"
// para que quede claro a cuál tabla pertenece cada columna.
function hojaInstrucciones({ titulo, paraQueSirve, hojas, advertencias }) {
  const filas = [];
  filas.push([titulo]);
  filas.push([]);
  filas.push(['¿Para qué sirve este archivo?']);
  filas.push([paraQueSirve]);

  const mostrarNombreHoja = hojas.length > 1;
  for (const hoja of hojas) {
    filas.push([]);
    if (mostrarNombreHoja) filas.push([`Hoja "${hoja.nombre}"`]);
    filas.push(['Columna', 'Obligatoria', 'Qué significa', 'Ejemplo']);
    for (const col of hoja.columnas) {
      filas.push([
        col.encabezado,
        col.obligatorio ? 'Sí' : 'No',
        col.descripcion || '',
        col.ejemplo != null ? String(col.ejemplo) : ''
      ]);
    }
  }

  if (advertencias && advertencias.length) {
    filas.push([]);
    filas.push(['Advertencias']);
    for (const advertencia of advertencias) filas.push([advertencia]);
  }
  const hoja = XLSX.utils.aoa_to_sheet(filas);
  hoja['!cols'] = [{ wch: 26 }, { wch: 12 }, { wch: 70 }, { wch: 22 }];
  return hoja;
}

function hojaDatos({ columnas, filas }) {
  const encabezados = columnas.map((c) => c.encabezado);
  const datos = [encabezados, ...filas];
  const hoja = XLSX.utils.aoa_to_sheet(datos);
  hoja['!cols'] = columnas.map(() => ({ wch: 22 }));
  return hoja;
}

// Arma un libro con VARIAS hojas de datos (además de Instrucciones).
// hojas: [{ nombre, columnas, filas }] — si una hoja no trae `filas`
// (o viene vacío), queda con UNA fila de ejemplo tomada de sus columnas
// — así es como se ve una plantilla recién descargada.
function crearLibroMultiHoja({ titulo, paraQueSirve, hojas, advertencias }) {
  const libro = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    libro,
    hojaInstrucciones({ titulo, paraQueSirve, hojas, advertencias }),
    HOJA_INSTRUCCIONES
  );

  for (const hoja of hojas) {
    const filasDatos = hoja.filas && hoja.filas.length
      ? hoja.filas
      : [hoja.columnas.map((c) => (c.ejemplo != null ? c.ejemplo : ''))];
    XLSX.utils.book_append_sheet(libro, hojaDatos({ columnas: hoja.columnas, filas: filasDatos }), hoja.nombre);
  }

  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

// Caso simple (la mayoría de módulos): una sola hoja de datos llamada
// "Datos". Se apoya en crearLibroMultiHoja para no duplicar lógica.
function crearLibro({ titulo, paraQueSirve, columnas, filas, advertencias }) {
  return crearLibroMultiHoja({ titulo, paraQueSirve, advertencias, hojas: [{ nombre: HOJA_DATOS, columnas, filas }] });
}

module.exports = { crearLibro, crearLibroMultiHoja, HOJA_INSTRUCCIONES, HOJA_DATOS };