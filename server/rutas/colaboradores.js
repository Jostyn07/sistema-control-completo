const express = require('express');
const supabase = require('../supabase/cliente');
const { cifrar, descifrar } = require('../servicios/cifrado');
const router = express.Router();

function validarColaborador(datos) {
  const errores = [];
  if (!datos.nombre || !datos.nombre.trim()) errores.push('El nombre es obligatorio');
  return errores;
}

function conDatosDescifrados(c) {
  return {
    ...c,
    cedula: descifrar(c.cedula_cifrada),
    direccion: descifrar(c.direccion_cifrada),
    cedula_cifrada: undefined,
    direccion_cifrada: undefined
  };
}

// Los materiales de un encargo ya NO se eligen a mano: salen solos de la
// receta del proceso (procesos_materiales) × la cantidad requerida, y se
// guardan aquí para trazabilidad y para pintar la columna "Materiales
// entregados" en Nóminas.
const SELECT_ENCARGO = '*, procesos(nombre, unidad), colaboradores_encargos_materiales(material_id, cantidad, materiales(id, nombre, unidad))';

// GET /api/colaboradores
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('colaboradores')
      .select('*')
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .order('nombre');
    if (error) throw new Error(error.message);
    res.json((data || []).map(conDatosDescifrados));
  } catch (err) { next(err); }
});

// POST /api/colaboradores
router.post('/', async (req, res, next) => {
  try {
    const errores = validarColaborador(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const nuevo = {
      usuario_id: req.usuarioId,
      nombre: req.body.nombre.trim(),
      cedula_cifrada: cifrar(req.body.cedula),
      direccion_cifrada: cifrar(req.body.direccion)
    };
    const { data, error } = await supabase.from('colaboradores').insert(nuevo).select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(conDatosDescifrados(data));
  } catch (err) { next(err); }
});

// PUT /api/colaboradores/:id
router.put('/:id', async (req, res, next) => {
  try {
    const errores = validarColaborador(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const cambios = {
      nombre: req.body.nombre.trim(),
      cedula_cifrada: cifrar(req.body.cedula),
      direccion_cifrada: cifrar(req.body.direccion),
      actualizado_en: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('colaboradores').update(cambios).eq('id', req.params.id).eq('usuario_id', req.usuarioId).select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Colaborador no encontrado' });
    res.json(conDatosDescifrados(data));
  } catch (err) { next(err); }
});

// DELETE /api/colaboradores/:id — si tiene encargos, se desactiva en vez
// de borrarse (para no perder el historial de trabajo/pagos).
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: colaborador, error: eGet } = await supabase
      .from('colaboradores').select('id').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !colaborador) return res.status(404).json({ error: 'Colaborador no encontrado' });

    const { count, error: eCount } = await supabase
      .from('colaboradores_encargos')
      .select('id', { count: 'exact', head: true })
      .eq('colaborador_id', req.params.id);
    if (eCount) throw new Error(eCount.message);

    if (count > 0) {
      const { error } = await supabase
        .from('colaboradores')
        .update({ activo: false, actualizado_en: new Date().toISOString() })
        .eq('id', req.params.id).eq('usuario_id', req.usuarioId);
      if (error) throw new Error(error.message);
      return res.json({
        eliminado: false, desactivado: true,
        mensaje: `Este colaborador tiene ${count} encargo(s) registrados, así que se desactivó en vez de borrarse (para no perder el historial).`
      });
    }

    const { error } = await supabase.from('colaboradores').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);
    res.json({ eliminado: true, desactivado: false });
  } catch (err) { next(err); }
});

