// ============================================================
// Inventario · Productos terminados — public/js/inventario-productos.js
// Pestaña "Productos terminados": stock, mínimo, ingresos, compras para
// reventa, salidas, ajustes e historial por producto.
// ============================================================
let productosStock = [];
let claveMovProducto = null;
let decisionPendiente = null; // vista previa mostrada, esperando confirmación

const TITULOS_MOV = {
  ingreso: 'Ingresar unidades',
  reventa: 'Compra para reventa',
  salida: 'Registrar salida',
  ajuste: 'Ajustar por conteo'
};

const ORIGENES = {
  ingreso_producto: 'Ingreso', compra_reventa: 'Compra reventa', salida_producto: 'Salida',
  ajuste: 'Ajuste', venta: 'Venta', venta_edicion: 'Venta editada', venta_eliminacion: 'Venta eliminada',
  fabricacion: 'Fabricación', reversion: 'Reversión', importacion: 'Importación'
};

function cambiarVistaInventario(vista) {
  document.getElementById('vistaMateriales').hidden = vista !== 'materiales';
  document.getElementById('vistaProductos').hidden = vista !== 'productos';
  document.getElementById('vistaHistorial').hidden = vista !== 'historial';
  document.querySelectorAll('#pestanasInventario .tabs-modulo__item').forEach(b =>
    b.classList.toggle('tabs-modulo__item--activo', b.dataset.vista === vista));
  try { localStorage.setItem('inventario_vista', vista); } catch {}
  if (vista === 'productos') cargarProductosStock();
  if (vista === 'historial' && typeof cargarHistorialInventario === 'function') cargarHistorialInventario(1);
}

