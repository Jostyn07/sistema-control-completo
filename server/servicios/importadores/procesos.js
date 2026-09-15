// ============================================================
// IMPORTADOR — Procesos (server/servicios/importadores/procesos.js)
// Mismo patrón de dos pasos que Materiales/Productos, pero este
// módulo valida DOS hojas relacionadas entre sí:
//
//   - PROCESOS: cada fila crea o actualiza un proceso, ubicado en
//     la ficha técnica del producto que indica "Código producto".
//   - MATERIALES_PROCESO: cada fila asigna un material (y su
//     cantidad) a un proceso, referenciado por "Código proceso" —
//     que puede ser un proceso YA EXISTENTE en la plataforma, o uno
//     nuevo que se está creando en la hoja PROCESOS de este mismo
//     archivo (por eso un proceso nuevo necesita código propio si
//     se le van a asignar materiales en el mismo archivo).
//
// Los materiales de un proceso se REEMPLAZAN por completo (igual que
// hace rutas/procesos.js) pero SOLO si ese proceso aparece en la hoja
// MATERIALES_PROCESO — si no aparece, su ficha de materiales no se toca.
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerHoja } = require('../excel/lector');
const {
  HOJA_PROCESOS, HOJA_MATERIALES_PROCESO, COLUMNAS_PROCESOS, COLUMNAS_MATERIALES_PROCESO
} = require('../excel/definiciones/procesos');
const { aTextoLimpio, aNumero, aBooleanoSiNo, requerido, numeroValido, siNoValido } = require('../excel/validador');
const {
  obtenerCostoMinutoManoObra, recalcularCostoMaterialesDeProceso, recalcularProductoDesdeSusProcesos
} = require('../costos');

const CLAVE_PROCESOS = new Map(COLUMNAS_PROCESOS.map((c) => [c.encabezado, c.clave]));
const CLAVE_MATERIALES = new Map(COLUMNAS_MATERIALES_PROCESO.map((c) => [c.encabezado, c.clave]));

function extraer(filaExcel, mapaClaves) {
  const datos = {};
  for (const [encabezado, clave] of mapaClaves) datos[clave] = filaExcel[encabezado];
  return datos;
}

async function obtenerProductosPorCodigo(usuarioId) {
  const { data, error } = await supabase.from('productos').select('id, codigo').eq('usuario_id', usuarioId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((p) => [p.codigo.toLowerCase(), p]));
}

async function obtenerMaterialesPorCodigo(usuarioId) {
  const { data, error } = await supabase.from('materiales').select('id, codigo').eq('usuario_id', usuarioId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((m) => [m.codigo.toLowerCase(), m]));
}

async function obtenerProcesosPorCodigo(usuarioId) {
  const { data, error } = await supabase
    .from('procesos')
    .select('id, codigo, producto_id, nombre, tiempo_minutos, orden, repeticiones_por_unidad, activo')
    .eq('usuario_id', usuarioId)
    .not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((p) => [p.codigo.toLowerCase(), p]));
}

async function siguienteCodigoDisponible(usuarioId) {
  const { data, error } = await supabase
    .from('procesos').select('codigo').eq('usuario_id', usuarioId).not('codigo', 'is', null).like('codigo', 'PROC%');
  if (error) throw new Error(error.message);
  let maximo = 0;
  for (const fila of data || []) {
    const numero = parseInt(String(fila.codigo).replace(/^PROC/i, ''), 10);
    if (!isNaN(numero) && numero > maximo) maximo = numero;
  }
  return maximo + 1;
}

async function siguienteOrden(productoId, usuarioId, ordenesYaUsadosEnArchivo) {
  const { data, error } = await supabase
    .from('procesos').select('orden').eq('producto_id', productoId).eq('usuario_id', usuarioId)
    .order('orden', { ascending: false }).limit(1);
  if (error) throw new Error(error.message);
  const maximoBD = data && data.length > 0 && data[0].orden != null ? Number(data[0].orden) : 0;
  const maximoArchivo = ordenesYaUsadosEnArchivo.get(productoId) || 0;
  return Math.max(maximoBD, maximoArchivo) + 1;
}

