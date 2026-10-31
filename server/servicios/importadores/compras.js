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
//
// Cada fila es de un material ("Código material") o de un producto de
// reventa ("Código producto"). El costo no cambia solo desde el Excel
// (no hay a quién preguntarle); solo un producto sin costo toma el de
// la compra.
// ============================================================
const supabase = require('../../supabase/cliente');
const { aplicarOperacion } = require('../inventario/nucleo');
const log = require('../../seguridad/log');
const { usuarioActual } = require('../../contexto');
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

async function obtenerMaterialesPorCodigo(empresaId) {
  const { data, error } = await supabase
    .from('materiales').select('id, codigo, costo_unitario, tiempo_entrega_dias, stock_actual')
    .eq('empresa_id', empresaId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((m) => [m.codigo.toLowerCase(), m]));
}

async function obtenerProductosPorCodigo(empresaId) {
  const { data, error } = await supabase
    .from('productos').select('id, codigo, tipo, costo_calculado')
    .eq('empresa_id', empresaId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((p) => [p.codigo.toLowerCase(), p]));
}

// -------------------- 1. ANALIZAR --------------------
async function analizarCompras(buffer, empresaId) {
  const filasExcel = leerFilas(buffer);
  const [materialesPorCodigo, productosPorCodigo] = await Promise.all([
    obtenerMaterialesPorCodigo(empresaId), obtenerProductosPorCodigo(empresaId)
  ]);
  const resumen = { validas: 0, errores: 0 };
  let hayFilasRecibidas = false;

  const filas = filasExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraerDatos(filaExcel);
    const codigoMaterial = aTextoLimpio(datos.codigo_material);
    const codigoProducto = aTextoLimpio(datos.codigo_producto);
    const estado = aTextoLimpio(datos.estado).toUpperCase();

    const errores = [
      !codigoMaterial && !codigoProducto ? 'Falta "Código material" o "Código producto"' : null,
      codigoMaterial && codigoProducto ? 'Usa "Código material" o "Código producto", no los dos' : null,
      requerido(datos.proveedor, 'Proveedor'),
      numeroValido(datos.cantidad, 'Cantidad', { minimo: 0.0001 }),
      numeroValido(datos.precio_unitario, 'Precio unitario', { minimo: 0 }),
      enListaValido(datos.estado, 'Estado', ESTADOS_VALIDOS),
      fechaValida(datos.fecha, 'Fecha', { opcional: true })
    ].filter(Boolean);

    const material = codigoMaterial ? materialesPorCodigo.get(codigoMaterial.toLowerCase()) : null;
    if (codigoMaterial && !material) errores.push(`El material con código "${codigoMaterial}" no existe`);
    const producto = codigoProducto && !codigoMaterial ? productosPorCodigo.get(codigoProducto.toLowerCase()) : null;
    if (codigoProducto && !codigoMaterial && !producto) errores.push(`El producto con código "${codigoProducto}" no existe`);
    if (producto && producto.tipo !== 'reventa') errores.push(`"${codigoProducto}" es un producto fabricado: no se compra, se fabrica`);

    if (estado === 'RECIBIDA') hayFilasRecibidas = true;

    if (errores.length) resumen.errores++; else resumen.validas++;

    return {
      numero_fila: numeroFila,
      codigo_material: codigoMaterial || null,
      material_id: material ? material.id : null,
      codigo_producto: codigoProducto || null,
      producto_id: producto ? producto.id : null,
      estado: ESTADOS_VALIDOS.includes(estado) ? estado : null,
      datos,
      errores
    };
  });

  return { modulo: 'compras', total_filas: filas.length, resumen, hay_filas_recibidas: hayFilasRecibidas, filas };
}

