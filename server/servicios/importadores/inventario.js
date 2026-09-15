// ============================================================
// IMPORTADOR — Inventario (server/servicios/importadores/inventario.js)
// A diferencia de Materiales/Productos/Procesos, aquí no hay
// "crear" ni "actualizar": cada fila válida es un MOVIMIENTO nuevo
// que se aplica al stock, exactamente igual que un ajuste manual
// hecho uno por uno desde la plataforma (POST /api/inventario/ajuste),
// solo que aquí se hacen muchos de una vez.
//
// - ENTRADA: cantidad (positiva) se SUMA al stock.
// - SALIDA:  cantidad (positiva) se RESTA del stock.
// - AJUSTE:  cantidad es la diferencia a corregir (puede ser
//            negativa) y se SUMA tal cual al stock.
// Ninguna fila puede dejar el stock en negativo.
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerFilas } = require('../excel/lector');
const { COLUMNAS, TIPOS_VALIDOS } = require('../excel/definiciones/inventario');
const { aTextoLimpio, aNumero, requerido, numeroValido, enListaValido } = require('../excel/validador');

const CLAVE_POR_ENCABEZADO = new Map(COLUMNAS.map((c) => [c.encabezado, c.clave]));

function extraerDatos(filaExcel) {
  const datos = {};
  for (const [encabezado, clave] of CLAVE_POR_ENCABEZADO) datos[clave] = filaExcel[encabezado];
  return datos;
}

async function obtenerMaterialesPorCodigo(usuarioId) {
  const { data, error } = await supabase
    .from('materiales').select('id, codigo, stock_actual').eq('usuario_id', usuarioId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((m) => [m.codigo.toLowerCase(), m]));
}

// Calcula en cuánto cambia el stock según el tipo. Devuelve `undefined`
// si el tipo no es válido (ya se habrá reportado como error antes).
function deltaSegunTipo(tipo, cantidad) {
  const tipoNorm = aTextoLimpio(tipo).toUpperCase();
  if (tipoNorm === 'ENTRADA') return cantidad;
  if (tipoNorm === 'SALIDA') return -cantidad;
  if (tipoNorm === 'AJUSTE') return cantidad; // ya viene con el signo correcto
  return undefined;
}

// -------------------- 1. ANALIZAR --------------------
async function analizarInventario(buffer, usuarioId) {
  const filasExcel = leerFilas(buffer);
  const materialesPorCodigo = await obtenerMaterialesPorCodigo(usuarioId);

  // Saldo proyectado por material a medida que se procesan las filas del
  // archivo EN ORDEN — así, si dos filas mueven el mismo material, la
  // segunda se valida contra el resultado de la primera (no contra el
  // stock que había antes de abrir el archivo).
  const saldoProyectado = new Map();
  for (const material of materialesPorCodigo.values()) saldoProyectado.set(material.id, Number(material.stock_actual));

  const resumen = { validas: 0, errores: 0 };

  const filas = filasExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraerDatos(filaExcel);
    const codigoMaterial = aTextoLimpio(datos.codigo_material);

    const errores = [
      requerido(datos.codigo_material, 'Código material'),
      enListaValido(datos.tipo, 'Tipo', TIPOS_VALIDOS),
      requerido(datos.motivo, 'Motivo')
    ].filter(Boolean);

    const material = codigoMaterial ? materialesPorCodigo.get(codigoMaterial.toLowerCase()) : null;
    if (codigoMaterial && !material) errores.push(`El material con código "${codigoMaterial}" no existe`);

    const tipoNorm = aTextoLimpio(datos.tipo).toUpperCase();
    const esEntradaOSalida = tipoNorm === 'ENTRADA' || tipoNorm === 'SALIDA';
    const errorCantidad = esEntradaOSalida
      ? numeroValido(datos.cantidad, 'Cantidad', { minimo: 0.0001 }) // debe ser positiva
      : numeroValido(datos.cantidad, 'Cantidad', {}); // AJUSTE: cualquier número, incluido negativo
    if (errorCantidad) errores.push(errorCantidad);

    let stockAnterior = null;
    let stockNuevo = null;
    let delta = null;

    if (material && errores.length === 0) {
      const cantidad = Number(aNumero(datos.cantidad));
      delta = deltaSegunTipo(tipoNorm, cantidad);
      stockAnterior = saldoProyectado.get(material.id);
      stockNuevo = Math.round((stockAnterior + delta) * 10000) / 10000;
      if (stockNuevo < 0) {
        errores.push(`Esta fila dejaría el stock en ${stockNuevo} (no puede quedar negativo)`);
      } else {
        saldoProyectado.set(material.id, stockNuevo); // solo se actualiza el saldo proyectado si la fila es válida
      }
    }

    if (errores.length) resumen.errores++;
    else resumen.validas++;

    return {
      numero_fila: numeroFila,
      codigo_material: codigoMaterial || null,
      material_id: material ? material.id : null,
      tipo: errores.length ? (TIPOS_VALIDOS.includes(tipoNorm) ? tipoNorm : null) : tipoNorm,
      datos,
      delta,
      stock_anterior_proyectado: stockAnterior,
      stock_nuevo_proyectado: stockNuevo,
      errores
    };
  });

  return { modulo: 'inventario', total_filas: filas.length, resumen, filas };
}

