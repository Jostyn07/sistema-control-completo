// ============================================================
// ventas.js — pestaña Ventas
// Funciones (según estructura funcional):
//   cargarProductosParaVenta()
//   calcularTotalVenta(items)
//   registrarVenta(datosVenta)
//   cambiarEstadoPedido(id, nuevoEstado)
//   cargarHistorialVentas(filtros)
// ============================================================

let productosParaVenta = [];
let itemsVentaEnEdicion = []; // [{ producto_id, nombre, precio, cantidad, fabricables }]
let pedidosEnMemoria = [];
let historialEnMemoria = [];

const ETIQUETA_ESTADO = {
  pendiente: 'Pendiente',
  en_produccion: 'En producción',
  listo: 'Listo',
  entregado: 'Entregado'
};
const SIGUIENTE_ESTADO = {
  pendiente: 'en_produccion',
  en_produccion: 'listo',
  listo: 'entregado',
  entregado: null
};

// ---- 1. Nueva venta ----
async function cargarProductosParaVenta() {
  productosParaVenta = await API.obtener('/api/ventas/productos-disponibles');

  const opciones = productosParaVenta
    .map(p => `<option value="${p.id}">${escaparHtml(p.nombre)} — ${formatearPesos(p.precio_venta)} (puedes fabricar ${p.unidades_fabricables})</option>`)
    .join('');
  document.getElementById('selectorProductoVenta').innerHTML = opciones;
  // El selector del modal de edición solo existe en esa vista; si no está
  // presente (ej. otra pantalla que reutilice ventas.js) no pasa nada.
  const selectorEditar = document.getElementById('selectorProductoEditarVenta');
  if (selectorEditar) selectorEditar.innerHTML = opciones;

  actualizarCategoriaAutomatica('selectorProductoVenta', 'categoriaAutoVenta');
  actualizarCategoriaAutomatica('selectorProductoEditarVenta', 'categoriaAutoEditarVenta');
}

// La categoría de la venta ya NO se escribe: sale directo de la que
// tiene asignada el producto en Productos. Si el producto no tiene
// categoría, se avisa y se bloquea el botón "Agregar" — hay que
// asignarle una categoría desde Productos antes de poder venderlo.
function actualizarCategoriaAutomatica(idSelector, idMuestraCategoria) {
  const selector = document.getElementById(idSelector);
  const muestra = document.getElementById(idMuestraCategoria);
  if (!selector || !muestra) return;

  const producto = productosParaVenta.find(p => p.id === selector.value);
  const botonAgregar = selector.closest('.agregar-material')?.querySelector('button');

  if (!producto) {
    muestra.textContent = '';
    muestra.className = 'texto-secundario';
    return;
  }
  if (producto.categoria) {
    muestra.textContent = producto.categoria;
    muestra.className = '';
    if (botonAgregar) botonAgregar.disabled = false;
  } else {
    muestra.textContent = 'Este producto no tiene categoría asignada. Ve a Productos y asígnale una antes de venderlo.';
    muestra.className = 'indicador__valor--negativo';
    if (botonAgregar) botonAgregar.disabled = true;
  }
}

async function abrirNuevaVenta() {
  try {
    await cargarProductosParaVenta();
  } catch (err) {
    mostrarAviso('No se pudieron cargar los productos: ' + err.message, 'error');
    return;
  }
  if (productosParaVenta.length === 0) {
    mostrarAviso('No hay productos para vender. Crea primero las fichas técnicas en Productos.', 'error');
    return;
  }
  itemsVentaEnEdicion = [];
  document.getElementById('campoCliente').value = '';
  document.getElementById('campoClienteTelefono').value = '';
  document.getElementById('campoClienteCedula').value = '';
  document.getElementById('campoFechaEntrega').value = '';
  document.getElementById('cantidadVenta').value = '';
  pintarItemsVenta();
  document.getElementById('modalVenta').hidden = false;
}

function cerrarNuevaVenta() {
  document.getElementById('modalVenta').hidden = true;
}

