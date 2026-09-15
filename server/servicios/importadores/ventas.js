// ============================================================
// IMPORTADOR — Ventas (server/servicios/importadores/ventas.js)
// Dos hojas relacionadas (como Procesos), pero cada venta es SIEMPRE
// un registro NUEVO (como Inventario/Compras) — este archivo no
// sirve para editar pedidos que ya existen.
//
// Reutiliza EXACTAMENTE los mismos servicios que usa la creación
// manual de una venta (rutas/ventas.js), para no duplicar reglas de
// negocio delicadas en dos lugares:
//   - cifrar()                          → teléfono/cédula
//   - obtenerFichasEfectivasParaProductos → qué materiales descuenta
//   - consumirWIPYGenerarNecesidad      → productos con Procesos activos
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerHoja } = require('../excel/lector');
const {
  ESTADOS_VALIDOS, HOJA_VENTAS, HOJA_VENTAS_ITEMS, COLUMNAS_VENTAS, COLUMNAS_VENTAS_ITEMS
} = require('../excel/definiciones/ventas');
const { aTextoLimpio, aNumero, aBooleanoSiNo, aFechaISO, requerido, numeroValido, enListaValido, fechaValida } = require('../excel/validador');
const { cifrar } = require('../../servicios/cifrado');
const { obtenerFichasEfectivasParaProductos } = require('../costos');
const { consumirWIPYGenerarNecesidad } = require('../../servicios/produccion');

const CLAVE_VENTAS = new Map(COLUMNAS_VENTAS.map((c) => [c.encabezado, c.clave]));
const CLAVE_ITEMS = new Map(COLUMNAS_VENTAS_ITEMS.map((c) => [c.encabezado, c.clave]));

function extraer(filaExcel, mapaClaves) {
  const datos = {};
  for (const [encabezado, clave] of mapaClaves) datos[clave] = filaExcel[encabezado];
  return datos;
}

async function obtenerProductosPorCodigo(usuarioId) {
  const { data, error } = await supabase
    .from('productos').select('id, codigo, nombre, precio_venta, costo_calculado, activo, categoria_id')
    .eq('usuario_id', usuarioId).not('codigo', 'is', null);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((p) => [p.codigo.toLowerCase(), p]));
}

async function siguienteCodigoDisponible(usuarioId) {
  const { data, error } = await supabase
    .from('ventas').select('codigo').eq('usuario_id', usuarioId).not('codigo', 'is', null).like('codigo', 'VEN%');
  if (error) throw new Error(error.message);
  let maximo = 0;
  for (const fila of data || []) {
    const numero = parseInt(String(fila.codigo).replace(/^VEN/i, ''), 10);
    if (!isNaN(numero) && numero > maximo) maximo = numero;
  }
  return maximo + 1;
}

// -------------------- 1. ANALIZAR --------------------
async function analizarVentas(buffer, usuarioId) {
  const filasVentasExcel = leerHoja(buffer, HOJA_VENTAS);
  const filasItemsExcel = leerHoja(buffer, HOJA_VENTAS_ITEMS);
  const productosPorCodigo = await obtenerProductosPorCodigo(usuarioId);

  const codigosVistosEnArchivo = new Set();
  const resumen = { validas: 0, errores: 0 };

  const filas = filasVentasExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_VENTAS);
    const codigo = aTextoLimpio(datos.codigo);

    const errores = [
      requerido(datos.codigo, 'Código venta'),
      fechaValida(datos.fecha, 'Fecha', { opcional: true }),
      fechaValida(datos.fecha_entrega, 'Fecha entrega', { opcional: true }),
      enListaValido(datos.estado, 'Estado', ESTADOS_VALIDOS, { opcional: true })
    ].filter(Boolean);

    if (codigo) {
      const codigoNorm = codigo.toLowerCase();
      if (codigosVistosEnArchivo.has(codigoNorm)) errores.push(`El código "${codigo}" está repetido dentro de este archivo`);
      codigosVistosEnArchivo.add(codigoNorm);
    }

    return {
      numero_fila: numeroFila,
      codigo: codigo || null,
      datos,
      errores, // puede crecer más abajo si no tiene productos válidos
      items: [],
      total: 0,
      costo_total: 0
    };
  });

  const filaPorCodigo = new Map(filas.filter((f) => f.codigo).map((f) => [f.codigo.toLowerCase(), f]));
  const resumenItems = { validas: 0, errores: 0 };

  filasItemsExcel.forEach((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_ITEMS);
    const codigoVenta = aTextoLimpio(datos.codigo_venta);
    const codigoProducto = aTextoLimpio(datos.codigo_producto);

    const errores = [
      requerido(datos.codigo_venta, 'Código venta'),
      requerido(datos.codigo_producto, 'Código producto'),
      numeroValido(datos.cantidad, 'Cantidad', { minimo: 0.0001 })
    ].filter(Boolean);

    const filaVenta = codigoVenta ? filaPorCodigo.get(codigoVenta.toLowerCase()) : null;
    if (codigoVenta && !filaVenta) errores.push(`La venta con código "${codigoVenta}" no existe en este archivo`);

    const producto = codigoProducto ? productosPorCodigo.get(codigoProducto.toLowerCase()) : null;
    if (codigoProducto && !producto) errores.push(`El producto con código "${codigoProducto}" no existe`);
    else if (producto && !producto.activo) errores.push(`"${producto.nombre}" está desactivado y no se puede vender`);
    else if (producto && !producto.categoria_id) errores.push(`"${producto.nombre}" no tiene categoría asignada en Productos`);

    const entrada = {
      numero_fila: numeroFila,
      codigo_producto: codigoProducto || null,
      producto_id: producto ? producto.id : null,
      cantidad: errores.length === 0 ? aNumero(datos.cantidad) : null,
      errores
    };

    if (errores.length) resumenItems.errores++; else resumenItems.validas++;
    if (filaVenta) filaVenta.items.push(entrada);
  });

  for (const fila of filas) {
    const itemsValidos = fila.items.filter((i) => i.errores.length === 0);
    if (itemsValidos.length === 0 && fila.errores.length === 0) {
      fila.errores.push('Esta venta no tiene productos válidos (revisa la hoja VENTAS_ITEMS)');
    }
    if (fila.errores.length === 0) {
      for (const item of itemsValidos) {
        const producto = productosPorCodigo.get(item.codigo_producto.toLowerCase());
        fila.total += Number(producto.precio_venta) * item.cantidad;
        fila.costo_total += Number(producto.costo_calculado) * item.cantidad;
      }
      fila.total = Math.round(fila.total * 100) / 100;
      fila.costo_total = Math.round(fila.costo_total * 100) / 100;
    }

    if (fila.errores.length) resumen.errores++; else resumen.validas++;
  }

  return { modulo: 'ventas', total_filas: filas.length, resumen, resumen_items: resumenItems, filas };
}

