// ============================================================
// SUSCRIPCIÓN  (/api/suscripcion) — requiere sesión
// - GET  /planes          catálogo de planes disponibles (con
//                         sus límites Y qué funciones incluyen)
// - GET  /mi-suscripcion  estado actual del usuario (pone al día
//                         el vencimiento antes de responder)
// - POST /iniciar-pago    prepara los datos para abrir el Widget de
//                         Wompi (referencia + firma de integridad);
//                         aplica 50% de descuento si es el primer
//                         pago real del usuario
// - POST /confirmar-pago  el navegador llama esto cuando el Widget
//                         se cierra, con el id de transacción que
//                         Wompi le entregó; el servidor SIEMPRE
//                         reconsulta ese id contra la API de Wompi
//                         antes de activar nada — nunca se confía
//                         en el estado que reporta el navegador
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const wompi = require('../servicios/wompi');
const { sincronizarEstadoSuscripcion, calcularBloqueo, tienePagoAceptadoPrevio, crearPruebaGratis } = require('../servicios/suscripcion');
const router = express.Router();

// GET /api/suscripcion/llave-publica-wompi
router.get('/llave-publica-wompi', async (req, res, next) => {
  try {
    const { publicKey } = wompi.obtenerCredenciales();
    res.json({ public_key: publicKey });
  } catch (err) { next(err); }
});

