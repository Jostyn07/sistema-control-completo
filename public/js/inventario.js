const SEGUNDOS_REFRESCO = 15;
let inventarioEnMemoria = [];
let ultimoAjustePorMaterial = new Map();
let temporizadorRefresco = null;
let paginaInventario = 1;
let filasPorPaginaInventario = 15;

// ---- 1. Vista por material (semáforo) ----
async function cargarInventarioPorMaterial() {
  const cuerpo = document.getElementById('cuerpoInventarioMateriales');
  try {
    const [materiales, ajustes] = await Promise.all([
      API.obtener('/api/inventario/materiales'),
      API.obtener('/api/inventario/ajustes').catch(() => [])
    ]);
    inventarioEnMemoria = materiales;
    ultimoAjustePorMaterial = new Map();
    for (const a of ajustes) {
      if (!ultimoAjustePorMaterial.has(a.material_id)) ultimoAjustePorMaterial.set(a.material_id, a.fecha);
    }
    poblarFiltroProveedoresInventario();
    pintarKpisInventario();
    buscarInventario();
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="8" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function poblarFiltroProveedoresInventario() {
  const selector = document.getElementById('filtroProveedorInventario');
  const actual = selector.value;
  const proveedores = [...new Set(inventarioEnMemoria.map(m => m.proveedor).filter(Boolean))].sort();
  selector.innerHTML = '<option value="">Todos</option>' +
    proveedores.map(p => `<option value="${escaparHtml(p)}">${escaparHtml(p)}</option>`).join('');
  if (proveedores.includes(actual)) selector.value = actual;
}

// Sin "% vs. mes anterior": es una foto del inventario actual, no hay
// un histórico guardado de estos totales para comparar.
function pintarKpisInventario() {
  const contenedor = document.getElementById('kpisInventario');
  if (!contenedor) return;

  const total = inventarioEnMemoria.length;
  const conStock = inventarioEnMemoria.filter(m => m.estado === 'verde').length;
  const stockBajo = inventarioEnMemoria.filter(m => m.estado === 'amarillo').length;
  const sinStock = inventarioEnMemoria.filter(m => m.estado === 'rojo').length;

  const ICONOS = {
    caja: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    x: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>'
  };

  const pct = (n) => total > 0 ? `${Math.round((n / total) * 1000) / 10}% del total` : '';

  const tarjetas = [
    { icono: 'caja', color: 'azul', etiqueta: 'Total de materiales', valor: String(total), extra: 'productos' },
    { icono: 'check', color: 'verde', etiqueta: 'Con stock suficiente', valor: String(conStock), extra: pct(conStock) },
    { icono: 'alerta', color: 'naranja', etiqueta: 'Stock bajo', valor: String(stockBajo), extra: pct(stockBajo) },
    { icono: 'x', color: 'rosa', etiqueta: 'Sin stock', valor: String(sinStock), extra: pct(sinStock) }
  ];

  contenedor.innerHTML = tarjetas.map(t => `
    <div class="kpi-tarjeta">
      <span class="kpi-tarjeta__icono indicador__icono--${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[t.icono]}</svg></span>
      <span class="kpi-tarjeta__etiqueta">${t.etiqueta}</span>
      <span class="kpi-tarjeta__valor">${t.valor}</span>
      <span class="kpi-tarjeta__delta">${t.extra}</span>
    </div>`).join('');
}

function limpiarFiltrosInventario() {
  document.getElementById('buscadorInventario').value = '';
  document.getElementById('filtroEstadoInventario').value = '';
  document.getElementById('filtroProveedorInventario').value = '';
  buscarInventario();
}

function pintarInventarioPorMaterial(lista) {
  const cuerpo = document.getElementById('cuerpoInventarioMateriales');

  if (inventarioEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">No hay materiales registrados todavía. Créalos en la pestaña Materiales.</td></tr>';
    document.getElementById('paginacionInventario').innerHTML = '';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">Ningún material coincide con la búsqueda o los filtros.</td></tr>';
    document.getElementById('paginacionInventario').innerHTML = '';
    return;
  }

  // Rojo primero, luego amarillo, luego verde (lo urgente arriba)
  const orden = { rojo: 0, amarillo: 1, verde: 2 };
  const ordenados = [...lista].sort((a, b) => orden[a.estado] - orden[b.estado]);

  const totalPaginas = Math.max(1, Math.ceil(ordenados.length / filasPorPaginaInventario));
  if (paginaInventario > totalPaginas) paginaInventario = totalPaginas;
  const inicio = (paginaInventario - 1) * filasPorPaginaInventario;
  const pagina = ordenados.slice(inicio, inicio + filasPorPaginaInventario);

  cuerpo.innerHTML = pagina.map(m => {
    const ultimoAjuste = ultimoAjustePorMaterial.get(m.id);
    return `
    <tr>
      <td><span class="etiqueta-estado etiqueta-estado--${m.estado === 'verde' ? 'listo' : (m.estado === 'amarillo' ? 'pendiente' : 'critico')}" title="${textoEstado(m.estado)}">${textoEstadoCorto(m.estado)}</span></td>
      <td><strong>${escaparHtml(m.nombre)}</strong></td>
      <td>${m.stock_actual} ${escaparHtml(m.unidad)}</td>
      <td>${m.punto_reorden}</td>
      <td>${m.consumo_diario_promedio > 0 ? m.consumo_diario_promedio + '/día' : 'Sin ventas aún'}</td>
      <td>${escaparHtml(m.proveedor)}</td>
      <td>${ultimoAjuste ? formatearFechaCortaInv(ultimoAjuste) : '—'}</td>
      <td><span class="acciones-fila"><button type="button" onclick="abrirAjuste('${m.id}')" title="Ajustar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg></button></span></td>
    </tr>`;
  }).join('');

  pintarPaginacionInventario(ordenados.length, totalPaginas);
}

function formatearFechaCortaInv(fecha) {
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function pintarPaginacionInventario(totalFilas, totalPaginas) {
  const contenedor = document.getElementById('paginacionInventario');
  const inicio = totalFilas === 0 ? 0 : (paginaInventario - 1) * filasPorPaginaInventario + 1;
  const fin = Math.min(paginaInventario * filasPorPaginaInventario, totalFilas);

  const botones = [];
  for (let p = 1; p <= totalPaginas; p++) {
    botones.push(`<button type="button" class="${p === paginaInventario ? 'paginacion__botones--activa' : ''}" onclick="irAPaginaInventario(${p})">${p}</button>`);
  }
  contenedor.innerHTML = `
    <span>Mostrando ${inicio} a ${fin} de ${totalFilas} materiales</span>
    <span class="paginacion__selector">
      Filas por página
      <select onchange="cambiarFilasPorPaginaInventario(this.value)">
        ${[15, 30, 50, 100].map(n => `<option value="${n}" ${n === filasPorPaginaInventario ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </span>
    <span class="paginacion__botones">
      <button type="button" onclick="irAPaginaInventario(${paginaInventario - 1})" ${paginaInventario <= 1 ? 'disabled' : ''}>‹</button>
      ${botones.join('')}
      <button type="button" onclick="irAPaginaInventario(${paginaInventario + 1})" ${paginaInventario >= totalPaginas ? 'disabled' : ''}>›</button>
    </span>`;
}

function irAPaginaInventario(pagina) {
  paginaInventario = pagina;
  buscarInventario();
}

function cambiarFilasPorPaginaInventario(valor) {
  filasPorPaginaInventario = Number(valor);
  paginaInventario = 1;
  buscarInventario();
}

// ---- Búsqueda + filtros (instantáneo, en memoria) ----
function buscarInventario() {
  const texto = normalizarTexto(document.getElementById('buscadorInventario').value);
  const estado = document.getElementById('filtroEstadoInventario').value;
  const proveedor = document.getElementById('filtroProveedorInventario').value;

  let lista = inventarioEnMemoria;
  if (texto) lista = lista.filter(m => normalizarTexto(m.nombre).includes(texto) || normalizarTexto(m.proveedor).includes(texto));
  if (estado) lista = lista.filter(m => m.estado === estado);
  if (proveedor) lista = lista.filter(m => m.proveedor === proveedor);

  paginaInventario = 1;
  pintarInventarioPorMaterial(lista);
}

// Conecta el buscador de la barra superior (tema.js) con el de esta página.
window.buscarDesdeTopbar = function (texto) {
  document.getElementById('buscadorInventario').value = texto;
  buscarInventario();
};

function normalizarTexto(texto) {
  return (texto ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function textoEstado(estado) {
  if (estado === 'rojo') return 'Comprar ya: el stock está en o por debajo del punto de reorden';
  if (estado === 'amarillo') return 'Atención: el stock se acerca al punto de reorden';
  return 'Stock suficiente';
}

function textoEstadoCorto(estado) {
  if (estado === 'rojo') return 'Sin stock';
  if (estado === 'amarillo') return 'Stock bajo';
  return 'Con stock';
}

// ---- 2. Vista por producto (capacidad) ----
async function cargarCapacidadPorProducto() {
  const contenedor = document.getElementById('listaCapacidad');
  try {
    const capacidad = await API.obtener('/api/inventario/capacidad');

    if (capacidad.length === 0) {
      contenedor.innerHTML = '<p class="tabla__vacio">No hay productos registrados todavía. Crea las fichas técnicas en la pestaña Productos.</p>';
      return;
    }

    contenedor.innerHTML = capacidad.map(p => `
      <article class="tarjeta-producto">
        <div class="tarjeta-producto__cuerpo">
          <h3>${escaparHtml(p.nombre)}</h3>
          <p class="capacidad__numero ${p.unidades_fabricables === 0 ? 'capacidad__numero--cero' : ''}">
            ${p.unidades_fabricables} <span class="texto-secundario">unidades fabricables</span>
          </p>
          ${p.material_limitante ? `
            <p class="texto-secundario">
              Limita: <strong>${escaparHtml(p.material_limitante.nombre)}</strong>
              (quedan ${p.material_limitante.stock_actual} ${escaparHtml(p.material_limitante.unidad)},
              usa ${p.material_limitante.cantidad_por_unidad} por unidad)
            </p>` : `<p class="texto-secundario">${escaparHtml(p.detalle || '')}</p>`}
        </div>
      </article>`).join('');
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- 3. Ajuste manual ----
function abrirAjuste(materialId) {
  const m = inventarioEnMemoria.find(x => x.id === materialId);
  if (!m) return;
  document.getElementById('tituloAjuste').textContent = `Ajustar inventario — ${m.nombre}`;
  document.getElementById('campoAjusteMaterialId').value = m.id;
  document.getElementById('textoStockActual').textContent =
    `El sistema registra ${m.stock_actual} ${m.unidad}. Escribe la cantidad real que contaste.`;
  document.getElementById('campoCantidadNueva').value = m.stock_actual;
  document.getElementById('campoMotivo').value = '';
  document.getElementById('modalAjuste').hidden = false;
}

function cerrarAjuste() {
  document.getElementById('modalAjuste').hidden = true;
}

async function confirmarAjuste() {
  const materialId = document.getElementById('campoAjusteMaterialId').value;
  const cantidadNueva = document.getElementById('campoCantidadNueva').value;
  const motivo = document.getElementById('campoMotivo').value;
  await registrarAjusteManual(materialId, cantidadNueva, motivo);
}

async function registrarAjusteManual(materialId, cantidadNueva, motivo) {
  if (cantidadNueva === '' || Number(cantidadNueva) < 0) {
    mostrarAviso('La cantidad debe ser un número mayor o igual a 0', 'error');
    return;
  }
  if (!motivo || !motivo.trim()) {
    mostrarAviso('El motivo es obligatorio: es lo que deja rastro de por qué cambió el stock', 'error');
    return;
  }

  try {
    const resultado = await API.enviar('/api/inventario/ajuste', {
      material_id: materialId,
      cantidad_nueva: cantidadNueva,
      motivo
    });
    mostrarAviso(`Ajuste registrado: de ${resultado.stock_anterior} a ${resultado.stock_nuevo}`);
    cerrarAjuste();
    refrescarInventario();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- WIP (producción en proceso) ----
async function cargarWip() {
  const cuerpo = document.getElementById('cuerpoWip');
  try {
    const wip = await API.obtener('/api/inventario/wip');
    if (wip.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">No hay unidades a medio hacer ahora mismo</td></tr>';
      return;
    }
    cuerpo.innerHTML = wip.map(f => `
      <tr>
        <td>${escaparHtml(f.producto)}</td>
        <td>${escaparHtml(f.proceso)}</td>
        <td>${f.cantidad}</td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="3" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

// ---- Refresco automático ----
async function refrescarInventario() {
  await Promise.all([cargarInventarioPorMaterial(), cargarCapacidadPorProducto(), cargarWip()]);
  const ahora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('indicadorActualizacion').textContent = `Actualizado ${ahora} · se refresca solo cada ${SEGUNDOS_REFRESCO}s`;
}

function iniciarRefrescoAutomatico() {
  if (temporizadorRefresco) clearInterval(temporizadorRefresco);
  temporizadorRefresco = setInterval(refrescarInventario, SEGUNDOS_REFRESCO * 1000);

  // Refresca también al volver a la pestaña del navegador
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refrescarInventario();
  });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  refrescarInventario();
  iniciarRefrescoAutomatico();
});