// -------------------- 2. IMPORTAR --------------------
async function importarVentas(usuarioId, filas) {
  const resultado = { creadas: 0, omitidas: 0, ventas_con_stock_insuficiente: [], productos_con_produccion_generada: 0 };
  let siguienteConsecutivo = null;
  let codigosExistentes = null;

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidas++; continue; }

    const itemsValidos = fila.items.filter((i) => i.errores.length === 0);
    const productoIds = itemsValidos.map((i) => i.producto_id);

    // Se releen los productos justo antes de crear la venta (precio y
    // costo pueden haber cambiado desde que se analizó el archivo).
    const { data: productosFrescos, error: eProd } = await supabase
      .from('productos').select('id, nombre, precio_venta, costo_calculado, activo, categoria_id, categorias_productos(nombre)')
      .eq('usuario_id', usuarioId).in('id', productoIds);
    if (eProd) throw new Error(eProd.message);
    const productoPorId = new Map((productosFrescos || []).map((p) => [p.id, p]));
    for (const id of productoIds) {
      const p = productoPorId.get(id);
      if (!p) throw new Error(`Venta ${fila.codigo}: uno de los productos ya no existe`);
      if (!p.activo) throw new Error(`Venta ${fila.codigo}: "${p.nombre}" ya no está activo`);
      if (!p.categoria_id) throw new Error(`Venta ${fila.codigo}: "${p.nombre}" ya no tiene categoría asignada`);
    }

    const { data: procesosActivos, error: eProc } = await supabase
      .from('procesos').select('producto_id').eq('usuario_id', usuarioId).eq('activo', true).in('producto_id', productoIds);
    if (eProc) throw new Error(eProc.message);
    const idsConProcesos = new Set((procesosActivos || []).map((p) => p.producto_id));

    let total = 0, costoTotal = 0;
    const filasItems = itemsValidos.map((item) => {
      const p = productoPorId.get(item.producto_id);
      total += Number(p.precio_venta) * item.cantidad;
      costoTotal += Number(p.costo_calculado) * item.cantidad;
      return {
        producto_id: item.producto_id,
        cantidad: item.cantidad,
        precio_unitario: Number(p.precio_venta),
        costo_unitario: Number(p.costo_calculado),
        categoria: p.categorias_productos ? p.categorias_productos.nombre : null
      };
    });
    total = Math.round(total * 100) / 100;
    costoTotal = Math.round(costoTotal * 100) / 100;

    const datos = fila.datos;
    const fechaVenta = aFechaISO(datos.fecha) || new Date().toISOString().slice(0, 10);
    const fechaEntrega = aFechaISO(datos.fecha_entrega) || null;
    const estado = aTextoLimpio(datos.estado).toLowerCase() || 'pendiente';
    const pagada = aBooleanoSiNo(datos.pagada) ?? false;

    // El código del Excel es solo una etiqueta de conveniencia — si por
    // algún motivo ya existe una venta con ese código (poco probable,
    // pero posible si se reimporta el archivo), se le asigna uno nuevo
    // en vez de fallar por la restricción de unicidad.
    if (codigosExistentes == null) {
      const { data: existentes, error: eCod } = await supabase
        .from('ventas').select('codigo').eq('usuario_id', usuarioId).not('codigo', 'is', null);
      if (eCod) throw new Error(eCod.message);
      codigosExistentes = new Set((existentes || []).map((v) => v.codigo.toLowerCase()));
    }
    let codigo = fila.codigo;
    if (!codigo || codigosExistentes.has(codigo.toLowerCase())) {
      if (siguienteConsecutivo == null) siguienteConsecutivo = await siguienteCodigoDisponible(usuarioId);
      do {
        codigo = `VEN${String(siguienteConsecutivo).padStart(3, '0')}`;
        siguienteConsecutivo++;
      } while (codigosExistentes.has(codigo.toLowerCase()));
    }
    codigosExistentes.add(codigo.toLowerCase());

    const { data: venta, error: eVenta } = await supabase.from('ventas').insert({
      usuario_id: usuarioId,
      codigo,
      cliente: aTextoLimpio(datos.cliente) || null,
      cliente_telefono_cifrado: cifrar(aTextoLimpio(datos.telefono) || null),
      cliente_cedula_cifrada: cifrar(aTextoLimpio(datos.cedula) || null),
      fecha: fechaVenta,
      fecha_entrega: fechaEntrega,
      total,
      costo_total: costoTotal,
      estado,
      pagado: pagada,
      fecha_pago: pagada ? fechaVenta : null
    }).select('id').single();
    if (eVenta) throw new Error(`Venta ${fila.codigo}: ${eVenta.message}`);

    const { error: eItems } = await supabase
      .from('ventas_items').insert(filasItems.map((f) => ({ ...f, venta_id: venta.id })));
    if (eItems) throw new Error(`Venta ${fila.codigo}: ${eItems.message}`);

    // Igual que la creación manual: los productos SIN procesos activos
    // descuentan material directo; los que SÍ tienen, van por WIP.
    const itemsSinProcesos = itemsValidos.filter((i) => !idsConProcesos.has(i.producto_id));
    const itemsConProcesos = itemsValidos.filter((i) => idsConProcesos.has(i.producto_id));

    if (itemsSinProcesos.length > 0) {
      const fichas = await obtenerFichasEfectivasParaProductos(itemsSinProcesos.map((i) => i.producto_id), usuarioId);
      const requeridoPorMaterial = new Map();
      for (const item of itemsSinProcesos) {
        for (const f of (fichas || []).filter((f) => f.producto_id === item.producto_id)) {
          const previo = requeridoPorMaterial.get(f.material_id) || { nombre: f.materiales.nombre, requerido: 0 };
          previo.requerido += Number(f.cantidad) * item.cantidad;
          requeridoPorMaterial.set(f.material_id, previo);
        }
      }

      const materialesInsuficientes = [];
      for (const [materialId, { nombre, requerido }] of requeridoPorMaterial) {
        const { data: material, error: eMat } = await supabase
          .from('materiales').select('stock_actual').eq('id', materialId).eq('usuario_id', usuarioId).single();
        if (eMat || !material) continue; // material borrado entre analizar e importar: se ignora esta línea, no rompe la venta
        const stockAnterior = Number(material.stock_actual);
        if (stockAnterior < requerido) materialesInsuficientes.push(nombre);
        const stockNuevo = Math.max(0, Math.round((stockAnterior - requerido) * 100) / 100);

        const { error: eStock } = await supabase
          .from('materiales').update({ stock_actual: stockNuevo, actualizado_en: new Date().toISOString() })
          .eq('id', materialId).eq('usuario_id', usuarioId);
        if (eStock) throw new Error(eStock.message);

        const { error: eMov } = await supabase.from('inventario_movimientos').insert({
          usuario_id: usuarioId, material_id: materialId, tipo: 'venta',
          cantidad: -requerido, stock_anterior: stockAnterior, stock_nuevo: stockNuevo, referencia_id: venta.id
        });
        if (eMov) console.error('[inventario_movimientos] No se pudo registrar el movimiento de importación:', eMov.message);
      }
      if (materialesInsuficientes.length > 0) {
        resultado.ventas_con_stock_insuficiente.push({ codigo_venta: fila.codigo, materiales: materialesInsuficientes });
      }
    }

    for (const item of itemsConProcesos) {
      const generado = await consumirWIPYGenerarNecesidad({ productoId: item.producto_id, cantidadVendida: item.cantidad, usuarioId });
      if (generado.generado && generado.generado.length > 0) resultado.productos_con_produccion_generada++;
    }

    resultado.creadas++;
  }

  return resultado;
}

module.exports = { analizarVentas, importarVentas };