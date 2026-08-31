// ============================================================
// MÓDULO — PROCESOS  (/api/procesos)
// Requiere sesión. Cada consulta se filtra por req.usuarioId.
//
// Cada proceso pertenece a UNA ficha técnica (producto) — no puede
// existir un proceso suelto.
//
// Costo de un proceso = DOS partes que se guardan por separado:
//   costo_unitario    = tiempo_minutos × (precio de hora global ÷ 60)  — SOLO mano de obra
//   costo_materiales  = suma de sus procesos_materiales × costo de cada material
// Se guardan separados porque costo_unitario también se usa para pagarle
// al colaborador en Nóminas, y ahí nunca debe incluir material.
//
// `orden` ubica al proceso dentro de la ruta de producción de su ficha
// técnica (1 = primero, 2 = segundo...). Si no se manda, se asigna solo
// al final de la lista.
//
// La suma de tiempo de todos los procesos de un producto ES sus minutos
// de fabricación, así que crear/editar/eliminar un proceso recalcula
// automáticamente la ficha técnica completa (minutos_fabricacion +
// costo_calculado — ver servicios/costos.js para el detalle de cómo se
// decide si el producto se costea "por ficha técnica" o "por procesos").
//
// Lo usa también el módulo de Nóminas, para asignarle a un
// colaborador el trabajo de completar un proceso puntual.
//
// - GET    /?producto_id=   lista procesos (opcionalmente de una ficha técnica), ordenados por `orden`
// - POST   /                crear proceso (producto_id obligatorio)
// - PUT    /:id              editar proceso
// - DELETE /:id              eliminar solo si ningún colaborador lo tiene asignado
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const {
  obtenerCostoMinutoManoObra,
  recalcularCostoMaterialesDeProceso,
  recalcularProductoDesdeSusProcesos
} = require('../servicios/costos');
const router = express.Router();

const SELECT_PROCESO = '*, productos(id, nombre), procesos_materiales(id, cantidad, materiales(id, nombre, unidad))';

function validarProceso(datos) {
  const errores = [];
  if (!datos.producto_id) errores.push('Elige a qué ficha técnica pertenece este proceso');
  if (!datos.nombre || !datos.nombre.trim()) errores.push('El nombre es obligatorio');
  if (datos.tiempo_minutos == null || isNaN(datos.tiempo_minutos) || Number(datos.tiempo_minutos) <= 0)
    errores.push('El tiempo del proceso debe ser un número de minutos mayor a 0');
  if (datos.materiales && !Array.isArray(datos.materiales)) errores.push('La lista de materiales no es válida');
  if (datos.orden != null && (isNaN(datos.orden) || Number(datos.orden) <= 0))
    errores.push('El orden debe ser un número mayor a 0');
  if (datos.repeticiones_por_unidad != null && (isNaN(datos.repeticiones_por_unidad) || Number(datos.repeticiones_por_unidad) <= 0))
    errores.push('Las repeticiones por unidad deben ser un número mayor a 0');
  return errores;
}

async function reemplazarMaterialesDeProceso(procesoId, materiales) {
  const { error: eDel } = await supabase.from('procesos_materiales').delete().eq('proceso_id', procesoId);
  if (eDel) throw new Error(eDel.message);
  const filas = (materiales || [])
    .filter(m => m.material_id && Number(m.cantidad) > 0)
    .map(m => ({ proceso_id: procesoId, material_id: m.material_id, cantidad: Number(m.cantidad) }));
  if (filas.length === 0) return;
  const { error: eIns } = await supabase.from('procesos_materiales').insert(filas);
  if (eIns) throw new Error(eIns.message);
}

// Si no se manda `orden`, asigna el siguiente disponible dentro de esa ficha técnica.
async function siguienteOrden(productoId, usuarioId) {
  const { data, error } = await supabase
    .from('procesos')
    .select('orden')
    .eq('producto_id', productoId)
    .eq('usuario_id', usuarioId)
    .order('orden', { ascending: false })
    .limit(1);
  if (error) throw new Error(error.message);
  const maximo = data && data.length > 0 && data[0].orden != null ? Number(data[0].orden) : 0;
  return maximo + 1;
}

