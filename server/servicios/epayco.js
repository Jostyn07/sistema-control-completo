// ============================================================
// SERVICIO EPAYCO — server/servicios/epayco.js
// Tres responsabilidades:
// 1) Armar los datos que el navegador necesita para abrir el
//    checkout de ePayco (usa la Public Key, que es segura de exponer).
// 2) Validar la firma del webhook de confirmación — esto es lo
//    único que realmente demuestra que el pago ocurrió. Nunca se
//    activa una suscripción sin pasar por aquí.
// 3) Registrar un método de pago guardado (tokenización): el
//    navegador captura la tarjeta directo con el script de ePayco
//    y nos manda solo un "token" — nuestro servidor NUNCA ve el
//    número de tarjeta real, solo esa referencia segura.
//
// Algoritmo de firma oficial de ePayco:
//   sha256( P_CUST_ID_CLIENTE ^ P_KEY ^ x_ref_payco ^ x_transaction_id ^ x_amount ^ x_currency_code )
// (P_CUST_ID_CLIENTE y P_KEY son secretos — viven solo en el
// servidor, nunca se mandan al navegador)
// ============================================================
const crypto = require('crypto');
const EpaycoSDK = require('epayco-sdk-node');

function obtenerCredenciales() {
  const publicKey = process.env.EPAYCO_PUBLIC_KEY;
  const custId = process.env.EPAYCO_P_CUST_ID_CLIENTE;
  const pKey = process.env.EPAYCO_P_KEY;
  const modoPrueba = process.env.EPAYCO_TEST_MODE !== 'false'; // por defecto en pruebas, hay que apagarlo a propósito
  if (!publicKey || !custId || !pKey) {
    throw new Error('Faltan las variables de entorno de ePayco (EPAYCO_PUBLIC_KEY, EPAYCO_P_CUST_ID_CLIENTE, EPAYCO_P_KEY)');
  }
  return { publicKey, custId, pKey, modoPrueba };
}

function obtenerClienteSDK() {
  const { publicKey, pKey, modoPrueba } = obtenerCredenciales();
  return EpaycoSDK({ apiKey: publicKey, privateKey: pKey, lang: 'ES', test: modoPrueba });
}

// Valida la firma que ePayco manda en el webhook de confirmación.
function validarFirmaWebhook(datos) {
  const { custId, pKey } = obtenerCredenciales();
  const cadena = [
    custId, pKey,
    datos.x_ref_payco, datos.x_transaction_id,
    datos.x_amount, datos.x_currency_code
  ].join('^');
  const firmaCalculada = crypto.createHash('sha256').update(cadena).digest('hex');
  return firmaCalculada === datos.x_signature;
}

// Registra el método de pago a partir de un token ya creado en el
// navegador (nunca recibe el número de tarjeta directamente).
async function registrarMetodoPago({ token, nombre, apellido, correo, telefono }) {
  const epayco = obtenerClienteSDK();
  const cliente = await epayco.customers.create({
    token_card: token,
    name: nombre,
    last_name: apellido || nombre,
    email: correo,
    phone: telefono || '',
    default: true
  });
  if (!cliente || cliente.status === false) {
    throw new Error((cliente && cliente.data && cliente.data.description) || 'No se pudo registrar el método de pago');
  }
  return cliente;
}

module.exports = { obtenerCredenciales, obtenerClienteSDK, validarFirmaWebhook, registrarMetodoPago };