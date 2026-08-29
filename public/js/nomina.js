// ============================================================
// nomina.js — pestaña Nóminas
// Funciones:
//   cargarListaColaboradores()
//   abrirFormularioColaborador(id) / guardarColaborador() / eliminarColaborador(id)
//   abrirDetalleColaborador(id) → Análisis de rendimiento + Materiales/procesos
//   crearEncargo() / guardarEntregaEncargo() / confirmarPagoEncargo()
// ============================================================

let colaboradoresEnMemoria = [];
let materialesParaEncargo = [];
let procesosParaEncargo = [];
let colaboradorActualId = null;

// ---- 1. Lista de colaboradores (vista rápida) ----
async function cargarListaColaboradores() {
  const contenedor = document.getElementById('listaColaboradores');
  try {
    colaboradoresEnMemoria = await API.obtener('/api/colaboradores');

    if (colaboradoresEnMemoria.length === 0) {
      contenedor.innerHTML = '<p class="tabla__vacio">Aún no hay colaboradores. Crea el primero con el botón de arriba.</p>';
      return;
    }

    contenedor.innerHTML = colaboradoresEnMemoria.map(c => `
      <article class="tarjeta-producto">
        <div class="tarjeta-producto__cuerpo">
          <h3>${escaparHtml(c.nombre)}</h3>
          ${c.cedula ? `<p class="texto-secundario" style="margin:-2px 0 6px">C.C. ${escaparHtml(c.cedula)}</p>` : ''}
          ${c.direccion ? `<p class="texto-secundario" style="margin:0 0 10px">${escaparHtml(c.direccion)}</p>` : ''}
          <div class="tabla__acciones">
            <button type="button" class="boton boton--pequeno boton--primario" onclick="abrirDetalleColaborador('${c.id}')">Ver detalle</button>
          </div>
        </div>
      </article>`).join('');
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar la lista: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- 1b. Balanceo de producción: procesos pendientes (arriba, se
// arrastran) + carga de cada colaborador (abajo, reciben el arrastre) ----
let pendientesEnMemoria = [];
let cargaColaboradoresEnMemoria = [];
let asignacionEnCurso = null; // { encargoId, colaboradorId, maximo }

async function cargarBalanceo() {
  const seccion = document.getElementById('seccionBalanceo');
  try {
    const [pendientes, carga] = await Promise.all([
      API.obtener('/api/colaboradores/encargos/pendientes'),
      API.obtener('/api/colaboradores/carga')
    ]);
    pendientesEnMemoria = pendientes;
    cargaColaboradoresEnMemoria = carga;

    const hayAlgoQueMostrar = pendientes.length > 0 || carga.some(c => c.tareas.length > 0);
    seccion.hidden = !hayAlgoQueMostrar;
    if (!hayAlgoQueMostrar) return;

    pintarChipsPendientes();
    pintarBarrasColaboradores();
  } catch (err) {
    seccion.hidden = true;
  }
}

function pintarChipsPendientes() {
  const contenedor = document.getElementById('filaChipsPendientes');
  if (pendientesEnMemoria.length === 0) {
    contenedor.innerHTML = '<p class="tabla__vacio">No hay procesos pendientes por asignar ahora mismo.</p>';
    return;
  }
  contenedor.innerHTML = pendientesEnMemoria.map(p => {
    const pendiente = Math.round((p.cantidad_requerida - p.cantidad_entregada) * 10000) / 10000;
    const minutos = Math.round(pendiente * p.tiempo_minutos);
    return `
      <div class="balanceo__chip" draggable="true"
           ondragstart="arrastrarPendiente(event, '${p.id}')">
        <strong>${escaparHtml(p.proceso)}</strong>
        <span>${escaparHtml(p.producto)}</span>
        <span class="texto-secundario">${pendiente} unidades · ${minutos} min</span>
        ${p.wip_disponible_etapa_anterior != null
          ? `<span class="texto-secundario">Disponible de la etapa anterior: ${p.wip_disponible_etapa_anterior}</span>`
          : ''}
      </div>`;
  }).join('');
}

function pintarBarrasColaboradores() {
  const contenedor = document.getElementById('filaBarrasColaboradores');
  if (cargaColaboradoresEnMemoria.length === 0) {
    contenedor.innerHTML = '<p class="tabla__vacio">Crea un colaborador para poder asignarle procesos.</p>';
    return;
  }
  const maximo = Math.max(1, ...cargaColaboradoresEnMemoria.map(c => c.minutos_pendientes));
  contenedor.innerHTML = cargaColaboradoresEnMemoria.map(c => `
    <div class="balanceo__fila-colaborador"
         ondragover="permitirSoltar(event)"
         ondragleave="quitarResaltadoSoltar(event)"
         ondrop="soltarSobreColaborador(event, '${c.colaborador_id}', '${escaparHtml(c.nombre).replace(/'/g, "&#39;")}')">
      <div class="balanceo__colaborador-info">
        <strong>${escaparHtml(c.nombre)}</strong>
        <span class="texto-secundario">${c.minutos_pendientes} min pendientes</span>
      </div>
      <div class="balanceo__barra">
        <div class="balanceo__barra__relleno" style="width:${Math.round((c.minutos_pendientes / maximo) * 100)}%"></div>
      </div>
      <div></div>
      <div class="balanceo__tareas">
        ${c.tareas.length === 0
          ? '<span class="texto-secundario">Sin procesos pendientes</span>'
          : c.tareas.map(t => `<span class="balanceo__tarea">${escaparHtml(t.proceso)} × ${t.cantidad_pendiente} (${escaparHtml(t.producto)})</span>`).join('')}
      </div>
    </div>`).join('');
}

let idEncargoArrastrado = null;
function arrastrarPendiente(evento, encargoId) {
  idEncargoArrastrado = encargoId;
  evento.dataTransfer.setData('text/plain', encargoId);
  evento.dataTransfer.effectAllowed = 'move';
}

function permitirSoltar(evento) {
  evento.preventDefault();
  evento.currentTarget.classList.add('balanceo__fila-colaborador--sobre');
}

function quitarResaltadoSoltar(evento) {
  evento.currentTarget.classList.remove('balanceo__fila-colaborador--sobre');
}

function soltarSobreColaborador(evento, colaboradorId, nombreColaborador) {
  evento.preventDefault();
  evento.currentTarget.classList.remove('balanceo__fila-colaborador--sobre');
  const encargoId = evento.dataTransfer.getData('text/plain') || idEncargoArrastrado;
  if (!encargoId) return;

  const pendiente = pendientesEnMemoria.find(p => p.id === encargoId);
  if (!pendiente) return;
  const maximo = Math.round((pendiente.cantidad_requerida - pendiente.cantidad_entregada) * 10000) / 10000;

  asignacionEnCurso = { encargoId, colaboradorId, maximo };
  document.getElementById('tituloAsignarCantidad').textContent = `Asignar a ${nombreColaborador}`;
  document.getElementById('textoAsignarCantidad').textContent =
    `${pendiente.proceso} — ${pendiente.producto} (máximo ${maximo} unidades)`;
  const campo = document.getElementById('campoCantidadAsignar');
  campo.max = maximo;
  campo.value = maximo;
  document.getElementById('modalAsignarCantidad').hidden = false;
}

function cerrarAsignarCantidad() {
  document.getElementById('modalAsignarCantidad').hidden = true;
  asignacionEnCurso = null;
}

async function confirmarAsignarCantidad() {
  if (!asignacionEnCurso) return;
  const cantidad = document.getElementById('campoCantidadAsignar').value;
  if (!cantidad || Number(cantidad) <= 0) { mostrarAviso('La cantidad no es válida', 'error'); return; }
  if (Number(cantidad) > asignacionEnCurso.maximo + 0.0001) {
    mostrarAviso(`Solo hay ${asignacionEnCurso.maximo} unidades pendientes`, 'error');
    return;
  }

  try {
    await API.actualizar(`/api/colaboradores/encargos/${asignacionEnCurso.encargoId}/asignar`, {
      colaborador_id: asignacionEnCurso.colaboradorId,
      cantidad
    });
    mostrarAviso('Proceso asignado');
    cerrarAsignarCantidad();
    cargarBalanceo();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 2. Crear / editar colaborador ----
function abrirFormularioColaborador(id) {
  const modal = document.getElementById('modalColaborador');
  const titulo = document.getElementById('tituloFormularioColaborador');

  if (id) {
    const c = colaboradoresEnMemoria.find(x => x.id === id);
    if (!c) return;
    titulo.textContent = 'Editar colaborador';
    document.getElementById('campoColaboradorId').value = c.id;
    document.getElementById('campoNombreColaborador').value = c.nombre;
    document.getElementById('campoCedulaColaborador').value = c.cedula || '';
    document.getElementById('campoDireccionColaborador').value = c.direccion || '';
  } else {
    titulo.textContent = 'Crear colaborador';
    document.getElementById('campoColaboradorId').value = '';
    ['campoNombreColaborador', 'campoCedulaColaborador', 'campoDireccionColaborador']
      .forEach(c2 => document.getElementById(c2).value = '');
  }
  modal.hidden = false;
}

function cerrarFormularioColaborador() {
  document.getElementById('modalColaborador').hidden = true;
}

async function guardarColaborador() {
  const id = document.getElementById('campoColaboradorId').value;
  const datos = {
    nombre: document.getElementById('campoNombreColaborador').value,
    cedula: document.getElementById('campoCedulaColaborador').value,
    direccion: document.getElementById('campoDireccionColaborador').value
  };
  if (!datos.nombre.trim()) { mostrarAviso('El nombre es obligatorio', 'error'); return; }

  try {
    if (id) {
      await API.actualizar(`/api/colaboradores/${id}`, datos);
      mostrarAviso('Colaborador actualizado');
    } else {
      await API.enviar('/api/colaboradores', datos);
      mostrarAviso('Colaborador creado');
    }
    cerrarFormularioColaborador();
    cargarListaColaboradores();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

function editarColaboradorActual() {
  const id = colaboradorActualId;
  volverAListaColaboradores();
  abrirFormularioColaborador(id);
}

async function eliminarColaboradorActual() {
  const c = colaboradoresEnMemoria.find(x => x.id === colaboradorActualId);
  if (!c) return;
  const confirmado = confirm(`¿Eliminar a "${c.nombre}"? Si ya tiene encargos registrados, se desactivará en vez de borrarse.`);
  if (!confirmado) return;

  try {
    const resultado = await API.eliminar(`/api/colaboradores/${colaboradorActualId}`);
    mostrarAviso(resultado.desactivado ? resultado.mensaje : 'Colaborador eliminado');
    cerrarDetalleColaborador();
    cargarListaColaboradores();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 3. Detalle: vista dedicada (no modal), con dos divisiones ----
async function abrirDetalleColaborador(id) {
  colaboradorActualId = id;
  const c = colaboradoresEnMemoria.find(x => x.id === id);
  document.getElementById('tituloDetalleColaborador').textContent = c ? c.nombre : 'Colaborador';

  document.getElementById('vistaListaColaboradores').hidden = true;
  document.getElementById('vistaDetalleColaborador').hidden = false;
  window.scrollTo(0, 0);
  cambiarPestanaColaborador('rendimiento');

  await Promise.all([
    cargarRendimientoColaborador(id),
    cargarMaterialesYProcesosParaEncargo(),
    cargarEncargosColaborador(id)
  ]);
}

function volverAListaColaboradores() {
  document.getElementById('vistaDetalleColaborador').hidden = true;
  document.getElementById('vistaListaColaboradores').hidden = false;
  colaboradorActualId = null;
  cargarBalanceo();
}

// Se mantiene por compatibilidad con el resto del archivo (ya no cierra
// un modal, vuelve a la lista).
function cerrarDetalleColaborador() {
  volverAListaColaboradores();
}

function cambiarPestanaColaborador(pestana) {
  const esRendimiento = pestana === 'rendimiento';
  document.getElementById('panelRendimiento').hidden = !esRendimiento;
  document.getElementById('panelTrabajo').hidden = esRendimiento;
  document.getElementById('pestanaRendimientoBtn').classList.toggle('boton--primario', esRendimiento);
  document.getElementById('pestanaTrabajoBtn').classList.toggle('boton--primario', !esRendimiento);
}

// ---- 3.1 Análisis de rendimiento ----
async function cargarRendimientoColaborador(id) {
  const contenedor = document.getElementById('tarjetasRendimiento');
  contenedor.innerHTML = '<p class="tabla__vacio">Cargando…</p>';
  try {
    const r = await API.obtener(`/api/colaboradores/${id}/rendimiento`);
    contenedor.innerHTML = `
      <article class="tarjeta">
        <p class="numero-resumen">${r.total_encargos} <span class="texto-secundario">encargos totales</span></p>
        <p class="texto-secundario">${r.encargos_completados} completados · ${r.encargos_pendientes} pendientes</p>
      </article>
      <article class="tarjeta">
        <p class="numero-resumen">${r.porcentaje_cumplimiento}% <span class="texto-secundario">cumplimiento</span></p>
        <p class="texto-secundario">${r.total_unidades_entregadas} de ${r.total_unidades_requeridas} unidades entregadas</p>
      </article>
      <article class="tarjeta">
        <p class="numero-resumen">${formatearPesos(r.total_ganado)} <span class="texto-secundario">ganado en total</span></p>
        <p class="texto-secundario">Por el trabajo entregado hasta hoy</p>
      </article>
      <article class="tarjeta">
        <p class="numero-resumen ${r.total_pendiente_pago > 0 ? 'capacidad__numero--cero' : ''}">${formatearPesos(r.total_pendiente_pago)} <span class="texto-secundario">pendiente de pago</span></p>
        <p class="texto-secundario">Ya pagado: ${formatearPesos(r.total_pagado)}</p>
      </article>`;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- 3.2 Materiales y procesos (encargos) ----
async function cargarMaterialesYProcesosParaEncargo() {
  try {
    [materialesParaEncargo, procesosParaEncargo] = await Promise.all([
      API.obtener('/api/materiales'),
      API.obtener('/api/procesos')
    ]);
  } catch (err) {
    mostrarAviso('No se pudieron cargar materiales/procesos: ' + err.message, 'error');
    materialesParaEncargo = [];
    procesosParaEncargo = [];
  }

  document.getElementById('selectorProcesoEncargo').innerHTML =
    procesosParaEncargo.map(p => `<option value="${p.id}">${escaparHtml(p.nombre)} (${escaparHtml(p.productos ? p.productos.nombre : '')}) — ${formatearPesos(p.costo_unitario)}</option>`).join('');

  if (procesosParaEncargo.length === 0) {
    mostrarAviso('Aún no hay procesos creados. Ve a la pestaña Procesos para crear el primero.', 'error');
  }
  calcularMaterialesEncargoEnVivo();
}

// Recalcula, en vivo, cuánto de cada material hace falta según el
// proceso elegido y la cantidad a entregar (cantidad_por_proceso ×
// cantidad_requerida) — y avisa si algo supera el stock disponible.
function calcularMaterialesEncargoEnVivo() {
  const cuerpo = document.getElementById('cuerpoMaterialesEncargoPreview');
  const procesoId = document.getElementById('selectorProcesoEncargo').value;
  const cantidadRequerida = Number(document.getElementById('campoCantidadRequeridaEncargo').value || 0);

  const proceso = procesosParaEncargo.find(p => p.id === procesoId);
  if (!proceso || !cantidadRequerida) {
    cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Elige un proceso y una cantidad</td></tr>';
    return;
  }
  const materiales = proceso.procesos_materiales || [];
  if (materiales.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Este proceso no tiene materiales definidos</td></tr>';
    return;
  }

  cuerpo.innerHTML = materiales.map(m => {
    const necesaria = Math.round(Number(m.cantidad) * cantidadRequerida * 10000) / 10000;
    const stockActual = materialesParaEncargo.find(x => x.id === m.materiales.id)?.stock_actual ?? 0;
    const faltaStock = necesaria > Number(stockActual);
    return `
      <tr>
        <td>${escaparHtml(m.materiales.nombre)}</td>
        <td class="${faltaStock ? 'indicador__valor--negativo' : ''}">${necesaria} ${escaparHtml(m.materiales.unidad)}</td>
        <td>${stockActual} ${escaparHtml(m.materiales.unidad)}</td>
      </tr>`;
  }).join('');
}

async function cargarEncargosColaborador(id) {
  const cuerpo = document.getElementById('cuerpoEncargos');
  try {
    const encargos = await API.obtener(`/api/colaboradores/${id}/encargos`);
    pintarEncargos(encargos);
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="9" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function pintarEncargos(encargos) {
  const cuerpo = document.getElementById('cuerpoEncargos');
  if (encargos.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="9" class="tabla__vacio">Aún no hay encargos para este colaborador.</td></tr>';
    return;
  }
  cuerpo.innerHTML = encargos.map(e => `
    <tr>
      <td>${(e.colaboradores_encargos_materiales || []).map(m => `${m.cantidad} ${escaparHtml(m.materiales.unidad)} de ${escaparHtml(m.materiales.nombre)}`).join(', ') || '—'}</td>
      <td>${e.procesos ? escaparHtml(e.procesos.nombre) : '—'}</td>
      <td>${e.cantidad_requerida}</td>
      <td>${e.cantidad_entregada}</td>
      <td>${e.fecha_entrega ? formatearFechaNomina(e.fecha_entrega) : '—'}</td>
      <td>${formatearPesos(e.costo_unitario_proceso)}</td>
      <td>${formatearPesos(e.costo_total_proceso)}</td>
      <td>${celdaPagoEncargo(e)}</td>
      <td class="tabla__acciones">
        <button type="button" class="boton boton--pequeno" onclick="abrirEntregaEncargo('${e.id}', ${e.cantidad_requerida - e.cantidad_entregada})">Registrar entrega</button>
        <button type="button" class="boton boton--pequeno boton--peligro" onclick="eliminarEncargo('${e.id}')">Eliminar</button>
      </td>
    </tr>`).join('');
}

function celdaPagoEncargo(e) {
  if (e.pagado) {
    return `<span class="indicador__valor--positivo">✓ Pagado</span> <button type="button" class="boton boton--pequeno" onclick="confirmarPagoEncargo('${e.id}', false)">Deshacer</button>`;
  }
  return `<button type="button" class="boton boton--pequeno" onclick="confirmarPagoEncargo('${e.id}', true)">Confirmar pago</button>`;
}

async function crearEncargo() {
  if (!colaboradorActualId) return;
  const datos = {
    proceso_id: document.getElementById('selectorProcesoEncargo').value,
    cantidad_requerida: document.getElementById('campoCantidadRequeridaEncargo').value,
    fecha_entrega: document.getElementById('campoFechaEntregaEncargo').value || null
  };

  if (!datos.proceso_id) { mostrarAviso('Elige el proceso requerido', 'error'); return; }
  if (!datos.cantidad_requerida || Number(datos.cantidad_requerida) <= 0) {
    mostrarAviso('La cantidad a entregar del proceso debe ser mayor a 0', 'error');
    return;
  }

  try {
    await API.enviar(`/api/colaboradores/${colaboradorActualId}/encargos`, datos);
    mostrarAviso('Encargo agregado.');
    document.getElementById('campoCantidadRequeridaEncargo').value = '';
    document.getElementById('campoFechaEntregaEncargo').value = '';
    calcularMaterialesEncargoEnVivo();
    cargarEncargosColaborador(colaboradorActualId);
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

function abrirEntregaEncargo(encargoId, cantidadPendiente) {
  document.getElementById('campoEncargoEntregaId').value = encargoId;
  document.getElementById('textoPendienteEntrega').textContent = `Quedan ${cantidadPendiente} unidades pendientes de este proceso.`;
  document.getElementById('campoCantidadEntregaEvento').value = '';
  document.getElementById('campoCantidadEntregaEvento').max = cantidadPendiente;
  document.getElementById('campoFechaEntregaEvento').value = new Date().toISOString().slice(0, 10);
  document.getElementById('modalEntregaEncargo').hidden = false;
  cargarHistorialEntregas(encargoId);
}

function cerrarEntregaEncargo() {
  document.getElementById('modalEntregaEncargo').hidden = true;
}

async function cargarHistorialEntregas(encargoId) {
  const cuerpo = document.getElementById('cuerpoHistorialEntregas');
  cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Cargando…</td></tr>';
  try {
    const historial = await API.obtener(`/api/colaboradores/encargos/${encargoId}/entregas`);
    if (historial.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Todavía no hay entregas registradas</td></tr>';
      return;
    }
    cuerpo.innerHTML = historial.map(h => `
      <tr>
        <td>${formatearFechaNomina(h.fecha)}</td>
        <td>${h.cantidad}</td>
        <td><button type="button" class="boton boton--pequeno boton--peligro" onclick="borrarEntrega('${h.id}', '${encargoId}')">Borrar</button></td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="3" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

async function borrarEntrega(entregaId, encargoId) {
  const confirmado = confirm('¿Borrar este registro de entrega? Se revierte el material y el WIP que había movido.');
  if (!confirmado) return;
  try {
    await API.eliminar(`/api/colaboradores/entregas/${entregaId}`);
    mostrarAviso('Registro borrado y revertido');
    cargarHistorialEntregas(encargoId);
    cargarEncargosColaborador(colaboradorActualId);
    cargarRendimientoColaborador(colaboradorActualId);
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

async function guardarEntregaEncargo(forzar = false) {
  const id = document.getElementById('campoEncargoEntregaId').value;
  const cantidad = document.getElementById('campoCantidadEntregaEvento').value;
  const fecha = document.getElementById('campoFechaEntregaEvento').value;

  if (cantidad === '' || Number(cantidad) <= 0) {
    mostrarAviso('La cantidad no es válida', 'error');
    return;
  }
  if (!fecha) {
    mostrarAviso('Elige la fecha de esta entrega', 'error');
    return;
  }

  try {
    await API.actualizar(`/api/colaboradores/encargos/${id}/entrega`, { cantidad, fecha, forzar });
    mostrarAviso(forzar ? 'Entrega registrada forzando el inventario. Recuerda corregirlo con un ajuste.' : 'Entrega registrada');
    document.getElementById('campoCantidadEntregaEvento').value = '';
    cargarHistorialEntregas(id);
    cargarEncargosColaborador(colaboradorActualId);
    cargarRendimientoColaborador(colaboradorActualId);
  } catch (err) {
    // El backend responde 409 con la lista de lo que falta (material o
    // trabajo de la etapa anterior) — se ofrece forzar, igual que en Ventas.
    if (err.message.includes('No hay suficiente material o trabajo')) {
      const confirmado = confirm(
        'No hay suficiente material o trabajo de la etapa anterior según el sistema.\n\n' +
        '¿Registrar la entrega de todas formas? (Luego corriges con un ajuste de inventario.)'
      );
      if (confirmado) guardarEntregaEncargo(true);
    } else {
      mostrarAviso(err.message, 'error');
    }
  }
}

// ---- Pago (esto es la "facturación" para pagarle al colaborador) ----
async function confirmarPagoEncargo(id, pagado) {
  try {
    await API.actualizar(`/api/colaboradores/encargos/${id}/pago`, { pagado });
    mostrarAviso(pagado ? 'Pago confirmado' : 'Pago revertido');
    cargarEncargosColaborador(colaboradorActualId);
    cargarRendimientoColaborador(colaboradorActualId);
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

async function eliminarEncargo(id) {
  const confirmado = confirm('¿Eliminar este encargo?');
  if (!confirmado) return;

  try {
    await API.eliminar(`/api/colaboradores/encargos/${id}`);
    mostrarAviso('Encargo eliminado y stock revertido');
    cargarEncargosColaborador(colaboradorActualId);
    cargarRendimientoColaborador(colaboradorActualId);
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Utilidades ----
function formatearFechaNomina(fecha) {
  return new Date(fecha + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', async () => {
  await cargarListaColaboradores();
  cargarBalanceo();
});
// Buenas tardes