// ============================================================
// materiales.js — pestaña Materiales
// Usa /api/inventario/materiales (no /api/materiales) porque esa
// vista ya trae, calculado en el servidor, el punto de reorden y el
// semáforo de estado (rojo/amarillo/verde) — lo mismo que usa Compras
// para armar sus sugerencias. Así el estado que se ve acá es real,
// no un color puesto a mano en el front.
// ============================================================

let materialesEnMemoria = [];
let filtroEstadoActivo = ''; // '', 'verde', 'amarillo', 'rojo'
let paginaMateriales = 1;
let filasPorPaginaMateriales = 10;

const ETIQUETA_ESTADO_MATERIAL = { verde: 'En stock', amarillo: 'Stock bajo', rojo: 'Stock bajo' };

// ---- 1. Lista ----
async function cargarListaMateriales() {
  const cuerpo = document.getElementById('cuerpoTablaMateriales');
  try {
    materialesEnMemoria = await API.obtener('/api/inventario/materiales');
    poblarFiltroProveedores();
    pintarKpisMateriales();
    buscarMateriales();
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="9" class="tabla__vacio">No se pudo cargar la lista: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function poblarFiltroProveedores() {
  const selector = document.getElementById('filtroProveedorMaterial');
  const actual = selector.value;
  const proveedores = [...new Set(materialesEnMemoria.map(m => m.proveedor).filter(Boolean))].sort();
  selector.innerHTML = '<option value="">Todos</option>' +
    proveedores.map(p => `<option value="${escaparHtml(p)}">${escaparHtml(p)}</option>`).join('');
  if (proveedores.includes(actual)) selector.value = actual;
}

// ---- KPIs reales (sin comparación "vs mes anterior": esta lista es una
// foto del inventario actual, no hay un histórico de esos totales guardado) ----
function pintarKpisMateriales() {
  const contenedor = document.getElementById('kpisMateriales');
  if (!contenedor) return;

  const total = materialesEnMemoria.length;
  const stockTotal = materialesEnMemoria.reduce((s, m) => s + Number(m.stock_actual || 0), 0);
  const costoInventario = materialesEnMemoria.reduce((s, m) => s + Number(m.stock_actual || 0) * Number(m.costo_unitario || 0), 0);
  const stockBajo = materialesEnMemoria.filter(m => m.estado !== 'verde').length;

  const ICONOS = {
    caja: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
    capas: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>',
    carrito: '<circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 3h2l2.6 12.4a2 2 0 0 0 2 1.6h9a2 2 0 0 0 2-1.6L22 7H6"/>',
    alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
  };

  const tarjetas = [
    { icono: 'caja', color: 'azul', etiqueta: 'Total de materiales', valor: String(total) },
    { icono: 'capas', color: 'verde', etiqueta: 'Stock total', valor: stockTotal.toLocaleString('es-CO') },
    { icono: 'carrito', color: 'morado', etiqueta: 'Costo en inventario', valor: formatearPesos(costoInventario) },
    { icono: 'alerta', color: 'naranja', etiqueta: 'Materiales con stock bajo', valor: String(stockBajo) }
  ];

  contenedor.innerHTML = tarjetas.map(t => `
    <div class="kpi-tarjeta">
      <span class="kpi-tarjeta__icono indicador__icono--${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[t.icono]}</svg></span>
      <span class="kpi-tarjeta__etiqueta">${t.etiqueta}</span>
      <span class="kpi-tarjeta__valor">${t.valor}</span>
    </div>`).join('');
}

// ---- Búsqueda + filtros (proveedor, estado) + buscador de la barra superior ----
function buscarMateriales() {
  paginaMateriales = 1;
  pintarListaMaterialesFiltrada();
}

// Conecta el buscador de la barra superior (tema.js) con este filtro local.
window.buscarDesdeTopbar = function (texto) {
  document.getElementById('buscadorMateriales').value = texto;
  buscarMateriales();
};

function limpiarFiltrosMateriales() {
  document.getElementById('buscadorMateriales').value = '';
  document.getElementById('filtroProveedorMaterial').value = '';
  document.getElementById('filtroEstadoMaterial').value = '';
  buscarMateriales();
}

function pintarListaMaterialesFiltrada() {
  const texto = normalizarTexto(document.getElementById('buscadorMateriales').value);
  const proveedor = document.getElementById('filtroProveedorMaterial').value;
  const estado = document.getElementById('filtroEstadoMaterial').value;

  let lista = materialesEnMemoria;
  if (texto) lista = lista.filter(m => normalizarTexto(m.nombre).includes(texto) || normalizarTexto(m.proveedor).includes(texto));
  if (proveedor) lista = lista.filter(m => m.proveedor === proveedor);
  if (estado) lista = lista.filter(m => m.estado === estado);

  pintarListaMateriales(lista);
}

function pintarListaMateriales(lista) {
  const cuerpo = document.getElementById('cuerpoTablaMateriales');

  if (materialesEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="9" class="tabla__vacio">Aún no hay materiales. Agrega el primero con el botón de arriba.</td></tr>';
    document.getElementById('paginacionMateriales').innerHTML = '';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="9" class="tabla__vacio">Ningún material coincide con la búsqueda o los filtros.</td></tr>';
    document.getElementById('paginacionMateriales').innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / filasPorPaginaMateriales));
  if (paginaMateriales > totalPaginas) paginaMateriales = totalPaginas;
  const inicio = (paginaMateriales - 1) * filasPorPaginaMateriales;
  const paginaActual = lista.slice(inicio, inicio + filasPorPaginaMateriales);

  cuerpo.innerHTML = paginaActual.map(m => `
    <tr>
      <td><strong>${escaparHtml(m.nombre)}</strong></td>
      <td>${escaparHtml(m.unidad)}</td>
      <td>${formatearPesos(m.costo_unitario)}</td>
      <td>${escaparHtml(m.proveedor)}</td>
      <td>${celdaStockMaterial(m)}</td>
      <td>${Number(m.punto_reorden).toLocaleString('es-CO')}</td>
      <td>${m.tiempo_entrega_dias}</td>
      <td><span class="etiqueta-estado etiqueta-estado--${claseEstadoMaterial(m)}">${etiquetaEstadoMaterial(m)}</span></td>
      <td>${accionesMaterial(m)}</td>
    </tr>`).join('');

  pintarPaginacionMateriales(lista.length, totalPaginas);
}

function claseEstadoMaterial(m) {
  if (m.estado === 'verde') return 'listo';
  if (m.estado === 'amarillo') return 'pendiente';
  return Number(m.stock_actual) <= 0 ? 'critico' : 'pendiente';
}

function etiquetaEstadoMaterial(m) {
  if (m.estado === 'rojo' && Number(m.stock_actual) <= 0) return 'Sin stock';
  return ETIQUETA_ESTADO_MATERIAL[m.estado] || m.estado;
}

function celdaStockMaterial(m) {
  const stock = Number(m.stock_actual);
  const objetivo = Math.max(Number(m.punto_reorden) * 2, 1);
  const porcentaje = Math.max(0, Math.min(100, Math.round((stock / objetivo) * 100)));
  const color = m.estado === 'verde' ? 'var(--t-exito)' : (m.estado === 'amarillo' ? 'var(--t-advertencia)' : 'var(--t-peligro)');
  return `
    <div>${stock.toLocaleString('es-CO')}</div>
    <div class="barra-progreso" style="height:5px;margin-top:4px;">
      <div class="barra-progreso__relleno" style="width:${porcentaje}%;background:${color};"></div>
    </div>`;
}

const ICONO_HISTORIAL = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';
const ICONO_LAPIZ_MATERIAL = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>';
const ICONO_BASURA_MATERIAL = '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';

function accionesMaterial(m) {
  return `<span class="acciones-fila">
    <button type="button" onclick="verHistorialPrecio('${m.id}')" title="Historial de precio"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_HISTORIAL}</svg></button>
    <button type="button" onclick="abrirFormularioMaterial('${m.id}')" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_LAPIZ_MATERIAL}</svg></button>
    <button type="button" class="acciones-fila__peligro" onclick="eliminarMaterial('${m.id}')" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_BASURA_MATERIAL}</svg></button>
  </span>`;
}

// ---- Paginación ----
function pintarPaginacionMateriales(totalFilas, totalPaginas) {
  const contenedor = document.getElementById('paginacionMateriales');
  const inicio = totalFilas === 0 ? 0 : (paginaMateriales - 1) * filasPorPaginaMateriales + 1;
  const fin = Math.min(paginaMateriales * filasPorPaginaMateriales, totalFilas);

  const botones = [];
  for (let p = 1; p <= totalPaginas; p++) {
    botones.push(`<button type="button" class="${p === paginaMateriales ? 'paginacion__botones--activa' : ''}" onclick="irAPaginaMateriales(${p})">${p}</button>`);
  }

  contenedor.innerHTML = `
    <span>Mostrando ${inicio} a ${fin} de ${totalFilas} materiales</span>
    <span class="paginacion__selector">
      Filas por página
      <select onchange="cambiarFilasPorPaginaMateriales(this.value)">
        ${[10, 20, 50, 100].map(n => `<option value="${n}" ${n === filasPorPaginaMateriales ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </span>
    <span class="paginacion__botones">
      <button type="button" onclick="irAPaginaMateriales(${paginaMateriales - 1})" ${paginaMateriales <= 1 ? 'disabled' : ''}>‹</button>
      ${botones.join('')}
      <button type="button" onclick="irAPaginaMateriales(${paginaMateriales + 1})" ${paginaMateriales >= totalPaginas ? 'disabled' : ''}>›</button>
    </span>`;
}

function irAPaginaMateriales(pagina) {
  paginaMateriales = pagina;
  pintarListaMaterialesFiltrada();
}

function cambiarFilasPorPaginaMateriales(valor) {
  filasPorPaginaMateriales = Number(valor);
  paginaMateriales = 1;
  pintarListaMaterialesFiltrada();
}

// ---- 2. Formulario nuevo / editar ----
function abrirFormularioMaterial(id) {
  const modal = document.getElementById('modalMaterial');
  const titulo = document.getElementById('tituloFormulario');
  const grupoStockInicial = document.getElementById('grupoStockInicial');

  if (id) {
    const m = materialesEnMemoria.find(x => x.id === id);
    if (!m) return;
    titulo.textContent = 'Editar material';
    document.getElementById('campoId').value = m.id;
    document.getElementById('campoNombre').value = m.nombre;
    document.getElementById('campoUnidad').value = m.unidad;
    document.getElementById('campoCosto').value = m.costo_unitario;
    document.getElementById('campoProveedor').value = m.proveedor;
    document.getElementById('campoEntrega').value = m.tiempo_entrega_dias;
    document.getElementById('campoStockSeguridad').value = m.stock_seguridad;
    grupoStockInicial.hidden = true; // el stock se ajusta desde Inventario, no aquí
  } else {
    titulo.textContent = 'Nuevo material';
    document.getElementById('campoId').value = '';
    ['campoNombre','campoUnidad','campoCosto','campoProveedor'].forEach(c => document.getElementById(c).value = '');
    document.getElementById('campoEntrega').value = 1;
    document.getElementById('campoStockSeguridad').value = 0;
    document.getElementById('campoStockInicial').value = 0;
    grupoStockInicial.hidden = false;
  }
  modal.hidden = false;
}

function cerrarFormularioMaterial() {
  document.getElementById('modalMaterial').hidden = true;
}

async function guardarMaterial() {
  const id = document.getElementById('campoId').value;
  const datos = {
    nombre: document.getElementById('campoNombre').value,
    unidad: document.getElementById('campoUnidad').value,
    costo_unitario: document.getElementById('campoCosto').value,
    proveedor: document.getElementById('campoProveedor').value,
    tiempo_entrega_dias: document.getElementById('campoEntrega').value,
    stock_seguridad: document.getElementById('campoStockSeguridad').value
  };

  if (!datos.nombre.trim() || !datos.unidad.trim() || datos.costo_unitario === '' || !datos.proveedor.trim()) {
    mostrarAviso('Completa los campos obligatorios: nombre, unidad, costo y proveedor', 'error');
    return;
  }

  try {
    if (id) {
      const resultado = await API.actualizar(`/api/materiales/${id}`, datos);
      if (resultado.productos_recalculados > 0) {
        mostrarAviso(`Material actualizado. Se recalculó el costo de ${resultado.productos_recalculados} producto(s).`);
      } else {
        mostrarAviso('Material actualizado');
      }
    } else {
      datos.stock_actual = document.getElementById('campoStockInicial').value;
      await API.enviar('/api/materiales', datos);
      mostrarAviso('Material creado');
    }
    cerrarFormularioMaterial();
    cargarListaMateriales();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Eliminar ----
async function eliminarMaterial(id) {
  const m = materialesEnMemoria.find(x => x.id === id);
  if (!m) return;
  const confirmado = confirm(`¿Eliminar "${m.nombre}"? Esta acción no se puede deshacer.`);
  if (!confirmado) return;

  try {
    await API.eliminar(`/api/materiales/${id}`);
    mostrarAviso('Material eliminado');
    cargarListaMateriales();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 3. Historial de precios ----
async function verHistorialPrecio(id) {
  const m = materialesEnMemoria.find(x => x.id === id);
  const modal = document.getElementById('modalHistorial');
  const contenido = document.getElementById('contenidoHistorial');
  document.getElementById('tituloHistorial').textContent = `Historial de precios — ${m ? m.nombre : ''}`;
  contenido.innerHTML = '<p>Cargando…</p>';
  modal.hidden = false;

  try {
    const historial = await API.obtener(`/api/materiales/${id}/historial-precio`);
    if (historial.length === 0) {
      contenido.innerHTML = '<p class="tabla__vacio">Este material no ha tenido cambios de precio todavía.</p>';
      return;
    }
    contenido.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Fecha</th><th>Precio anterior</th><th>Precio nuevo</th><th>Origen</th></tr></thead>
        <tbody>
          ${historial.map(h => `
            <tr>
              <td>${new Date(h.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td>${formatearPesos(h.costo_anterior)}</td>
              <td>${formatearPesos(h.costo_nuevo)}</td>
              <td>${h.origen === 'compra' ? 'Compra registrada' : 'Edición manual'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    contenido.innerHTML = `<p class="tabla__vacio">Error: ${escaparHtml(err.message)}</p>`;
  }
}

function cerrarHistorial() {
  document.getElementById('modalHistorial').hidden = true;
}

function normalizarTexto(texto) {
  return (texto ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', cargarListaMateriales);