async function cargarProductosStock() {
  const cuerpo = document.getElementById('cuerpoProductosStock');
  try {
    productosStock = await API.obtener('/api/inventario/productos');
    pintarKpisProductos();
    pintarProductosStock();
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function pintarKpisProductos() {
  const contenedor = document.getElementById('kpisProductos');
  const controlados = productosStock.filter(p => p.controla_stock);
  const unidades = controlados.reduce((s, p) => s + Math.max(0, p.stock_actual), 0);
  const bajos = controlados.filter(p => p.estado === 'amarillo').length;
  const sinStock = controlados.filter(p => p.estado === 'rojo').length;
  const tieneValor = controlados.some(p => p.valor_inventario !== undefined);
  const valor = controlados.reduce((s, p) => s + (p.valor_inventario || 0), 0);
  const tarjetas = [
    { color: 'azul', etiqueta: 'Productos con stock', valor: String(controlados.length) },
    { color: 'verde', etiqueta: 'Unidades disponibles', valor: String(Math.round(unidades * 100) / 100) },
    { color: 'naranja', etiqueta: 'Stock bajo', valor: String(bajos) },
    { color: 'rosa', etiqueta: 'Sin stock', valor: String(sinStock) }
  ];
  if (tieneValor) tarjetas.splice(0, 1, { color: 'morado', etiqueta: 'Valor del inventario', valor: formatearPesos(valor) });
  contenedor.innerHTML = tarjetas.map(t => `
    <div class="kpi-tarjeta">
      <span class="kpi-tarjeta__icono indicador__icono--${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/></svg></span>
      <span class="kpi-tarjeta__etiqueta">${t.etiqueta}</span>
      <span class="kpi-tarjeta__valor">${t.valor}</span>
    </div>`).join('');
}

function pintarProductosStock() {
  const cuerpo = document.getElementById('cuerpoProductosStock');
  const texto = (document.getElementById('buscadorProductosStock').value || '').toLowerCase().trim();
  const filtro = document.getElementById('filtroControlProductos').value;
  const lista = productosStock
    .filter(p => filtro === 'todos' || p.controla_stock)
    .filter(p => !texto || p.nombre.toLowerCase().includes(texto) || (p.categoria || '').toLowerCase().includes(texto));

  if (lista.length === 0) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="tabla__vacio">${filtro === 'controlados'
      ? 'Ningún producto controla stock todavía. Elige "Todos los productos" para activarlo.'
      : 'No hay productos que coincidan.'}</td></tr>`;
    return;
  }

  cuerpo.innerHTML = lista.map(p => {
    const semaforo = p.controla_stock
      ? `<span class="semaforo semaforo--${p.estado}"></span>`
      : '<span class="texto-secundario">—</span>';
    const valor = p.valor_inventario !== undefined && p.controla_stock ? formatearPesos(p.valor_inventario) : '—';
    const esReventa = p.tipo === 'reventa';
    const acciones = p.controla_stock ? (esReventa
      ? `<button type="button" class="boton boton--pequeno boton--primario" onclick="abrirMovProducto('${p.producto_id}','reventa')">Registrar compra</button>`
      : `<button type="button" class="boton boton--pequeno boton--primario" onclick="abrirMovProducto('${p.producto_id}','ingreso')">Ingresar</button>
        <button type="button" class="boton boton--pequeno" onclick="abrirMovProducto('${p.producto_id}','reventa')">Compra reventa</button>`) + `
        <button type="button" class="boton boton--pequeno" onclick="abrirMovProducto('${p.producto_id}','salida')">Salida</button>
        <button type="button" class="boton boton--pequeno" onclick="abrirMovProducto('${p.producto_id}','ajuste')">Ajustar</button>
        <button type="button" class="boton boton--pequeno" onclick="verHistorialProducto('${p.producto_id}')">Historial</button>
        <button type="button" class="boton boton--pequeno" onclick="abrirConfigProducto('${p.producto_id}')">⚙</button>`
      : `<button type="button" class="boton boton--pequeno" onclick="abrirConfigProducto('${p.producto_id}', true)">Activar stock</button>`;
    return `<tr>
      <td>${semaforo}</td>
      <td>${escaparHtml(p.nombre)}${p.categoria ? ` <span class="texto-secundario">· ${escaparHtml(p.categoria)}</span>` : ''}</td>
      <td><strong>${p.controla_stock ? p.stock_actual : '—'}</strong></td>
      <td>${p.controla_stock ? p.stock_minimo : '—'}</td>
      <td>${valor}</td>
      <td style="white-space:nowrap;">${acciones}</td>
    </tr>`;
  }).join('');
}

// ---- Movimientos ----
function abrirMovProducto(id, tipo) {
  const p = productosStock.find(x => x.producto_id === id);
  if (!p) return;
  claveMovProducto = null;
  decisionPendiente = null;
  document.getElementById('bloqueDecision').hidden = true;
  document.getElementById('botonMovProducto').textContent = 'Guardar';
  document.getElementById('campoMovProductoId').value = id;
  document.getElementById('campoMovTipo').value = tipo;
  const titulo = tipo === 'reventa' && p.tipo === 'reventa' ? 'Registrar compra' : TITULOS_MOV[tipo];
  document.getElementById('tituloMovProducto').textContent = `${titulo} · ${p.nombre}`;
  document.getElementById('textoMovStock').textContent = `Stock actual: ${p.stock_actual}`;
  document.getElementById('etiquetaMovCantidad').textContent = tipo === 'ajuste' ? 'Cantidad real contada *' : 'Cantidad *';
  document.getElementById('etiquetaMovMotivo').textContent = (tipo === 'salida' || tipo === 'ajuste') ? 'Motivo *' : 'Motivo';
  document.getElementById('bloqueMovCosto').hidden = tipo !== 'reventa';
  document.getElementById('bloqueMovProveedor').hidden = tipo !== 'reventa';
  document.getElementById('campoMovMotivo').parentElement.hidden = tipo === 'reventa';
  ['campoMovCantidad', 'campoMovCosto', 'campoMovProveedor', 'campoMovMotivo'].forEach(c => { document.getElementById(c).value = ''; });
  if (tipo === 'ajuste') document.getElementById('campoMovCantidad').value = Math.max(0, p.stock_actual);
  document.getElementById('modalMovProducto').hidden = false;
  document.getElementById('campoMovCantidad').focus();
}

function cerrarMovProducto() {
  document.getElementById('modalMovProducto').hidden = true;
  claveMovProducto = null;
  decisionPendiente = null;
}

async function confirmarMovProducto(forzar = false) {
  const id = document.getElementById('campoMovProductoId').value;
  const tipo = document.getElementById('campoMovTipo').value;
  const cantidad = document.getElementById('campoMovCantidad').value;
  const motivo = document.getElementById('campoMovMotivo').value.trim();
  if (cantidad === '' || Number(cantidad) < 0 || (tipo !== 'ajuste' && Number(cantidad) <= 0)) {
    mostrarAviso('Escribe una cantidad válida', 'error'); return;
  }
  if ((tipo === 'salida' || tipo === 'ajuste') && !motivo) { mostrarAviso('El motivo es obligatorio', 'error'); return; }

  claveMovProducto = claveMovProducto || (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
  const cuerpo = { clave: claveMovProducto.replace(/[^A-Za-z0-9_-]/g, ''), motivo, forzar };
  let ruta;
  if (tipo === 'ingreso') {
    ruta = 'ingreso'; cuerpo.cantidad = Number(cantidad);
    if (!decisionPendiente) {
      // Primero se muestra qué consumiría (si la política es preguntar)
      try {
        const plan = await API.enviar(`/api/inventario/productos/${id}/vista-previa`, { cantidad: Number(cantidad) });
        if (plan.tipo !== 'ninguno' && plan.politica_descuento === 'preguntar') {
          mostrarDecision(plan);
          return;
        }
      } catch (err) { mostrarAviso(err.message, 'error'); return; }
    } else {
      if (decisionPendiente.cantidad !== Number(cantidad)) { decisionPendiente = null; return confirmarMovProducto(forzar); }
      cuerpo.descontar_materiales = document.querySelector('input[name="decisionDescuento"]:checked').value === 'si';
      cuerpo.recordar = document.getElementById('campoRecordarDecision').checked;
    }
  }
  if (tipo === 'salida') { ruta = 'salida'; cuerpo.cantidad = Number(cantidad); }
  if (tipo === 'ajuste') { ruta = 'ajuste'; cuerpo.cantidad_nueva = Number(cantidad); }
  if (tipo === 'reventa') {
    ruta = 'compra-reventa';
    cuerpo.cantidad = Number(cantidad);
    cuerpo.costo_unitario = Number(document.getElementById('campoMovCosto').value);
    cuerpo.proveedor = document.getElementById('campoMovProveedor').value.trim();
    if (!cuerpo.proveedor || document.getElementById('campoMovCosto').value === '') {
      mostrarAviso('Proveedor y costo son obligatorios', 'error'); return;
    }
  }

  const boton = document.getElementById('botonMovProducto');
  boton.disabled = true;
  try {
    const url = `/api/inventario/productos/${id}/${ruta}`;
    const r = tipo === 'reventa'
      ? await conDecisionCosto(d => API.enviar(url, { ...cuerpo, decision_costo: d }))
      : await API.enviar(url, cuerpo);
    if (!r) return; // canceló la decisión de costo
    if (r.sin_cambios) mostrarAviso('El stock ya tenía ese valor');
    else mostrarAviso(r.forzada ? `Guardado. El stock quedó en ${r.stock_nuevo}` : `Listo. Stock: ${r.stock_nuevo}`, r.forzada ? 'error' : 'ok');
    cerrarMovProducto();
    cargarProductosStock();
  } catch (err) {
    if (!forzar && tipo === 'ingreso' && err.message.includes('No hay material suficiente para fabricar')) {
      if (confirm(`${err.message}.\n\n¿Fabricar de todas formas? Los materiales que faltan quedarán en negativo.`)) {
        boton.disabled = false;
        return confirmarMovProducto(true);
      }
    } else if (!forzar && tipo === 'salida' && err.message.includes('No hay suficiente stock')) {
      if (confirm(`${err.message}.\n\n¿Registrar la salida de todas formas? El stock quedará en negativo.`)) {
        boton.disabled = false;
        return confirmarMovProducto(true);
      }
    } else {
      mostrarAviso(err.message, 'error');
    }
  } finally {
    boton.disabled = false;
  }
}

function mostrarDecision(plan) {
  decisionPendiente = plan;
  const esEtapa = plan.tipo === 'procesos';
  document.getElementById('encabezadoConsumo').textContent = esEtapa ? 'Etapa final' : 'Material';
  document.getElementById('textoDescontar').textContent = esEtapa ? `Tomar de lo terminado en ${plan.etapa.nombre}` : 'Descontar materiales';
  const filas = esEtapa
    ? [{ nombre: plan.etapa.nombre, requerido: plan.etapa.requerido, disponible: plan.etapa.disponible, falta: plan.etapa.falta }]
    : plan.materiales;
  document.getElementById('cuerpoDecision').innerHTML = filas.map(m => `
    <tr>
      <td>${escaparHtml(m.nombre)}</td>
      <td>${m.requerido}${m.unidad ? ' ' + escaparHtml(m.unidad) : ''}</td>
      <td style="${m.falta > 0 ? 'color:var(--t-peligro);font-weight:600;' : ''}">${m.disponible}${m.falta > 0 ? ` (faltan ${m.falta})` : ''}</td>
    </tr>`).join('');
  document.querySelector('input[name="decisionDescuento"][value="si"]').checked = true;
  document.getElementById('campoRecordarDecision').checked = false;
  document.getElementById('bloqueDecision').hidden = false;
  document.getElementById('botonMovProducto').textContent = 'Confirmar';
}

// ---- Configuración ----
function abrirConfigProducto(id, activar = false) {
  const p = productosStock.find(x => x.producto_id === id);
  if (!p) return;
  document.getElementById('campoConfigProductoId').value = id;
  document.getElementById('tituloConfigProducto').textContent = p.nombre;
  document.getElementById('campoConfigControla').checked = activar || p.controla_stock;
  document.getElementById('campoConfigMinimo').value = p.stock_minimo || 0;
  document.getElementById('campoConfigPolitica').value = p.politica_descuento || 'preguntar';
  document.getElementById('modalConfigProducto').hidden = false;
}

function cerrarConfigProducto() {
  document.getElementById('modalConfigProducto').hidden = true;
}

async function guardarConfigProducto() {
  const id = document.getElementById('campoConfigProductoId').value;
  try {
    await API.actualizar(`/api/inventario/productos/${id}/config`, {
      controla_stock: document.getElementById('campoConfigControla').checked,
      stock_minimo: Number(document.getElementById('campoConfigMinimo').value || 0),
      politica_descuento: document.getElementById('campoConfigPolitica').value
    });
    mostrarAviso('Guardado');
    cerrarConfigProducto();
    cargarProductosStock();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Historial ----
async function verHistorialProducto(id) {
  const p = productosStock.find(x => x.producto_id === id);
  const cuerpo = document.getElementById('cuerpoHistorialProducto');
  document.getElementById('tituloHistorialProducto').textContent = `Movimientos · ${p ? p.nombre : ''}`;
  cuerpo.innerHTML = '<tr><td colspan="5" class="tabla__vacio">Cargando…</td></tr>';
  document.getElementById('modalHistorialProducto').hidden = false;
  try {
    const movs = await API.obtener(`/api/inventario/productos/${id}/movimientos`);
    cuerpo.innerHTML = movs.length === 0
      ? '<tr><td colspan="5" class="tabla__vacio">Sin movimientos todavía</td></tr>'
      : movs.map(m => `<tr>
          <td>${new Date(m.fecha).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' })}</td>
          <td>${escaparHtml(ORIGENES[m.origen] || m.origen || m.tipo)}</td>
          <td><strong>${Number(m.cantidad) > 0 ? '+' : ''}${Number(m.cantidad)}</strong></td>
          <td>${Number(m.stock_anterior)} → ${Number(m.stock_nuevo)}</td>
          <td>${escaparHtml(m.motivo || '')}</td>
        </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="5" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  let vista = 'materiales';
  try { vista = localStorage.getItem('inventario_vista') || 'materiales'; } catch {}
  // Sin fabricación no hay materiales: se abre en productos
  if (vista === 'materiales' && typeof Negocio !== 'undefined' && !Negocio.fabrica()) vista = 'productos';
  if (vista === 'productos' || vista === 'historial') cambiarVistaInventario(vista);
});
