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
let filtroEstadoPedidos = 'todos'; // tab activa sobre la tabla de Pedidos
let paginaHistorial = 1;
let filasPorPaginaHistorial = 5;

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
    return `<span class="etiqueta-pago etiqueta-pago--pagado">✓ Pagado</span> <button type="button" class="boton boton--pequeno" onclick="confirmarPago('${venta.id}', false)">Deshacer</button>`;
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
const ICONO_OJO = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
const ICONO_LAPIZ = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>';
const ICONO_CAMION = '<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8Z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>';
const ICONO_BASURA = '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';

function accionesVenta(venta) {
  const datos = JSON.stringify(venta).replace(/'/g, "&#39;");
  return `<span class="acciones-fila">
    <button type="button" onclick='abrirComprobanteVenta(${datos})' title="Ver comprobante"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_OJO}</svg></button>
    <button type="button" onclick='abrirEditarVenta(${datos})' title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_LAPIZ}</svg></button>
    <button type="button" onclick='abrirEntregasVenta(${datos})' title="Entregas"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_CAMION}</svg></button>
    <button type="button" class="acciones-fila__peligro" onclick="eliminarVenta('${venta.id}', '${escaparHtml(venta.cliente || 'sin cliente')}')" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_BASURA}</svg></button>
  </span>`;
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

function actualizarConteosPedidos() {
  const porEstado = { pendiente: 0, en_produccion: 0, listo: 0 };
  for (const v of pedidosEnMemoria) { if (v.estado in porEstado) porEstado[v.estado]++; }
  const set = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = `(${valor})`; };
  set('conteoTodos', pedidosEnMemoria.length);
  set('conteoPendiente', porEstado.pendiente);
  set('conteoEnProduccion', porEstado.en_produccion);
  set('conteoListo', porEstado.listo);
}

function filtrarPorEstado(estado) {
  filtroEstadoPedidos = estado;
  document.querySelectorAll('#tabsPedidos .tabs-modulo__item').forEach(boton => {
    boton.classList.toggle('tabs-modulo__item--activo', boton.dataset.filtro === estado);
  });
  buscarVentas();
}

function pintarPedidos(lista) {
  const cuerpo = document.getElementById('cuerpoPedidos');
  actualizarConteosPedidos();

  const listaFiltrada = filtroEstadoPedidos === 'todos'
    ? lista
    : lista.filter(v => v.estado === filtroEstadoPedidos);

  if (pedidosEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="10" class="tabla__vacio">No hay pedidos activos. Los entregados quedan en el historial.</td></tr>';
    return;
  }
  if (listaFiltrada.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="10" class="tabla__vacio">Ningún pedido coincide con la búsqueda o el filtro.</td></tr>';
    return;
  }

  cuerpo.innerHTML = listaFiltrada.map(v => {
    const siguiente = SIGUIENTE_ESTADO[v.estado];
    return `
    <tr>
      <td>${numeroCortoVenta(v)}</td>
      <td>${formatearFecha(v.fecha)}</td>
      <td><span class="celda-cliente">${avatarCliente(v)}${escaparHtml(v.cliente || '—')}</span></td>
      <td>${resumenProductosCompacto(v)}</td>
      <td>${miniaturaVenta(v)}</td>
      <td>${celdaFechaEntrega(v)}</td>
      <td>${formatearPesos(v.total)}</td>
      <td>
        <span class="etiqueta-estado etiqueta-estado--${v.estado}">${ETIQUETA_ESTADO[v.estado]}</span>
        ${siguiente ? `<button type="button" class="boton boton--pequeno" style="margin-top:4px" onclick="cambiarEstadoPedido('${v.id}', '${siguiente}')">Pasar a ${ETIQUETA_ESTADO[siguiente].toLowerCase()}</button>` : ''}
      </td>
      <td>${celdaPago(v)}</td>
      <td>${accionesVenta(v)}</td>
    </tr>`;
  }).join('');
}

function numeroCortoVenta(venta) {
  return '#' + String(venta.id || '').replace(/-/g, '').slice(-5).toUpperCase();
}

function avatarCliente(venta) {
  const inicial = (venta.cliente || '?').trim().charAt(0).toUpperCase();
  return `<span class="avatar-inicial">${escaparHtml(inicial)}</span>`;
}

function primeraFotoVenta(venta) {
  const items = venta.ventas_items || [];
  const conFoto = items.find(i => i.productos && i.productos.foto_url);
  return conFoto ? conFoto.productos.foto_url : null;
}

function miniaturaVenta(venta) {
  const foto = primeraFotoVenta(venta);
  if (foto) return `<img src="${escaparHtml(foto)}" class="miniatura" alt="">`;
  return `<span class="miniatura miniatura--vacia"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/></svg></span>`;
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
    paginaHistorial = 1;
    buscarVentas(); // pinta respetando el texto de búsqueda si había uno
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="11" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function pintarHistorial(lista) {
  const cuerpo = document.getElementById('cuerpoHistorial');
  pintarKpisVentas(lista);

  if (historialEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="13" class="tabla__vacio">No hay ventas con esos filtros.</td></tr>';
    document.getElementById('paginacionHistorial').innerHTML = '';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="13" class="tabla__vacio">Ninguna venta coincide con la búsqueda.</td></tr>';
    document.getElementById('paginacionHistorial').innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / filasPorPaginaHistorial));
  if (paginaHistorial > totalPaginas) paginaHistorial = totalPaginas;
  const inicio = (paginaHistorial - 1) * filasPorPaginaHistorial;
  const paginaActual = lista.slice(inicio, inicio + filasPorPaginaHistorial);

  cuerpo.innerHTML = paginaActual.map(v => `
    <tr>
      <td>${numeroCortoVenta(v)}</td>
      <td>${formatearFecha(v.fecha)}</td>
      <td><span class="celda-cliente">${avatarCliente(v)}${escaparHtml(v.cliente || '—')}</span></td>
      <td>${contactoCliente(v)}</td>
      <td>${v.fecha_entrega ? formatearFechaCortaVenta(v.fecha_entrega) : '—'}</td>
      <td>${resumenProductosCompacto(v)}</td>
      <td>${miniaturaVenta(v)}</td>
      <td>${formatearPesos(v.total)}</td>
      <td>${formatearPesos(v.costo_total)}</td>
      <td>${formatearPesos(v.total - v.costo_total)}</td>
      <td><span class="etiqueta-estado etiqueta-estado--${v.estado}">${ETIQUETA_ESTADO[v.estado]}</span></td>
      <td>${celdaPago(v)}</td>
      <td>${accionesVenta(v)}</td>
    </tr>`).join('');

  pintarPaginacionHistorial(lista.length, totalPaginas);
}

function pintarPaginacionHistorial(totalFilas, totalPaginas) {
  const contenedor = document.getElementById('paginacionHistorial');
  const inicio = totalFilas === 0 ? 0 : (paginaHistorial - 1) * filasPorPaginaHistorial + 1;
  const fin = Math.min(paginaHistorial * filasPorPaginaHistorial, totalFilas);

  const botonesPagina = [];
  for (let p = 1; p <= totalPaginas; p++) {
    botonesPagina.push(`<button type="button" class="${p === paginaHistorial ? 'paginacion__botones--activa' : ''}" onclick="irAPaginaHistorial(${p})">${p}</button>`);
  }

  contenedor.innerHTML = `
    <span>Mostrando ${inicio} a ${fin} de ${totalFilas} resultados</span>
    <span class="paginacion__selector">
      Filas por página
      <select onchange="cambiarFilasPorPaginaHistorial(this.value)">
        ${[5, 10, 20, 50].map(n => `<option value="${n}" ${n === filasPorPaginaHistorial ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </span>
    <span class="paginacion__botones">
      <button type="button" onclick="irAPaginaHistorial(${paginaHistorial - 1})" ${paginaHistorial <= 1 ? 'disabled' : ''}>‹</button>
      ${botonesPagina.join('')}
      <button type="button" onclick="irAPaginaHistorial(${paginaHistorial + 1})" ${paginaHistorial >= totalPaginas ? 'disabled' : ''}>›</button>
    </span>`;
}

function irAPaginaHistorial(pagina) {
  paginaHistorial = pagina;
  buscarVentas();
}

function cambiarFilasPorPaginaHistorial(valor) {
  filasPorPaginaHistorial = Number(valor);
  paginaHistorial = 1;
  buscarVentas();
}

// ---- KPIs del período actualmente cargado en el historial ----
function pintarKpisVentas(lista) {
  const contenedor = document.getElementById('kpisVentas');
  if (!contenedor) return;

  const totalVentas = lista.reduce((suma, v) => suma + Number(v.total || 0), 0);
  const pedidos = lista.length;
  const ticketPromedio = pedidos > 0 ? totalVentas / pedidos : 0;
  const productosVendidos = lista.reduce((suma, v) => suma + (v.ventas_items || []).reduce((s, i) => s + Number(i.cantidad || 0), 0), 0);

  const tarjetas = [
    { icono: 'ICONO_PESO', color: 'azul', etiqueta: 'Ventas totales', valor: formatearPesos(totalVentas) },
    { icono: 'ICONO_CARRITO', color: 'verde', etiqueta: 'Pedidos', valor: String(pedidos) },
    { icono: 'ICONO_BOLSA', color: 'morado', etiqueta: 'Ticket promedio', valor: formatearPesos(Math.round(ticketPromedio)) },
    { icono: 'ICONO_BARRAS', color: 'naranja', etiqueta: 'Productos vendidos', valor: String(productosVendidos) }
  ];

  const SVGS = {
    ICONO_PESO: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>',
    ICONO_CARRITO: '<circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 3h2l2.6 12.4a2 2 0 0 0 2 1.6h9a2 2 0 0 0 2-1.6L22 7H6"/>',
    ICONO_BOLSA: '<path d="M6 2 3 6v14a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V6l-3-4Z"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    ICONO_BARRAS: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'
  };

  contenedor.innerHTML = tarjetas.map(t => `
    <div class="kpi-tarjeta">
      <span class="kpi-tarjeta__icono indicador__icono--${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${SVGS[t.icono]}</svg></span>
      <span class="kpi-tarjeta__etiqueta">${t.etiqueta}</span>
      <span class="kpi-tarjeta__valor">${t.valor}</span>
    </div>`).join('');
}

// ---- Exportar historial a Excel (reutiliza el endpoint real de Importar/Exportar) ----
async function exportarVentasExcel() {
  try {
    const token = localStorage.getItem('token_sesion');
    const respuesta = await fetch('/api/excel/ventas/exportar', { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!respuesta.ok) {
      const datos = await respuesta.json().catch(() => ({}));
      throw new Error(datos.error || `Error ${respuesta.status}`);
    }
    const blob = await respuesta.blob();
    const url = URL.createObjectURL(blob);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = '06_Ventas.xlsx';
    document.body.appendChild(enlace);
    enlace.click();
    enlace.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
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

// Igual que resumenProductos(), pero si hay más de 2 productos los
// colapsa detrás de un "y N más" — evita que una venta con 8-10
// productos vuelva la fila altísima. Se puede expandir con un clic sin
// salir de la tabla ni abrir un modal aparte.
function resumenProductosCompacto(venta) {
  const items = venta.ventas_items || [];
  if (items.length <= 2) return resumenProductos(venta);

  const idBase = `productosVenta-${venta.id}`;
  const primeros = items.slice(0, 2)
    .map(i => `${i.cantidad}× ${escaparHtml(i.productos ? i.productos.nombre : 'Producto')}`)
    .join(', ');
  const resto = items.length - 2;

  return `
    <span id="${idBase}-corto">${primeros} <a href="#" onclick="event.preventDefault(); alternarProductosVenta('${venta.id}')">y ${resto} más</a></span>
    <span id="${idBase}-completo" hidden>${resumenProductos(venta)} <a href="#" onclick="event.preventDefault(); alternarProductosVenta('${venta.id}')">(ver menos)</a></span>`;
}

function alternarProductosVenta(ventaId) {
  const corto = document.getElementById(`productosVenta-${ventaId}-corto`);
  const completo = document.getElementById(`productosVenta-${ventaId}-completo`);
  if (!corto || !completo) return;
  corto.hidden = !corto.hidden;
  completo.hidden = !completo.hidden;
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
          <select id="modoComprobanteGrupo-${indice}" class="selector-pequeno">
            <option value="unico">Comprobante completo</option>
            <option value="categoria">Por categoría</option>
            <option value="individual">Individual (por producto)</option>
          </select>
          <button type="button" class="boton boton--pequeno" onclick="generarComprobanteGrupo(${indice})">Generar</button>
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
// También incluye la misma información del negocio que ya se usa en
// Facturación (razón social, NIT, régimen, resolución si aplica,
// persona y métodos de pago) — se trae una sola vez y se reutiliza.
let configFiscalEnMemoria = undefined; // undefined = todavía no se pidió; null = se pidió y no hay configuración

async function obtenerConfigFiscalParaComprobante() {
  if (configFiscalEnMemoria !== undefined) return configFiscalEnMemoria;
  try {
    configFiscalEnMemoria = await API.obtener('/api/facturacion/configuracion');
  } catch (err) {
    configFiscalEnMemoria = null;
  }
  return configFiscalEnMemoria;
}

async function abrirComprobanteVenta(venta) {
  const conFirma = confirm('¿El cliente va a firmar este comprobante impreso?\n\nAceptar = sí, se agrega el espacio de firma.\nCancelar = no, se imprime sin eso.');
  const items = (venta.ventas_items || []).map(i => ({
    producto: i.productos ? i.productos.nombre : 'Producto',
    cantidad: i.cantidad
  }));
  const config = await obtenerConfigFiscalParaComprobante();
  pintarComprobante({ cliente: venta.cliente, fecha: venta.fecha, items, conFirma, config });
  document.getElementById('modalComprobanteVenta').hidden = false;
}

function generarComprobanteGrupo(indice) {
  const selector = document.getElementById(`modoComprobanteGrupo-${indice}`);
  abrirComprobanteGrupo(indice, selector ? selector.value : 'unico');
}

async function abrirComprobanteGrupo(indice, modo = 'unico') {
  const grupo = gruposEntregaEnMemoria[indice];
  if (!grupo) return;
  const ventaId = document.getElementById('campoEntregaVentaId').value;
  const venta = pedidosEnMemoria.find(v => v.id === ventaId) || historialEnMemoria.find(v => v.id === ventaId);

  const conFirma = confirm('¿El cliente va a firmar este comprobante impreso?\n\nAceptar = sí, se agrega el espacio de firma.\nCancelar = no, se imprime sin eso.');
  const config = await obtenerConfigFiscalParaComprobante();
  pintarComprobante({
    cliente: venta ? venta.cliente : '',
    fecha: grupo.fecha,
    items: grupo.items.map(it => ({ producto: it.producto, categoria: it.categoria || null, cantidad: it.cantidad })),
    conFirma,
    esParcial: true,
    config,
    modo
  });
  document.getElementById('modalComprobanteVenta').hidden = false;
}

function agruparItemsParaComprobante(items, modo) {
  if (modo === 'individual') {
    return items.map(i => ({ etiqueta: i.producto, items: [i] }));
  }
  if (modo === 'categoria') {
    const grupos = new Map();
    for (const i of items) {
      const clave = i.categoria || 'Sin categoría';
      if (!grupos.has(clave)) grupos.set(clave, []);
      grupos.get(clave).push(i);
    }
    return [...grupos.entries()].map(([etiqueta, itemsGrupo]) => ({ etiqueta, items: itemsGrupo }));
  }
  return [{ etiqueta: null, items }];
}

function pintarComprobante({ cliente, fecha, items, conFirma, esParcial, config, modo = 'unico' }) {
  const grupos = agruparItemsParaComprobante(items, modo);
  const tituloBase = esParcial ? 'Comprobante de entrega parcial' : 'Comprobante de entrega';
  const tieneNit = !!(config && config.nit);

  const bloques = grupos.map(grupo => {
    const filas = grupo.items.map(i => `
      <tr>
        <td>${escaparHtml(i.producto)}</td>
        <td>${i.cantidad}</td>
      </tr>`).join('');

    return `
    <div class="factura">
      <header class="factura__encabezado">
        <div>
          <h2 style="margin:0">${escaparHtml(config ? config.razon_social || '' : '')}</h2>
          ${tieneNit ? `<p class="texto-secundario" style="margin:2px 0">NIT: ${escaparHtml(config.nit)}</p>` : ''}
          ${tieneNit && config.regimen ? `<p class="texto-secundario" style="margin:2px 0">${escaparHtml(config.regimen)}</p>` : ''}
        </div>
        <div style="text-align:right">
          <h3 style="margin:0">${tituloBase}</h3>
          ${grupo.etiqueta ? `<p style="margin:2px 0"><strong>${escaparHtml(grupo.etiqueta)}</strong></p>` : ''}
          <p class="texto-secundario" style="margin:2px 0">${formatearFecha(fecha)}</p>
        </div>
      </header>

      <p style="margin:12px 0 4px"><strong>Cliente:</strong> ${escaparHtml(cliente || 'Consumidor final')}</p>

      <table class="tabla">
        <thead><tr><th>Producto</th><th>Cantidad</th></tr></thead>
        <tbody>${filas}</tbody>
      </table>

      ${bloqueDatosPersonaYPagoComprobante(config)}
      ${conFirma ? bloqueFirmaComprobante() : ''}
    </div>`;
  }).join('');

  document.getElementById('contenidoComprobante').innerHTML = `<div id="areaImprimible">${bloques}</div>`;
}

// Mismo bloque que ya se usa en la factura DIAN (persona + hasta 5
// métodos de pago) — solo se imprime si de verdad se llenó algo.
const ETIQUETA_TIPO_PAGO_COMPROBANTE = { cuenta: 'Número de cuenta', llave: 'Llave', nequi: 'Nequi' };

function bloqueDatosPersonaYPagoComprobante(config) {
  if (!config) return '';
  const tieneDatosPersona = !!(config.nombre_persona || config.cedula);
  const metodos = Array.isArray(config.metodos_pago) ? config.metodos_pago : [];
  if (!tieneDatosPersona && metodos.length === 0) return '';

  return `
    <div style="margin-top:14px;padding-top:10px;border-top:1px solid var(--hairline)">
      ${tieneDatosPersona ? `
        <p style="margin:2px 0">
          ${config.nombre_persona ? `<strong>${escaparHtml(config.nombre_persona)}</strong>` : ''}
          ${config.cedula ? ` — C.C. ${escaparHtml(config.cedula)}` : ''}
        </p>` : ''}
      ${metodos.length > 0 ? `
        <p class="texto-secundario" style="margin:6px 0 2px"><strong>Métodos de pago</strong></p>
        <ul style="margin:0;padding-left:18px">
          ${metodos.map(m => `
            <li>${ETIQUETA_TIPO_PAGO_COMPROBANTE[m.tipo] || m.tipo}: ${escaparHtml(m.valor)}${m.etiqueta ? ` (${escaparHtml(m.etiqueta)})` : ''}</li>
          `).join('')}
        </ul>` : ''}
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