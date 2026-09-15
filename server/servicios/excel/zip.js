// ============================================================
// ZIP DE EXCEL — server/servicios/excel/zip.js
// Empaqueta varios archivos .xlsx (uno por módulo) en un único
// .zip para las descargas masivas ("Descargar todas las
// plantillas" / "Descargar toda mi información").
// ============================================================
const archiver = require('archiver');
const { PassThrough } = require('stream');

// archivos: [{ nombre: '01_Materiales.xlsx', buffer: Buffer }, ...]
// Devuelve una Promise<Buffer> con el .zip ya armado.
function crearZip(archivos) {
  return new Promise((resolve, reject) => {
    const salida = new PassThrough();
    const trozos = [];
    salida.on('data', (trozo) => trozos.push(trozo));
    salida.on('end', () => resolve(Buffer.concat(trozos)));
    salida.on('error', reject);

    const zip = archiver('zip', { zlib: { level: 9 } });
    zip.on('error', reject);
    zip.pipe(salida);

    for (const archivo of archivos) {
      zip.append(archivo.buffer, { name: archivo.nombre });
    }
    zip.finalize();
  });
}

module.exports = { crearZip };