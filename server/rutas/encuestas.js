// ============================================================
// ENCUESTAS CORTAS (/api/encuestas) — server/rutas/encuestas.js
// Facilidad de uso: preguntas breves en el momento justo.
//  GET  /pendiente   ¿toca mostrar alguna? { encuesta: 'facilidad' | null }
//  POST /            guarda una respuesta u omisión
//      { encuesta: 'facilidad'|'formulario', estado: 'respondida'|'omitida',
//        contexto?, puntaje? (1–5), motivo?, comentario? (≤500) }
// La de cancelación se guarda desde /api/suscripcion/cancelar.
// ============================================================
const express = require('express');
const { supabaseAdminBase } = require('../supabase/cliente');
const log = require('../seguridad/log');
const router = express.Router();

const DIAS_PARA_FACILIDAD = 7;
const MOTIVOS = {
  formulario: ['no_entendi', 'me_falta_dato', 'error_al_guardar', 'solo_mirando', 'otro'],
  cancelacion: ['muy_caro', 'dificil_de_usar', 'falta_funcion', 'no_lo_uso', 'otro_sistema', 'cierre_negocio', 'otro']
};
const CONTEXTO = /^[a-z_-]{1,40}(:[a-z][A-Za-z0-9]{2,40})?$/;

// Fecha de registro del usuario (caché corta)
const cacheAlta = new Map();
async function fechaDeAlta(usuarioId) {
  const c = cacheAlta.get(usuarioId);
  if (c && c.vence > Date.now()) return c.fecha;
  const { data } = await supabaseAdminBase.auth.admin.getUserById(usuarioId);
  const fecha = data && data.user ? new Date(data.user.created_at) : null;
  cacheAlta.set(usuarioId, { fecha, vence: Date.now() + 60 * 60 * 1000 });
  return fecha;
}

// Limpia una respuesta; devuelve { fila } o { error }
function normalizar(cuerpo, encuesta) {
  const b = cuerpo || {};
  const fila = { encuesta, estado: b.estado === 'omitida' ? 'omitida' : 'respondida' };
  if (b.contexto != null && b.contexto !== '') {
    if (typeof b.contexto !== 'string' || !CONTEXTO.test(b.contexto)) return { error: 'Contexto no válido' };
    fila.contexto = b.contexto;
  }
  if (b.puntaje != null) {
    const p = Number(b.puntaje);
    if (!Number.isInteger(p) || p < 1 || p > 5) return { error: 'El puntaje va de 1 a 5' };
    fila.puntaje = p;
  }
  if (b.motivo != null && b.motivo !== '') {
    if (!(MOTIVOS[encuesta] || []).includes(b.motivo)) return { error: 'Motivo no válido' };
    fila.motivo = b.motivo;
  }
  const comentario = typeof b.comentario === 'string' ? b.comentario.trim().slice(0, 500) : '';
  if (comentario) fila.comentario = comentario;
  if (fila.estado === 'respondida' && encuesta === 'facilidad' && !fila.puntaje) fila.estado = 'omitida';
  return { fila };
}

async function guardarRespuesta(req, encuesta, cuerpo) {
  const { fila, error } = normalizar(cuerpo, encuesta);
  if (error) return { error };
  const { error: e } = await supabaseAdminBase.from('encuestas_respuestas')
    .insert({ ...fila, empresa_id: req.empresa.id, usuario_id: req.usuarioId });
  if (e) throw new Error(e.message);
  return { ok: true };
}

// GET /api/encuestas/pendiente
router.get('/pendiente', async (req, res) => {
  try {
    const alta = await fechaDeAlta(req.usuarioId);
    if (!alta || Date.now() - alta.getTime() < DIAS_PARA_FACILIDAD * 86400000) return res.json({ encuesta: null });
    const { count, error } = await supabaseAdminBase.from('encuestas_respuestas')
      .select('id', { count: 'exact', head: true })
      .eq('usuario_id', req.usuarioId).eq('encuesta', 'facilidad');
    if (error) throw error;
    res.json({ encuesta: count ? null : 'facilidad' });
  } catch (err) {
    log.warn('[encuestas] No se pudo revisar la encuesta pendiente', err);
    res.json({ encuesta: null }); // nunca molesta si algo falla
  }
});

// POST /api/encuestas
router.post('/', async (req, res, next) => {
  try {
    const encuesta = req.body && req.body.encuesta;
    if (!['facilidad', 'formulario'].includes(encuesta)) return res.status(400).json({ error: 'Encuesta no válida' });

    // Una vez por persona (facilidad) o por persona y ventana (formulario)
    let consulta = supabaseAdminBase.from('encuestas_respuestas').select('id', { count: 'exact', head: true })
      .eq('usuario_id', req.usuarioId).eq('encuesta', encuesta);
    if (encuesta === 'formulario') consulta = consulta.eq('contexto', String(req.body.contexto || ''));
    const { count } = await consulta;
    if (count) return res.status(200).json({ ok: true, repetida: true });

    const r = await guardarRespuesta(req, encuesta, req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports.guardarRespuesta = guardarRespuesta;
module.exports._interno = { normalizar, MOTIVOS };