function agregarItemVenta() {
  const productoId = document.getElementById('selectorProductoVenta').value;
  const cantidad = Number(document.getElementById('cantidadVenta').value);
  if (!productoId) { mostrarAviso('Elige un producto', 'error'); return; }
  if (!cantidad || cantidad <= 0) { mostrarAviso('La cantidad debe ser mayor a 0', 'error'); return; }

  const producto = productosParaVenta.find(p => p.id === productoId);
  if (!producto) return;
  if (!producto.categoria) {
    mostrarAviso('Este producto no tiene categoría asignada. Asígnale una en Productos antes de venderlo.', 'error');
    return;
  }

  // Aviso temprano (el backend valida de nuevo con la ficha técnica completa)
  if (cantidad > producto.unidades_fabricables) {
    mostrarAviso(`Ojo: con el stock actual solo alcanza para ${producto.unidades_fabricables} unidad(es) de este producto. El sistema te avisará al registrar.`, 'error');
  }

  // Mismo producto => se suma/actualiza la cantidad de esa línea.
  const existente = itemsVentaEnEdicion.find(i => i.producto_id === productoId);
  if (existente) existente.cantidad = cantidad;
  else itemsVentaEnEdicion.push({
    producto_id: productoId, nombre: producto.nombre,
    precio: Number(producto.precio_venta), cantidad, categoria: producto.categoria,
    costoMaterialesUnitario: Number(producto.costo_materiales_unitario || 0),
    costoManoObraUnitario: Number(producto.costo_mano_obra_unitario || 0)
  });

  document.getElementById('cantidadVenta').value = '';
  pintarItemsVenta();
}

function quitarItemVenta(indice) {
  itemsVentaEnEdicion.splice(indice, 1);
  pintarItemsVenta();
}

function pintarItemsVenta() {
  const cuerpo = document.getElementById('cuerpoItemsVenta');
  if (itemsVentaEnEdicion.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="tabla__vacio">Aún no has agregado productos</td></tr>';
  } else {
    cuerpo.innerHTML = itemsVentaEnEdicion.map((i, indice) => `
      <tr>
        <td>${escaparHtml(i.nombre)}</td>
        <td>${escaparHtml(i.categoria || '—')}</td>
        <td>${i.cantidad}</td>
        <td>${formatearPesos(i.precio)}</td>
        <td>${formatearPesos(i.precio * i.cantidad)}</td>
        <td><button type="button" class="boton boton--pequeno boton--peligro" onclick="quitarItemVenta(${indice})">Quitar</button></td>
      </tr>`).join('');
  }
  document.getElementById('totalVenta').textContent = formatearPesos(calcularTotalVenta(itemsVentaEnEdicion));
  pintarDesgloseCategoria(itemsVentaEnEdicion, 'desgloseCategoriaVenta');
}

// Agrupa por categoría (o por producto si no tiene categoría) y calcula,
// para cada grupo, inversión en materiales, mano de obra y margen —
// y al final el total de la venta completa. Es solo informativo: no se
// manda al backend, se recalcula siempre a partir de los items en pantalla.
function calcularDesglosePorCategoria(items) {
  const grupos = new Map();
  for (const i of items) {
    const clave = i.categoria ? i.categoria : i.nombre;
    const previo = grupos.get(clave) || {
      etiqueta: clave, cantidad: 0, inversion: 0, manoObra: 0, ventas: 0
    };
    previo.cantidad += i.cantidad;
    previo.inversion += (i.costoMaterialesUnitario || 0) * i.cantidad;
    previo.manoObra += (i.costoManoObraUnitario || 0) * i.cantidad;
    previo.ventas += i.precio * i.cantidad;
    grupos.set(clave, previo);
  }
  const filas = [...grupos.values()].map(g => ({
    ...g,
    margen: g.ventas - g.inversion - g.manoObra
  }));
  const totales = filas.reduce((s, g) => ({
    inversion: s.inversion + g.inversion,
    manoObra: s.manoObra + g.manoObra,
    margen: s.margen + g.margen
  }), { inversion: 0, manoObra: 0, margen: 0 });
  return { filas, totales };
}

function pintarDesgloseCategoria(items, idContenedor) {
  const contenedor = document.getElementById(idContenedor);
  if (!contenedor) return;
  if (items.length === 0) { contenedor.innerHTML = ''; return; }

  const { filas, totales } = calcularDesglosePorCategoria(items);
  contenedor.innerHTML = `
    <h4 style="margin:14px 0 6px">Inversión y margen por categoría</h4>
    <table class="tabla">
      <thead><tr><th>Categoría</th><th>Cantidad</th><th>Inversión (materiales)</th><th>Mano de obra</th><th>Margen</th></tr></thead>
      <tbody>
        ${filas.map(g => `
          <tr>
            <td>${escaparHtml(g.etiqueta)}</td>
            <td>${g.cantidad}</td>
            <td>${formatearPesos(g.inversion)}</td>
            <td>${formatearPesos(g.manoObra)}</td>
            <td class="${g.margen < 0 ? 'indicador__valor--negativo' : ''}">${formatearPesos(g.margen)}</td>
          </tr>`).join('')}
      </tbody>
    </table>
    <section class="tarjeta tarjeta--resumen">
      <div><span class="campo__etiqueta">Inversión total</span><strong>${formatearPesos(totales.inversion)}</strong></div>
      <div><span class="campo__etiqueta">Mano de obra total</span><strong>${formatearPesos(totales.manoObra)}</strong></div>
      <div><span class="campo__etiqueta">Margen de ganancia total</span><strong class="${totales.margen < 0 ? 'indicador__valor--negativo' : ''}">${formatearPesos(totales.margen)}</strong></div>
    </section>`;
}

