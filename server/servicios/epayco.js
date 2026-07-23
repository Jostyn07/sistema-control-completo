const crypto = require('crypto');

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

module.exports = { obtenerCredenciales, validarFirmaWebhook };