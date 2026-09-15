// ============================================================
// IMPORTADOR — Nóminas (server/servicios/importadores/nominas.js)
// - COLABORADORES: crear/actualizar por Código (como Materiales).
// - ENCARGOS: registra trabajo YA COMPLETADO — cantidad_requerida =
//   cantidad_entregada = Cantidad (100% entregado), con el Costo
//   exacto que se indique. NO toca produccion_wip ni la cola de
//   procesos pendientes — ver definiciones/nominas.js.
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerHoja } = require('../excel/lector');
const {
  HOJA_COLABORADORES, HOJA_ENCARGOS, COLUMNAS_COLABORADORES, COLUMNAS_ENCARGOS
} = require('../excel/definiciones/nominas');
const { aTextoLimpio, aNumero, aBooleanoSiNo, aFechaISO, requerido, numeroValido, siNoValido, fechaValida } = require('../excel/validador');
const { cifrar } = require('../../servicios/cifrado');

const CLAVE_COLAB = new Map(COLUMNAS_COLABORADORES.map((c) => [c.encabezado, c.clave]));
const CLAVE_ENCARGOS = new Map(COLUMNAS_ENCARGOS.map((c) => [c.encabezado, c.clave]));

function extraer(filaExcel, mapaClaves) {
  const datos = {};
  for (const [encabezado, clave] of mapaClaves) datos[clave] = filaExcel[encabezado];
  return datos;
}

async function obtenerColaboradoresPorCodigo(usuarioId) {
  const { data, error } = await supabase
    .from('colaboradores').select('id, codigo, nombre').eq('usuario_id', usuarioId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((c) => [c.codigo.toLowerCase(), c]));
}

async function obtenerProcesosPorCodigo(usuarioId) {
  const { data, error } = await supabase
    .from('procesos').select('id, codigo').eq('usuario_id', usuarioId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((p) => [p.codigo.toLowerCase(), p]));
}

async function siguienteCodigoDisponible(usuarioId) {
  const { data, error } = await supabase
    .from('colaboradores').select('codigo').eq('usuario_id', usuarioId).not('codigo', 'is', null).like('codigo', 'COL%');
  if (error) throw new Error(error.message);
  let maximo = 0;
  for (const fila of data || []) {
    const numero = parseInt(String(fila.codigo).replace(/^COL/i, ''), 10);
    if (!isNaN(numero) && numero > maximo) maximo = numero;
  }
  return maximo + 1;
}

// -------------------- 1. ANALIZAR --------------------
async function analizarNominas(buffer, usuarioId) {
  // ---- COLABORADORES ----
  const filasColabExcel = leerHoja(buffer, HOJA_COLABORADORES);
  const colaboradoresPorCodigo = await obtenerColaboradoresPorCodigo(usuarioId);

  const codigosVistos = new Set();
  const resumenColaboradores = { nuevos: 0, actualizados: 0, errores: 0 };
  const filasColaboradores = filasColabExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_COLAB);
    const codigo = aTextoLimpio(datos.codigo) || null;

    const errores = [
      requerido(datos.nombre, 'Nombre'),
      siNoValido(datos.activo, 'Activo', { opcional: true })
    ].filter(Boolean);

    if (codigo) {
      const clave = codigo.toLowerCase();
      if (codigosVistos.has(clave)) errores.push(`El código "${codigo}" está repetido dentro de este archivo`);
      codigosVistos.add(clave);
    }

    const existente = codigo ? colaboradoresPorCodigo.get(codigo.toLowerCase()) : null;
    const accion = existente ? 'actualizar' : 'crear';

    if (errores.length) resumenColaboradores.errores++;
    else if (accion === 'crear') resumenColaboradores.nuevos++;
    else resumenColaboradores.actualizados++;

    return { numero_fila: numeroFila, codigo, datos, accion, colaborador_id: existente ? existente.id : null, errores };
  });

  // ---- ENCARGOS ----
  const filasEncargosExcel = leerHoja(buffer, HOJA_ENCARGOS, { opcional: true });
  const procesosPorCodigo = await obtenerProcesosPorCodigo(usuarioId);
  const colaboradorLocalPorCodigo = new Map(
    filasColaboradores.filter((f) => f.codigo).map((f) => [f.codigo.toLowerCase(), f])
  );

  const resumenEncargos = { validas: 0, errores: 0 };
  const filasEncargos = filasEncargosExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_ENCARGOS);
    const codigoColaborador = aTextoLimpio(datos.codigo_colaborador);
    const codigoProceso = aTextoLimpio(datos.codigo_proceso);

    const errores = [
      requerido(datos.codigo_colaborador, 'Código colaborador'),
      requerido(datos.codigo_proceso, 'Código proceso'),
      fechaValida(datos.fecha, 'Fecha', { opcional: true }),
      numeroValido(datos.cantidad, 'Cantidad', { minimo: 0.0001 }),
      numeroValido(datos.costo, 'Costo', { minimo: 0 }),
      siNoValido(datos.pagado, 'Pagado', { opcional: true })
    ].filter(Boolean);

    const colaboradorExistente = codigoColaborador ? colaboradoresPorCodigo.get(codigoColaborador.toLowerCase()) : null;
    const colaboradorLocal = codigoColaborador ? colaboradorLocalPorCodigo.get(codigoColaborador.toLowerCase()) : null;
    let colaboradorId = colaboradorExistente ? colaboradorExistente.id : null;
    if (codigoColaborador && !colaboradorExistente && !colaboradorLocal) {
      errores.push(`El colaborador con código "${codigoColaborador}" no existe en este archivo ni en la plataforma`);
    } else if (codigoColaborador && !colaboradorExistente && colaboradorLocal && colaboradorLocal.errores.length) {
      errores.push(`El colaborador "${codigoColaborador}" tiene errores en la hoja COLABORADORES`);
    }

    const proceso = codigoProceso ? procesosPorCodigo.get(codigoProceso.toLowerCase()) : null;
    if (codigoProceso && !proceso) errores.push(`El proceso con código "${codigoProceso}" no existe`);

    if (errores.length) resumenEncargos.errores++; else resumenEncargos.validas++;

    return {
      numero_fila: numeroFila,
      codigo_colaborador: codigoColaborador || null,
      colaborador_id: colaboradorId,
      colaborador_local: colaboradorLocal || null, // se resuelve su id real recién creado, en importar()
      codigo_proceso: codigoProceso || null,
      proceso_id: proceso ? proceso.id : null,
      datos,
      errores
    };
  });

  return {
    modulo: 'nominas',
    resumen_colaboradores: resumenColaboradores,
    filas_colaboradores: filasColaboradores,
    resumen_encargos: resumenEncargos,
    filas_encargos: filasEncargos
  };
}

