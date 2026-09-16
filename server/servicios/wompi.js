// ============================================================
// SERVICIO WOMPI — server/servicios/wompi.js
// Reemplaza a servicios/mercadopago.js. Tres responsabilidades:
// 1) Generar la firma de integridad que el Widget de Wompi exige
//    en el navegador (nunca se genera en el cliente: usaría el
//    secreto de integridad expuesto).
// 2) Consultar el detalle de una transacción por su id — el
//    navegador nos entrega un id al cerrar el Widget, pero eso NO
//    basta para activar nada: hay que confirmarlo contra la API.
// 3) Validar el checksum del webhook de eventos (header
//    X-Event-Checksum / campo signature.checksum). Nunca se activa
//    una suscripción sin pasar por aquí primero.
//
// Ambientes: Wompi usa una URL base distinta para pruebas y para
// producción, y se detecta sola por el prefijo de la llave pública
// (pub_test_ vs pub_prod_) — así no hace falta otra variable de
// entorno que se pueda desincronizar de la llave real.
//
// Firma de integridad (Widget):
//   SHA256(referencia + montoEnCentavos + moneda + secretoIntegridad)
//
// Checksum de eventos (webhook):
//   Se toman los campos listados en el propio evento
//   (signature.properties, en el orden en que vienen — nunca se
//   asume un orden fijo), se concatenan sus valores, luego el
//   timestamp del evento, luego el secreto de eventos, y se aplica
//   SHA256. Se compara contra signature.checksum.
// ============================================================
const crypto = require('crypto');

function obtenerCredenciales() {
  const publicKey = process.env.WOMPI_PUBLIC_KEY;
  const integritySecret = process.env.WOMPI_INTEGRITY_SECRET;
  const eventsSecret = process.env.WOMPI_EVENTS_SECRET;
  if (!publicKey || !integritySecret) {
    throw new Error('Faltan las variables de entorno de Wompi (WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET)');
  }
  return { publicKey, integritySecret, eventsSecret };
}

// La llave pública determina el ambiente: pub_test_ → sandbox, pub_prod_ → producción.
function obtenerBaseUrl(publicKey) {
  return publicKey.startsWith('pub_test_')
    ? 'https://sandbox.wompi.co/v1'
    : 'https://production.wompi.co/v1';
}

// Genera la firma de integridad que exige el Widget para abrir el
// checkout. Debe calcularse en el servidor: el secreto de integridad
// nunca debe llegar al navegador.
function generarFirmaIntegridad({ referencia, montoEnCentavos, moneda }) {
  const { integritySecret } = obtenerCredenciales();
  const cadena = `${referencia}${montoEnCentavos}${moneda}${integritySecret}`;
  return crypto.createHash('sha256').update(cadena).digest('hex');
}

// Consulta el estado real de una transacción por su id. Se usa tanto
// en la confirmación síncrona (cuando el Widget se cierra) como,
// opcionalmente, para reconciliar manualmente — nunca se confía en
// el estado que reporta el navegador.
async function consultarTransaccion(id) {
  const { publicKey } = obtenerCredenciales();
  const baseUrl = obtenerBaseUrl(publicKey);
  const respuesta = await fetch(`${baseUrl}/transactions/${id}`, {
    headers: { 'Authorization': `Bearer ${publicKey}` }
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos?.error?.reason || 'No se pudo consultar la transacción en Wompi');
  return datos.data; // incluye id, reference, status ('APPROVED' | 'DECLINED' | 'PENDING' | 'VOIDED' | 'ERROR'), amount_in_cents
}

// Lee un valor anidado a partir de una ruta con puntos, ej.
// "transaction.status" sobre { transaction: { status: 'APPROVED' } }.
function leerValorAnidado(objeto, ruta) {
  return ruta.split('.').reduce((acc, llave) => (acc == null ? acc : acc[llave]), objeto);
}

// Valida el checksum de un evento de webhook. `cuerpo` es el JSON
// completo tal cual lo mandó Wompi (incluye data, signature, timestamp).
// Las propiedades a concatenar SIEMPRE se toman de signature.properties
// del propio evento — nunca se asume un arreglo fijo en el código,
// porque Wompi puede variarlas entre eventos.
function validarChecksumWebhook(cuerpo) {
  const { eventsSecret } = obtenerCredenciales();
  if (!eventsSecret) throw new Error('Falta configurar WOMPI_EVENTS_SECRET en el servidor');

  const propiedades = cuerpo?.signature?.properties;
  const checksumRecibido = cuerpo?.signature?.checksum;
  const timestamp = cuerpo?.timestamp;
  if (!Array.isArray(propiedades) || !checksumRecibido || timestamp == null) return false;

  const valoresConcatenados = propiedades
    .map(ruta => leerValorAnidado(cuerpo.data, ruta))
    .join('');

  const cadena = `${valoresConcatenados}${timestamp}${eventsSecret}`;
  const checksumCalculado = crypto.createHash('sha256').update(cadena).digest('hex');
  return checksumCalculado === checksumRecibido;
}

module.exports = { obtenerCredenciales, obtenerBaseUrl, generarFirmaIntegridad, consultarTransaccion, validarChecksumWebhook };