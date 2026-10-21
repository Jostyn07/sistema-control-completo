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
const { randomUUID } = require('crypto');
const { aplicarOperacion } = require('../inventario/nucleo');
const log = require('../../seguridad/log');
const { usuarioActual } = require('../../contexto');
const { leerFilas } = require('../excel/lector');
const { COLUMNAS, TIPOS_VALIDOS } = require('../excel/definiciones/inventario');
const { aTextoLimpio, aNumero, requerido, numeroValido, enListaValido } = require('../excel/validador');

const CLAVE_POR_ENCABEZADO = new Map(COLUMNAS.map((c) => [c.encabezado, c.clave]));

function extraerDatos(filaExcel) {
  const datos = {};
  for (const [encabezado, clave] of CLAVE_POR_ENCABEZADO) datos[clave] = filaExcel[encabezado];
  return datos;
}

async function obtenerMaterialesPorCodigo(empresaId) {
  const { data, error } = await supabase
    .from('materiales').select('id, codigo, stock_actual').eq('empresa_id', empresaId).not('codigo', 'is', null);
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
async function analizarInventario(buffer, empresaId) {
  const filasExcel = leerFilas(buffer);
  const materialesPorCodigo = await obtenerMaterialesPorCodigo(empresaId);

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
async function importarInventario(empresaId, filas) {
  const resultado = { aplicados: 0, omitidos: 0 };

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }

    // Se relee el stock actual justo antes de aplicar cada fila (en vez
    // de confiar en el saldo proyectado del análisis) por si pasó tiempo
    // entre analizar y confirmar la importación.
    // Todo o nada por fila, en la base. Nunca deja negativo.
    const ajusteId = randomUUID();
    const motivo = `[${fila.tipo}] ${aTextoLimpio(fila.datos.motivo)}`;
    const operacion = await aplicarOperacion({
      empresaId, tipo: 'importacion', origenTabla: 'inventario_ajustes', origenId: ajusteId, motivo,
      movimientos: [{ material_id: fila.material_id, cantidad: fila.delta }]
    }).catch((err) => { throw new Error(`Fila ${fila.numero_fila}: ${err.message}`); });
    if (!operacion.ok) throw new Error(`Fila ${fila.numero_fila}: dejaría el stock en negativo, no se importó`);
    const mov = operacion.movimientos[0];

    const { error: eAjuste } = await supabase.from('inventario_ajustes').insert({
      id: ajusteId,
      empresa_id: empresaId, usuario_id: usuarioActual(),
      material_id: fila.material_id,
      stock_anterior: mov.stock_anterior,
      stock_nuevo: mov.stock_nuevo,
      motivo,
      usuario: 'Importación Excel'
    });
    if (eAjuste) log.error('[inventario_ajustes] No se pudo guardar la copia de la importación:', eAjuste);

    resultado.aplicados++;
  }

  return resultado;
}

module.exports = { analizarInventario, importarInventario };