// GET /api/procesos?producto_id=...
router.get('/', async (req, res, next) => {
  try {
    let consulta = supabase
      .from('procesos')
      .select(SELECT_PROCESO)
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .order('orden', { ascending: true, nullsFirst: false })
      .order('nombre');
    if (req.query.producto_id) consulta = consulta.eq('producto_id', req.query.producto_id);

    const { data, error } = await consulta;
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/procesos — cuerpo: { producto_id, nombre, tiempo_minutos, orden, materiales: [{material_id, cantidad}] }
router.post('/', async (req, res, next) => {
  try {
    const errores = validarProceso(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const { data: producto, error: eProd } = await supabase
      .from('productos').select('id').eq('id', req.body.producto_id).eq('usuario_id', req.usuarioId).single();
    if (eProd || !producto) return res.status(404).json({ error: 'La ficha técnica elegida no existe o no te pertenece' });

    const costoMinuto = await obtenerCostoMinutoManoObra(req.usuarioId);
    const tiempoMinutos = Number(req.body.tiempo_minutos);
    const costoUnitario = Math.round(tiempoMinutos * costoMinuto * 100) / 100;
    const orden = req.body.orden != null ? Number(req.body.orden) : await siguienteOrden(req.body.producto_id, req.usuarioId);
    const repeticiones = req.body.repeticiones_por_unidad != null ? Number(req.body.repeticiones_por_unidad) : 1;

    const { data: nuevo, error } = await supabase
      .from('procesos')
      .insert({
        usuario_id: req.usuarioId,
        producto_id: req.body.producto_id,
        nombre: req.body.nombre.trim(),
        unidad: 'minutos',
        tiempo_minutos: tiempoMinutos,
        costo_unitario: costoUnitario,
        costo_materiales: 0,
        orden,
        repeticiones_por_unidad: repeticiones,
        descripcion: (req.body.descripcion || '').trim() || null
      })
      .select().single();
    if (error) throw new Error(error.message);

    await reemplazarMaterialesDeProceso(nuevo.id, req.body.materiales);
    await recalcularCostoMaterialesDeProceso(nuevo.id, req.usuarioId);
    const ficha = await recalcularProductoDesdeSusProcesos(req.body.producto_id, req.usuarioId);

    const { data: completo, error: eGet } = await supabase
      .from('procesos').select(SELECT_PROCESO).eq('id', nuevo.id).single();
    if (eGet) throw new Error(eGet.message);

    res.status(201).json({ ...completo, ficha_tecnica_recalculada: ficha });
  } catch (err) { next(err); }
});

// PUT /api/procesos/:id
router.put('/:id', async (req, res, next) => {
  try {
    const errores = validarProceso(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const { data: actual, error: eGet } = await supabase
      .from('procesos').select('id, producto_id, orden').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !actual) return res.status(404).json({ error: 'Proceso no encontrado' });

    const { data: producto, error: eProd } = await supabase
      .from('productos').select('id').eq('id', req.body.producto_id).eq('usuario_id', req.usuarioId).single();
    if (eProd || !producto) return res.status(404).json({ error: 'La ficha técnica elegida no existe o no te pertenece' });

    const costoMinuto = await obtenerCostoMinutoManoObra(req.usuarioId);
    const tiempoMinutos = Number(req.body.tiempo_minutos);
    const costoUnitario = Math.round(tiempoMinutos * costoMinuto * 100) / 100;
    const orden = req.body.orden != null ? Number(req.body.orden) : actual.orden;
    const repeticiones = req.body.repeticiones_por_unidad != null ? Number(req.body.repeticiones_por_unidad) : 1;

    const { error } = await supabase
      .from('procesos')
      .update({
        producto_id: req.body.producto_id,
        nombre: req.body.nombre.trim(),
        tiempo_minutos: tiempoMinutos,
        costo_unitario: costoUnitario,
        orden,
        repeticiones_por_unidad: repeticiones,
        descripcion: (req.body.descripcion || '').trim() || null,
        actualizado_en: new Date().toISOString()
      })
      .eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);

    await reemplazarMaterialesDeProceso(req.params.id, req.body.materiales);
    await recalcularCostoMaterialesDeProceso(req.params.id, req.usuarioId);

    // Si se movió de ficha técnica, hay que recalcular AMBAS (la
    // vieja pierde este proceso, la nueva lo gana).
    const fichaNueva = await recalcularProductoDesdeSusProcesos(req.body.producto_id, req.usuarioId);
    if (actual.producto_id && actual.producto_id !== req.body.producto_id) {
      await recalcularProductoDesdeSusProcesos(actual.producto_id, req.usuarioId);
    }

    const { data: completo, error: eFinal } = await supabase
      .from('procesos').select(SELECT_PROCESO).eq('id', req.params.id).single();
    if (eFinal) throw new Error(eFinal.message);

    res.json({ ...completo, ficha_tecnica_recalculada: fichaNueva });
  } catch (err) { next(err); }
});

// DELETE /api/procesos/:id — solo si ningún colaborador lo tiene asignado
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: proceso, error: eGet } = await supabase
      .from('procesos').select('id, producto_id').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !proceso) return res.status(404).json({ error: 'Proceso no encontrado' });

    const { count, error: eRef } = await supabase
      .from('colaboradores_encargos')
      .select('id', { count: 'exact', head: true })
      .eq('proceso_id', req.params.id);
    if (eRef) throw new Error(eRef.message);

    if (count > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: este proceso está asignado a ${count} encargo(s) de colaboradores.`
      });
    }

    const { error: eDelMat } = await supabase.from('procesos_materiales').delete().eq('proceso_id', req.params.id);
    if (eDelMat) throw new Error(eDelMat.message);

    const { error } = await supabase.from('procesos').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);

    const ficha = await recalcularProductoDesdeSusProcesos(proceso.producto_id, req.usuarioId);
    res.json({ eliminado: true, ficha_tecnica_recalculada: ficha });
  } catch (err) { next(err); }
});

module.exports = router;