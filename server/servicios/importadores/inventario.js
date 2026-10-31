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
// Cada fila es de un material o de un producto (stock de terminados).
// ============================================================
const supabase = require('../../supabase/cliente');
const { mapaCodigoONombre } = require('./buscador');
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
    .from('materiales').select('id, codigo, nombre, stock_actual').eq('empresa_id', empresaId);
  if (error) throw new Error(error.message);
  return mapaCodigoONombre(data);
}

async function obtenerProductosPorCodigo(empresaId) {
  const [{ data, error }, { data: stock, error: eS }] = await Promise.all([
    supabase.from('productos').select('id, codigo, nombre').eq('empresa_id', empresaId),
    supabase.from('inventario_productos').select('producto_id, stock_actual').eq('empresa_id', empresaId)
  ]);
  if (error || eS) throw new Error((error || eS).message);
  const stockPorId = new Map((stock || []).map((s) => [s.producto_id, Number(s.stock_actual)]));
  return mapaCodigoONombre(data, (p) => ({ ...p, stock_actual: stockPorId.get(p.id) || 0 }));
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
  const [materialesPorCodigo, productosPorCodigo] = await Promise.all([
    obtenerMaterialesPorCodigo(empresaId), obtenerProductosPorCodigo(empresaId)
  ]);

  // Saldo proyectado por material a medida que se procesan las filas del
  // archivo EN ORDEN — así, si dos filas mueven el mismo material, la
  // segunda se valida contra el resultado de la primera (no contra el
  // stock que había antes de abrir el archivo).
  const saldoProyectado = new Map();
  for (const material of materialesPorCodigo.values()) saldoProyectado.set(material.id, Number(material.stock_actual));
  for (const producto of productosPorCodigo.values()) saldoProyectado.set(producto.id, producto.stock_actual);

  const resumen = { validas: 0, errores: 0 };

  const filas = filasExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraerDatos(filaExcel);
    const codigoMaterial = aTextoLimpio(datos.codigo_material);
    const codigoProducto = aTextoLimpio(datos.codigo_producto);

    const errores = [
      !codigoMaterial && !codigoProducto ? 'Falta "Código material" o "Código producto"' : null,
      codigoMaterial && codigoProducto ? 'Usa "Código material" o "Código producto", no los dos' : null,
      enListaValido(datos.tipo, 'Tipo', TIPOS_VALIDOS),
      requerido(datos.motivo, 'Motivo')
    ].filter(Boolean);

    let material = codigoMaterial ? materialesPorCodigo.get(codigoMaterial.toLowerCase()) : null;
    if (codigoMaterial && !material) errores.push(`El material con código "${codigoMaterial}" no existe`);
    const producto = codigoProducto && !codigoMaterial ? productosPorCodigo.get(codigoProducto.toLowerCase()) : null;
    if (codigoProducto && !codigoMaterial && !producto) errores.push(`El producto con código "${codigoProducto}" no existe`);
    // Desde aquí el artículo es el material o el producto (mismo cálculo de saldo)
    if (producto) material = producto;

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
      material_id: material && !producto ? material.id : null,
      codigo_producto: codigoProducto || null,
      producto_id: producto ? producto.id : null,
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
// opciones.reemplazar: la "Cantidad" del Excel pasa a ser el stock final
// del artículo (se ajusta desde el stock actual), en vez de sumarse.
async function stockActual(empresaId, fila) {
  if (fila.producto_id && !fila.material_id) {
    const { data, error } = await supabase.from('inventario_productos')
      .select('stock_actual').eq('empresa_id', empresaId).eq('producto_id', fila.producto_id).maybeSingle();
    if (error) throw error;
    return Number(data?.stock_actual || 0);
  }
  const { data, error } = await supabase.from('materiales')
    .select('stock_actual').eq('empresa_id', empresaId).eq('id', fila.material_id).single();
  if (error) throw error;
  return Number(data?.stock_actual || 0);
}

async function importarInventario(empresaId, filas, opciones = {}) {
  const resultado = { aplicados: 0, omitidos: 0 };

  for (let fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }

    // Se relee el stock actual justo antes de aplicar cada fila (en vez
    // de confiar en el saldo proyectado del análisis) por si pasó tiempo
    // entre analizar y confirmar la importación.
    // Todo o nada por fila, en la base. Nunca deja negativo.
    const ajusteId = randomUUID();
    let motivo = `[${fila.tipo}] ${aTextoLimpio(fila.datos.motivo)}`;

    if (opciones.reemplazar) {
      const final = Number(aNumero(fila.datos.cantidad));
      if (!(final >= 0)) { resultado.omitidos++; continue; }
      const delta = Math.round((final - await stockActual(empresaId, fila)) * 10000) / 10000;
      if (delta === 0) { resultado.omitidos++; continue; }
      fila = { ...fila, delta };
      motivo = `[REEMPLAZO] ${aTextoLimpio(fila.datos.motivo)}`;
    }

    if (fila.producto_id && !fila.material_id) {
      const op = await aplicarOperacion({
        empresaId, tipo: 'importacion', origenTabla: 'productos', origenId: fila.producto_id, motivo,
        movimientos: [{ producto_id: fila.producto_id, cantidad: fila.delta }]
      }).catch((err) => { throw new Error(`Fila ${fila.numero_fila}: ${err.message}`); });
      if (!op.ok) throw new Error(`Fila ${fila.numero_fila}: dejaría el stock en negativo, no se importó`);
      resultado.aplicados++;
      continue;
    }

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