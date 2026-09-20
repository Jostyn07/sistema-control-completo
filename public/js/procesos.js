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

  filtrarSelectorFichaProcesos();
  filtrarMaterialesProceso();
}

// ---- Búsqueda (input separado que filtra un <select>, en vivo) ----
function normalizarTexto(texto) {
  return (texto ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function filtrarSelectorFichaProcesos() {
  const texto = normalizarTexto(document.getElementById('buscadorFiltroFichaProcesos').value);
  const selector = document.getElementById('filtroProductoProcesos');
  const seleccionActual = selector.value;

  const filtrados = texto
    ? productosParaProceso.filter(p => normalizarTexto(p.nombre).includes(texto))
    : productosParaProceso;

  selector.innerHTML = '<option value="">Todas</option>' +
    filtrados.map(p => `<option value="${p.id}">${escaparHtml(p.nombre)}</option>`).join('');

  const sigueDisponible = seleccionActual === '' || filtrados.some(p => p.id === seleccionActual);
  selector.value = sigueDisponible ? seleccionActual : '';
  if (!sigueDisponible) cargarListaProcesos(); // la selección cambió de verdad — hay que refrescar la tabla
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

// ---- Checklist de fichas técnicas al CREAR un proceso (varias a la vez) ----
function pintarListaFichasProcesoNuevo() {
  const texto = normalizarTexto(document.getElementById('buscadorFichasProcesoNuevo').value);
  const contenedor = document.getElementById('listaFichasProcesoNuevo');

  const filtrados = texto
    ? productosParaProceso.filter(p => normalizarTexto(p.nombre).includes(texto))
    : productosParaProceso;

  if (filtrados.length === 0) {
    contenedor.innerHTML = '<p class="texto-secundario" style="margin:4px 0">Sin resultados</p>';
    return;
  }

  contenedor.innerHTML = filtrados.map(p => `
    <label style="display:flex;align-items:center;gap:8px;padding:4px 0;cursor:pointer">
      <input type="checkbox" value="${p.id}" ${idsProductosSeleccionadosNuevoProceso.has(p.id) ? 'checked' : ''}
        onchange="alternarProductoProcesoNuevo('${p.id}', this.checked)">
      ${escaparHtml(p.nombre)}
    </label>`).join('');
}

function alternarProductoProcesoNuevo(productoId, marcado) {
  if (marcado) idsProductosSeleccionadosNuevoProceso.add(productoId);
  else idsProductosSeleccionadosNuevoProceso.delete(productoId);
}
// ---- 1. Lista de procesos ----
let paginaProcesos = 1;
let filasPorPaginaProcesos = 10;

async function cargarListaProcesos() {
  const cuerpo = document.getElementById('cuerpoTablaProcesos');
  cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">Cargando…</td></tr>';
  try {
    const productoId = document.getElementById('filtroProductoProcesos').value;
    const url = '/api/procesos' + (productoId ? `?producto_id=${productoId}` : '');
    procesosEnMemoria = await API.obtener(url);
    paginaProcesos = 1;
    pintarKpisProcesos();
    pintarListaProcesosFiltrada();
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="8" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function costoTotalProceso(p) {
  const repeticiones = Number(p.repeticiones_por_unidad || 1);
  const costoPorEjecucion = Number(p.costo_unitario || 0) + Number(p.costo_materiales || 0);
  return costoPorEjecucion * repeticiones;
}

// Sin "% vs. mes anterior": estos totales son del estado actual de las
// fichas técnicas, no hay un histórico guardado de estos números.
function pintarKpisProcesos() {
  const contenedor = document.getElementById('kpisProcesos');
  if (!contenedor) return;

  const total = procesosEnMemoria.length;
  const tiempoPromedio = total ? procesosEnMemoria.reduce((s, p) => s + Number(p.tiempo_minutos || 0), 0) / total : 0;
  const costoPromedio = total ? procesosEnMemoria.reduce((s, p) => s + costoTotalProceso(p), 0) / total : 0;

  const porProducto = new Map();
  for (const p of procesosEnMemoria) {
    if (!p.productos) continue;
    porProducto.set(p.productos.nombre, (porProducto.get(p.productos.nombre) || 0) + 1);
  }
  let productoConMasPasos = null, maxPasos = 0;
  for (const [nombre, cantidad] of porProducto) {
    if (cantidad > maxPasos) { maxPasos = cantidad; productoConMasPasos = nombre; }
  }

  const ICONOS = {
    engranaje: '<circle cx="12" cy="6" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M12 8.2v3.3M12 11.5 6.6 16M12 11.5 17.4 16"/>',
    reloj: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    moneda: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5a2.5 2 0 0 1 2.5-1.5c1.5 0 2.5.8 2.5 2s-1 1.7-2.5 2-2.5.8-2.5 2 1 2 2.5 2a2.5 2 0 0 0 2.5-1.5"/>',
    capas: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'
  };

  const tarjetas = [
    { icono: 'engranaje', color: 'azul', etiqueta: 'Total de procesos', valor: String(total) },
    { icono: 'reloj', color: 'verde', etiqueta: 'Tiempo promedio', valor: `${tiempoPromedio.toFixed(2)} min` },
    { icono: 'moneda', color: 'naranja', etiqueta: 'Costo promedio', valor: formatearPesos(Math.round(costoPromedio)) },
    { icono: 'capas', color: 'morado', etiqueta: 'Ficha técnica con más pasos', valor: productoConMasPasos ? `${escaparHtml(productoConMasPasos)}` : '—', extra: productoConMasPasos ? `${maxPasos} proceso(s)` : '' }
  ];

  contenedor.innerHTML = tarjetas.map(t => `
    <div class="kpi-tarjeta">
      <span class="kpi-tarjeta__icono indicador__icono--${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[t.icono]}</svg></span>
      <span class="kpi-tarjeta__etiqueta">${t.etiqueta}</span>
      <span class="kpi-tarjeta__valor" style="font-size:${t.extra !== undefined ? '1.1rem' : ''}">${t.valor}</span>
      ${t.extra ? `<span class="kpi-tarjeta__delta">${t.extra}</span>` : ''}
    </div>`).join('');
}

function pintarListaProcesosFiltrada() {
  const texto = normalizarTexto(document.getElementById('buscadorNombreProceso').value);
  const orden = document.getElementById('ordenProcesos').value;

  let lista = procesosEnMemoria;
  if (texto) lista = lista.filter(p => normalizarTexto(p.nombre).includes(texto));

  lista = [...lista];
  if (orden === 'nombre') lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  else if (orden === 'tiempo_desc') lista.sort((a, b) => Number(b.tiempo_minutos) - Number(a.tiempo_minutos));
  else if (orden === 'costo_desc') lista.sort((a, b) => costoTotalProceso(b) - costoTotalProceso(a));
  else lista.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));

  pintarListaProcesos(lista);
}

// Conecta el buscador de la barra superior (tema.js) con el de esta página.
window.buscarDesdeTopbar = function (texto) {
  document.getElementById('buscadorNombreProceso').value = texto;
  pintarListaProcesosFiltrada();
};

const ICONO_LAPIZ_PROCESO = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>';
const ICONO_BASURA_PROCESO = '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';

function pintarListaProcesos(lista) {
  const cuerpo = document.getElementById('cuerpoTablaProcesos');
  if (procesosEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">Aún no hay procesos. Agrega el primero con el botón de arriba.</td></tr>';
    document.getElementById('paginacionProcesos').innerHTML = '';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">Ningún proceso coincide con la búsqueda.</td></tr>';
    document.getElementById('paginacionProcesos').innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / filasPorPaginaProcesos));
  if (paginaProcesos > totalPaginas) paginaProcesos = totalPaginas;
  const inicio = (paginaProcesos - 1) * filasPorPaginaProcesos;
  const paginaActual = lista.slice(inicio, inicio + filasPorPaginaProcesos);

  cuerpo.innerHTML = paginaActual.map(p => {
    const repeticiones = Number(p.repeticiones_por_unidad || 1);
    const costoPorEjecucion = Number(p.costo_unitario) + Number(p.costo_materiales || 0);
    return `
    <tr>
      <td>${p.orden != null ? p.orden : '—'}</td>
      <td>${p.productos ? escaparHtml(p.productos.nombre) : '—'}</td>
      <td><strong>${escaparHtml(p.nombre)}</strong></td>
      <td>${repeticiones > 1 ? `×${repeticiones}` : '—'}</td>
      <td>${p.tiempo_minutos} min</td>
      <td>${(p.procesos_materiales || []).map(m => `${m.cantidad} ${escaparHtml(m.materiales.unidad)} de ${escaparHtml(m.materiales.nombre)}`).join(', ') || '—'}</td>
      <td>${formatearPesos(costoPorEjecucion)}${repeticiones > 1 ? ` × ${repeticiones} = ${formatearPesos(costoPorEjecucion * repeticiones)}` : ''}</td>
      <td><span class="acciones-fila">
        <button type="button" onclick="abrirFormularioProceso('${p.id}')" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_LAPIZ_PROCESO}</svg></button>
        <button type="button" class="acciones-fila__peligro" onclick="eliminarProceso('${p.id}')" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_BASURA_PROCESO}</svg></button>
      </span></td>
    </tr>`;
  }).join('');

  pintarPaginacionProcesos(lista.length, totalPaginas);
}

function pintarPaginacionProcesos(totalFilas, totalPaginas) {
  const contenedor = document.getElementById('paginacionProcesos');
  const inicio = totalFilas === 0 ? 0 : (paginaProcesos - 1) * filasPorPaginaProcesos + 1;
  const fin = Math.min(paginaProcesos * filasPorPaginaProcesos, totalFilas);

  const botones = [];
  for (let p = 1; p <= totalPaginas; p++) {
    botones.push(`<button type="button" class="${p === paginaProcesos ? 'paginacion__botones--activa' : ''}" onclick="irAPaginaProcesos(${p})">${p}</button>`);
  }

  contenedor.innerHTML = `
    <span>Mostrando ${inicio} a ${fin} de ${totalFilas} procesos</span>
    <span class="paginacion__selector">
      Filas por página
      <select onchange="cambiarFilasPorPaginaProcesos(this.value)">
        ${[10, 20, 50].map(n => `<option value="${n}" ${n === filasPorPaginaProcesos ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </span>
    <span class="paginacion__botones">
      <button type="button" onclick="irAPaginaProcesos(${paginaProcesos - 1})" ${paginaProcesos <= 1 ? 'disabled' : ''}>‹</button>
      ${botones.join('')}
      <button type="button" onclick="irAPaginaProcesos(${paginaProcesos + 1})" ${paginaProcesos >= totalPaginas ? 'disabled' : ''}>›</button>
    </span>`;
}

function irAPaginaProcesos(pagina) {
  paginaProcesos = pagina;
  pintarListaProcesosFiltrada();
}

function cambiarFilasPorPaginaProcesos(valor) {
  filasPorPaginaProcesos = Number(valor);
  paginaProcesos = 1;
  pintarListaProcesosFiltrada();
}

// ---- 2. Formulario nuevo / editar ----
let idsProductosSeleccionadosNuevoProceso = new Set();

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
    document.getElementById('campoFichaTecnicaUnica').hidden = false;
    document.getElementById('bloqueFichasTecnicasMultiple').hidden = true;
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
    document.getElementById('campoFichaTecnicaUnica').hidden = true;
    document.getElementById('bloqueFichasTecnicasMultiple').hidden = false;
    document.getElementById('campoProcesoId').value = '';
    document.getElementById('campoNombreProceso').value = '';
    document.getElementById('campoOrdenProceso').value = '';
    document.getElementById('campoTiempoProceso').value = '';
    document.getElementById('campoRepeticionesProceso').value = 1;
    document.getElementById('campoDescripcionProceso').value = '';

    idsProductosSeleccionadosNuevoProceso = new Set();
    const productoPreseleccionado = document.getElementById('filtroProductoProcesos').value;
    if (productoPreseleccionado) idsProductosSeleccionadosNuevoProceso.add(productoPreseleccionado);
    document.getElementById('buscadorFichasProcesoNuevo').value = '';
    pintarListaFichasProcesoNuevo();
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
  const datosBase = {
    nombre: document.getElementById('campoNombreProceso').value,
    orden: valorOrden !== '' ? Number(valorOrden) : null,
    tiempo_minutos: tiempoProcesoEnMinutos(),
    repeticiones_por_unidad: document.getElementById('campoRepeticionesProceso').value || 1,
    descripcion: document.getElementById('campoDescripcionProceso').value,
    materiales: filasMaterialesProcesoEnEdicion.map(f => ({ material_id: f.material_id, cantidad: f.cantidad }))
  };

  if (!datosBase.nombre.trim()) { mostrarAviso('El nombre del proceso es obligatorio', 'error'); return; }
  if (!datosBase.tiempo_minutos || Number(datosBase.tiempo_minutos) <= 0) {
    mostrarAviso('El tiempo del proceso debe ser mayor a 0', 'error');
    return;
  }
  if (!datosBase.repeticiones_por_unidad || Number(datosBase.repeticiones_por_unidad) <= 0) {
    mostrarAviso('Las repeticiones por unidad deben ser mayor a 0', 'error');
    return;
  }

  if (id) {
    // Editar: sigue siendo un solo proceso, en una sola ficha técnica.
    const productoId = document.getElementById('selectorProductoProceso').value;
    if (!productoId) { mostrarAviso('Elige a qué ficha técnica pertenece este proceso', 'error'); return; }

    try {
      await API.actualizar(`/api/procesos/${id}`, { ...datosBase, producto_id: productoId });
      mostrarAviso('Proceso actualizado — la ficha técnica se recalculó');
      cerrarFormularioProceso();
      cargarListaProcesos();
    } catch (err) {
      mostrarAviso(err.message, 'error');
    }
    return;
  }

  // Crear: un proceso independiente por cada ficha técnica marcada,
  // todos con los mismos datos de arranque (nombre, tiempo, materiales…).
  const idsProductos = [...idsProductosSeleccionadosNuevoProceso];
  if (idsProductos.length === 0) {
    mostrarAviso('Marca al menos una ficha técnica que lleve este proceso', 'error');
    return;
  }

  let creados = 0;
  const fallidos = [];
  for (const productoId of idsProductos) {
    try {
      await API.enviar('/api/procesos', { ...datosBase, producto_id: productoId });
      creados++;
    } catch (err) {
      const producto = productosParaProceso.find(p => p.id === productoId);
      fallidos.push(`${producto ? producto.nombre : productoId}: ${err.message}`);
    }
  }

  if (creados > 0) {
    mostrarAviso(
      idsProductos.length === 1
        ? 'Proceso creado — la ficha técnica se recalculó'
        : `Proceso creado en ${creados} ficha(s) técnica(s) — cada una se recalculó`
    );
  }
  if (fallidos.length > 0) {
    mostrarAviso(`No se pudo crear en: ${fallidos.join(' · ')}`, 'error');
  }
  if (creados > 0) cerrarFormularioProceso();
  cargarListaProcesos();
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