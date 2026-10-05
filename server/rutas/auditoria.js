// ============================================================
// MÓDULO — AUDITORÍA  (/api/auditoria)
// FASE 7. Solo lectura, solo propietario y administrador.
// - GET /   ?modulo=&entidad=&entidad_id=&desde=&hasta=&limite=
//   Devuelve las acciones de la empresa activa, más recientes primero,
//   con el correo de quien las hizo.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { supabaseAdmin } = require('../supabase/cliente');
const router = express.Router();

const FECHA = /^\d{4}-\d{2}-\d{2}/;
const TEXTO = /^[a-z_]{1,40}$/;

router.get('/', async (req, res, next) => {
  try {
    const { modulo, entidad, entidad_id, desde, hasta } = req.query;
    const limite = Math.min(Math.max(parseInt(req.query.limite, 10) || 100, 1), 500);

    let consulta = supabase
      .from('audit_log')
      .select('id, creado_en, usuario_id, origen, accion, modulo, entidad, entidad_id, resultado, cambios')
      .eq('empresa_id', req.empresa.id)
      .order('creado_en', { ascending: false })
      .limit(limite);

    if (modulo && TEXTO.test(modulo)) consulta = consulta.eq('modulo', modulo);
    if (entidad && TEXTO.test(entidad)) consulta = consulta.eq('entidad', entidad);
    if (entidad_id) consulta = consulta.eq('entidad_id', String(entidad_id).slice(0, 64));
    if (desde && FECHA.test(desde)) consulta = consulta.gte('creado_en', desde);
    if (hasta && FECHA.test(hasta)) consulta = consulta.lte('creado_en', hasta);

    const { data, error } = await consulta;
    if (error) throw new Error(error.message);

    // Correo de cada actor (una consulta por persona distinta, no por fila)
    const actores = [...new Set(data.map(f => f.usuario_id).filter(Boolean))];
    const correos = {};
    await Promise.all(actores.map(async (id) => {
      const { data: u } = await supabaseAdmin.auth.admin.getUserById(id);
      correos[id] = u?.user?.email || null;
    }));

    res.json(data.map(f => ({ ...f, actor: f.usuario_id ? correos[f.usuario_id] : 'Sistema' })));
  } catch (err) { next(err); }
});

module.exports = router;