// GET /api/colaboradores/:id/encargos
router.get('/:id/encargos', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('colaboradores_encargos')
      .select(SELECT_ENCARGO)
      .eq('colaborador_id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .order('creado_en', { ascending: false });
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/colaboradores/:id/encargos — cuerpo:
// { proceso_id, cantidad_requerida, fecha_entrega }
// Los materiales entregados se calculan solos desde la receta del proceso
// (procesos_materiales) × la cantidad requerida, y se guardan en
// colaboradores_encargos_materiales SOLO para control y trazabilidad
// (columna "Materiales entregados" de Nóminas). YA NO se descuentan del
// inventario aquí: ese mismo material se descuenta cuando se vende el
// producto terminado (ficha técnica del producto en Ventas), así que
// descontarlo también al crear el encargo duplicaba la salida.
router.post('/:id/encargos', async (req, res, next) => {
  try {
    const { proceso_id, cantidad_requerida, fecha_entrega } = req.body;
    if (!proceso_id) return res.status(400).json({ error: 'Elige el proceso requerido' });
    if (cantidad_requerida == null || isNaN(cantidad_requerida) || Number(cantidad_requerida) <= 0)
      return res.status(400).json({ error: 'La cantidad a entregar del proceso debe ser mayor a 0' });

    const { data: colaborador, error: eCol } = await supabase
      .from('colaboradores').select('id').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eCol || !colaborador) return res.status(404).json({ error: 'Colaborador no encontrado' });

    const { data: proceso, error: eProc } = await supabase
      .from('procesos')
      .select('id, costo_unitario, procesos_materiales(material_id, cantidad)')
      .eq('id', proceso_id).eq('usuario_id', req.usuarioId).single();
    if (eProc || !proceso) return res.status(404).json({ error: 'Proceso no encontrado' });

    const cantidadReq = Number(cantidad_requerida);

    // Para pagarle al colaborador se usa el costo por unidad REDONDEADO
    // al entero más cercano (ej: $52,91 → $53), no el decimal exacto de
    // la ficha técnica — así el total que se le paga no arrastra
    // centavos. La ficha técnica y el costo del producto para Ventas
    // siguen usando el valor exacto; esto es solo para Nóminas.
    const costoUnitarioColaborador = Math.round(Number(proceso.costo_unitario));

    const nuevo = {
      usuario_id: req.usuarioId,
      colaborador_id: req.params.id,
      proceso_id,
      cantidad_requerida: cantidadReq,
      cantidad_entregada: 0,
      fecha_entrega: fecha_entrega || null,
      costo_unitario_proceso: costoUnitarioColaborador,
      costo_total_proceso: 0
    };
    const { data: encargo, error } = await supabase
      .from('colaboradores_encargos').insert(nuevo).select().single();
    if (error) throw new Error(error.message);

    const filasMateriales = (proceso.procesos_materiales || [])
      .filter(f => Number(f.cantidad) > 0)
      .map(f => ({
        encargo_id: encargo.id,
        material_id: f.material_id,
        cantidad: Math.round(Number(f.cantidad) * cantidadReq * 10000) / 10000
      }));
    if (filasMateriales.length > 0) {
      const { error: eIns } = await supabase.from('colaboradores_encargos_materiales').insert(filasMateriales);
      if (eIns) throw new Error(eIns.message);
    }

    const { data: completo, error: eFinal } = await supabase
      .from('colaboradores_encargos').select(SELECT_ENCARGO).eq('id', encargo.id).single();
    if (eFinal) throw new Error(eFinal.message);

    res.status(201).json(completo);
  } catch (err) { next(err); }
});

// PUT /api/colaboradores/encargos/:id/entrega — cuerpo: { cantidad_entregada, fecha_entrega }
// Registra lo que el colaborador realmente entregó y recalcula el costo
// total con el costo unitario ya guardado en el encargo (no el actual
// del proceso, por si cambió desde que se creó el encargo).
router.put('/encargos/:id/entrega', async (req, res, next) => {
  try {
    const { cantidad_entregada, fecha_entrega } = req.body;
    if (cantidad_entregada == null || isNaN(cantidad_entregada) || Number(cantidad_entregada) < 0)
      return res.status(400).json({ error: 'La cantidad entregada debe ser un número mayor o igual a 0' });

    const { data: actual, error: eGet } = await supabase
      .from('colaboradores_encargos').select('*').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !actual) return res.status(404).json({ error: 'Encargo no encontrado' });

    const cantidadEntregada = Number(cantidad_entregada);
    const costoUnitarioRedondeado = Math.round(Number(actual.costo_unitario_proceso));
    const costoTotal = Math.round(cantidadEntregada * costoUnitarioRedondeado * 100) / 100;

    const { data, error } = await supabase
      .from('colaboradores_encargos')
      .update({
        cantidad_entregada: cantidadEntregada,
        fecha_entrega: fecha_entrega || actual.fecha_entrega,
        costo_total_proceso: costoTotal,
        actualizado_en: new Date().toISOString()
      })
      .eq('id', req.params.id).eq('usuario_id', req.usuarioId)
      .select(SELECT_ENCARGO).single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /api/colaboradores/encargos/:id/pago — cuerpo: { pagado: boolean }
// Esto ES la "facturación para pagar a los colaboradores": marca qué
// encargos ya se le pagaron al colaborador y cuáles siguen pendientes.
router.put('/encargos/:id/pago', async (req, res, next) => {
  try {
    const { pagado } = req.body;
    if (typeof pagado !== 'boolean') return res.status(400).json({ error: '"pagado" debe ser true o false' });

    const { data, error } = await supabase
      .from('colaboradores_encargos')
      .update({ pagado, fecha_pago: pagado ? new Date().toISOString() : null })
      .eq('id', req.params.id).eq('usuario_id', req.usuarioId)
      .select(SELECT_ENCARGO).single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Encargo no encontrado' });
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/colaboradores/encargos/:id — el encargo no toca inventario
// (los materiales que trae solo son registro/control), así que aquí no
// hay stock que revertir: se borra el encargo y sus filas de materiales.
router.delete('/encargos/:id', async (req, res, next) => {
  try {
    const { data: encargo, error: eGet } = await supabase
      .from('colaboradores_encargos').select('id').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !encargo) return res.status(404).json({ error: 'Encargo no encontrado' });

    await supabase.from('colaboradores_encargos_materiales').delete().eq('encargo_id', req.params.id);

    const { error } = await supabase
      .from('colaboradores_encargos').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);
    res.json({ eliminado: true });
  } catch (err) { next(err); }
});

// GET /api/colaboradores/:id/rendimiento
// Análisis de rendimiento: cuántos encargos ha tenido, qué tanto ha
// cumplido de lo requerido, cuánto ha ganado y cuánto le queda pendiente
// de pago.
router.get('/:id/rendimiento', async (req, res, next) => {
  try {
    const { data: colaborador, error: eCol } = await supabase
      .from('colaboradores').select('id, nombre').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eCol || !colaborador) return res.status(404).json({ error: 'Colaborador no encontrado' });

    const { data: encargos, error } = await supabase
      .from('colaboradores_encargos')
      .select('cantidad_requerida, cantidad_entregada, costo_total_proceso, pagado, fecha_entrega, creado_en')
      .eq('colaborador_id', req.params.id)
      .eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);

    const lista = encargos || [];
    const totalRequerido = lista.reduce((s, e) => s + Number(e.cantidad_requerida), 0);
    const totalEntregado = lista.reduce((s, e) => s + Number(e.cantidad_entregada), 0);
    const totalGanado = lista.reduce((s, e) => s + Number(e.costo_total_proceso), 0);
    const totalPagado = lista.filter(e => e.pagado).reduce((s, e) => s + Number(e.costo_total_proceso), 0);
    const totalPendientePago = totalGanado - totalPagado;
    const encargosCompletados = lista.filter(e => Number(e.cantidad_entregada) >= Number(e.cantidad_requerida) && Number(e.cantidad_requerida) > 0).length;
    const encargosPendientes = lista.filter(e => Number(e.cantidad_entregada) < Number(e.cantidad_requerida)).length;

    res.json({
      colaborador_id: colaborador.id,
      nombre: colaborador.nombre,
      total_encargos: lista.length,
      encargos_completados: encargosCompletados,
      encargos_pendientes: encargosPendientes,
      porcentaje_cumplimiento: totalRequerido > 0 ? Math.round((totalEntregado / totalRequerido) * 1000) / 10 : 0,
      total_unidades_requeridas: totalRequerido,
      total_unidades_entregadas: totalEntregado,
      total_ganado: Math.round(totalGanado * 100) / 100,
      total_pagado: Math.round(totalPagado * 100) / 100,
      total_pendiente_pago: Math.round(totalPendientePago * 100) / 100
    });
  } catch (err) { next(err); }
});

module.exports = router;