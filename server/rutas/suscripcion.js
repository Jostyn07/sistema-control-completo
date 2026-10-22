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
const log = require('../seguridad/log');
// Suscripciones y pagos se escriben SOLO con service_role (con RLS los
// usuarios no pueden tocarlas); siempre filtradas por la empresa ya
// validada en middleware/tenant.js. La suscripción es de la EMPRESA.
const { supabaseAdmin: supabase } = require('../supabase/cliente');
const wompi = require('../servicios/wompi');
const { enviarSuscripcionMeta } = require('../servicios/meta-capi');
const { sincronizarEstadoSuscripcion, calcularBloqueo, tienePagoAceptadoPrevio, crearPruebaGratis, activarSuscripcion } = require('../servicios/suscripcion');
const precios = require('../servicios/precios');
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
    let sub = await sincronizarEstadoSuscripcion(req.empresa.id); // marca "vencida" si ya tocaba

    // Red de seguridad: si por cualquier motivo nunca se le creó la
    // prueba (falla puntual en el registro, o entró por primera vez
    // con Google, que ni siquiera pasa por /registro), se la damos
    // aquí mismo — el primer momento en que la cuenta pregunta por
    // su propio estado. Así no depende de un único punto de falla.
    if (!sub) {
      try {
        await crearPruebaGratis(req.usuarioId, req.empresa.id);
        sub = await sincronizarEstadoSuscripcion(req.empresa.id);
      } catch (errRed) {
        log.error('[mi-suscripcion] La red de seguridad tampoco pudo crear la prueba:', errRed);
      }
    }

    if (!sub) return res.json({ estado: 'sin_suscripcion' });

    const { data, error } = await supabase
      .from('suscripciones')
      .select(`*, planes_suscripcion(
        nombre, precio_mensual, limite_materiales, limite_productos, limite_ventas_mes,
        incluye_rentabilidad_productos, incluye_analisis_clientes, incluye_meta_ventas, incluye_valor_inventario
      )`)
      .eq('empresa_id', req.empresa.id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const bloqueo = calcularBloqueo(data);
    // Periodo vigente (sin columna nueva): un tramo de más de 60 días es anual
    const dias = data && data.fecha_inicio && data.fecha_vencimiento
      ? (new Date(data.fecha_vencimiento) - new Date(data.fecha_inicio)) / 86400000 : 0;
    const periodo = data && data.estado !== 'prueba' && dias > 60 ? 'anual' : 'mensual';
    // El Widget de Wompi no guarda tarjeta para cobros futuros (no
    // hace falta: el sistema no cobra automático todavía, así que
    // cada renovación abre el Widget de nuevo).
    res.json({ ...data, ...bloqueo, periodo });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/iniciar-pago — cuerpo: { plan_id, periodo: 'mensual' | 'anual' }
// Devuelve los datos para abrir el Widget de Wompi (referencia + firma
// de integridad). No activa nada todavía: eso solo pasa cuando el pago
// se confirma (en /confirmar-pago o por el webhook).
// Montos (ver servicios/precios.js): mensual con 50 % solo en el primer
// pago real; anual = 12 meses con 30 % de descuento.
router.post('/iniciar-pago', async (req, res, next) => {
  try {
    const { plan_id } = req.body;
    if (!plan_id) return res.status(400).json({ error: 'Falta indicar el plan' });
    if (req.body.periodo && !precios.PERIODOS.includes(req.body.periodo))
      return res.status(400).json({ error: 'Periodo no válido' });
    const periodo = precios.normalizarPeriodo(req.body.periodo);

    const { data: plan, error: ePlan } = await supabase
      .from('planes_suscripcion').select('*').eq('id', plan_id).eq('activo', true).single();
    if (ePlan || !plan) return res.status(404).json({ error: 'Plan no encontrado' });

    const yaPagoAntes = await tienePagoAceptadoPrevio(req.empresa.id);
    const precioLista = Number(plan.precio_mensual);
    const monto = precios.calcularMonto(precioLista, periodo, yaPagoAntes);
    const montoEnCentavos = monto * 100;
    const montoOriginal = periodo === 'anual' ? precioLista * 12 : precioLista;

    // A propósito NO se toca la fila de suscripciones aquí: si la
    // persona cierra el Widget sin pagar, conserva su estado real.
    // La referencia lleva empresa, plan y periodo para que la
    // confirmación y el webhook sepan qué activar sin confiar en el
    // navegador.
    const { publicKey } = wompi.obtenerCredenciales();
    const referencia = precios.armarReferencia(req.empresa.id, plan.id, periodo);
    const firma = wompi.generarFirmaIntegridad({ referencia, montoEnCentavos, moneda: 'COP' });

    res.json({
      public_key: publicKey,
      referencia,
      firma,
      descripcion: `Suscripción ${plan.nombre} ${periodo === 'anual' ? 'anual' : 'mensual'} — Fincil`,
      periodo,
      monto,
      monto_en_centavos: montoEnCentavos,
      monto_original: montoOriginal,
      ahorro: montoOriginal - monto,
      descuento_aplicado: periodo === 'anual' ? 'anual_30' : (!yaPagoAntes ? 'primer_mes_50' : null),
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

    // La referencia debe corresponder a esta empresa y a este plan —
    // si no calza, alguien intenta activar su cuenta con la
    // transacción de otra persona.
    const ref = precios.leerReferencia(transaccion.reference);
    if (ref.prefijo !== 'SUB' || ref.empresaId !== req.empresa.id || ref.planId !== plan.id)
      return res.status(400).json({ error: 'La transacción no corresponde a esta empresa/plan' });

    const montoPagado = Math.round(Number(transaccion.amount_in_cents) / 100);

    // Idempotencia: si el webhook ya la procesó (o el navegador
    // reintenta), no se duplica el pago NI se vuelven a sumar días.
    const { data: yaExiste } = await supabase
      .from('pagos_suscripcion').select('id, estado').eq('wompi_transaction_id', transaccion.id).maybeSingle();
    if (!yaExiste) {
      await supabase.from('pagos_suscripcion').insert({
        empresa_id: req.empresa.id,
        usuario_id: req.usuarioId,
        plan_id: plan.id,
        wompi_transaction_id: transaccion.id,
        monto: montoPagado,
        estado: transaccion.status,
        datos_crudos: transaccion
      });
    } else if (yaExiste.estado !== transaccion.status) {
      await supabase.from('pagos_suscripcion')
        .update({ estado: transaccion.status, datos_crudos: transaccion }).eq('id', yaExiste.id);
    }
    const yaActivada = yaExiste && yaExiste.estado === 'APPROVED';

    // "APPROVED" en el momento → se activa ya. "PENDING" (ej. PSE) → lo
    // activará el webhook cuando se resuelva.
    if (transaccion.status === 'APPROVED' && !yaActivada) {
      // El monto se comprueba contra el periodo de la referencia: nadie
      // puede pagar el precio mensual y llevarse un año.
      if (montoPagado < precios.montoMinimoAceptable(plan.precio_mensual, ref.periodo)) {
        log.error('[confirmar-pago] Monto menor al esperado', { transaccion: transaccion.id, montoPagado, periodo: ref.periodo });
        return res.status(400).json({ error: 'El monto pagado no corresponde al plan elegido. Escríbenos a soporte.' });
      }
      await activarSuscripcion({ empresaId: req.empresa.id, usuarioId: req.usuarioId, planId: plan.id, periodo: ref.periodo });

      // Conversión para Meta (servidor). Mismo event_id que el pixel del
      // navegador, así que Meta no la cuenta doble.
      await enviarSuscripcionMeta({ transaccion, plan, usuarioId: req.usuarioId, email: req.usuarioEmail, req });
    }

    res.json({ status: transaccion.status, monto: Math.round(Number(transaccion.amount_in_cents) / 100), periodo: ref.periodo });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/cancelar — deja de renovar, pero conserva el
// acceso hasta la fecha ya pagada (no se corta de inmediato).
router.post('/cancelar', async (req, res, next) => {
  try {
    const { data: actual, error: eGet } = await supabase
      .from('suscripciones').select('estado, fecha_vencimiento').eq('empresa_id', req.empresa.id).maybeSingle();
    if (eGet) throw new Error(eGet.message);
    if (!actual || !['activa', 'prueba'].includes(actual.estado))
      return res.status(400).json({ error: 'No tienes una suscripción activa para cancelar' });

    const { error } = await supabase
      .from('suscripciones')
      .update({ estado: 'cancelada', actualizado_en: new Date().toISOString() })
      .eq('empresa_id', req.empresa.id);
    if (error) throw new Error(error.message);

    // Motivo de la cancelación (opcional; nunca impide cancelar)
    if (req.body && (req.body.motivo || req.body.comentario)) {
      try {
        const { guardarRespuesta } = require('./encuestas');
        await guardarRespuesta(req, 'cancelacion', { motivo: req.body.motivo, comentario: req.body.comentario });
      } catch (_) { /* la cancelación ya quedó hecha */ }
    }

    res.json({ cancelada: true, fecha_vencimiento: actual.fecha_vencimiento });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/reactivar — deshace una cancelación, siempre
// que todavía no se haya pasado la fecha de vencimiento.
router.post('/reactivar', async (req, res, next) => {
  try {
    const { data: actual, error: eGet } = await supabase
      .from('suscripciones').select('estado, fecha_vencimiento').eq('empresa_id', req.empresa.id).maybeSingle();
    if (eGet) throw new Error(eGet.message);
    if (!actual || actual.estado !== 'cancelada')
      return res.status(400).json({ error: 'Esta suscripción no está cancelada' });
    if (actual.fecha_vencimiento && new Date(actual.fecha_vencimiento) < new Date())
      return res.status(400).json({ error: 'Ya venció; elige un plan para volver a activarla' });

    const { error } = await supabase
      .from('suscripciones')
      .update({ estado: 'activa', actualizado_en: new Date().toISOString() })
      .eq('empresa_id', req.empresa.id);
    if (error) throw new Error(error.message);

    res.json({ reactivada: true });
  } catch (err) { next(err); }
});

module.exports = router;