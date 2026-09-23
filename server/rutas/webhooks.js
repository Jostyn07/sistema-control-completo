// ============================================================
// WEBHOOKS  (/api/webhooks) — PÚBLICO, sin sesión de usuario.
// Wompi llama esta URL directo desde sus servidores para confirmar
// el resultado de una transacción; nunca manda nuestro token de
// sesión. La única defensa contra fraude es validar el checksum
// (signature.checksum / header X-Event-Checksum) en cada solicitud —
// nunca activar nada sin pasar por ahí.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const wompi = require('../servicios/wompi');
const { enviarSuscripcionMeta } = require('../servicios/meta-capi');
const router = express.Router();

// POST /api/webhooks/wompi
// Wompi manda el objeto de la transacción completo en el evento (a
// diferencia de otras pasarelas, no hay que volver a consultar la API
// para saber el estado) — pero el checksum SIEMPRE se valida antes de
// leer nada de ese cuerpo.
router.post('/wompi', async (req, res, next) => {
  try {
    const cuerpo = req.body;

    // Solo nos interesan los cambios de estado de una transacción —
    // Wompi también manda otros eventos (ej. payout.updated) que no
    // aplican a esta integración.
    if (cuerpo?.event !== 'transaction.updated') {
      return res.status(200).json({ ok: true, ignorado: cuerpo?.event });
    }

    if (!wompi.validarChecksumWebhook(cuerpo)) {
      console.error('[Wompi] Checksum inválido, se ignora la notificación');
      return res.status(400).json({ error: 'Checksum inválido' });
    }

    const transaccion = cuerpo.data?.transaction;
    if (!transaccion?.id) return res.status(200).json({ ok: true, ignorado: 'sin transacción' });

    // Idempotencia: Wompi puede reintentar el mismo evento hasta 3
    // veces si no respondemos 2xx a tiempo — si ya lo procesamos
    // (aquí o en /confirmar-pago), no lo duplicamos.
    const { data: yaExiste } = await supabase
      .from('pagos_suscripcion').select('id, estado').eq('wompi_transaction_id', transaccion.id).maybeSingle();

    const [prefijo, usuarioId, planId] = String(transaccion.reference || '').split('_');
    const aceptado = transaccion.status === 'APPROVED';

    if (!yaExiste) {
      // Se registra el pago siempre (aceptado o no), para trazabilidad
      const { error: ePago } = await supabase.from('pagos_suscripcion').insert({
        usuario_id: prefijo === 'SUB' ? usuarioId : null,
        plan_id: prefijo === 'SUB' ? planId : null,
        wompi_transaction_id: transaccion.id,
        monto: Math.round(Number(transaccion.amount_in_cents) / 100),
        estado: transaccion.status,
        datos_crudos: transaccion
      });
      if (ePago) throw new Error(ePago.message);
    } else if (yaExiste.estado !== transaccion.status) {
      // El estado avanzó (ej. de PENDING a APPROVED en un pago PSE) —
      // se actualiza el registro existente en vez de duplicarlo.
      await supabase.from('pagos_suscripcion')
        .update({ estado: transaccion.status, datos_crudos: transaccion })
        .eq('id', yaExiste.id);
    }

    // Solo se activa la suscripción si el pago fue aceptado Y trae el
    // usuario/plan (siempre deberían venir, se mandaron en la
    // referencia al abrir el Widget).
    if (aceptado && prefijo === 'SUB' && usuarioId && planId) {
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

      // Conversión para Meta. Cubre sobre todo los pagos que se aprueban
      // después (PSE): el navegador ya no está abierto para avisarle a
      // Meta. Si /confirmar-pago ya la envió, Meta la descarta por el
      // mismo event_id. Solo se envía si el estado CAMBIÓ a aprobado,
      // para no repetirla en cada reintento de Wompi.
      if (!yaExiste || yaExiste.estado !== 'APPROVED') {
        const { data: plan } = await supabase
          .from('planes_suscripcion').select('id, nombre').eq('id', planId).maybeSingle();
        await enviarSuscripcionMeta({ transaccion, plan, usuarioId });
      }
    }

    res.status(200).json({ ok: true });
  } catch (err) {
    console.error('[Wompi] Error procesando webhook:', err.message);
    // Igual respondemos 200 para que Wompi no reintente infinitamente
    // un error que ya quedó registrado en los logs
    res.status(200).json({ ok: false });
  }
});

module.exports = router;