const express = require('express');
const supabase = require('../supabase/cliente');
const { cifrar, descifrar } = require('../servicios/cifrado');
const { registrarEntrega, eliminarEntrega, obtenerHistorial } = require('../servicios/entregas');
const { validarYLimpiarMetodosPago } = require('../servicios/metodospago');
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

    const { error: errorMetodos, limpios: metodosPago } = validarYLimpiarMetodosPago(req.body.metodos_pago);
    if (errorMetodos) return res.status(400).json({ error: errorMetodos });

    const nuevo = {
      usuario_id: req.usuarioId,
      nombre: req.body.nombre.trim(),
      cedula_cifrada: cifrar(req.body.cedula),
      direccion_cifrada: cifrar(req.body.direccion),
      metodos_pago: metodosPago
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

    const { error: errorMetodos, limpios: metodosPago } = validarYLimpiarMetodosPago(req.body.metodos_pago);
    if (errorMetodos) return res.status(400).json({ error: errorMetodos });

    const cambios = {
      nombre: req.body.nombre.trim(),
      cedula_cifrada: cifrar(req.body.cedula),
      direccion_cifrada: cifrar(req.body.direccion),
      metodos_pago: metodosPago,
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

// GET /api/colaboradores/encargos/pendientes — la cola de procesos que
// el sistema generó solo (al registrar una venta sin WIP suficiente)
// y que todavía no se le asignan a ningún colaborador. Se muestra en
// la lista principal de Nóminas, antes de entrar al perfil de nadie.
router.get('/encargos/pendientes', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('colaboradores_encargos')
      .select('id, cantidad_requerida, cantidad_entregada, creado_en, procesos(id, nombre, orden, tiempo_minutos, producto_id, productos(nombre))')
      .eq('usuario_id', req.usuarioId)
      .is('colaborador_id', null)
      .order('creado_en', { ascending: true });
    if (error) throw new Error(error.message);

    const productoIds = [...new Set((data || []).map(f => f.procesos.producto_id))];
    let wipPorClave = new Map();
    const rutas = new Map();
    if (productoIds.length > 0) {
      const { data: wipFilas, error: eWip } = await supabase
        .from('produccion_wip')
        .select('producto_id, proceso_id, cantidad')
        .eq('usuario_id', req.usuarioId)
        .in('producto_id', productoIds);
      if (eWip) throw new Error(eWip.message);
      wipPorClave = new Map((wipFilas || []).map(f => [f.producto_id + '|' + f.proceso_id, Number(f.cantidad)]));

      for (const productoId of productoIds) {
        const { data: procesos, error: eProc } = await supabase
          .from('procesos')
          .select('id, orden')
          .eq('producto_id', productoId)
          .eq('usuario_id', req.usuarioId)
          .eq('activo', true)
          .order('orden', { ascending: true, nullsFirst: false })
          .order('creado_en', { ascending: true });
        if (eProc) throw new Error(eProc.message);
        rutas.set(productoId, procesos || []);
      }
    }

    const resultado = (data || []).map(e => {
      const productoId = e.procesos.producto_id;
      const ruta = rutas.get(productoId) || [];
      const indice = ruta.findIndex(p => p.id === e.procesos.id);
      const procesoAnterior = indice > 0 ? ruta[indice - 1] : null;
      const wipDisponibleEtapaAnterior = procesoAnterior
        ? (wipPorClave.get(productoId + '|' + procesoAnterior.id) || 0)
        : null; // null = es el primer proceso, no depende de una etapa anterior
      return {
        id: e.id,
        proceso_id: e.procesos.id,
        proceso: e.procesos.nombre,
        producto: e.procesos.productos.nombre,
        cantidad_requerida: Number(e.cantidad_requerida),
        cantidad_entregada: Number(e.cantidad_entregada),
        tiempo_minutos: Number(e.procesos.tiempo_minutos),
        creado_en: e.creado_en,
        wip_disponible_etapa_anterior: wipDisponibleEtapaAnterior
      };
    });
    res.json(resultado);
  } catch (err) { next(err); }
});