// GET /api/suscripcion/planes
router.get('/planes', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('planes_suscripcion').select('*').eq('activo', true).order('orden');
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/suscripcion/mi-suscripcion
router.get('/mi-suscripcion', async (req, res, next) => {
  try {
    let sub = await sincronizarEstadoSuscripcion(req.usuarioId); // marca "vencida" si ya tocaba

    // Red de seguridad: si por cualquier motivo nunca se le creó la
    // prueba (falla puntual en el registro, o entró por primera vez
    // con Google, que ni siquiera pasa por /registro), se la damos
    // aquí mismo — el primer momento en que la cuenta pregunta por
    // su propio estado. Así no depende de un único punto de falla.
    if (!sub) {
      try {
        await crearPruebaGratis(req.usuarioId);
        sub = await sincronizarEstadoSuscripcion(req.usuarioId);
      } catch (errRed) {
        console.error('[mi-suscripcion] La red de seguridad tampoco pudo crear la prueba:', errRed.message);
      }
    }

    if (!sub) return res.json({ estado: 'sin_suscripcion' });

    const { data, error } = await supabase
      .from('suscripciones')
      .select(`*, planes_suscripcion(
        nombre, precio_mensual, limite_materiales, limite_productos, limite_ventas_mes,
        incluye_rentabilidad_productos, incluye_analisis_clientes, incluye_meta_ventas, incluye_valor_inventario
      )`)
      .eq('usuario_id', req.usuarioId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const bloqueo = calcularBloqueo(data);
    // El Widget de Wompi no guarda tarjeta para cobros futuros (no
    // hace falta: el sistema no cobra automático todavía, así que
    // cada renovación abre el Widget de nuevo).
    res.json({ ...data, ...bloqueo });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/iniciar-pago — cuerpo: { plan_id }
// Devuelve los datos que el navegador necesita para abrir el Widget
// de Wompi (referencia + firma de integridad). No activa nada
// todavía: eso solo pasa cuando el pago se confirma (síncrono en
// /confirmar-pago, o por el webhook si llega antes o después).
router.post('/iniciar-pago', async (req, res, next) => {
  try {
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ error: 'Falta indicar el plan' });

    const { data: plan, error: ePlan } = await supabase
      .from('planes_suscripcion').select('*').eq('id', plan_id).eq('activo', true).single();
    if (ePlan || !plan) return res.status(404).json({ error: 'Plan no encontrado' });

    // El 50% de descuento solo aplica la primera vez que alguien paga
    // de verdad — no en cada renovación ni cada vez que cambia de plan.
    const yaPagoAntes = await tienePagoAceptadoPrevio(req.usuarioId);
    const precioLista = Number(plan.precio_mensual);
    const monto = yaPagoAntes ? precioLista : Math.round(precioLista / 2);
    const montoEnCentavos = monto * 100;

    // A propósito, NO se toca la fila de suscripciones aquí. El webhook
    // (o la confirmación síncrona de /confirmar-pago) ya recibe el
    // usuario y el plan directo en la referencia, así que no hace falta
    // "avisarle" por adelantado escribiendo "pendiente_pago" — si lo
    // hiciéramos, y la persona cierra el Widget sin pagar, se perdería
    // el estado real que tenía antes (días de prueba restantes, o el
    // plan cancelado que aún conserva vigencia). Solo cuando el pago se
    // confirma de verdad se actualiza esta fila.

    // La referencia lleva el usuario y el plan embebidos (separados por
    // "_", que nunca aparece dentro de un uuid) para que tanto la
    // confirmación síncrona como el webhook sepan a quién activar sin
    // tener que confiar en nada más que mande el navegador.
    const { publicKey } = wompi.obtenerCredenciales();
    const referencia = `SUB_${req.usuarioId}_${plan.id}_${Date.now()}`;
    const firma = wompi.generarFirmaIntegridad({ referencia, montoEnCentavos, moneda: 'COP' });

    res.json({
      public_key: publicKey,
      referencia,
      firma,
      descripcion: `Suscripción ${plan.nombre} — Sistema de Control`,
      monto,
      monto_en_centavos: montoEnCentavos,
      monto_original: precioLista,
      descuento_aplicado: !yaPagoAntes,
      moneda: 'COP',
      correo: req.usuarioEmail,
      plan_id: plan.id
    });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/confirmar-pago — cuerpo: { plan_id, transaction_id }
// El navegador llama esto apenas el Widget de Wompi se cierra, con el
// id de transacción que Wompi le entregó. El servidor SIEMPRE vuelve a
// consultar ese id contra la API de Wompi antes de activar nada — el
// estado que reporta el navegador nunca es la fuente de verdad, y
// tampoco el monto: se recalcula aquí para que nadie pueda manipular
// el descuento del 50% editando la petición.
router.post('/confirmar-pago', async (req, res, next) => {
  try {
    const { plan_id, transaction_id } = req.body;
    if (!plan_id || !transaction_id)
      return res.status(400).json({ error: 'Faltan datos del pago' });

    const { data: plan, error: ePlan } = await supabase
      .from('planes_suscripcion').select('*').eq('id', plan_id).eq('activo', true).single();
    if (ePlan || !plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const transaccion = await wompi.consultarTransaccion(transaction_id);

    // La referencia debe corresponder a este usuario y a este plan —
    // si no calza, alguien está intentando activar su cuenta con la
    // transacción de otra persona.
    const [prefijo, usuarioReferencia, planReferencia] = String(transaccion.reference || '').split('_');
    if (prefijo !== 'SUB' || usuarioReferencia !== req.usuarioId || planReferencia !== plan.id)
      return res.status(400).json({ error: 'La transacción no corresponde a este usuario/plan' });

    // Idempotencia: si el webhook ya la procesó (o si el navegador
    // reintenta esta llamada), no se duplica el registro del pago.
    const { data: yaExiste } = await supabase
      .from('pagos_suscripcion').select('id').eq('wompi_transaction_id', transaccion.id).maybeSingle();
    if (!yaExiste) {
      await supabase.from('pagos_suscripcion').insert({
        usuario_id: req.usuarioId,
        plan_id: plan.id,
        wompi_transaction_id: transaccion.id,
        monto: Math.round(Number(transaccion.amount_in_cents) / 100),
        estado: transaccion.status,
        datos_crudos: transaccion
      });
    }

    // Si Wompi ya respondió "APPROVED" en el momento, activamos de una
    // vez — no hace falta esperar al webhook. Si quedó "PENDING" (por
    // ejemplo PSE), el webhook es quien la activará cuando se resuelva.
    if (transaccion.status === 'APPROVED') {
      const ahora = new Date();
      const vencimiento = new Date(ahora);
      vencimiento.setDate(vencimiento.getDate() + 30);
      const { error: eSusc } = await supabase
        .from('suscripciones')
        .upsert({
          usuario_id: req.usuarioId,
          plan_id: plan.id,
          estado: 'activa',
          fecha_inicio: ahora.toISOString(),
          fecha_vencimiento: vencimiento.toISOString(),
          actualizado_en: ahora.toISOString()
        });
      if (eSusc) throw new Error(eSusc.message);
    }

    res.json({ status: transaccion.status, monto: Math.round(Number(transaccion.amount_in_cents) / 100) });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/cancelar — deja de renovar, pero conserva el
// acceso hasta la fecha ya pagada (no se corta de inmediato).
router.post('/cancelar', async (req, res, next) => {
  try {
    const { data: actual, error: eGet } = await supabase
      .from('suscripciones').select('estado, fecha_vencimiento').eq('usuario_id', req.usuarioId).maybeSingle();
    if (eGet) throw new Error(eGet.message);
    if (!actual || !['activa', 'prueba'].includes(actual.estado))
      return res.status(400).json({ error: 'No tienes una suscripción activa para cancelar' });

    const { error } = await supabase
      .from('suscripciones')
      .update({ estado: 'cancelada', actualizado_en: new Date().toISOString() })
      .eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);

    res.json({ cancelada: true, fecha_vencimiento: actual.fecha_vencimiento });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/reactivar — deshace una cancelación, siempre
// que todavía no se haya pasado la fecha de vencimiento.
router.post('/reactivar', async (req, res, next) => {
  try {
    const { data: actual, error: eGet } = await supabase
      .from('suscripciones').select('estado, fecha_vencimiento').eq('usuario_id', req.usuarioId).maybeSingle();
    if (eGet) throw new Error(eGet.message);
    if (!actual || actual.estado !== 'cancelada')
      return res.status(400).json({ error: 'Esta suscripción no está cancelada' });
    if (actual.fecha_vencimiento && new Date(actual.fecha_vencimiento) < new Date())
      return res.status(400).json({ error: 'Ya venció; elige un plan para volver a activarla' });

    const { error } = await supabase
      .from('suscripciones')
      .update({ estado: 'activa', actualizado_en: new Date().toISOString() })
      .eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);

    res.json({ reactivada: true });
  } catch (err) { next(err); }
});

module.exports = router;