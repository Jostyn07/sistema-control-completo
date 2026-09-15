// ============================================================
// IMPORTADOR — Finanzas (server/servicios/importadores/finanzas.js)
// Tres hojas independientes, cada una con su propia lógica:
//   - COSTOS_FIJOS  → crear/actualizar por Nombre (sin código, no
//     hace falta: nada más lo referencia).
//   - CAPITAL       → siempre crea un movimiento nuevo (como Inventario).
//   - CONFIGURACION → actualiza solo los parámetros con Valor escrito,
//     sobre la única fila de configuración del usuario.
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerHoja } = require('../excel/lector');
const {
  PARAMETROS_VALIDOS, HOJA_COSTOS_FIJOS, HOJA_CAPITAL, HOJA_CONFIGURACION,
  COLUMNAS_COSTOS_FIJOS, COLUMNAS_CAPITAL, COLUMNAS_CONFIGURACION
} = require('../excel/definiciones/finanzas');
const { aTextoLimpio, aNumero, aBooleanoSiNo, aFechaISO, requerido, numeroValido, enListaValido, fechaValida } = require('../excel/validador');
const { recalcularTodosLosProductos } = require('../costos');

const CLAVE_COSTOS = new Map(COLUMNAS_COSTOS_FIJOS.map((c) => [c.encabezado, c.clave]));
const CLAVE_CAPITAL = new Map(COLUMNAS_CAPITAL.map((c) => [c.encabezado, c.clave]));
const CLAVE_CONFIG = new Map(COLUMNAS_CONFIGURACION.map((c) => [c.encabezado, c.clave]));

function extraer(filaExcel, mapaClaves) {
  const datos = {};
  for (const [encabezado, clave] of mapaClaves) datos[clave] = filaExcel[encabezado];
  return datos;
}

// -------------------- 1. ANALIZAR --------------------
async function analizarFinanzas(buffer, usuarioId) {
  // ---- COSTOS_FIJOS ----
  const filasCostosExcel = leerHoja(buffer, HOJA_COSTOS_FIJOS);
  const { data: costosExistentes, error: eCostos } = await supabase
    .from('costos_fijos').select('id, nombre, valor_mensual, activo').eq('usuario_id', usuarioId);
  if (eCostos) throw new Error(eCostos.message);
  const costosPorNombre = new Map((costosExistentes || []).map((c) => [c.nombre.toLowerCase(), c]));

  const nombresVistos = new Set();
  const resumenCostos = { nuevos: 0, actualizados: 0, sin_cambios: 0, errores: 0 };
  const filasCostos = filasCostosExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_COSTOS);
    const nombre = aTextoLimpio(datos.nombre);

    const errores = [
      requerido(datos.nombre, 'Nombre'),
      numeroValido(datos.valor_mensual, 'Valor mensual', { minimo: 0 })
    ].filter(Boolean);

    if (nombre) {
      const clave = nombre.toLowerCase();
      if (nombresVistos.has(clave)) errores.push(`El nombre "${nombre}" está repetido dentro de este archivo`);
      nombresVistos.add(clave);
    }

    const existente = nombre ? costosPorNombre.get(nombre.toLowerCase()) : null;
    let accion = existente ? 'actualizar' : 'crear';
    if (existente && errores.length === 0) {
      const activoNuevo = aBooleanoSiNo(datos.activo) ?? true;
      const sinCambios = Number(aNumero(datos.valor_mensual)) === Number(existente.valor_mensual) && activoNuevo === existente.activo;
      if (sinCambios) accion = 'sin_cambios';
    }

    if (errores.length) resumenCostos.errores++;
    else if (accion === 'crear') resumenCostos.nuevos++;
    else if (accion === 'actualizar') resumenCostos.actualizados++;
    else resumenCostos.sin_cambios++;

    return { numero_fila: numeroFila, nombre: nombre || null, datos, accion, costo_fijo_id: existente ? existente.id : null, errores };
  });

  // ---- CAPITAL ----
  const filasCapitalExcel = leerHoja(buffer, HOJA_CAPITAL, { opcional: true });
  const resumenCapital = { validas: 0, errores: 0 };
  const filasCapital = filasCapitalExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_CAPITAL);
    const valor = aNumero(datos.valor);

    const errores = [
      fechaValida(datos.fecha, 'Fecha', { opcional: true }),
      requerido(datos.concepto, 'Concepto'),
      numeroValido(datos.valor, 'Valor', {})
    ].filter(Boolean);
    if (errores.length === 0 && valor === 0) errores.push('El valor no puede ser 0');

    if (errores.length) resumenCapital.errores++; else resumenCapital.validas++;
    return { numero_fila: numeroFila, datos, errores };
  });

  // ---- CONFIGURACION ----
  const filasConfigExcel = leerHoja(buffer, HOJA_CONFIGURACION, { opcional: true });
  const parametrosVistos = new Set();
  const resumenConfig = { aplicables: 0, sin_valor: 0, errores: 0 };
  const filasConfig = filasConfigExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_CONFIG);
    const parametro = aTextoLimpio(datos.parametro);
    const valorTexto = aTextoLimpio(datos.valor);

    const errores = [enListaValido(datos.parametro, 'Parámetro', PARAMETROS_VALIDOS)].filter(Boolean);

    if (parametro) {
      const clave = parametro.toLowerCase();
      if (parametrosVistos.has(clave)) errores.push(`El parámetro "${parametro}" está repetido dentro de este archivo`);
      parametrosVistos.add(clave);
    }

    if (errores.length === 0 && valorTexto !== '') {
      if (parametro === 'Fecha inicio operación') {
        const err = fechaValida(datos.valor, 'Valor', { opcional: false });
        if (err) errores.push(err);
      } else {
        const err = numeroValido(datos.valor, 'Valor', { minimo: 0 });
        if (err) errores.push(err);
      }
    }

    if (errores.length) resumenConfig.errores++;
    else if (valorTexto === '') resumenConfig.sin_valor++;
    else resumenConfig.aplicables++;

    return { numero_fila: numeroFila, parametro: parametro || null, tiene_valor: valorTexto !== '', datos, errores };
  });

  return {
    modulo: 'finanzas',
    resumen_costos_fijos: resumenCostos,
    filas_costos_fijos: filasCostos,
    resumen_capital: resumenCapital,
    filas_capital: filasCapital,
    resumen_configuracion: resumenConfig,
    filas_configuracion: filasConfig
  };
}

