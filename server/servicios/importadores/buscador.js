// ============================================================
// BUSCADOR POR CÓDIGO O NOMBRE — server/servicios/importadores/buscador.js
// Arma un Map donde cada registro se encuentra por su código o por su
// nombre (sin importar mayúsculas, tildes ni espacios de más). Así, en
// una columna "Código material" / "Código producto" el usuario puede
// escribir el código o el nombre.
// Un nombre repetido (dos registros con el mismo nombre) NO se agrega:
// sería ambiguo; en ese caso hay que usar el código.
// ============================================================
function claveBusqueda(valor) {
  return String(valor == null ? '' : valor).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

function mapaCodigoONombre(registros, transformar = (r) => r) {
  const mapa = new Map();
  const nombresRepetidos = new Set();
  const porNombre = new Map();
  for (const r of registros || []) {
    const valor = transformar(r);
    if (r.codigo) mapa.set(claveBusqueda(r.codigo), valor);
    const n = claveBusqueda(r.nombre);
    if (!n) continue;
    if (porNombre.has(n)) nombresRepetidos.add(n); else porNombre.set(n, valor);
  }
  for (const [n, valor] of porNombre) {
    if (!nombresRepetidos.has(n) && !mapa.has(n)) mapa.set(n, valor);
  }
  // Map.get con la clave normalizada, para no tocar cada llamada.
  const get = mapa.get.bind(mapa);
  mapa.get = (clave) => get(claveBusqueda(clave));
  return mapa;
}

module.exports = { mapaCodigoONombre, claveBusqueda };