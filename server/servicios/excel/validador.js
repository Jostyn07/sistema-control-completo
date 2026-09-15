// ============================================================
// VALIDADOR DE EXCEL — server/servicios/excel/validador.js
// Funciones genéricas para leer e interpretar el valor de una
// celda. Cada importador de módulo (materiales, productos, etc.)
// las combina según sus propias reglas de negocio — este archivo
// no sabe nada de "material" ni "producto".
//
// Las funciones "a..." CONVIERTEN un valor de celda (siempre texto,
// porque así lo entrega el lector) a su tipo real. Devuelven
// `undefined` cuando el valor no se puede interpretar — el
// importador decide entonces qué mensaje de error mostrar.
//
// Las funciones que terminan en "Valido" VALIDAN y devuelven
// `null` si está bien, o un mensaje de error listo para el usuario.
// ============================================================

function aTextoLimpio(valor) {
  return valor == null ? '' : String(valor).trim();
}

// undefined = no es un número válido
function aNumero(valor) {
  const texto = aTextoLimpio(valor);
  if (texto === '') return null;
  const numero = Number(texto.replace(',', '.'));
  return isNaN(numero) ? undefined : numero;
}

// undefined = no es ni SI ni NO
const TEXTOS_VERDADERO = ['SI', 'SÍ', 'S', '1', 'TRUE', 'VERDADERO'];
const TEXTOS_FALSO = ['NO', 'N', '0', 'FALSE', 'FALSO'];
function aBooleanoSiNo(valor) {
  const texto = aTextoLimpio(valor).toUpperCase();
  if (texto === '') return null;
  if (TEXTOS_VERDADERO.includes(texto)) return true;
  if (TEXTOS_FALSO.includes(texto)) return false;
  return undefined;
}

function requerido(valor, nombreCampo) {
  return aTextoLimpio(valor) === '' ? `${nombreCampo} es obligatorio` : null;
}

function numeroValido(valor, nombreCampo, { minimo, opcional = false } = {}) {
  const texto = aTextoLimpio(valor);
  if (texto === '') return opcional ? null : `${nombreCampo} es obligatorio`;
  const numero = aNumero(valor);
  if (numero === undefined) return `${nombreCampo} debe ser un número`;
  if (minimo != null && numero < minimo) return `${nombreCampo} debe ser mayor o igual a ${minimo}`;
  return null;
}

function siNoValido(valor, nombreCampo, { opcional = true } = {}) {
  const texto = aTextoLimpio(valor);
  if (texto === '') return opcional ? null : `${nombreCampo} es obligatorio (SI o NO)`;
  return aBooleanoSiNo(valor) === undefined ? `${nombreCampo} debe ser SI o NO` : null;
}

function enListaValido(valor, nombreCampo, listaValida, { opcional = false } = {}) {
  const texto = aTextoLimpio(valor);
  if (texto === '') return opcional ? null : `${nombreCampo} es obligatorio`;
  const encontrado = listaValida.some((v) => v.toUpperCase() === texto.toUpperCase());
  return encontrado ? null : `${nombreCampo} debe ser uno de: ${listaValida.join(', ')}`;
}

function fechaDesdePartes(anio, mes, dia) {
  const a = Number(anio), m = Number(mes), d = Number(dia);
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  const fecha = new Date(Date.UTC(a, m - 1, d));
  // Si el motor de fechas "corrigió" un día inválido (ej. 31/02) a otro
  // mes, es que la fecha no existía de verdad.
  if (isNaN(fecha.getTime()) || fecha.getUTCMonth() !== m - 1) return undefined;
  return fecha.toISOString().slice(0, 10); // YYYY-MM-DD
}

// undefined = no se pudo interpretar como fecha. Acepta AAAA-MM-DD (ISO)
// y DD/MM/AAAA o DD-MM-AAAA (el formato que usa el resto de la plataforma).
function aFechaISO(valor) {
  const texto = aTextoLimpio(valor);
  if (texto === '') return null;
  let coincidencia = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(texto);
  if (coincidencia) return fechaDesdePartes(coincidencia[1], coincidencia[2], coincidencia[3]);
  coincidencia = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/.exec(texto);
  if (coincidencia) return fechaDesdePartes(coincidencia[3], coincidencia[2], coincidencia[1]);
  return undefined;
}

function fechaValida(valor, nombreCampo, { opcional = true } = {}) {
  const texto = aTextoLimpio(valor);
  if (texto === '') return opcional ? null : `${nombreCampo} es obligatorio`;
  return aFechaISO(valor) === undefined ? `${nombreCampo} debe tener formato DD/MM/AAAA` : null;
}

module.exports = {
  aTextoLimpio,
  aNumero,
  aBooleanoSiNo,
  aFechaISO,
  requerido,
  numeroValido,
  siNoValido,
  enListaValido,
  fechaValida
};