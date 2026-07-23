// ============================================================
// SUSCRIPCIÓN  (/api/suscripcion) — requiere sesión
// - GET  /planes          catálogo de planes disponibles (con
//                         sus límites Y qué funciones incluyen)
// - GET  /mi-suscripcion  estado actual del usuario (pone al día
//                         el vencimiento antes de responder)
// - POST /iniciar-pago    prepara los datos para abrir el checkout
//                         de ePayco; aplica 50% de descuento si es
//                         el primer pago real del usuario
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { obtenerCredenciales, registrarMetodoPago } = require('../servicios/epayco');
const { sincronizarEstadoSuscripcion, calcularBloqueo, tienePagoAceptadoPrevio } = require('../servicios/suscripcion');
const router = express.Router();

// GET /api/suscripcion/llave-publica-epayco — la Public Key es
// segura de exponer, pero solo se la damos a quien ya tiene sesión.
router.get('/llave-publica-epayco', async (req, res, next) => {
  try {
    const { publicKey } = obtenerCredenciales();
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
    await sincronizarEstadoSuscripcion(req.usuarioId); // marca "vencida" si ya tocaba

    const { data, error } = await supabase
      .from('suscripciones')
      .select(`*, planes_suscripcion(
        nombre, precio_mensual, limite_materiales, limite_productos, limite_ventas_mes,
        incluye_rentabilidad_productos, incluye_analisis_clientes, incluye_meta_ventas, incluye_valor_inventario
      )`)
      .eq('usuario_id', req.usuarioId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const bloqueo = data ? calcularBloqueo(data) : { vencida: false, enGracia: false, bloqueada: false, diasGraciaRestantes: null };
    res.json(data ? { ...data, tiene_metodo_pago: !!data.epayco_customer_id, ...bloqueo } : { estado: 'sin_suscripcion' });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/agregar-metodo-pago — cuerpo: { token, nombre, apellido, telefono }
// El "token" ya lo generó el navegador hablando directo con ePayco;
// aquí NUNCA llega el número de tarjeta real.
router.post('/agregar-metodo-pago', async (req, res, next) => {
  try {
    const { token, nombre, apellido, telefono } = req.body;
    if (!token) return res.status(400).json({ error: 'Falta el token de la tarjeta' });
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const cliente = await registrarMetodoPago({
      token, nombre: nombre.trim(), apellido: (apellido || '').trim(),
      correo: req.usuarioEmail, telefono
    });

    const infoTarjeta = (cliente.data && cliente.data.franchise) ? cliente.data : (cliente.data || {});

    const { error: eUpd } = await supabase
      .from('suscripciones')
      .update({
        epayco_customer_id: cliente.data ? cliente.data.customerId || cliente.data.id_customer : null,
        tarjeta_franquicia: infoTarjeta.franchise || null,
        tarjeta_ultimos_4: infoTarjeta.mask ? String(infoTarjeta.mask).slice(-4) : null,
        actualizado_en: new Date().toISOString()
      })
      .eq('usuario_id', req.usuarioId);
    if (eUpd) throw new Error(eUpd.message);

    res.json({ guardado: true });
  } catch (err) { next(err); }
});

// POST /api/suscripcion/iniciar-pago — cuerpo: { plan_id }
// Devuelve los datos que el navegador necesita para abrir el
// checkout de ePayco. No activa nada todavía: eso solo pasa
// cuando llega y se valida el webhook de confirmación.
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

    // Deja la suscripción en "pendiente_pago" apuntando a este plan,
    // así el webhook sabe qué activar cuando confirme el pago.
    const { error: eUpsert } = await supabase
      .from('suscripciones')
      .upsert({
        usuario_id: req.usuarioId,
        plan_id: plan.id,
        estado: 'pendiente_pago',
        actualizado_en: new Date().toISOString()
      });
    if (eUpsert) throw new Error(eUpsert.message);

    const { publicKey, modoPrueba } = obtenerCredenciales();
    const factura = `SUB-${req.usuarioId.slice(0, 8)}-${Date.now()}`;

    res.json({
      public_key: publicKey,
      modo_prueba: modoPrueba,
      factura,
      descripcion: `Suscripción ${plan.nombre} — Sistema de Control`,
      monto,
      monto_original: precioLista,
      descuento_aplicado: !yaPagoAntes,
      moneda: 'cop',
      extra1: req.usuarioId,
      extra2: plan.id
    });
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