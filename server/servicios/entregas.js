// ============================================================
// SERVICIO DE ENTREGAS PARCIALES — server/servicios/entregas.js
// Un solo motor para dos casos que funcionan igual: "algo que se debe
// en cierta cantidad, se entrega de a poco, y cada entrega queda
// registrada con su fecha". Hoy lo usa Colaboradores (entrega B lo
// conectará también a Ventas).
//
// Cada tipo soportado sabe en qué tabla vive su "referencia" (la fila
// que acumula el total entregado) y cuál es su columna de cantidad
// total — así el resto de la lógica (validar, sumar, revertir) es
// idéntica para ambos.
// ============================================================
const supabase = require('../supabase/cliente');
const { registrarProduccionProceso, revertirProduccionProceso } = require('./produccion');

// `ventas_items` no tiene su propia columna usuario_id (el dueño es
// `ventas`, la tabla padre) — para ese tipo se verifica la propiedad
// con un join a ventas en vez de filtrar directo por esa columna.
const CONFIG_TIPO = {
  proceso_colaborador: { tabla: 'colaboradores_encargos', columnaTotal: 'cantidad_requerida', tieneUsuarioId: true },
  venta_item: { tabla: 'ventas_items', columnaTotal: 'cantidad', tieneUsuarioId: false }
};

function errorConEstado(mensaje, status) {
  return Object.assign(new Error(mensaje), { status });
}

// Trae la fila de referencia (colaboradores_encargos o ventas_items),
// verificando que sea del usuario correcto — con o sin columna
// usuario_id propia, según el tipo.
async function obtenerReferencia(config, referenciaId, usuarioId) {
  if (config.tieneUsuarioId) {
    const { data, error } = await supabase
      .from(config.tabla).select('*').eq('id', referenciaId).eq('usuario_id', usuarioId).single();
    return { data, error };
  }
  const { data, error } = await supabase
    .from(config.tabla).select('*, ventas!inner(usuario_id)')
    .eq('id', referenciaId).eq('ventas.usuario_id', usuarioId).single();
  return { data, error };
}

// Actualiza la fila de referencia — mismo detalle: ventas_items no
// tiene usuario_id propio para filtrar el UPDATE.
async function actualizarReferencia(config, referenciaId, usuarioId, cambios) {
  let consulta = supabase.from(config.tabla).update(cambios).eq('id', referenciaId);
  if (config.tieneUsuarioId) consulta = consulta.eq('usuario_id', usuarioId);
  const { error } = await consulta;
  return error;
}

// Registra UN evento de entrega. `cantidad` es lo que se entregó EN
// ESTE evento (no el total acumulado). Para procesos de colaborador,
// primero valida/descuenta material y WIP — si falta algo y no se
// fuerza, devuelve { ok: false, faltantes } en vez de tirar error, para
// que la ruta arme su propio 409 con el detalle (igual que en Ventas).
async function registrarEntrega({ tipo, referenciaId, cantidad, fecha, usuarioId, grupoId, forzar }) {
  const config = CONFIG_TIPO[tipo];
  if (!config) throw errorConEstado('Tipo de entrega no soportado', 400);
  if (cantidad == null || isNaN(cantidad) || Number(cantidad) <= 0)
    throw errorConEstado('La cantidad entregada debe ser un número mayor a 0', 400);
  if (!fecha) throw errorConEstado('La fecha de entrega es obligatoria', 400);

  const { data: referencia, error: eRef } = await obtenerReferencia(config, referenciaId, usuarioId);
  if (eRef || !referencia) throw errorConEstado('No se encontró lo que se está entregando', 404);

  const totalRequerido = Number(referencia[config.columnaTotal]);
  const yaEntregado = Number(referencia.cantidad_entregada || 0);
  const cantidadNum = Number(cantidad);
  if (yaEntregado + cantidadNum > totalRequerido + 0.0001) {
    throw errorConEstado(
      `Ya se entregó ${yaEntregado} de ${totalRequerido} — no puedes entregar ${cantidadNum} más de la cuenta`, 400
    );
  }

  if (tipo === 'proceso_colaborador') {
    const { data: proceso, error: eProc } = await supabase
      .from('procesos').select('producto_id').eq('id', referencia.proceso_id).single();
    if (eProc) throw new Error(eProc.message);

    const resultado = await registrarProduccionProceso({
      procesoId: referencia.proceso_id,
      productoId: proceso.producto_id,
      delta: cantidadNum,
      usuarioId,
      encargoId: referencia.id,
      forzar: !!forzar
    });
    if (resultado.faltantes.length > 0 && !forzar) {
      return { ok: false, faltantes: resultado.faltantes };
    }
  }

  const { data: entrega, error: eIns } = await supabase
    .from('entregas_parciales')
    .insert({ usuario_id: usuarioId, tipo, referencia_id: referenciaId, cantidad: cantidadNum, fecha, grupo_id: grupoId || null })
    .select().single();
  if (eIns) throw new Error(eIns.message);

  const nuevoTotal = Math.round((yaEntregado + cantidadNum) * 10000) / 10000;
  const cambios = { cantidad_entregada: nuevoTotal, actualizado_en: new Date().toISOString() };
  if (tipo === 'proceso_colaborador') {
    const costoUnitarioRedondeado = Math.round(Number(referencia.costo_unitario_proceso));
    cambios.costo_total_proceso = Math.round(nuevoTotal * costoUnitarioRedondeado * 100) / 100;
    // Se mantiene fecha_entrega con la más reciente, para no romper
    // pantallas que ya muestran ese campo suelto.
    cambios.fecha_entrega = fecha;
  }

  const eUpd = await actualizarReferencia(config, referenciaId, usuarioId, cambios);
  if (eUpd) throw new Error(eUpd.message);

  return { ok: true, entrega };
}

