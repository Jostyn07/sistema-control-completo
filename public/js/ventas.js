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
  const selector = document.getElementById('selectorProductoVenta');
  selector.innerHTML = productosParaVenta
    .map(p => `<option value="${p.id}">${escaparHtml(p.nombre)} — ${formatearPesos(p.precio_venta)} (puedes fabricar ${p.unidades_fabricables})</option>`)
    .join('');
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

  // Aviso temprano (el backend valida de nuevo con la ficha técnica completa)
  if (cantidad > producto.unidades_fabricables) {
    mostrarAviso(`Ojo: con el stock actual solo alcanza para ${producto.unidades_fabricables} unidad(es) de este producto. El sistema te avisará al registrar.`, 'error');
  }

  const existente = itemsVentaEnEdicion.find(i => i.producto_id === productoId);
  if (existente) existente.cantidad = cantidad;
  else itemsVentaEnEdicion.push({
    producto_id: productoId, nombre: producto.nombre,
    precio: Number(producto.precio_venta), cantidad
  });

  document.getElementById('cantidadVenta').value = '';
  pintarItemsVenta();
}

function quitarItemVenta(productoId) {
  itemsVentaEnEdicion = itemsVentaEnEdicion.filter(i => i.producto_id !== productoId);
  pintarItemsVenta();
}

function pintarItemsVenta() {
  const cuerpo = document.getElementById('cuerpoItemsVenta');
  if (itemsVentaEnEdicion.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="5" class="tabla__vacio">Aún no has agregado productos</td></tr>';
  } else {
    cuerpo.innerHTML = itemsVentaEnEdicion.map(i => `
      <tr>
        <td>${escaparHtml(i.nombre)}</td>
        <td>${i.cantidad}</td>
        <td>${formatearPesos(i.precio)}</td>
        <td>${formatearPesos(i.precio * i.cantidad)}</td>
        <td><button type="button" class="boton boton--pequeno boton--peligro" onclick="quitarItemVenta('${i.producto_id}')">Quitar</button></td>
      </tr>`).join('');
  }
  document.getElementById('totalVenta').textContent = formatearPesos(calcularTotalVenta(itemsVentaEnEdicion));
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
    items: itemsVentaEnEdicion.map(i => ({ producto_id: i.producto_id, cantidad: i.cantidad })),
    forzar
  };

  try {
    const venta = await API.enviar('/api/ventas', datosVenta);
    if (venta.forzada) {
      mostrarAviso('Venta registrada forzando el stock. Recuerda corregir el inventario con un ajuste.', 'error');
    } else {
      mostrarAviso(`Venta registrada por ${formatearPesos(venta.total)}. El inventario se descontó automáticamente.`);
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
    <button type="button" class="boton boton--pequeno boton--peligro" onclick="eliminarVenta('${venta.id}', '${escaparHtml(venta.cliente || 'sin cliente')}')">Eliminar</button>`;
}

function abrirEditarVenta(venta) {
  document.getElementById('campoEditarVentaId').value = venta.id;
  document.getElementById('campoEditarCliente').value = venta.cliente || '';
  document.getElementById('campoEditarTelefono').value = venta.cliente_telefono || '';
  document.getElementById('campoEditarCedula').value = venta.cliente_cedula || '';
  document.getElementById('campoEditarFechaEntrega').value = venta.fecha_entrega || '';
  document.getElementById('modalEditarVenta').hidden = false;
}

function cerrarEditarVenta() {
  document.getElementById('modalEditarVenta').hidden = true;
}

async function guardarEdicionVenta() {
  const id = document.getElementById('campoEditarVentaId').value;
  try {
    await API.actualizar(`/api/ventas/${id}`, {
      cliente: document.getElementById('campoEditarCliente').value,
      cliente_telefono: document.getElementById('campoEditarTelefono').value,
      cliente_cedula: document.getElementById('campoEditarCedula').value,
      fecha_entrega: document.getElementById('campoEditarFechaEntrega').value
    });
    mostrarAviso('Venta actualizada');
    cerrarEditarVenta();
    cargarPedidos();
    cargarHistorialVentas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
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
    (v.ventas_items || []).some(i => normalizarTexto(i.productos ? i.productos.nombre : '').includes(texto));

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
    .map(i => `${i.cantidad}× ${escaparHtml(i.productos ? i.productos.nombre : 'Producto')}`)
    .join(', ');
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