// -------------------- 1. ANALIZAR --------------------
async function analizarProcesos(buffer, usuarioId) {
  const filasProcesosExcel = leerHoja(buffer, HOJA_PROCESOS);
  const filasMaterialesExcel = leerHoja(buffer, HOJA_MATERIALES_PROCESO, { opcional: true });

  const [productosPorCodigo, materialesPorCodigo, procesosPorCodigo] = await Promise.all([
    obtenerProductosPorCodigo(usuarioId),
    obtenerMaterialesPorCodigo(usuarioId),
    obtenerProcesosPorCodigo(usuarioId)
  ]);

  const codigosProcesoVistosEnArchivo = new Set();
  const resumen = { nuevos: 0, actualizados: 0, sin_cambios: 0, advertencias: 0, errores: 0 };

  const filas = filasProcesosExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_PROCESOS);
    const codigoProducto = aTextoLimpio(datos.codigo_producto);
    const codigo = aTextoLimpio(datos.codigo) || null;

    const errores = [
      requerido(datos.codigo_producto, 'Código producto'),
      requerido(datos.nombre, 'Nombre proceso'),
      numeroValido(datos.minutos, 'Minutos', { minimo: 0.01 }),
      numeroValido(datos.orden, 'Orden', { minimo: 1, opcional: true }),
      numeroValido(datos.repeticiones_por_unidad, 'Repeticiones por unidad', { minimo: 0.01, opcional: true }),
      siNoValido(datos.activo, 'Activo', { opcional: true })
    ].filter(Boolean);

    const producto = codigoProducto ? productosPorCodigo.get(codigoProducto.toLowerCase()) : null;
    if (codigoProducto && !producto) errores.push(`El producto con código "${codigoProducto}" no existe`);

    if (codigo) {
      const codigoNorm = codigo.toLowerCase();
      if (codigosProcesoVistosEnArchivo.has(codigoNorm)) errores.push(`El código "${codigo}" está repetido dentro de este archivo`);
      codigosProcesoVistosEnArchivo.add(codigoNorm);
    }

    const existente = codigo ? procesosPorCodigo.get(codigo.toLowerCase()) : null;
    let accion = existente ? 'actualizar' : 'crear';

    if (existente && errores.length === 0) {
      const sinCambios =
        aTextoLimpio(datos.nombre).toLowerCase() === existente.nombre.toLowerCase() &&
        Number(aNumero(datos.minutos)) === Number(existente.tiempo_minutos) &&
        (aTextoLimpio(datos.orden) === '' || Number(aNumero(datos.orden)) === Number(existente.orden)) &&
        (aTextoLimpio(datos.repeticiones_por_unidad) === '' || Number(aNumero(datos.repeticiones_por_unidad)) === Number(existente.repeticiones_por_unidad)) &&
        (aTextoLimpio(datos.activo) === '' || aBooleanoSiNo(datos.activo) === existente.activo) &&
        producto && producto.id === existente.producto_id;
      if (sinCambios) accion = 'sin_cambios';
    }

    if (errores.length) resumen.errores++;
    if (accion === 'crear') resumen.nuevos++;
    else if (accion === 'actualizar') resumen.actualizados++;
    else if (accion === 'sin_cambios') resumen.sin_cambios++;

    return {
      numero_fila: numeroFila,
      codigo,
      codigo_producto: codigoProducto || null,
      datos,
      accion,
      proceso_id: existente ? existente.id : null,
      producto_id: producto ? producto.id : null,
      producto_id_anterior: existente ? existente.producto_id : null,
      errores,
      advertencias: [],
      materiales: [] // se completa abajo con las filas de MATERIALES_PROCESO que le correspondan
    };
  });

  // Índice código de proceso (en minúscula) -> fila de PROCESOS, para
  // resolver referencias "locales" (un proceso nuevo definido en este
  // mismo archivo, todavía sin existir en la base de datos).
  const filaPorCodigoLocal = new Map(filas.filter((f) => f.codigo).map((f) => [f.codigo.toLowerCase(), f]));

  const resumenMateriales = { validas: 0, errores: 0 };
  filasMaterialesExcel.forEach((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_MATERIALES);
    const codigoProceso = aTextoLimpio(datos.codigo_proceso);
    const codigoMaterial = aTextoLimpio(datos.codigo_material);

    const errores = [
      requerido(datos.codigo_proceso, 'Código proceso'),
      requerido(datos.codigo_material, 'Código material'),
      numeroValido(datos.cantidad, 'Cantidad', { minimo: 0.0001 })
    ].filter(Boolean);

    const filaProcesoLocal = codigoProceso ? filaPorCodigoLocal.get(codigoProceso.toLowerCase()) : null;
    const procesoExistente = codigoProceso ? procesosPorCodigo.get(codigoProceso.toLowerCase()) : null;
    if (codigoProceso && !filaProcesoLocal && !procesoExistente) {
      errores.push(`El proceso con código "${codigoProceso}" no existe en este archivo ni en la plataforma`);
    }

    const material = codigoMaterial ? materialesPorCodigo.get(codigoMaterial.toLowerCase()) : null;
    if (codigoMaterial && !material) errores.push(`El material con código "${codigoMaterial}" no existe`);

    const entrada = {
      numero_fila: numeroFila,
      codigo_proceso: codigoProceso || null,
      codigo_material: codigoMaterial || null,
      material_id: material ? material.id : null,
      cantidad: errores.length === 0 ? aNumero(datos.cantidad) : null,
      errores
    };

    if (errores.length) resumenMateriales.errores++;
    else resumenMateriales.validas++;

    // Se cuelga de la fila de PROCESOS correspondiente (si existe) para
    // que la previsualización muestre juntos un proceso y sus materiales.
    if (filaProcesoLocal) filaProcesoLocal.materiales.push(entrada);
  });

  return {
    modulo: 'procesos',
    total_filas: filas.length,
    resumen,
    resumen_materiales: resumenMateriales,
    filas
  };
}