// PUT /api/colaboradores/encargos/:id/asignar — cuerpo: { colaborador_id }
// Le pone dueño a un encargo que el sistema generó solo (cola sin
// asignar). Solo funciona sobre encargos que de verdad estén sin
// asignar todavía.
// PUT /api/colaboradores/encargos/:id/asignar — cuerpo: { colaborador_id, cantidad? }
// Le pone dueño a un encargo que el sistema generó solo (cola sin
// asignar). Si `cantidad` es menor a lo pendiente, se DIVIDE: ese
// pedazo se asigna al colaborador elegido, y el resto se queda sin
// asignar (sigue disponible para repartirlo con otro arrastre).
router.put('/encargos/:id/asignar', async (req, res, next) => {
  try {
    const { colaborador_id, cantidad } = req.body;
    if (!colaborador_id) return res.status(400).json({ error: 'Elige a qué colaborador se lo vas a asignar' });

    const { data: colaborador, error: eCol } = await supabase
      .from('colaboradores').select('id').eq('id', colaborador_id).eq('usuario_id', req.usuarioId).single();
    if (eCol || !colaborador) return res.status(404).json({ error: 'Colaborador no encontrado' });

    const { data: pendiente, error: eGet } = await supabase
      .from('colaboradores_encargos')
      .select('*')
      .eq('id', req.params.id).eq('usuario_id', req.usuarioId).is('colaborador_id', null)
      .maybeSingle();
    if (eGet) throw new Error(eGet.message);
    if (!pendiente) return res.status(404).json({ error: 'Ese encargo no existe o ya estaba asignado a alguien' });

    const totalPendiente = Number(pendiente.cantidad_requerida) - Number(pendiente.cantidad_entregada);
    const aAsignar = cantidad != null ? Number(cantidad) : totalPendiente;
    if (isNaN(aAsignar) || aAsignar <= 0) return res.status(400).json({ error: 'La cantidad a asignar debe ser mayor a 0' });
    if (aAsignar > totalPendiente + 0.0001) {
      return res.status(400).json({ error: `Solo hay ${totalPendiente} unidades pendientes en este proceso` });
    }

    let encargoAsignadoId = req.params.id;

    if (aAsignar < totalPendiente - 0.0001) {
      // Se divide: el original se queda con lo que sobra (sin asignar),
      // y se crea uno nuevo, ya asignado, con el pedazo elegido.
      const { error: eRed } = await supabase
        .from('colaboradores_encargos')
        .update({ cantidad_requerida: Math.round((totalPendiente - aAsignar) * 10000) / 10000, actualizado_en: new Date().toISOString() })
        .eq('id', req.params.id).eq('usuario_id', req.usuarioId);
      if (eRed) throw new Error(eRed.message);

      const { data: nuevo, error: eNuevo } = await supabase
        .from('colaboradores_encargos')
        .insert({
          usuario_id: req.usuarioId,
          colaborador_id,
          proceso_id: pendiente.proceso_id,
          cantidad_requerida: Math.round(aAsignar * 10000) / 10000,
          cantidad_entregada: 0,
          fecha_entrega: pendiente.fecha_entrega,
          costo_unitario_proceso: pendiente.costo_unitario_proceso,
          costo_total_proceso: 0
        })
        .select('id').single();
      if (eNuevo) throw new Error(eNuevo.message);
      encargoAsignadoId = nuevo.id;
    } else {
      // Se asigna completo.
      const { error: eAsig } = await supabase
        .from('colaboradores_encargos')
        .update({ colaborador_id, actualizado_en: new Date().toISOString() })
        .eq('id', req.params.id).eq('usuario_id', req.usuarioId);
      if (eAsig) throw new Error(eAsig.message);
    }

    const { data: completo, error: eFinal } = await supabase
      .from('colaboradores_encargos').select(SELECT_ENCARGO).eq('id', encargoAsignadoId).single();
    if (eFinal) throw new Error(eFinal.message);
    res.json(completo);
  } catch (err) { next(err); }
});