// -------------------- 2. IMPORTAR --------------------
async function importarNominas(usuarioId, reporte) {
  const resultado = {
    colaboradores: { creados: 0, actualizados: 0, omitidos: 0 },
    encargos: { registrados: 0, omitidos: 0 }
  };
  let siguienteConsecutivo = null;
  const idPorCodigoLocal = new Map(); // se llena a medida que se crean colaboradores nuevos

  // ---- COLABORADORES ----
  for (const fila of reporte.filas_colaboradores || []) {
    if (fila.errores && fila.errores.length) { resultado.colaboradores.omitidos++; continue; }
    const datos = fila.datos;

    if (fila.accion === 'crear') {
      let codigo = fila.codigo;
      if (!codigo) {
        if (siguienteConsecutivo == null) siguienteConsecutivo = await siguienteCodigoDisponible(usuarioId);
        codigo = `COL${String(siguienteConsecutivo).padStart(3, '0')}`;
        siguienteConsecutivo++;
      }
      const { data: nuevo, error } = await supabase.from('colaboradores').insert({
        usuario_id: usuarioId,
        codigo,
        nombre: aTextoLimpio(datos.nombre),
        cedula_cifrada: cifrar(aTextoLimpio(datos.cedula) || null),
        direccion_cifrada: cifrar(aTextoLimpio(datos.direccion) || null),
        activo: aBooleanoSiNo(datos.activo) ?? true
      }).select('id').single();
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
      if (fila.codigo) idPorCodigoLocal.set(fila.codigo.toLowerCase(), nuevo.id);
      resultado.colaboradores.creados++;
    } else {
      const { error } = await supabase.from('colaboradores').update({
        nombre: aTextoLimpio(datos.nombre),
        cedula_cifrada: cifrar(aTextoLimpio(datos.cedula) || null),
        direccion_cifrada: cifrar(aTextoLimpio(datos.direccion) || null),
        activo: aBooleanoSiNo(datos.activo) ?? true,
        actualizado_en: new Date().toISOString()
      }).eq('id', fila.colaborador_id).eq('usuario_id', usuarioId);
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
      resultado.colaboradores.actualizados++;
    }
  }

  // ---- ENCARGOS ----
  for (const fila of reporte.filas_encargos || []) {
    if (fila.errores && fila.errores.length) { resultado.encargos.omitidos++; continue; }
    const datos = fila.datos;

    let colaboradorId = fila.colaborador_id;
    if (!colaboradorId && fila.codigo_colaborador) {
      colaboradorId = idPorCodigoLocal.get(fila.codigo_colaborador.toLowerCase());
    }
    if (!colaboradorId) throw new Error(`Fila ${fila.numero_fila}: no se pudo resolver el colaborador "${fila.codigo_colaborador}"`);

    const cantidad = aNumero(datos.cantidad);
    const costo = aNumero(datos.costo);
    const fecha = aFechaISO(datos.fecha) || new Date().toISOString().slice(0, 10);
    const pagado = aBooleanoSiNo(datos.pagado) ?? false;

    const { error } = await supabase.from('colaboradores_encargos').insert({
      usuario_id: usuarioId,
      colaborador_id: colaboradorId,
      proceso_id: fila.proceso_id,
      cantidad_requerida: cantidad,
      cantidad_entregada: cantidad, // se registra como 100% completado (ver advertencia del módulo)
      fecha_entrega: fecha,
      costo_unitario_proceso: Math.round((costo / cantidad) * 100) / 100,
      costo_total_proceso: costo,
      pagado,
      fecha_pago: pagado ? fecha : null
    });
    if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
    resultado.encargos.registrados++;
  }

  return resultado;
}

module.exports = { analizarNominas, importarNominas };