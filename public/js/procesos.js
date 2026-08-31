// ============================================================
// procesos.js — pestaña Procesos
// Cada proceso pertenece a una ficha técnica (producto). Su costo se
// calcula solo (tiempo_minutos × precio de hora global) — no se
// escribe a mano. Al guardar, el backend recalcula automáticamente
// los minutos de fabricación y el costo de la ficha técnica dueña.
// ============================================================

let procesosEnMemoria = [];
let productosParaProceso = [];       // fichas técnicas disponibles (para los selectores)
let materialesParaProceso = [];      // catálogo de materiales (para armar la lista del proceso)
let filasMaterialesProcesoEnEdicion = []; // [{ material_id, nombre, unidad, cantidad }]
let costoMinutoGlobalProceso = 0;

// ---- Carga inicial: fichas técnicas + materiales (para selectores) ----
async function cargarDatosBaseProcesos() {
  try {
    const [productos, materiales, config] = await Promise.all([
      API.obtener('/api/productos'),
      API.obtener('/api/materiales'),
      API.obtener('/api/configuracion/produccion')
    ]);
    productosParaProceso = productos;
    materialesParaProceso = materiales;
    costoMinutoGlobalProceso = Number(config.costo_hora_mano_obra || 0) / 60;
  } catch (err) {
    mostrarAviso('No se pudieron cargar fichas técnicas/materiales: ' + err.message, 'error');
    productosParaProceso = [];
    materialesParaProceso = [];
  }

  const opcionesProducto = productosParaProceso.map(p => `<option value="${p.id}">${escaparHtml(p.nombre)}</option>`).join('');
  document.getElementById('selectorProductoProceso').innerHTML = opcionesProducto;

  const filtro = document.getElementById('filtroProductoProcesos');
  filtro.innerHTML = '<option value="">Todas</option>' + opcionesProducto;

  document.getElementById('selectorMaterialProceso').innerHTML = materialesParaProceso
    .map(m => `<option value="${m.id}">${escaparHtml(m.nombre)} (${escaparHtml(m.unidad)})</option>`).join('');
}