// Compra de un producto de reventa (se vuelve a verificar en la base)
async function importarCompraProducto({ empresaId, fila, cantidad, precioUnitario, fechaCompra, notas, esRecibida, afectarInventario }) {
  const { data: producto, error } = await supabase
    .from('productos').select('id, tipo, costo_calculado')
    .eq('id', fila.producto_id).eq('empresa_id', empresaId).maybeSingle();
  if (error || !producto) throw new Error(`Fila ${fila.numero_fila}: el producto ya no existe`);
  if (producto.tipo !== 'reventa') throw new Error(`Fila ${fila.numero_fila}: el producto no es de reventa`);

  const { data: compra, error: eCompra } = await supabase.from('compras').insert({
    empresa_id: empresaId, usuario_id: usuarioActual(),
    producto_id: producto.id,
    proveedor: aTextoLimpio(fila.datos.proveedor),
    cantidad, precio_unitario: precioUnitario, notas,
    fecha: fechaCompra,
    estado: esRecibida ? 'recibida' : 'pendiente',
    fecha_estimada_llegada: fechaCompra,
    ...(esRecibida ? { fecha_llegada: fechaCompra } : {})
  }).select('id').single();
  if (eCompra) throw new Error(`Fila ${fila.numero_fila}: ${eCompra.message}`);

  if (!(Number(producto.costo_calculado) > 0)) {
    await supabase.from('productos').update({ costo_calculado: precioUnitario })
      .eq('id', producto.id).eq('empresa_id', empresaId);
  }

  if (esRecibida && afectarInventario) {
    const operacion = await aplicarOperacion({
      empresaId, tipo: 'importacion', origenTabla: 'compras', origenId: compra.id,
      motivo: 'Compra importada desde Excel', clave: `compra-recibida:${compra.id}`,
      movimientos: [{ producto_id: producto.id, cantidad, costo_unitario: Number(precioUnitario) }]
    });
    if (!operacion.ok) throw new Error(`Fila ${fila.numero_fila}: no se pudo sumar al inventario`);
  }
}

// -------------------- 2. IMPORTAR --------------------
// opciones.afectarInventario (default true): si es false, las filas
// RECIBIDA quedan en el historial pero no tocan el stock.
async function importarCompras(empresaId, filas, { afectarInventario = true } = {}) {
  const resultado = { registradas_pendientes: 0, registradas_recibidas: 0, stock_actualizado: afectarInventario, omitidos: 0 };

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }

    const datos = fila.datos;
    const cantidad = aNumero(datos.cantidad);
    const precioUnitario = aNumero(datos.precio_unitario);
    const fechaCompra = aFechaISO(datos.fecha) || new Date().toISOString().slice(0, 10);
    const codigo = aTextoLimpio(datos.codigo);
    const notas = [codigo ? `[${codigo}]` : null, aTextoLimpio(datos.notas) || null].filter(Boolean).join(' ') || null;

    const esRecibida = fila.estado === 'RECIBIDA';
    if (!fila.material_id && fila.producto_id) {
      await importarCompraProducto({ empresaId, fila, cantidad, precioUnitario, fechaCompra, notas, esRecibida, afectarInventario });
      if (esRecibida) resultado.registradas_recibidas++; else resultado.registradas_pendientes++;
      continue;
    }

    const { data: material, error: eMat } = await supabase
      .from('materiales').select('id, costo_unitario, tiempo_entrega_dias, stock_actual')
      .eq('id', fila.material_id).eq('empresa_id', empresaId).single();
    if (eMat || !material) throw new Error(`Fila ${fila.numero_fila}: el material ya no existe`);

    const cambios = {
      empresa_id: empresaId, usuario_id: usuarioActual(),
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
        empresa_id: empresaId, usuario_id: usuarioActual(),
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
        const operacion = await aplicarOperacion({
          empresaId, tipo: 'importacion', origenTabla: 'compras', origenId: compra.id,
          motivo: 'Compra importada desde Excel', clave: `compra-recibida:${compra.id}`,
          movimientos: [{ material_id: fila.material_id, cantidad, costo_unitario: Number(precioUnitario) }]
        });
        if (!operacion.ok) throw new Error(`Fila ${fila.numero_fila}: no se pudo sumar al inventario`);
      }
    } else {
      resultado.registradas_pendientes++;
    }
  }

  return resultado;
}

module.exports = { analizarCompras, importarCompras };