// GET /api/colaboradores/carga — cuánto trabajo pendiente (en minutos)
// tiene cada colaborador ahora mismo, para las barras del balanceo.
router.get('/carga', async (req, res, next) => {
  try {
    const { data: colaboradores, error: eCol } = await supabase
      .from('colaboradores').select('id, nombre').eq('usuario_id', req.usuarioId).eq('activo', true).order('nombre');
    if (eCol) throw new Error(eCol.message);

    const { data: encargos, error: eEnc } = await supabase
      .from('colaboradores_encargos')
      .select('id, colaborador_id, cantidad_requerida, cantidad_entregada, procesos(nombre, tiempo_minutos, productos(nombre))')
      .eq('usuario_id', req.usuarioId)
      .not('colaborador_id', 'is', null);
    if (eEnc) throw new Error(eEnc.message);

    const porColaborador = new Map(colaboradores.map(c => [c.id, { colaborador_id: c.id, nombre: c.nombre, minutos_pendientes: 0, tareas: [] }]));
    for (const e of encargos || []) {
      const fila = porColaborador.get(e.colaborador_id);
      if (!fila) continue; // colaborador inactivo — no se muestra en el balanceo
      const pendiente = Number(e.cantidad_requerida) - Number(e.cantidad_entregada);
      if (pendiente <= 0) continue;
      const minutos = pendiente * Number(e.procesos.tiempo_minutos);
      fila.minutos_pendientes += minutos;
      fila.tareas.push({
        encargo_id: e.id,
        proceso: e.procesos.nombre,
        producto: e.procesos.productos.nombre,
        cantidad_pendiente: Math.round(pendiente * 10000) / 10000,
        minutos: Math.round(minutos * 100) / 100
      });
    }

    const resultado = [...porColaborador.values()].map(f => ({ ...f, minutos_pendientes: Math.round(f.minutos_pendientes * 100) / 100 }));
    res.json(resultado);
  } catch (err) { next(err); }
});

// POST /api/colaboradores/:id/encargos — cuerpo:
// { proceso_id, cantidad_requerida, fecha_entrega }
// Los materiales entregados se calculan solos desde la receta del proceso
// (procesos_materiales) × la cantidad requerida, y se guardan en
// colaboradores_encargos_materiales SOLO para control y trazabilidad
// (columna "Materiales entregados" de Nóminas). El material real se
// descuenta cuando se REGISTRA LA ENTREGA de este proceso, no al crear
// el encargo (ver PUT /encargos/:id/entrega y servicios/produccion.js).
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
// PUT /api/colaboradores/encargos/:id/entrega — cuerpo:
// { cantidad_entregada, fecha_entrega, forzar }
// Al aumentar la cantidad entregada, se descuenta el material de ESE
// proceso y se consume WIP del proceso anterior de la ruta (si no es
// el primero) — el resultado avanza el WIP de este proceso. Si falta
// material o WIP del proceso anterior, avisa (409) y permite forzar,
// igual que en Ventas.
// PUT /api/colaboradores/encargos/:id/entrega — cuerpo:
// { cantidad, fecha, forzar }
// `cantidad` es lo que el colaborador entregó EN ESTE momento (no el
// total acumulado) — cada llamada es un evento nuevo en el historial
// (ver GET /encargos/:id/entregas). Descuenta el material de ESE
// proceso y consume WIP del proceso anterior de la ruta (si no es el
// primero) — el resultado avanza el WIP de este proceso. Si falta
// material o WIP del proceso anterior, avisa (409) y permite forzar.
router.put('/encargos/:id/entrega', async (req, res, next) => {
  try {
    const { cantidad, fecha, forzar } = req.body;
    const resultado = await registrarEntrega({
      tipo: 'proceso_colaborador',
      referenciaId: req.params.id,
      cantidad,
      fecha,
      usuarioId: req.usuarioId,
      forzar
    });
    if (!resultado.ok) {
      return res.status(409).json({
        error: 'No hay suficiente material o trabajo de la etapa anterior para registrar esta entrega',
        faltantes: resultado.faltantes,
        puede_forzar: true,
        mensaje: 'Puedes forzar la entrega (por ejemplo, si el conteo del sistema está desactualizado) y luego corregir con un ajuste de inventario.'
      });
    }

    const { data, error } = await supabase
      .from('colaboradores_encargos').select(SELECT_ENCARGO).eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/colaboradores/encargos/:id/entregas — historial de entregas
// puntuales de un encargo (más reciente primero).
router.get('/encargos/:id/entregas', async (req, res, next) => {
  try {
    const historial = await obtenerHistorial('proceso_colaborador', req.params.id, req.usuarioId);
    res.json(historial);
  } catch (err) { next(err); }
});

// DELETE /api/colaboradores/entregas/:id — corrige un registro de
// entrega puntual (se borra esa fila y se revierte el material/WIP que
// había movido).
router.delete('/entregas/:id', async (req, res, next) => {
  try {
    const resultado = await eliminarEntrega(req.params.id, req.usuarioId);
    res.json(resultado);
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