// ---- Búsqueda de materiales dentro del selector (la lista puede ser larga) ----
function normalizarTexto(texto) {
  return (texto ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function filtrarMaterialesProceso() {
  const texto = normalizarTexto(document.getElementById('buscadorMaterialProceso').value);
  const selector = document.getElementById('selectorMaterialProceso');
  const seleccionActual = selector.value;

  const filtrados = texto
    ? materialesParaProceso.filter(m => normalizarTexto(m.nombre).includes(texto) || normalizarTexto(m.unidad).includes(texto))
    : materialesParaProceso;

  if (filtrados.length === 0) {
    selector.innerHTML = '<option value="">Sin resultados</option>';
    return;
  }

  selector.innerHTML = filtrados
    .map(m => `<option value="${m.id}">${escaparHtml(m.nombre)} (${escaparHtml(m.unidad)})</option>`).join('');

  // Si el material que ya estaba elegido sigue en la lista filtrada, se mantiene seleccionado.
  if (filtrados.some(m => m.id === seleccionActual)) selector.value = seleccionActual;
}

// ---- 1. Lista de procesos ----
async function cargarListaProcesos() {
  const cuerpo = document.getElementById('cuerpoTablaProcesos');
  cuerpo.innerHTML = '<tr><td colspan="6" class="tabla__vacio">Cargando…</td></tr>';
  try {
    const productoId = document.getElementById('filtroProductoProcesos').value;
    const url = '/api/procesos' + (productoId ? `?producto_id=${productoId}` : '');
    procesosEnMemoria = await API.obtener(url);
    pintarListaProcesos(procesosEnMemoria);
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function pintarListaProcesos(lista) {
  const cuerpo = document.getElementById('cuerpoTablaProcesos');
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">Aún no hay procesos. Agrega el primero con el botón de arriba.</td></tr>';
    return;
  }
  cuerpo.innerHTML = lista.map(p => {
    const repeticiones = Number(p.repeticiones_por_unidad || 1);
    const costoPorEjecucion = Number(p.costo_unitario) + Number(p.costo_materiales || 0);
    return `
    <tr>
      <td>${p.orden != null ? p.orden : '—'}</td>
      <td>${p.productos ? escaparHtml(p.productos.nombre) : '—'}</td>
      <td>${escaparHtml(p.nombre)}</td>
      <td>${repeticiones > 1 ? `×${repeticiones}` : '—'}</td>
      <td>${p.tiempo_minutos} min</td>
      <td>${(p.procesos_materiales || []).map(m => `${m.cantidad} ${escaparHtml(m.materiales.unidad)} de ${escaparHtml(m.materiales.nombre)}`).join(', ') || '—'}</td>
      <td>${formatearPesos(costoPorEjecucion)}${repeticiones > 1 ? ` × ${repeticiones} = ${formatearPesos(costoPorEjecucion * repeticiones)}` : ''}</td>
      <td class="tabla__acciones">
        <button type="button" class="boton boton--pequeno" onclick="abrirFormularioProceso('${p.id}')">Editar</button>
        <button type="button" class="boton boton--pequeno boton--peligro" onclick="eliminarProceso('${p.id}')">Eliminar</button>
      </td>
    </tr>`;
  }).join('');
}

// ---- 2. Formulario nuevo / editar ----
function abrirFormularioProceso(id) {
  const modal = document.getElementById('modalProceso');
  const titulo = document.getElementById('tituloFormularioProceso');

  document.getElementById('buscadorMaterialProceso').value = '';
  filtrarMaterialesProceso();

  if (productosParaProceso.length === 0) {
    mostrarAviso('Primero crea al menos una ficha técnica en Productos — un proceso siempre debe pertenecer a una.', 'error');
    return;
  }

  filasMaterialesProcesoEnEdicion = [];
  document.getElementById('selectorUnidadTiempoProceso').value = 'minutos';

  if (id) {
    const p = procesosEnMemoria.find(x => x.id === id);
    if (!p) return;
    titulo.textContent = 'Editar proceso';
    document.getElementById('campoProcesoId').value = p.id;
    document.getElementById('selectorProductoProceso').value = p.producto_id;
    document.getElementById('campoNombreProceso').value = p.nombre;
    document.getElementById('campoOrdenProceso').value = p.orden != null ? p.orden : '';
    document.getElementById('campoTiempoProceso').value = p.tiempo_minutos;
    document.getElementById('campoRepeticionesProceso').value = p.repeticiones_por_unidad || 1;
    document.getElementById('campoDescripcionProceso').value = p.descripcion || '';
    filasMaterialesProcesoEnEdicion = (p.procesos_materiales || []).map(m => ({
      material_id: m.materiales.id, nombre: m.materiales.nombre, unidad: m.materiales.unidad, cantidad: m.cantidad
    }));
  } else {
    titulo.textContent = 'Nuevo proceso';
    document.getElementById('campoProcesoId').value = '';
    document.getElementById('campoNombreProceso').value = '';
    document.getElementById('campoOrdenProceso').value = '';
    document.getElementById('campoTiempoProceso').value = '';
    document.getElementById('campoRepeticionesProceso').value = 1;
    document.getElementById('campoDescripcionProceso').value = '';
    const productoPreseleccionado = document.getElementById('filtroProductoProcesos').value;
    document.getElementById('selectorProductoProceso').value = productoPreseleccionado || productosParaProceso[0].id;
  }

  pintarMaterialesProceso();
  calcularCostoProcesoEnVivo();
  modal.hidden = false;
}

function cerrarFormularioProceso() {
  document.getElementById('modalProceso').hidden = true;
}

// ---- Materiales del proceso en construcción ----
function agregarMaterialAProceso() {
  const materialId = document.getElementById('selectorMaterialProceso').value;
  const cantidad = Number(document.getElementById('cantidadMaterialProceso').value);
  if (!materialId) { mostrarAviso('Elige un material', 'error'); return; }
  if (!cantidad || cantidad <= 0) { mostrarAviso('La cantidad debe ser mayor a 0', 'error'); return; }

  const material = materialesParaProceso.find(m => m.id === materialId);
  if (!material) return;

  const existente = filasMaterialesProcesoEnEdicion.find(f => f.material_id === materialId);
  if (existente) existente.cantidad = cantidad;
  else filasMaterialesProcesoEnEdicion.push({ material_id: materialId, nombre: material.nombre, unidad: material.unidad, cantidad });

  document.getElementById('cantidadMaterialProceso').value = '';
  pintarMaterialesProceso();
  calcularCostoProcesoEnVivo();
}

function quitarMaterialDeProceso(materialId) {
  filasMaterialesProcesoEnEdicion = filasMaterialesProcesoEnEdicion.filter(f => f.material_id !== materialId);
  pintarMaterialesProceso();
  calcularCostoProcesoEnVivo();
}

function pintarMaterialesProceso() {
  const cuerpo = document.getElementById('cuerpoMaterialesProceso');
  if (filasMaterialesProcesoEnEdicion.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Sin materiales agregados</td></tr>';
    return;
  }
  cuerpo.innerHTML = filasMaterialesProcesoEnEdicion.map(f => `
    <tr>
      <td>${escaparHtml(f.nombre)}</td>
      <td>${f.cantidad} ${escaparHtml(f.unidad)}</td>
      <td><button type="button" class="boton boton--pequeno boton--peligro" onclick="quitarMaterialDeProceso('${f.material_id}')">Quitar</button></td>
    </tr>`).join('');
}

// ---- Tiempo ingresado → siempre en minutos (segundos se dividen entre 60) ----
function tiempoProcesoEnMinutos() {
  const valor = Number(document.getElementById('campoTiempoProceso').value || 0);
  const unidad = document.getElementById('selectorUnidadTiempoProceso').value;
  return unidad === 'segundos' ? valor / 60 : valor;
}

// ---- Costo en vivo: (mano de obra + materiales) × repeticiones por unidad ----
function calcularCostoProcesoEnVivo() {
  const minutos = tiempoProcesoEnMinutos();
  const repeticiones = Number(document.getElementById('campoRepeticionesProceso').value || 1);
  const costoManoObra = minutos * costoMinutoGlobalProceso;
  const costoMateriales = filasMaterialesProcesoEnEdicion.reduce((s, f) => {
    const material = materialesParaProceso.find(m => m.id === f.material_id);
    return s + (material ? Number(material.costo_unitario) * Number(f.cantidad) : 0);
  }, 0);
  const costoPorEjecucion = costoManoObra + costoMateriales;
  document.getElementById('resumenPrecioHoraProceso').textContent = formatearPesos(costoMinutoGlobalProceso * 60);
  document.getElementById('resumenCostoProceso').textContent = repeticiones > 1
    ? `${formatearPesos(costoPorEjecucion * repeticiones)} — ${formatearPesos(costoPorEjecucion)} por ejecución × ${repeticiones} (mano de obra ${formatearPesos(costoManoObra)} + materiales ${formatearPesos(costoMateriales)}, por ejecución)`
    : `${formatearPesos(costoPorEjecucion)} (mano de obra ${formatearPesos(costoManoObra)} + materiales ${formatearPesos(costoMateriales)})`;
}

// ---- Guardar ----
async function guardarProceso() {
  const id = document.getElementById('campoProcesoId').value;
  const valorOrden = document.getElementById('campoOrdenProceso').value;
  const datos = {
    producto_id: document.getElementById('selectorProductoProceso').value,
    nombre: document.getElementById('campoNombreProceso').value,
    orden: valorOrden !== '' ? Number(valorOrden) : null,
    tiempo_minutos: tiempoProcesoEnMinutos(),
    repeticiones_por_unidad: document.getElementById('campoRepeticionesProceso').value || 1,
    descripcion: document.getElementById('campoDescripcionProceso').value,
    materiales: filasMaterialesProcesoEnEdicion.map(f => ({ material_id: f.material_id, cantidad: f.cantidad }))
  };

  if (!datos.producto_id) { mostrarAviso('Elige a qué ficha técnica pertenece este proceso', 'error'); return; }
  if (!datos.nombre.trim()) { mostrarAviso('El nombre del proceso es obligatorio', 'error'); return; }
  if (!datos.tiempo_minutos || Number(datos.tiempo_minutos) <= 0) {
    mostrarAviso('El tiempo del proceso debe ser mayor a 0', 'error');
    return;
  }
  if (!datos.repeticiones_por_unidad || Number(datos.repeticiones_por_unidad) <= 0) {
    mostrarAviso('Las repeticiones por unidad deben ser mayor a 0', 'error');
    return;
  }

  try {
    if (id) {
      await API.actualizar(`/api/procesos/${id}`, datos);
      mostrarAviso('Proceso actualizado — la ficha técnica se recalculó');
    } else {
      await API.enviar('/api/procesos', datos);
      mostrarAviso('Proceso creado — la ficha técnica se recalculó');
    }
    cerrarFormularioProceso();
    cargarListaProcesos();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Eliminar ----
async function eliminarProceso(id) {
  const p = procesosEnMemoria.find(x => x.id === id);
  if (!p) return;
  const confirmado = confirm(`¿Eliminar el proceso "${p.nombre}"? La ficha técnica se recalculará sin él.`);
  if (!confirmado) return;

  try {
    await API.eliminar(`/api/procesos/${id}`);
    mostrarAviso('Proceso eliminado — la ficha técnica se recalculó');
    cargarListaProcesos();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
  await cargarDatosBaseProcesos();
  cargarListaProcesos();
});