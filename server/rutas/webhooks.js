// ============================================================
// WEBHOOKS  (/api/webhooks) — PÚBLICO, sin sesión de usuario.
// Mercado Pago llama esta URL directo desde sus servidores para
// confirmar el resultado de un pago; nunca manda nuestro token.
// La única defensa contra fraude es validar la firma (x-signature)
// en cada solicitud — nunca activar nada sin pasar por ahí.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const mercadopago = require('../servicios/mercadopago');
const router = express.Router();

// POST /api/webhooks/mercadopago
// Mercado Pago solo manda el id del recurso en la notificación — hay
// que consultar el pago completo con ese id antes de decidir nada.
router.post('/mercadopago', async (req, res, next) => {
  try {
    const tipo = req.body?.type || req.query.type;
    const dataId = req.body?.data?.id || req.query['data.id'] || req.query.id;
    const xSignature = req.headers['x-signature'];
    const xRequestId = req.headers['x-request-id'];

    // Ignoramos notificaciones que no sean de un pago (Mercado Pago
    // también manda otras, como merchant_order) — nunca activamos
    // nada a partir de esos otros tipos.
    if (tipo !== 'payment') return res.status(200).json({ ok: true, ignorado: tipo });

    if (!mercadopago.validarFirmaWebhook({ xSignature, xRequestId, dataId })) {
      console.error('[MercadoPago] Firma inválida, se ignora la notificación:', dataId);
      return res.status(400).json({ error: 'Firma inválida' });
    }

    // Idempotencia: Mercado Pago puede reintentar el mismo webhook
    // varias veces — si ya procesamos este pago, no lo duplicamos.
    const { data: yaExiste } = await supabase
      .from('pagos_suscripcion').select('id').eq('mp_payment_id', String(dataId)).maybeSingle();
    if (yaExiste) return res.status(200).json({ ok: true, ya_procesado: true });

    const pago = await mercadopago.obtenerPago(dataId);
    const [usuarioId, planId] = String(pago.external_reference || '').split(':');
    const aceptado = pago.status === 'approved';

    // Se registra el pago siempre (aceptado o no), para trazabilidad
    const { error: ePago } = await supabase.from('pagos_suscripcion').insert({
      usuario_id: usuarioId || null,
      plan_id: planId || null,
      mp_payment_id: String(dataId),
      monto: Number(pago.transaction_amount),
      estado: pago.status,
      datos_crudos: pago
    });
    if (ePago) throw new Error(ePago.message);

    // Solo se activa la suscripción si el pago fue aceptado Y trae
    // el usuario/plan (siempre deberían venir, se mandaron en
    // external_reference al crear el pago).
    if (aceptado && usuarioId && planId) {
      const ahora = new Date();
      const vencimiento = new Date(ahora);
      vencimiento.setDate(vencimiento.getDate() + 30);

      const { error: eSusc } = await supabase
        .from('suscripciones')
        .upsert({
          usuario_id: usuarioId,
          plan_id: planId,
          estado: 'activa',
          fecha_inicio: ahora.toISOString(),
          fecha_vencimiento: vencimiento.toISOString(),
          actualizado_en: ahora.toISOString()
        });
      if (eSusc) throw new Error(eSusc.message);
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[MercadoPago] Error procesando webhook:', err.message);
    // Igual respondemos 200 para que Mercado Pago no reintente
    // infinitamente un error que ya quedó registrado en los logs
    res.status(200).json({ ok: false });
  }
});

module.exports = router;