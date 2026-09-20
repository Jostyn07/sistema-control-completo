// ============================================================
// compras.js — pestaña Compras
// Funciones (según estructura funcional):
//   cargarPendientesCompra()
//   abrirFormularioCompra(materialId)
//   confirmarCompra(datosCompra)
//   cargarEnCamino()
//   marcarLlegada(compraId)
//   cargarHistorialCompras(filtros)
// ============================================================

let pendientesEnMemoria = [];
let historialEnMemoria = [];
let materialesParaCompra = [];
let filtroEstadoCompras = 'todas';
let periodoActualCompras = 'mes';

const ETIQUETA_ESTADO_COMPRA = { pendiente: 'Pendiente', recibida: 'Recibida' };

// ---- 1. Pendientes de compra (lista automática) ----
async function cargarPendientesCompra() {
  const cuerpo = document.getElementById('cuerpoPendientes');
  try {
    pendientesEnMemoria = await API.obtener('/api/compras/pendientes');

    if (pendientesEnMemoria.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">Nada pendiente: todos los materiales están por encima de su punto de reorden.</td></tr>';
      return;
    }

    cuerpo.innerHTML = pendientesEnMemoria.map(p => `
      <tr>
        <td><span class="semaforo semaforo--${p.estado}"></span></td>
        <td>${escaparHtml(p.nombre)}</td>
        <td>${p.stock_actual} ${escaparHtml(p.unidad)}</td>
        <td>${p.punto_reorden}</td>
        <td><strong>${p.cantidad_sugerida} ${escaparHtml(p.unidad)}</strong></td>
        <td>${escaparHtml(p.proveedor_sugerido)} <span class="texto-secundario">(${p.tiempo_entrega_dias} día(s))</span></td>
        <td>${formatearPesos(p.costo_estimado)}</td>
        <td>
          <button type="button" class="boton boton--pequeno boton--primario" onclick="abrirFormularioCompra('${p.material_id}')">Comprar</button>
          ${p.ya_en_camino > 0 ? `<div class="texto-secundario" style="margin-top:4px">Ya pediste ${p.ya_en_camino} ${escaparHtml(p.unidad)}, llega ${formatearFechaCorta(p.llega_aprox)}</div>` : ''}
        </td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="8" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

// ---- 2. Formulario de compra ----
async function abrirFormularioCompra(materialId) {
  try {
    materialesParaCompra = await API.obtener('/api/materiales');
  } catch (err) {
    mostrarAviso('No se pudo cargar la lista de materiales: ' + err.message, 'error');
    return;
  }
  if (materialesParaCompra.length === 0) {
    mostrarAviso('No hay materiales registrados. Créalos primero en la pestaña Materiales.', 'error');
    return;
  }

  const selector = document.getElementById('selectorMaterialCompra');
  selector.innerHTML = materialesParaCompra
    .map(m => `<option value="${m.id}">${escaparHtml(m.nombre)} (${escaparHtml(m.unidad)})</option>`)
    .join('');

  if (materialId) selector.value = materialId;
  precargarDatosMaterial(materialId);

  document.getElementById('campoNotasCompra').value = '';
  document.getElementById('modalCompra').hidden = false;
}

// Precarga proveedor sugerido, cantidad recomendada y último precio (todo editable)
function precargarDatosMaterial(materialId) {
  const id = materialId || document.getElementById('selectorMaterialCompra').value;
  const material = materialesParaCompra.find(m => m.id === id);
  if (!material) return;

  const pendiente = pendientesEnMemoria.find(p => p.material_id === id);
  document.getElementById('campoProveedorCompra').value = material.proveedor;
  document.getElementById('campoCantidadCompra').value = pendiente ? pendiente.cantidad_sugerida : '';
  document.getElementById('campoPrecioCompra').value = material.costo_unitario;
  calcularTotalCompra();
}

function calcularTotalCompra() {
  const cantidad = Number(document.getElementById('campoCantidadCompra').value || 0);
  const precio = Number(document.getElementById('campoPrecioCompra').value || 0);
  document.getElementById('totalCompra').textContent = formatearPesos(cantidad * precio);
}

function cerrarFormularioCompra() {
  document.getElementById('modalCompra').hidden = true;
}

async function confirmarCompra() {
  const datosCompra = {
    material_id: document.getElementById('selectorMaterialCompra').value,
    proveedor: document.getElementById('campoProveedorCompra').value,
    cantidad: document.getElementById('campoCantidadCompra').value,
    precio_unitario: document.getElementById('campoPrecioCompra').value,
    notas: document.getElementById('campoNotasCompra').value
  };

  if (!datosCompra.proveedor.trim()) { mostrarAviso('El proveedor es obligatorio', 'error'); return; }
  if (!datosCompra.cantidad || Number(datosCompra.cantidad) <= 0) { mostrarAviso('La cantidad debe ser mayor a 0', 'error'); return; }
  if (datosCompra.precio_unitario === '' || Number(datosCompra.precio_unitario) < 0) { mostrarAviso('El precio unitario no es válido', 'error'); return; }

  try {
    const resultado = await API.enviar('/api/compras', datosCompra);
    mostrarAviso(resultado.mensaje || 'Pedido registrado');
    if (resultado.sugerencia) {
      setTimeout(() => mostrarAviso(resultado.sugerencia, 'error'), 1800);
    }
    cerrarFormularioCompra();
    cargarPendientesCompra();
    cargarEnCamino();
    cargarHistorialCompras();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 3. Marcar llegada (usado desde la tabla unificada de compras) ----
async function marcarLlegada(compraId) {
  if (!confirm('¿Confirmar que este pedido ya llegó? El stock se sumará ahora.')) return;
  try {
    const resultado = await API.enviar(`/api/compras/${compraId}/recibir`, {});
    mostrarAviso(resultado.mensaje || 'Llegada confirmada');
    cargarPendientesCompra();
    cargarHistorialCompras();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Eliminar compra (con motivo obligatorio; revierte el stock si ya estaba recibida) ----
function abrirEliminarCompra(compraId) {
  const compra = historialEnMemoria.find(c => c.id === compraId);
  document.getElementById('campoEliminarCompraId').value = compraId;
  document.getElementById('campoMotivoEliminarCompra').value = '';

  const texto = document.getElementById('textoEliminarCompra');
  if (compra && compra.estado === 'recibida') {
    texto.textContent = `Esta compra ya está marcada como recibida: su cantidad (${compra.cantidad} ${compra.materiales ? compra.materiales.unidad : ''}) ya se sumó al stock. Al eliminarla, esa cantidad se restará automáticamente.`;
  } else {
    texto.textContent = 'Esta compra aún no ha llegado, así que no afecta el stock actual.';
  }
  document.getElementById('modalEliminarCompra').hidden = false;
}

function cerrarEliminarCompra() {
  document.getElementById('modalEliminarCompra').hidden = true;
}

async function confirmarEliminarCompra() {
  const compraId = document.getElementById('campoEliminarCompraId').value;
  const motivo = document.getElementById('campoMotivoEliminarCompra').value;
  if (!motivo.trim()) { mostrarAviso('El motivo es obligatorio', 'error'); return; }

  try {
    const resultado = await API.eliminar(`/api/compras/${compraId}`, { motivo });
    mostrarAviso(resultado.stock_revertido ? 'Compra eliminada y el stock se corrigió' : 'Compra eliminada');
    cerrarEliminarCompra();
    cargarPendientesCompra();
    cargarEnCamino();
    cargarHistorialCompras();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 4. Compras registradas: período + tabs + búsqueda ----
async function cargarHistorialCompras() {
  const filtros = new URLSearchParams();
  const proveedor = document.getElementById('filtroProveedor').value;
  const desde = document.getElementById('filtroDesde').value;
  const hasta = document.getElementById('filtroHasta').value;
  if (proveedor.trim()) filtros.set('proveedor', proveedor.trim());
  if (desde) filtros.set('desde', desde);
  if (hasta) filtros.set('hasta', hasta);

  const cuerpo = document.getElementById('cuerpoHistorialCompras');
  try {
    historialEnMemoria = await API.obtener('/api/compras/historial' + (filtros.toString() ? '?' + filtros.toString() : ''));
    pintarHistorialCompras();
    cargarKpisCompras(desde, hasta);
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="10" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function actualizarConteosCompras() {
  const porEstado = { pendiente: 0, recibida: 0 };
  for (const c of historialEnMemoria) { if (c.estado in porEstado) porEstado[c.estado]++; }
  const set = (id, valor) => { const el = document.getElementById(id); if (el) el.textContent = `(${valor})`; };
  set('conteoComprasTodas', historialEnMemoria.length);
  set('conteoComprasPendiente', porEstado.pendiente);
  set('conteoComprasRecibida', porEstado.recibida);
}

function filtrarComprasPorEstado(estado) {
  filtroEstadoCompras = estado;
  document.querySelectorAll('#tabsCompras .tabs-modulo__item').forEach(boton => {
    boton.classList.toggle('tabs-modulo__item--activo', boton.dataset.filtro === estado);
  });
  pintarHistorialCompras();
}

function pintarHistorialCompras() {
  const cuerpo = document.getElementById('cuerpoHistorialCompras');
  actualizarConteosCompras();
  pintarComprasRecientes();
  pintarTopProveedores();

  const texto = normalizarTextoCompras(document.getElementById('buscadorCompras').value);
  let lista = filtroEstadoCompras === 'todas'
    ? historialEnMemoria
    : historialEnMemoria.filter(c => c.estado === filtroEstadoCompras);

  if (texto) {
    lista = lista.filter(c =>
      normalizarTextoCompras(c.proveedor).includes(texto) ||
      normalizarTextoCompras(c.materiales ? c.materiales.nombre : '').includes(texto));
  }

  if (historialEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="10" class="tabla__vacio">No hay compras con esos filtros.</td></tr>';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="10" class="tabla__vacio">Ninguna compra coincide con la búsqueda o el filtro.</td></tr>';
    return;
  }

  cuerpo.innerHTML = lista.map(c => `
    <tr>
      <td>${numeroCortoCompra(c)}</td>
      <td>${formatearFecha(c.fecha)}</td>
      <td>${escaparHtml(c.materiales ? c.materiales.nombre : '—')}</td>
      <td><span class="celda-cliente">${avatarTexto(c.proveedor)}${escaparHtml(c.proveedor)}</span></td>
      <td>${c.cantidad} ${escaparHtml(c.materiales ? c.materiales.unidad : '')}</td>
      <td>${formatearPesos(c.precio_unitario)}</td>
      <td>${formatearPesos(c.total)}</td>
      <td><span class="etiqueta-estado etiqueta-estado--${c.estado === 'recibida' ? 'listo' : 'pendiente'}">${ETIQUETA_ESTADO_COMPRA[c.estado] || c.estado}</span></td>
      <td>${escaparHtml(c.notas || '—')}</td>
      <td>${accionesCompra(c)}</td>
    </tr>`).join('');
}

function normalizarTextoCompras(texto) {
  return (texto ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// Conecta el buscador de la barra superior (tema.js) con el de esta página.
window.buscarDesdeTopbar = function (texto) {
  document.getElementById('buscadorCompras').value = texto;
  pintarHistorialCompras();
};

function numeroCortoCompra(compra) {
  return '#OC-' + String(compra.id || '').replace(/-/g, '').slice(-4).toUpperCase();
}

function avatarTexto(texto) {
  const inicial = (texto || '?').trim().charAt(0).toUpperCase();
  return `<span class="avatar-inicial">${escaparHtml(inicial)}</span>`;
}

const ICONO_CAMION_OK = '<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8Z"/><path d="m9 12 1.5 1.5L14 10"/>';
const ICONO_BASURA_COMPRA = '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';

function accionesCompra(compra) {
  const puedeRecibir = compra.estado === 'pendiente';
  return `<span class="acciones-fila">
    ${puedeRecibir ? `<button type="button" onclick="marcarLlegada('${compra.id}')" title="Marcar como recibida"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_CAMION_OK}</svg></button>` : ''}
    <button type="button" class="acciones-fila__peligro" onclick="abrirEliminarCompra('${compra.id}')" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_BASURA_COMPRA}</svg></button>
  </span>`;
}

// ---- Selector de período: calcula desde/hasta y vuelve a cargar ----
function aplicarPeriodoCompras(periodo) {
  periodoActualCompras = periodo;
  document.querySelectorAll('#selectorPeriodoCompras .tabs-modulo__item').forEach(boton => {
    boton.classList.toggle('tabs-modulo__item--activo', boton.dataset.periodo === periodo);
  });
  const { desde, hasta } = rangoDesdePeriodo(periodo);
  document.getElementById('filtroDesde').value = desde;
  document.getElementById('filtroHasta').value = hasta;
  cargarHistorialCompras();
}

function rangoDesdePeriodo(periodo) {
  const hoy = new Date();
  const hasta = hoy.toISOString().slice(0, 10);
  const inicio = new Date(hoy);
  if (periodo === '7d') inicio.setDate(inicio.getDate() - 6);
  else if (periodo === '30d') inicio.setDate(inicio.getDate() - 29);
  else if (periodo === 'mes') inicio.setDate(1);
  else if (periodo === '3m') inicio.setMonth(inicio.getMonth() - 3);
  else if (periodo === '6m') inicio.setMonth(inicio.getMonth() - 6);
  else if (periodo === '1y') inicio.setFullYear(inicio.getFullYear() - 1);
  return { desde: inicio.toISOString().slice(0, 10), hasta };
}

// ---- KPIs reales del período, comparados contra el período anterior de
// igual duración (una segunda consulta al mismo endpoint, sin inventar
// ningún dato) ----
async function cargarKpisCompras(desde, hasta) {
  const contenedor = document.getElementById('kpisCompras');
  if (!contenedor) return;

  let anterior = [];
  if (desde && hasta) {
    const msDia = 86400000;
    const dias = Math.round((new Date(hasta) - new Date(desde)) / msDia) + 1;
    const hastaAnterior = new Date(new Date(desde).getTime() - msDia).toISOString().slice(0, 10);
    const desdeAnterior = new Date(new Date(desde).getTime() - dias * msDia).toISOString().slice(0, 10);
    try {
      anterior = await API.obtener(`/api/compras/historial?desde=${desdeAnterior}&hasta=${hastaAnterior}`);
    } catch { anterior = []; }
  }

  pintarKpisCompras(historialEnMemoria, anterior);
}

function resumenCompras(lista) {
  return {
    total: lista.reduce((s, c) => s + Number(c.total || 0), 0),
    ordenes: lista.length,
    proveedores: new Set(lista.map(c => (c.proveedor || '').trim().toLowerCase()).filter(Boolean)).size,
    materiales: new Set(lista.map(c => c.material_id).filter(Boolean)).size
  };
}

function variacionPct(actual, previo) {
  if (!previo) return null;
  return Math.round(((actual - previo) / previo) * 100);
}

function pintarKpisCompras(listaActual, listaAnterior) {
  const contenedor = document.getElementById('kpisCompras');
  if (!contenedor) return;

  const actual = resumenCompras(listaActual);
  const previo = resumenCompras(listaAnterior);
  const hayComparacion = listaAnterior.length > 0;

  const ICONOS = {
    carrito: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 11.6a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L21 8H6"/>',
    caja: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
    camion: '<rect x="1" y="3" width="15" height="13"/><path d="M16 8h4l3 3v5h-7V8Z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/>',
    barras: '<line x1="12" y1="20" x2="12" y2="10"/><line x1="18" y1="20" x2="18" y2="4"/><line x1="6" y1="20" x2="6" y2="16"/>'
  };

  const tarjetas = [
    { icono: 'carrito', color: 'azul', etiqueta: 'Total de compras', valor: formatearPesos(actual.total), delta: variacionPct(actual.total, previo.total) },
    { icono: 'caja', color: 'verde', etiqueta: 'Órdenes de compra', valor: String(actual.ordenes), delta: variacionPct(actual.ordenes, previo.ordenes) },
    { icono: 'camion', color: 'morado', etiqueta: 'Proveedores', valor: String(actual.proveedores), delta: variacionPct(actual.proveedores, previo.proveedores) },
    { icono: 'barras', color: 'naranja', etiqueta: 'Materiales distintos', valor: String(actual.materiales), delta: variacionPct(actual.materiales, previo.materiales) }
  ];

  contenedor.innerHTML = tarjetas.map(t => {
    let deltaHtml = '';
    if (hayComparacion && t.delta != null) {
      const clase = t.delta >= 0 ? 'kpi-tarjeta__delta--positivo' : 'kpi-tarjeta__delta--negativo';
      const flecha = t.delta >= 0 ? '↑' : '↓';
      deltaHtml = `<span class="kpi-tarjeta__delta ${clase}">${flecha} ${Math.abs(t.delta)}% vs período anterior</span>`;
    }
    return `
    <div class="kpi-tarjeta">
      <span class="kpi-tarjeta__icono indicador__icono--${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[t.icono]}</svg></span>
      <span class="kpi-tarjeta__etiqueta">${t.etiqueta}</span>
      <span class="kpi-tarjeta__valor">${t.valor}</span>
      ${deltaHtml}
    </div>`;
  }).join('');
}

// ---- Compras recientes (últimas 5) ----
function pintarComprasRecientes() {
  const contenedor = document.getElementById('listaComprasRecientes');
  if (!contenedor) return;
  if (historialEnMemoria.length === 0) {
    contenedor.innerHTML = '<p class="tabla__vacio">Sin compras en este período.</p>';
    return;
  }
  const recientes = [...historialEnMemoria].sort((a, b) => b.fecha.localeCompare(a.fecha)).slice(0, 5);
  contenedor.innerHTML = recientes.map(c => `
    <div class="celda-cliente" style="justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--t-borde);">
      <span class="celda-cliente">${avatarTexto(c.materiales ? c.materiales.nombre : '?')}
        <span>
          <strong style="display:block;font-size:0.875rem;">${escaparHtml(c.materiales ? c.materiales.nombre : '—')}</strong>
          <span class="texto-secundario">${escaparHtml(c.proveedor)} · ${formatearFecha(c.fecha)}</span>
        </span>
      </span>
      <span style="text-align:right;">
        <strong style="display:block;">${formatearPesos(c.total)}</strong>
        <span class="etiqueta-estado etiqueta-estado--${c.estado === 'recibida' ? 'listo' : 'pendiente'}">${ETIQUETA_ESTADO_COMPRA[c.estado]}</span>
      </span>
    </div>`).join('');
}

// ---- Top proveedores por total comprado en el período ----
function pintarTopProveedores() {
  const contenedor = document.getElementById('listaTopProveedores');
  if (!contenedor) return;
  if (historialEnMemoria.length === 0) {
    contenedor.innerHTML = '<p class="tabla__vacio">Sin compras en este período.</p>';
    return;
  }
  const porProveedor = new Map();
  for (const c of historialEnMemoria) {
    const nombre = (c.proveedor || 'Sin proveedor').trim();
    porProveedor.set(nombre, (porProveedor.get(nombre) || 0) + Number(c.total || 0));
  }
  const top = [...porProveedor.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const maximo = top[0] ? top[0][1] : 1;

  contenedor.innerHTML = top.map(([nombre, total]) => `
    <div style="padding:8px 0;">
      <div style="display:flex;justify-content:space-between;font-size:0.875rem;margin-bottom:6px;">
        <span>${escaparHtml(nombre)}</span>
        <strong>${formatearPesos(total)}</strong>
      </div>
      <div class="barra-progreso"><div class="barra-progreso__relleno" style="width:${Math.round((total / maximo) * 100)}%"></div></div>
    </div>`).join('');
}

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function formatearFechaCorta(fecha) {
  if (!fecha) return '—';
  return new Date(fecha + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  cargarPendientesCompra();
  aplicarPeriodoCompras('mes');
});