// -------------------- 2. IMPORTAR --------------------
// No recibe `modo` (crear/actualizar) porque no aplica aquí — cada fila
// válida siempre se aplica, en el mismo orden en que aparece en el archivo.
async function importarInventario(usuarioId, filas) {
  const resultado = { aplicados: 0, omitidos: 0 };

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }

    // Se relee el stock actual justo antes de aplicar cada fila (en vez
    // de confiar en el saldo proyectado del análisis) por si pasó tiempo
    // entre analizar y confirmar la importación.
    const { data: material, error: eGet } = await supabase
      .from('materiales').select('id, stock_actual').eq('id', fila.material_id).eq('usuario_id', usuarioId).single();
    if (eGet || !material) throw new Error(`Fila ${fila.numero_fila}: el material ya no existe`);

    const stockAnterior = Number(material.stock_actual);
    const stockNuevo = Math.round((stockAnterior + fila.delta) * 10000) / 10000;
    if (stockNuevo < 0) throw new Error(`Fila ${fila.numero_fila}: dejaría el stock en negativo, no se importó`);

    const { data: ajuste, error: eAjuste } = await supabase.from('inventario_ajustes').insert({
      usuario_id: usuarioId,
      material_id: fila.material_id,
      stock_anterior: stockAnterior,
      stock_nuevo: stockNuevo,
      motivo: `[${fila.tipo}] ${aTextoLimpio(fila.datos.motivo)}`,
      usuario: 'Importación Excel'
    }).select().single();
    if (eAjuste) throw new Error(`Fila ${fila.numero_fila}: ${eAjuste.message}`);

    const { error: eUpd } = await supabase
      .from('materiales').update({ stock_actual: stockNuevo, actualizado_en: new Date().toISOString() })
      .eq('id', fila.material_id).eq('usuario_id', usuarioId);
    if (eUpd) throw new Error(`Fila ${fila.numero_fila}: ${eUpd.message}`);

    // Bitácora — igual que en el ajuste manual: si falla, el movimiento ya
    // se aplicó igual, solo queda sin registrar en el historial de gráficas.
    const { error: eMov } = await supabase.from('inventario_movimientos').insert({
      usuario_id: usuarioId,
      material_id: fila.material_id,
      tipo: 'ajuste',
      cantidad: fila.delta,
      stock_anterior: stockAnterior,
      stock_nuevo: stockNuevo,
      referencia_id: ajuste.id
    });
    if (eMov) console.error('[inventario_movimientos] No se pudo registrar el movimiento de importación:', eMov.message);

    resultado.aplicados++;
  }

  return resultado;
}

module.exports = { analizarInventario, importarInventario };