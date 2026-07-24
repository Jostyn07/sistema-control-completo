// ============================================================
// SERVICIO MERCADO PAGO — server/servicios/mercadopago.js
// Reemplaza a servicios/epayco.js. Tres responsabilidades:
// 1) Crear un pago único (Checkout Bricks manda un "token" de
//    tarjeta ya generado en el navegador; nuestro servidor nunca
//    ve el número de tarjeta real, igual que antes con ePayco).
// 2) Consultar el detalle de un pago por su id (el webhook de
//    Mercado Pago solo manda el id, no los datos completos).
// 3) Validar la firma del webhook (header x-signature) — esto es
//    lo único que demuestra que la notificación vino de verdad de
//    Mercado Pago. Nunca se activa una suscripción sin pasar por
//    aquí primero.
//
// Algoritmo oficial de firma (Mercado Pago):
//   manifest = "id:{id};request-id:{x-request-id};ts:{ts};"
//   firma    = HMAC_SHA256(manifest, MP_WEBHOOK_SECRET) en hex
// El header x-signature llega como "ts=...,v1=..." separado por coma.
// ============================================================
const crypto = require('crypto');

const BASE_URL = 'https://api.mercadopago.com';

function obtenerCredenciales() {
  const publicKey = process.env.MP_PUBLIC_KEY;
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const webhookSecret = process.env.MP_WEBHOOK_SECRET;
  if (!publicKey || !accessToken) {
    throw new Error('Faltan las variables de entorno de Mercado Pago (MP_PUBLIC_KEY, MP_ACCESS_TOKEN)');
  }
  return { publicKey, accessToken, webhookSecret };
}

// Crea un pago único a partir del token que generó el Brick en el
// navegador. `factura` se usa como llave de idempotencia: si la
// misma petición se reintenta (por un doble clic o un timeout de
// red), Mercado Pago no cobra dos veces.
async function crearPago({ token, monto, descripcion, correo, factura, paymentMethodId, installments, externalReference }) {
  const { accessToken } = obtenerCredenciales();

  const respuesta = await fetch(`${BASE_URL}/v1/payments`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken}`,
      'X-Idempotency-Key': factura
    },
    body: JSON.stringify({
      transaction_amount: monto,
      token,
      description: descripcion,
      installments: installments || 1,
      payment_method_id: paymentMethodId,
      payer: { email: correo },
      external_reference: externalReference,
      statement_descriptor: 'SISTEMA CONTROL'
    })
  });

  const datos = await respuesta.json();
  if (!respuesta.ok) {
    throw new Error(datos.message || 'No se pudo procesar el pago con Mercado Pago');
  }
  return datos; // incluye id, status ('approved' | 'in_process' | 'rejected'), status_detail
}

// Trae el detalle completo de un pago por su id — el webhook solo
// manda el id, nunca los datos completos del pago.
async function obtenerPago(id) {
  const { accessToken } = obtenerCredenciales();
  const respuesta = await fetch(`${BASE_URL}/v1/payments/${id}`, {
    headers: { 'Authorization': `Bearer ${accessToken}` }
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(datos.message || 'No se pudo consultar el pago en Mercado Pago');
  return datos;
}

// Valida la firma x-signature de un webhook. `dataId` es el id del
// recurso (viene en la query string, ej. ?data.id=123), tal cual
// lo manda Mercado Pago junto al header.
function validarFirmaWebhook({ xSignature, xRequestId, dataId }) {
  const { webhookSecret } = obtenerCredenciales();
  if (!webhookSecret) throw new Error('Falta configurar MP_WEBHOOK_SECRET en el servidor');
  if (!xSignature || !dataId) return false;

  const partes = Object.fromEntries(
    xSignature.split(',').map(p => p.trim().split('=').map(s => s.trim()))
  );
  const ts = partes.ts;
  const firmaRecibida = partes.v1;
  if (!ts || !firmaRecibida) return false;

  const manifest = `id:${dataId};request-id:${xRequestId || ''};ts:${ts};`;
  const firmaCalculada = crypto.createHmac('sha256', webhookSecret).update(manifest).digest('hex');
  return firmaCalculada === firmaRecibida;
}

module.exports = { obtenerCredenciales, crearPago, obtenerPago, validarFirmaWebhook };