// -------------------- 2. IMPORTAR --------------------
async function importarProcesos(usuarioId, filas, modo = 'crear_y_actualizar') {
  let siguienteConsecutivo = null;
  const ordenesUsadosEnArchivo = new Map(); // producto_id -> mayor orden ya repartido en esta importación
  const costoMinuto = await obtenerCostoMinutoManoObra(usuarioId);
  const productosARecalcular = new Set();
  const resultado = { creados: 0, actualizados: 0, sin_cambios: 0, omitidos: 0 };

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }
    if (fila.accion === 'sin_cambios') { resultado.sin_cambios++; continue; }
    if (fila.accion === 'crear' && modo === 'actualizar_solamente') { resultado.omitidos++; continue; }
    if (fila.accion === 'actualizar' && modo === 'crear_solamente') { resultado.omitidos++; continue; }

    const datos = fila.datos;
    const tiempoMinutos = aNumero(datos.minutos);
    const costoUnitario = Math.round(tiempoMinutos * costoMinuto * 100) / 100;
    const repeticiones = aNumero(datos.repeticiones_por_unidad) ?? 1;
    // Solo las filas de MATERIALES_PROCESO que pasaron su propia validación.
    const materialesValidos = (fila.materiales || []).filter((m) => m.errores.length === 0)
      .map((m) => ({ material_id: m.material_id, cantidad: m.cantidad }));

    let procesoId;

    if (fila.accion === 'crear') {
      let codigo = fila.codigo;
      if (!codigo) {
        if (siguienteConsecutivo == null) siguienteConsecutivo = await siguienteCodigoDisponible(usuarioId);
        codigo = `PROC${String(siguienteConsecutivo).padStart(3, '0')}`;
        siguienteConsecutivo++;
      }
      const orden = aNumero(datos.orden) ?? await siguienteOrden(fila.producto_id, usuarioId, ordenesUsadosEnArchivo);
      ordenesUsadosEnArchivo.set(fila.producto_id, Math.max(ordenesUsadosEnArchivo.get(fila.producto_id) || 0, orden));

      const { data: nuevo, error } = await supabase.from('procesos').insert({
        usuario_id: usuarioId,
        producto_id: fila.producto_id,
        codigo,
        nombre: aTextoLimpio(datos.nombre),
        unidad: 'minutos',
        tiempo_minutos: tiempoMinutos,
        costo_unitario: costoUnitario,
        costo_materiales: 0,
        orden,
        repeticiones_por_unidad: repeticiones,
        activo: aBooleanoSiNo(datos.activo) ?? true
      }).select('id').single();
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
      procesoId = nuevo.id;

      if (materialesValidos.length > 0) {
        const { error: eIns } = await supabase.from('procesos_materiales')
          .insert(materialesValidos.map((m) => ({ proceso_id: procesoId, ...m })));
        if (eIns) throw new Error(eIns.message);
      }
      resultado.creados++;
    } else {
      const cambios = {
        producto_id: fila.producto_id,
        nombre: aTextoLimpio(datos.nombre),
        tiempo_minutos: tiempoMinutos,
        costo_unitario: costoUnitario,
        actualizado_en: new Date().toISOString()
      };
      if (aTextoLimpio(datos.orden) !== '') cambios.orden = aNumero(datos.orden);
      if (aTextoLimpio(datos.repeticiones_por_unidad) !== '') cambios.repeticiones_por_unidad = repeticiones;
      if (aTextoLimpio(datos.activo) !== '') cambios.activo = aBooleanoSiNo(datos.activo);

      const { error } = await supabase.from('procesos').update(cambios).eq('id', fila.proceso_id).eq('usuario_id', usuarioId);
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
      procesoId = fila.proceso_id;

      // Si el archivo trae materiales para este proceso, se reemplazan
      // por completo; si no aparece en MATERIALES_PROCESO, no se toca.
      if (fila.materiales && fila.materiales.length > 0) {
        const { error: eDel } = await supabase.from('procesos_materiales').delete().eq('proceso_id', procesoId);
        if (eDel) throw new Error(eDel.message);
        if (materialesValidos.length > 0) {
          const { error: eIns } = await supabase.from('procesos_materiales')
            .insert(materialesValidos.map((m) => ({ proceso_id: procesoId, ...m })));
          if (eIns) throw new Error(eIns.message);
        }
      }

      // Si el proceso se movió de ficha técnica, hay que recalcular
      // también la anterior (perdió este proceso).
      if (fila.producto_id_anterior && fila.producto_id_anterior !== fila.producto_id) {
        productosARecalcular.add(fila.producto_id_anterior);
      }
      resultado.actualizados++;
    }

    await recalcularCostoMaterialesDeProceso(procesoId, usuarioId);
    productosARecalcular.add(fila.producto_id);
  }

  for (const productoId of productosARecalcular) {
    await recalcularProductoDesdeSusProcesos(productoId, usuarioId);
  }

  return resultado;
}

module.exports = { analizarProcesos, importarProcesos };