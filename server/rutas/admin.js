// ============================================================
// RUTAS DE ADMINISTRADOR — server/rutas/admin.js
// Protegidas por exigirAdmin (montado en index.js). No filtran por
// usuario_id como el resto del sistema — a propósito: acá se mira
// TODA la base de suscriptores, no la de un solo tenant.
//
// Definiciones acordadas:
//   MRR              suma de precio_mensual de las suscripciones 'activa'
//   Usuarios activos 'activa' + 'prueba' (cualquiera usando el sistema hoy)
//   Nuevos clientes  fecha_inicio dentro del período
//   Churn            pasaron a 'vencida' o 'cancelada' dentro del período
//                     (se mide por actualizado_en — no hay tabla de
//                     historial de estados, así que es una aproximación:
//                     si algo más también toca actualizado_en de una
//                     suscripción vigente, podría inflar el número)
//   Pruebas gratuitas estado = 'prueba' ahora mismo
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { calcularRango } = require('../servicios/periodo');
const router = express.Router();

// GET /api/admin/verificar — solo confirma acceso, sin traer datos.
// admin.js la llama primero, antes de pintar cualquier cosa, para
// poder redirigir de inmediato si la sesión no es la tuya.
router.get('/verificar', (req, res) => res.json({ ok: true }));

// GET /api/admin/metricas?periodo=7d|30d|mes|3m|6m|1y
router.get('/metricas', async (req, res, next) => {
  try {
    const rango = calcularRango(req.query);

    const { data: subs, error } = await supabase
      .from('suscripciones')
      .select('usuario_id, estado, fecha_inicio, fecha_vencimiento, actualizado_en, plan_id, planes_suscripcion(nombre, precio_mensual)');
    if (error) throw new Error(error.message);

    const activas = subs.filter(s => s.estado === 'activa');
    const enPrueba = subs.filter(s => s.estado === 'prueba');
    const mrr = activas.reduce((s, x) => s + Number(x.planes_suscripcion?.precio_mensual || 0), 0);

    const dentroDelRango = (fechaTexto) =>
      fechaTexto && new Date(fechaTexto) >= rango.desde && new Date(fechaTexto) <= rango.hasta;

    const nuevosClientes = subs.filter(s => dentroDelRango(s.fecha_inicio)).length;
    const churn = subs.filter(s => ['vencida', 'cancelada'].includes(s.estado) && dentroDelRango(s.actualizado_en)).length;

    const porPlan = new Map();
    for (const s of [...activas, ...enPrueba]) {
      const nombre = s.planes_suscripcion?.nombre || 'Sin plan';
      porPlan.set(nombre, (porPlan.get(nombre) || 0) + 1);
    }

    res.json({
      periodo: { desde: rango.desde.toISOString(), hasta: rango.hasta.toISOString() },
      mrr: Math.round(mrr * 100) / 100,
      usuarios_activos: activas.length + enPrueba.length,
      pruebas_gratuitas: enPrueba.length,
      nuevos_clientes: nuevosClientes,
      churn,
      por_plan: [...porPlan.entries()].map(([nombre, cantidad]) => ({ nombre, cantidad }))
    });
  } catch (err) { next(err); }
});

// GET /api/admin/clientes — tabla completa, sin filtrar por período
router.get('/clientes', async (req, res, next) => {
  try {
    const { data: subs, error } = await supabase
      .from('suscripciones')
      .select('usuario_id, estado, fecha_inicio, fecha_vencimiento, planes_suscripcion(nombre, precio_mensual)')
      .order('fecha_inicio', { ascending: false });
    if (error) throw new Error(error.message);

    // No hay tabla propia de usuarios — el correo vive en Supabase Auth.
    // Se trae con la Admin API (requiere la Service Role Key, que el
    // servidor ya tiene) — el navegador nunca podría hacer esto directo.
    const { data: listaAuth, error: eAuth } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    if (eAuth) throw new Error(eAuth.message);
    const correoPorId = new Map(listaAuth.users.map(u => [u.id, u.email]));

    const clientes = subs.map(s => ({
      usuario_id: s.usuario_id,
      correo: correoPorId.get(s.usuario_id) || '(usuario eliminado)',
      plan: s.planes_suscripcion?.nombre || '—',
      mrr: s.estado === 'activa' ? Number(s.planes_suscripcion?.precio_mensual || 0) : 0,
      fecha_inicio: s.fecha_inicio,
      fecha_vencimiento: s.fecha_vencimiento,
      estado: s.estado
    }));

    res.json(clientes);
  } catch (err) { next(err); }
});

module.exports = router;