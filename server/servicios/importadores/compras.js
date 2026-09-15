// ============================================================
// IMPORTADOR — Compras (server/servicios/importadores/compras.js)
// Igual que Inventario: cada fila válida es un registro NUEVO, no
// algo que se "actualice". Dos casos según la columna Estado:
//
//   - PENDIENTE: se crea el pedido (estado 'pendiente') con su fecha
//     estimada de llegada calculada igual que un pedido manual — el
//     stock se sumará solo cuando llegue (automático o manual), no ahora.
//
//   - RECIBIDA: se crea el registro como ya recibido. Si `afectarInventario`
//     es true (una sola decisión para todo el archivo, tomada por el
//     usuario antes de importar), también se suma el stock y se registra
//     el movimiento — igual que confirmar la llegada de una compra. Si es
//     false, solo queda el historial, sin tocar el stock (para cuando ya
//     se cargó aparte por Materiales o por Inventario).
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerFilas } = require('../excel/lector');
const { COLUMNAS, ESTADOS_VALIDOS } = require('../excel/definiciones/compras');
const { aTextoLimpio, aNumero, aFechaISO, requerido, numeroValido, enListaValido, fechaValida } = require('../excel/validador');
const { calcularFechaEstimada } = require('../compras');

const CLAVE_POR_ENCABEZADO = new Map(COLUMNAS.map((c) => [c.encabezado, c.clave]));

function extraerDatos(filaExcel) {
  const datos = {};
  for (const [encabezado, clave] of CLAVE_POR_ENCABEZADO) datos[clave] = filaExcel[encabezado];
  return datos;
}

async function obtenerMaterialesPorCodigo(usuarioId) {
  const { data, error } = await supabase
    .from('materiales').select('id, codigo, costo_unitario, tiempo_entrega_dias, stock_actual')
    .eq('usuario_id', usuarioId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((m) => [m.codigo.toLowerCase(), m]));
}

// -------------------- 1. ANALIZAR --------------------
async function analizarCompras(buffer, usuarioId) {
  const filasExcel = leerFilas(buffer);
  const materialesPorCodigo = await obtenerMaterialesPorCodigo(usuarioId);
  const resumen = { validas: 0, errores: 0 };
  let hayFilasRecibidas = false;

  const filas = filasExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraerDatos(filaExcel);
    const codigoMaterial = aTextoLimpio(datos.codigo_material);
    const estado = aTextoLimpio(datos.estado).toUpperCase();

    const errores = [
      requerido(datos.codigo_material, 'Código material'),
      requerido(datos.proveedor, 'Proveedor'),
      numeroValido(datos.cantidad, 'Cantidad', { minimo: 0.0001 }),
      numeroValido(datos.precio_unitario, 'Precio unitario', { minimo: 0 }),
      enListaValido(datos.estado, 'Estado', ESTADOS_VALIDOS),
      fechaValida(datos.fecha, 'Fecha', { opcional: true })
    ].filter(Boolean);

    const material = codigoMaterial ? materialesPorCodigo.get(codigoMaterial.toLowerCase()) : null;
    if (codigoMaterial && !material) errores.push(`El material con código "${codigoMaterial}" no existe`);

    if (estado === 'RECIBIDA') hayFilasRecibidas = true;

    if (errores.length) resumen.errores++; else resumen.validas++;

    return {
      numero_fila: numeroFila,
      codigo_material: codigoMaterial || null,
      material_id: material ? material.id : null,
      estado: ESTADOS_VALIDOS.includes(estado) ? estado : null,
      datos,
      errores
    };
  });

  return { modulo: 'compras', total_filas: filas.length, resumen, hay_filas_recibidas: hayFilasRecibidas, filas };
}

// -------------------- 2. IMPORTAR --------------------
// opciones.afectarInventario (default true): si es false, las filas
// RECIBIDA quedan en el historial pero no tocan el stock.
async function importarCompras(usuarioId, filas, { afectarInventario = true } = {}) {
  const resultado = { registradas_pendientes: 0, registradas_recibidas: 0, stock_actualizado: afectarInventario, omitidos: 0 };

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }

    const datos = fila.datos;
    const cantidad = aNumero(datos.cantidad);
    const precioUnitario = aNumero(datos.precio_unitario);
    const fechaCompra = aFechaISO(datos.fecha) || new Date().toISOString().slice(0, 10);
    const codigo = aTextoLimpio(datos.codigo);
    const notas = [codigo ? `[${codigo}]` : null, aTextoLimpio(datos.notas) || null].filter(Boolean).join(' ') || null;

    const { data: material, error: eMat } = await supabase
      .from('materiales').select('id, costo_unitario, tiempo_entrega_dias, stock_actual')
      .eq('id', fila.material_id).eq('usuario_id', usuarioId).single();
    if (eMat || !material) throw new Error(`Fila ${fila.numero_fila}: el material ya no existe`);

    const esRecibida = fila.estado === 'RECIBIDA';
    const cambios = {
      usuario_id: usuarioId,
      material_id: fila.material_id,
      proveedor: aTextoLimpio(datos.proveedor),
      cantidad,
      precio_unitario: precioUnitario,
      notas,
      fecha: fechaCompra,
      estado: esRecibida ? 'recibida' : 'pendiente',
      fecha_estimada_llegada: esRecibida ? fechaCompra : calcularFechaEstimada(material.tiempo_entrega_dias)
    };
    if (esRecibida) cambios.fecha_llegada = fechaCompra;

    const { data: compra, error: eCompra } = await supabase.from('compras').insert(cambios).select('id').single();
    if (eCompra) throw new Error(`Fila ${fila.numero_fila}: ${eCompra.message}`);

    // Historial de precio — igual que registrar una compra manual.
    if (Number(precioUnitario) !== Number(material.costo_unitario)) {
      const { error: eHist } = await supabase.from('materiales_historial_precio').insert({
        usuario_id: usuarioId,
        material_id: fila.material_id,
        costo_anterior: material.costo_unitario,
        costo_nuevo: precioUnitario,
        origen: 'compra'
      });
      if (eHist) throw new Error(eHist.message);
    }

    if (esRecibida) {
      resultado.registradas_recibidas++;
      if (afectarInventario) {
        const stockAnterior = Number(material.stock_actual);
        const stockNuevo = Math.round((stockAnterior + cantidad) * 100) / 100;
        const { error: eStock } = await supabase
          .from('materiales').update({ stock_actual: stockNuevo, actualizado_en: new Date().toISOString() })
          .eq('id', fila.material_id).eq('usuario_id', usuarioId);
        if (eStock) throw new Error(`Fila ${fila.numero_fila}: ${eStock.message}`);

        const { error: eMov } = await supabase.from('inventario_movimientos').insert({
          usuario_id: usuarioId,
          material_id: fila.material_id,
          tipo: 'compra',
          cantidad,
          stock_anterior: stockAnterior,
          stock_nuevo: stockNuevo,
          referencia_id: compra.id
        });
        if (eMov) console.error('[inventario_movimientos] No se pudo registrar el movimiento de importación:', eMov.message);
      }
    } else {
      resultado.registradas_pendientes++;
    }
  }

  return resultado;
}

module.exports = { analizarCompras, importarCompras };