// Suma en vivo el total según productos y cantidades elegidas
function calcularTotalVenta(items) {
  return (items || []).reduce((s, i) => s + i.precio * i.cantidad, 0);
}

async function registrarVenta(forzar = false) {
  if (itemsVentaEnEdicion.length === 0) {
    mostrarAviso('Agrega al menos un producto a la venta', 'error');
    return;
  }
  const datosVenta = {
    cliente: document.getElementById('campoCliente').value,
    cliente_telefono: document.getElementById('campoClienteTelefono').value,
    cliente_cedula: document.getElementById('campoClienteCedula').value,
    fecha_entrega: document.getElementById('campoFechaEntrega').value || null,
    items: itemsVentaEnEdicion.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad, categoria: i.categoria || null })),
    forzar
  };

  try {
    const venta = await API.enviar('/api/ventas', datosVenta);
    if (venta.forzada) {
      mostrarAviso('Venta registrada forzando el stock. Recuerda corregir el inventario con un ajuste.', 'error');
    } else {
      mostrarAviso(`Venta registrada por ${formatearPesos(venta.total)}. El inventario se descontó automáticamente.`);
    }
    if (venta.produccion_generada && venta.produccion_generada.length > 0) {
      const detalle = venta.produccion_generada
        .map(p => `${p.producto}: ${p.procesos.map(pr => `${pr.cantidad} de ${pr.nombre}`).join(', ')}`)
        .join(' · ');
      mostrarAviso(`No había suficiente producción lista — se agregaron procesos pendientes en Nóminas: ${detalle}`);
    }
    cerrarNuevaVenta();
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    // El backend responde 409 con la lista de faltantes; ofrecemos forzar
    if (err.message.includes('No hay material suficiente')) {
      const confirmado = confirm(
        'No hay material suficiente según el sistema.\n\n' +
        '¿Registrar la venta de todas formas? (Útil si el conteo del sistema está desactualizado; luego corriges con un ajuste de inventario.)'
      );
      if (confirmado) registrarVenta(true);
    } else {
      mostrarAviso(err.message, 'error');
    }
  }
}

// ---- Pago (independiente del estado de entrega) ----
function celdaPago(venta) {
  if (venta.pagado) {
    return `<span class="indicador__valor--positivo">✓ Pagado</span> <button type="button" class="boton boton--pequeno" onclick="confirmarPago('${venta.id}', false)">Deshacer</button>`;
  }
  return `<button type="button" class="boton boton--pequeno" onclick="confirmarPago('${venta.id}', true)">Confirmar pago</button>`;
}

