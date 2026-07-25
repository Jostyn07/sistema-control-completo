// ============================================================
// SUSCRIPCIÓN  (/api/suscripcion) — requiere sesión
// - GET  /planes          catálogo de planes disponibles (con
//                         sus límites Y qué funciones incluyen)
// - GET  /mi-suscripcion  estado actual del usuario (pone al día
//                         el vencimiento antes de responder)
// - POST /iniciar-pago    prepara los datos para el Brick de pago de
//                         Mercado Pago; aplica 50% de descuento si es
//                         el primer pago real del usuario
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const mercadopago = require('../servicios/mercadopago');
const { sincronizarEstadoSuscripcion, calcularBloqueo, tienePagoAceptadoPrevio, crearPruebaGratis } = require('../servicios/suscripcion');
const router = express.Router();

// GET /api/suscripcion/llave-publica-mercadopago
router.get('/llave-publica-mercadopago', async (req, res, next) => {
  try {
    const { publicKey } = mercadopago.obtenerCredenciales();
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
    // epayco_customer_id: alguien pudo haber guardado tarjeta antes de
    // la migración a Mercado Pago — se sigue reconociendo para no
    // pedirle que la guarde de nuevo si ya la tenía.
    res.json({ ...data, tiene_metodo_pago: !!(data.mp_customer_id || data.epayco_customer_id), ...bloqueo });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/agregar-metodo-pago — cuerpo: { token }
// El "token" ya lo generó el navegador con los Secure Fields de
// Mercado Pago; aquí NUNCA llega el número de tarjeta real.
router.post('/agregar-metodo-pago', async (req, res, next) => {
  try {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Falta el token de la tarjeta' });

    const customerId = await mercadopago.obtenerOCrearCliente(req.usuarioEmail);
    const tarjeta = await mercadopago.guardarTarjeta(customerId, token);

    const { error: eUpd } = await supabase
      .from('suscripciones')
      .update({
        mp_customer_id: customerId,
        tarjeta_franquicia: tarjeta.payment_method ? (tarjeta.payment_method.name || tarjeta.payment_method.id) : null,
        tarjeta_ultimos_4: tarjeta.last_four_digits || null,
        actualizado_en: new Date().toISOString()
      })
      .eq('usuario_id', req.usuarioId);
    if (eUpd) throw new Error(eUpd.message);

    res.json({ guardado: true });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/iniciar-pago — cuerpo: { plan_id }
// Devuelve los datos que el navegador necesita para abrir el
// Brick de pago de Mercado Pago. No activa nada todavía: eso solo pasa
// cuando el pago se confirma (síncrono en /procesar-pago, o por el
// webhook si queda en proceso).
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

    // A propósito, NO se toca la fila de suscripciones aquí. El webhook
    // (o la confirmación síncrona de /procesar-pago) ya recibe el usuario
    // y el plan directo en external_reference, así que no hace falta "avisarle" por adelantado escribiendo
    // "pendiente_pago" — si lo hiciéramos, y la persona cierra el
    // checkout sin pagar, se perdería el estado real que tenía antes
    // (días de prueba restantes, o el plan cancelado que aún conserva
    // vigencia). Solo el webhook, cuando el pago se confirma de
    // verdad, actualiza esta fila.

    const { publicKey } = mercadopago.obtenerCredenciales();
    const factura = `SUB-${req.usuarioId.slice(0, 8)}-${Date.now()}`;

    res.json({
      public_key: publicKey,
      factura,
      descripcion: `Suscripción ${plan.nombre} — Sistema de Control`,
      monto,
      monto_original: precioLista,
      descuento_aplicado: !yaPagoAntes,
      moneda: 'cop',
      correo: req.usuarioEmail,
      plan_id: plan.id
    });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/procesar-pago — cuerpo: { plan_id, token,
// payment_method_id, installments }
// El "token" ya lo generó el Brick de Mercado Pago en el navegador
// (nunca llega el número de tarjeta real al backend). El monto se
// vuelve a calcular aquí mismo — nunca se confía en un monto que
// mande el navegador — para que nadie pueda manipular el descuento
// del 50% editando la petición.
router.post('/procesar-pago', async (req, res, next) => {
  try {
    const { plan_id, token, payment_method_id, installments } = req.body;
    if (!plan_id || !token || !payment_method_id)
      return res.status(400).json({ error: 'Faltan datos del pago' });

    const { data: plan, error: ePlan } = await supabase
      .from('planes_suscripcion').select('*').eq('id', plan_id).eq('activo', true).single();
    if (ePlan || !plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const yaPagoAntes = await tienePagoAceptadoPrevio(req.usuarioId);
    const precioLista = Number(plan.precio_mensual);
    const monto = yaPagoAntes ? precioLista : Math.round(precioLista / 2);
    const factura = `SUB-${req.usuarioId.slice(0, 8)}-${Date.now()}`;

    const pago = await mercadopago.crearPago({
      token,
      monto,
      descripcion: `Suscripción ${plan.nombre} — Sistema de Control`,
      correo: req.usuarioEmail,
      factura,
      paymentMethodId: payment_method_id,
      installments: installments || 1,
      externalReference: `${req.usuarioId}:${plan.id}`
    });

    // Registro de trazabilidad — mismo patrón que el webhook, con la
    // misma llave (mp_payment_id) para que cuando el webhook llegue
    // después no lo duplique (chequeo de idempotencia en webhooks.js).
    const { data: yaExiste } = await supabase
      .from('pagos_suscripcion').select('id').eq('mp_payment_id', String(pago.id)).maybeSingle();
    if (!yaExiste) {
      await supabase.from('pagos_suscripcion').insert({
        usuario_id: req.usuarioId,
        plan_id: plan.id,
        mp_payment_id: String(pago.id),
        monto,
        estado: pago.status,
        datos_crudos: pago
      });
    }

    // Si Mercado Pago ya respondió "approved" en el momento (lo más
    // común con tarjetas en Colombia), activamos de una vez — no hace
    // falta esperar al webhook. Si quedó "in_process"/"pending", el
    // webhook es quien la activará más adelante cuando se resuelva.
    if (pago.status === 'approved') {
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

    res.json({ status: pago.status, status_detail: pago.status_detail, monto });
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