// Borra UN registro de entrega puntual (corrección) y revierte lo que
// esa entrega había movido — material/WIP si era de un colaborador.
async function eliminarEntrega(entregaId, usuarioId) {
  const { data: entrega, error: eGet } = await supabase
    .from('entregas_parciales').select('*').eq('id', entregaId).eq('usuario_id', usuarioId).single();
  if (eGet || !entrega) throw errorConEstado('Ese registro de entrega no existe', 404);

  const config = CONFIG_TIPO[entrega.tipo];
  const { data: referencia, error: eRef } = await obtenerReferencia(config, entrega.referencia_id, usuarioId);
  if (eRef || !referencia) throw new Error('No se encontró el registro asociado a esta entrega');

  if (entrega.tipo === 'proceso_colaborador') {
    const { data: proceso, error: eProc } = await supabase
      .from('procesos').select('producto_id').eq('id', referencia.proceso_id).single();
    if (eProc) throw new Error(eProc.message);

    await revertirProduccionProceso({
      procesoId: referencia.proceso_id,
      productoId: proceso.producto_id,
      delta: Number(entrega.cantidad),
      usuarioId,
      encargoId: referencia.id
    });
  }

  const { error: eDel } = await supabase.from('entregas_parciales').delete().eq('id', entregaId).eq('usuario_id', usuarioId);
  if (eDel) throw new Error(eDel.message);

  const nuevoTotal = Math.max(0, Math.round((Number(referencia.cantidad_entregada) - Number(entrega.cantidad)) * 10000) / 10000);
  const cambios = { cantidad_entregada: nuevoTotal, actualizado_en: new Date().toISOString() };
  if (entrega.tipo === 'proceso_colaborador') {
    const costoUnitarioRedondeado = Math.round(Number(referencia.costo_unitario_proceso));
    cambios.costo_total_proceso = Math.round(nuevoTotal * costoUnitarioRedondeado * 100) / 100;
  }

  const eUpd = await actualizarReferencia(config, entrega.referencia_id, usuarioId, cambios);
  if (eUpd) throw new Error(eUpd.message);

  return { eliminado: true, nuevo_total: nuevoTotal };
}

// Historial de entregas de una referencia puntual (más reciente primero).
async function obtenerHistorial(tipo, referenciaId, usuarioId) {
  const { data, error } = await supabase
    .from('entregas_parciales')
    .select('*')
    .eq('tipo', tipo).eq('referencia_id', referenciaId).eq('usuario_id', usuarioId)
    .order('fecha', { ascending: false })
    .order('creado_en', { ascending: false });
  if (error) throw new Error(error.message);
  return data;
}

module.exports = { registrarEntrega, eliminarEntrega, obtenerHistorial };