async function confirmarPago(id, pagado) {
  try {
    await API.actualizar(`/api/ventas/${id}/pago`, { pagado });
    mostrarAviso(pagado ? 'Pago confirmado' : 'Pago revertido');
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Editar / Eliminar ----
function accionesVenta(venta) {
  return `
    <button type="button" class="boton boton--pequeno" onclick='abrirEditarVenta(${JSON.stringify(venta).replace(/'/g, "&#39;")})'>Editar</button>
    <button type="button" class="boton boton--pequeno" onclick='abrirEntregasVenta(${JSON.stringify(venta).replace(/'/g, "&#39;")})'>Entregas</button>
    <button type="button" class="boton boton--pequeno" onclick='abrirComprobanteVenta(${JSON.stringify(venta).replace(/'/g, "&#39;")})'>Comprobante</button>
    <button type="button" class="boton boton--pequeno boton--peligro" onclick="eliminarVenta('${venta.id}', '${escaparHtml(venta.cliente || 'sin cliente')}')">Eliminar</button>`;
}

let itemsEditarVentaEnEdicion = [];
let ventaFacturadaEnEdicion = false;

async function abrirEditarVenta(venta) {
  document.getElementById('campoEditarVentaId').value = venta.id;
  document.getElementById('campoEditarCliente').value = venta.cliente || '';
  document.getElementById('campoEditarTelefono').value = venta.cliente_telefono || '';
  document.getElementById('campoEditarCedula').value = venta.cliente_cedula || '';
  document.getElementById('campoEditarFechaEntrega').value = venta.fecha_entrega || '';

  itemsEditarVentaEnEdicion = (venta.ventas_items || []).map(i => ({
    producto_id: i.producto_id,
    nombre: i.productos ? i.productos.nombre : 'Producto',
    precio: Number(i.precio_unitario),
    cantidad: i.cantidad,
    categoria: i.categoria || ''
  }));

  ventaFacturadaEnEdicion = !!venta.facturada;
  document.getElementById('avisoFacturadaEditar').hidden = !ventaFacturadaEnEdicion;
  document.getElementById('selectorProductoEditarVenta').disabled = ventaFacturadaEnEdicion;
  document.getElementById('cantidadEditarVenta').disabled = ventaFacturadaEnEdicion;

  try {
    await cargarProductosParaVenta();
  } catch (err) {
    mostrarAviso('No se pudieron cargar los productos disponibles: ' + err.message, 'error');
  }

  // Completa el desglose de costo (materiales/mano de obra) de los items
  // que ya traía la venta — no vienen en venta.ventas_items, así que se
  // buscan por producto_id en la lista recién cargada. Si el producto ya
  // fue desactivado, queda en 0 (no se puede recalcular ese desglose).
  for (const item of itemsEditarVentaEnEdicion) {
    const producto = productosParaVenta.find(p => p.id === item.producto_id);
    item.costoMaterialesUnitario = producto ? Number(producto.costo_materiales_unitario || 0) : 0;
    item.costoManoObraUnitario = producto ? Number(producto.costo_mano_obra_unitario || 0) : 0;
  }

  pintarItemsEditarVenta();
  document.getElementById('modalEditarVenta').hidden = false;
}

function agregarItemEditarVenta() {
  if (ventaFacturadaEnEdicion) return;
  const productoId = document.getElementById('selectorProductoEditarVenta').value;
  const cantidad = Number(document.getElementById('cantidadEditarVenta').value);
  if (!productoId) { mostrarAviso('Elige un producto', 'error'); return; }
  if (!cantidad || cantidad <= 0) { mostrarAviso('La cantidad debe ser mayor a 0', 'error'); return; }

  const producto = productosParaVenta.find(p => p.id === productoId);
  if (!producto) return;
  if (!producto.categoria) {
    mostrarAviso('Este producto no tiene categoría asignada. Asígnale una en Productos antes de venderlo.', 'error');
    return;
  }

  const existente = itemsEditarVentaEnEdicion.find(i => i.producto_id === productoId);
  if (existente) existente.cantidad = cantidad;
  else itemsEditarVentaEnEdicion.push({
    producto_id: productoId, nombre: producto.nombre,
    precio: Number(producto.precio_venta), cantidad, categoria: producto.categoria,
    costoMaterialesUnitario: Number(producto.costo_materiales_unitario || 0),
    costoManoObraUnitario: Number(producto.costo_mano_obra_unitario || 0)
  });

  document.getElementById('cantidadEditarVenta').value = '';
  pintarItemsEditarVenta();
}

function quitarItemEditarVenta(indice) {
  if (ventaFacturadaEnEdicion) return;
  itemsEditarVentaEnEdicion.splice(indice, 1);
  pintarItemsEditarVenta();
}

function pintarItemsEditarVenta() {
  const cuerpo = document.getElementById('cuerpoItemsEditarVenta');
  if (itemsEditarVentaEnEdicion.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="tabla__vacio">Sin productos</td></tr>';
  } else {
    cuerpo.innerHTML = itemsEditarVentaEnEdicion.map((i, indice) => `
      <tr>
        <td>${escaparHtml(i.nombre)}</td>
        <td>${escaparHtml(i.categoria || '—')}</td>
        <td>${i.cantidad}</td>
        <td>${formatearPesos(i.precio)}</td>
        <td>${formatearPesos(i.precio * i.cantidad)}</td>
        <td>${ventaFacturadaEnEdicion ? '' : `<button type="button" class="boton boton--pequeno boton--peligro" onclick="quitarItemEditarVenta(${indice})">Quitar</button>`}</td>
      </tr>`).join('');
  }
  document.getElementById('totalEditarVenta').textContent = formatearPesos(calcularTotalVenta(itemsEditarVentaEnEdicion));
  pintarDesgloseCategoria(itemsEditarVentaEnEdicion, 'desgloseCategoriaEditarVenta');
}

function cerrarEditarVenta() {
  document.getElementById('modalEditarVenta').hidden = true;
}

async function guardarEdicionVenta() {
  const id = document.getElementById('campoEditarVentaId').value;
  if (!ventaFacturadaEnEdicion && itemsEditarVentaEnEdicion.length === 0) {
    mostrarAviso('La venta debe tener al menos un producto', 'error');
    return;
  }

  const datos = {
    cliente: document.getElementById('campoEditarCliente').value,
    cliente_telefono: document.getElementById('campoEditarTelefono').value,
    cliente_cedula: document.getElementById('campoEditarCedula').value,
    fecha_entrega: document.getElementById('campoEditarFechaEntrega').value
  };
  // Si la venta ya tiene factura, el backend rechaza cambios de productos;
  // en ese caso ni siquiera mandamos "items" para no disparar ese error
  // quedando solo la edición de contacto/fecha.
  if (!ventaFacturadaEnEdicion) {
    datos.items = itemsEditarVentaEnEdicion.map(i => ({
      producto_id: i.producto_id, cantidad: i.cantidad, categoria: i.categoria || null
    }));
  }

  try {
    await API.actualizar(`/api/ventas/${id}`, datos);
    mostrarAviso('Venta actualizada');
    cerrarEditarVenta();
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    if (err.message.includes('No hay material suficiente')) {
      const confirmado = confirm(
        'No hay material suficiente según el sistema para estos cambios.\n\n' +
        '¿Guardar de todas formas? (Luego corriges con un ajuste de inventario.)'
      );
      if (confirmado) {
        try {
          await API.actualizar(`/api/ventas/${id}`, { ...datos, forzar: true });
          mostrarAviso('Venta actualizada forzando el stock');
          cerrarEditarVenta();
          cargarPedidos();
          cargarHistorialVentas();
        } catch (err2) {
          mostrarAviso(err2.message, 'error');
        }
      }
    } else {
      mostrarAviso(err.message, 'error');
    }
  }
}

async function eliminarVenta(id, nombreCliente) {
  const motivo = prompt(`Vas a eliminar la venta de "${nombreCliente}". El stock consumido se devuelve automáticamente.\n\nEscribe el motivo:`);
  if (motivo === null) return; // canceló
  if (!motivo.trim()) { mostrarAviso('Necesitas escribir un motivo', 'error'); return; }

  try {
    await API.eliminar(`/api/ventas/${id}`, { motivo });
    mostrarAviso('Venta eliminada y stock revertido');
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 2. Pedidos con estado ----
async function cargarPedidos() {
  const cuerpo = document.getElementById('cuerpoPedidos');
  try {
    const ventas = await API.obtener('/api/ventas');
    pedidosEnMemoria = ventas.filter(v => v.estado !== 'entregado');
    buscarVentas(); // pinta respetando el texto de búsqueda si había uno
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="9" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function pintarPedidos(lista) {
  const cuerpo = document.getElementById('cuerpoPedidos');

  if (pedidosEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="9" class="tabla__vacio">No hay pedidos activos. Los entregados quedan en el historial.</td></tr>';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="9" class="tabla__vacio">Ningún pedido coincide con la búsqueda.</td></tr>';
    return;
  }

  cuerpo.innerHTML = lista.map(v => {
    const siguiente = SIGUIENTE_ESTADO[v.estado];
    return `
    <tr>
      <td>${formatearFecha(v.fecha)}</td>
      <td>${escaparHtml(v.cliente || '—')}</td>
      <td>${celdaFechaEntrega(v)}</td>
      <td>${resumenProductos(v)}</td>
      <td>${formatearPesos(v.total)}</td>
      <td><span class="etiqueta-estado etiqueta-estado--${v.estado}">${ETIQUETA_ESTADO[v.estado]}</span></td>
      <td>${celdaPago(v)}</td>
      <td>${siguiente ? `<button type="button" class="boton boton--pequeno" onclick="cambiarEstadoPedido('${v.id}', '${siguiente}')">Pasar a ${ETIQUETA_ESTADO[siguiente].toLowerCase()}</button>` : ''}</td>
      <td>${accionesVenta(v)}</td>
    </tr>`;
  }).join('');
}

function celdaFechaEntrega(venta) {
  const hoy = new Date().toISOString().slice(0, 10);
  let clase = '';
  let texto = 'Sin definir';
  if (venta.fecha_entrega) {
    texto = formatearFechaCortaVenta(venta.fecha_entrega);
    if (venta.fecha_entrega < hoy) clase = ' style="color:#b91c1c;font-weight:600"';
    else if (venta.fecha_entrega === hoy) clase = ' style="color:#c2410c;font-weight:600"';
  }
  return `<span${clase}>${texto}</span> <button type="button" class="boton boton--pequeno" onclick="abrirFechaEntrega('${venta.id}', '${venta.fecha_entrega || ''}')">Cambiar</button>`;
}

function formatearFechaCortaVenta(fecha) {
  return new Date(fecha + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

function abrirFechaEntrega(ventaId, fechaActual) {
  document.getElementById('campoVentaFechaEntregaId').value = ventaId;
  document.getElementById('campoNuevaFechaEntrega').value = fechaActual || '';
  document.getElementById('modalFechaEntrega').hidden = false;
}

function cerrarFechaEntrega() {
  document.getElementById('modalFechaEntrega').hidden = true;
}

async function guardarFechaEntrega() {
  const ventaId = document.getElementById('campoVentaFechaEntregaId').value;
  const fecha = document.getElementById('campoNuevaFechaEntrega').value;
  try {
    await API.actualizar(`/api/ventas/${ventaId}/fecha-entrega`, { fecha_entrega: fecha || null });
    mostrarAviso('Fecha de entrega actualizada');
    cerrarFechaEntrega();
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

async function cambiarEstadoPedido(id, nuevoEstado) {
  try {
    await API.actualizar(`/api/ventas/${id}/estado`, { estado: nuevoEstado });
    mostrarAviso(`Pedido movido a "${ETIQUETA_ESTADO[nuevoEstado]}"`);
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 3. Historial con filtros ----
async function cargarHistorialVentas() {
  const cuerpo = document.getElementById('cuerpoHistorial');
  const filtros = new URLSearchParams();
  const desde = document.getElementById('filtroDesde').value;
  const hasta = document.getElementById('filtroHasta').value;
  const estado = document.getElementById('filtroEstado').value;
  if (desde) filtros.set('desde', desde);
  if (hasta) filtros.set('hasta', hasta);
  if (estado) filtros.set('estado', estado);

  try {
    historialEnMemoria = await API.obtener('/api/ventas' + (filtros.toString() ? '?' + filtros.toString() : ''));
    buscarVentas(); // pinta respetando el texto de búsqueda si había uno
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="11" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function pintarHistorial(lista) {
  const cuerpo = document.getElementById('cuerpoHistorial');

  if (historialEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="11" class="tabla__vacio">No hay ventas con esos filtros.</td></tr>';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="11" class="tabla__vacio">Ninguna venta coincide con la búsqueda.</td></tr>';
    return;
  }

  cuerpo.innerHTML = lista.map(v => `
    <tr>
      <td>${formatearFecha(v.fecha)}</td>
      <td>${escaparHtml(v.cliente || '—')}</td>
      <td>${contactoCliente(v)}</td>
      <td>${v.fecha_entrega ? formatearFechaCortaVenta(v.fecha_entrega) : '—'}</td>
      <td>${resumenProductos(v)}</td>
      <td>${formatearPesos(v.total)}</td>
      <td>${formatearPesos(v.costo_total)}</td>
      <td>${formatearPesos(v.total - v.costo_total)}</td>
      <td><span class="etiqueta-estado etiqueta-estado--${v.estado}">${ETIQUETA_ESTADO[v.estado]}</span></td>
      <td>${celdaPago(v)}</td>
      <td>${accionesVenta(v)}</td>
    </tr>`).join('');
}

// ---- Búsqueda (instantánea, en memoria; filtra pedidos e historial a la vez) ----
function buscarVentas() {
  const texto = normalizarTexto(document.getElementById('buscadorVentas').value);

  if (!texto) {
    pintarPedidos(pedidosEnMemoria);
    pintarHistorial(historialEnMemoria);
    return;
  }

  const coincide = v =>
    normalizarTexto(v.cliente).includes(texto) ||
    (v.ventas_items || []).some(i =>
      normalizarTexto(i.productos ? i.productos.nombre : '').includes(texto) ||
      normalizarTexto(i.categoria).includes(texto));

  pintarPedidos(pedidosEnMemoria.filter(coincide));
  pintarHistorial(historialEnMemoria.filter(coincide));
}

function normalizarTexto(texto) {
  return (texto ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ---- Utilidades ----
function contactoCliente(venta) {
  const partes = [];
  if (venta.cliente_telefono) partes.push(escaparHtml(venta.cliente_telefono));
  if (venta.cliente_cedula) partes.push('CC ' + escaparHtml(venta.cliente_cedula));
  return partes.length ? partes.join(' · ') : '<span class="texto-secundario">—</span>';
}

function resumenProductos(venta) {
  return (venta.ventas_items || [])
    .map(i => {
      const entregado = Number(i.cantidad_entregada || 0);
      const progreso = entregado > 0 && entregado < Number(i.cantidad) ? ` (${entregado}/${i.cantidad} entregado)` : '';
      return `${i.cantidad}× ${escaparHtml(i.productos ? i.productos.nombre : 'Producto')}${i.categoria ? ` (${escaparHtml(i.categoria)})` : ''}${progreso}`;
    })
    .join(', ');
}

// ---- Entregas parciales de un pedido ----
async function abrirEntregasVenta(venta) {
  document.getElementById('campoEntregaVentaId').value = venta.id;
  document.getElementById('campoFechaEntregaVenta').value = new Date().toISOString().slice(0, 10);

  const cuerpo = document.getElementById('cuerpoItemsEntregaVenta');
  cuerpo.innerHTML = (venta.ventas_items || []).map(i => {
    const total = Number(i.cantidad);
    const entregado = Number(i.cantidad_entregada || 0);
    const pendiente = Math.round((total - entregado) * 10000) / 10000;
    return `
      <tr>
        <td><input type="checkbox" id="chkEntregaItem-${i.id}" ${pendiente > 0 ? 'checked' : 'disabled'}></td>
        <td>${escaparHtml(i.productos ? i.productos.nombre : 'Producto')}</td>
        <td>${total}</td>
        <td>${entregado}</td>
        <td><input type="number" id="cantidadEntregaItem-${i.id}" min="0" max="${pendiente}" step="1" value="${pendiente}" style="max-width:100px" ${pendiente <= 0 ? 'disabled' : ''}></td>
      </tr>`;
  }).join('');

  document.getElementById('modalEntregasVenta').hidden = false;
  cargarHistorialEntregaVenta(venta.id);
}

function cerrarEntregasVenta() {
  document.getElementById('modalEntregasVenta').hidden = true;
}

let gruposEntregaEnMemoria = [];

async function cargarHistorialEntregaVenta(ventaId) {
  const cuerpo = document.getElementById('cuerpoHistorialEntregaVenta');
  cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Cargando…</td></tr>';
  try {
    const grupos = await API.obtener(`/api/ventas/${ventaId}/entregas`);
    gruposEntregaEnMemoria = grupos;
    if (grupos.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Todavía no hay entregas registradas</td></tr>';
      return;
    }
    cuerpo.innerHTML = grupos.map((g, indice) => `
      <tr>
        <td>${formatearFechaCortaVenta(g.fecha)}</td>
        <td>${g.items.map(it => `${it.cantidad}× ${escaparHtml(it.producto)}`).join(', ')}</td>
        <td class="tabla__acciones">
          <button type="button" class="boton boton--pequeno" onclick="abrirComprobanteGrupo(${indice})">Comprobante</button>
          <button type="button" class="boton boton--pequeno boton--peligro" onclick="borrarGrupoEntregaVenta('${g.grupo_id}', '${ventaId}')">Borrar</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="3" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

async function registrarEntregaVenta() {
  const ventaId = document.getElementById('campoEntregaVentaId').value;
  const fecha = document.getElementById('campoFechaEntregaVenta').value;
  if (!fecha) { mostrarAviso('Elige la fecha de esta entrega', 'error'); return; }

  const venta = pedidosEnMemoria.find(v => v.id === ventaId) || historialEnMemoria.find(v => v.id === ventaId);
  const items = [];
  for (const i of (venta ? venta.ventas_items : [])) {
    const casilla = document.getElementById(`chkEntregaItem-${i.id}`);
    if (!casilla || !casilla.checked) continue;
    const cantidad = document.getElementById(`cantidadEntregaItem-${i.id}`).value;
    if (cantidad && Number(cantidad) > 0) items.push({ venta_item_id: i.id, cantidad });
  }
  if (items.length === 0) { mostrarAviso('Marca al menos un producto con cantidad mayor a 0', 'error'); return; }

  try {
    await API.enviar(`/api/ventas/${ventaId}/entregas`, { fecha, items });
    mostrarAviso('Entrega registrada');
    abrirEntregasVenta(venta); // vuelve a pintar con los pendientes actualizados
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

async function borrarGrupoEntregaVenta(grupoId, ventaId) {
  const confirmado = confirm('¿Borrar esta entrega? Se quita del historial y las cantidades vuelven a quedar pendientes.');
  if (!confirmado) return;
  try {
    await API.eliminar(`/api/ventas/entregas/grupo/${grupoId}`);
    mostrarAviso('Entrega borrada');
    cargarHistorialEntregaVenta(ventaId);
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Comprobante de entrega (imprimible, con firma opcional) ----
// Antes de generarlo SIEMPRE se pregunta si el cliente va a firmar el
// papel impreso — de eso depende si se agrega el bloque de firma al
// final. El resto del comprobante es idéntico en ambos casos.
function abrirComprobanteVenta(venta) {
  const conFirma = confirm('¿El cliente va a firmar este comprobante impreso?\n\nAceptar = sí, se agrega el espacio de firma.\nCancelar = no, se imprime sin eso.');
  const items = (venta.ventas_items || []).map(i => ({
    producto: i.productos ? i.productos.nombre : 'Producto',
    cantidad: i.cantidad
  }));
  pintarComprobante({ cliente: venta.cliente, fecha: venta.fecha, items, conFirma });
  document.getElementById('modalComprobanteVenta').hidden = false;
}

function abrirComprobanteGrupo(indice) {
  const grupo = gruposEntregaEnMemoria[indice];
  if (!grupo) return;
  const ventaId = document.getElementById('campoEntregaVentaId').value;
  const venta = pedidosEnMemoria.find(v => v.id === ventaId) || historialEnMemoria.find(v => v.id === ventaId);

  const conFirma = confirm('¿El cliente va a firmar este comprobante impreso?\n\nAceptar = sí, se agrega el espacio de firma.\nCancelar = no, se imprime sin eso.');
  pintarComprobante({
    cliente: venta ? venta.cliente : '',
    fecha: grupo.fecha,
    items: grupo.items.map(it => ({ producto: it.producto, cantidad: it.cantidad })),
    conFirma,
    esParcial: true
  });
  document.getElementById('modalComprobanteVenta').hidden = false;
}

function pintarComprobante({ cliente, fecha, items, conFirma, esParcial }) {
  const filas = items.map(i => `
    <tr>
      <td>${escaparHtml(i.producto)}</td>
      <td>${i.cantidad}</td>
    </tr>`).join('');

  document.getElementById('contenidoComprobante').innerHTML = `
    <div class="factura" id="areaImprimible">
      <header class="factura__encabezado">
        <h2 style="margin:0">${esParcial ? 'Comprobante de entrega parcial' : 'Comprobante de entrega'}</h2>
        <p class="texto-secundario" style="margin:2px 0">${formatearFecha(fecha)}</p>
      </header>

      <p style="margin:12px 0 4px"><strong>Cliente:</strong> ${escaparHtml(cliente || 'Consumidor final')}</p>

      <table class="tabla">
        <thead><tr><th>Producto</th><th>Cantidad</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>

      ${conFirma ? bloqueFirmaComprobante() : ''}
    </div>`;
}

function bloqueFirmaComprobante() {
  return `
    <div style="margin-top:60px;display:flex;justify-content:space-between;gap:40px">
      <div style="flex:1;text-align:center">
        <div style="border-top:1px solid #000;margin-bottom:6px"></div>
        <span>Firma del comprador o autorizado</span>
      </div>
      <div style="flex:1;text-align:center">
        <div style="border-top:1px solid #000;margin-bottom:6px"></div>
        <span>Fecha de entrega</span>
      </div>
    </div>
    <p style="margin-top:24px">Al firmar el comprobante declaro haber recibido conforme el producto.</p>
    <p><strong>IMPORTANTE:</strong> En caso de contracargos por parte del titular de la tarjeta, se presentará este documento como prueba de la entrega del producto.</p>`;
}

function cerrarComprobanteVenta() {
  document.getElementById('modalComprobanteVenta').hidden = true;
}

function imprimirComprobanteVenta() {
  window.print();
}

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  cargarPedidos();
  cargarHistorialVentas();
});