// -------------------- 2. IMPORTAR --------------------
// Recibe exactamente lo que devolvió analizarFinanzas() (o esas mismas
// tres listas ya editadas/confirmadas por el usuario).
async function importarFinanzas(usuarioId, reporte) {
  const resultado = {
    costos_fijos: { creados: 0, actualizados: 0, sin_cambios: 0, omitidos: 0 },
    capital: { creados: 0, omitidos: 0 },
    configuracion: { aplicados: 0, omitidos: 0 }
  };

  // ---- COSTOS_FIJOS ----
  for (const fila of reporte.filas_costos_fijos || []) {
    if (fila.errores && fila.errores.length) { resultado.costos_fijos.omitidos++; continue; }
    if (fila.accion === 'sin_cambios') { resultado.costos_fijos.sin_cambios++; continue; }

    const datos = fila.datos;
    if (fila.accion === 'crear') {
      const { error } = await supabase.from('costos_fijos').insert({
        usuario_id: usuarioId,
        nombre: aTextoLimpio(datos.nombre),
        valor_mensual: aNumero(datos.valor_mensual),
        activo: aBooleanoSiNo(datos.activo) ?? true
      });
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
      resultado.costos_fijos.creados++;
    } else {
      const { error } = await supabase.from('costos_fijos').update({
        nombre: aTextoLimpio(datos.nombre),
        valor_mensual: aNumero(datos.valor_mensual),
        activo: aBooleanoSiNo(datos.activo) ?? true
      }).eq('id', fila.costo_fijo_id).eq('usuario_id', usuarioId);
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
      resultado.costos_fijos.actualizados++;
    }
  }

  // ---- CAPITAL ----
  for (const fila of reporte.filas_capital || []) {
    if (fila.errores && fila.errores.length) { resultado.capital.omitidos++; continue; }
    const datos = fila.datos;
    const { error } = await supabase.from('capital_invertido').insert({
      usuario_id: usuarioId,
      concepto: aTextoLimpio(datos.concepto),
      valor: aNumero(datos.valor),
      fecha: aFechaISO(datos.fecha) || new Date().toISOString().slice(0, 10)
    });
    if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
    resultado.capital.creados++;
  }

  // ---- CONFIGURACION ----
  const cambios = {};
  let costoHoraCambio = false;
  for (const fila of reporte.filas_configuracion || []) {
    if (fila.errores && fila.errores.length) { resultado.configuracion.omitidos++; continue; }
    if (!fila.tiene_valor) continue; // vacío = no tocar ese parámetro

    const valorTexto = aTextoLimpio(fila.datos.valor);
    if (fila.parametro === 'Costo hora mano de obra') { cambios.costo_hora_mano_obra = aNumero(valorTexto); costoHoraCambio = true; }
    else if (fila.parametro === 'Meta ventas mensual') cambios.meta_ventas_mensual = aNumero(valorTexto);
    else if (fila.parametro === 'Fecha inicio operación') cambios.fecha_inicio_operacion = aFechaISO(valorTexto);
    resultado.configuracion.aplicados++;
  }

  if (Object.keys(cambios).length > 0) {
    const { data: existente, error: eGet } = await supabase
      .from('configuracion_produccion').select('usuario_id').eq('usuario_id', usuarioId).maybeSingle();
    if (eGet) throw new Error(eGet.message);

    cambios.actualizado_en = new Date().toISOString();
    const operacion = existente
      ? supabase.from('configuracion_produccion').update(cambios).eq('usuario_id', usuarioId)
      : supabase.from('configuracion_produccion').insert({ usuario_id: usuarioId, ...cambios });
    const { error: eUpd } = await operacion;
    if (eUpd) throw new Error(eUpd.message);

    if (costoHoraCambio) await recalcularTodosLosProductos(usuarioId);
  }

  return resultado;
}

module.exports = { analizarFinanzas, importarFinanzas };