// ============================================================
// facturacion.js — pestaña Facturación Electrónica
// Funciones (según estructura funcional):
//   cargarConfiguracionFiscal() / guardarConfiguracionFiscal(datos)
//   cargarVentasFacturables()
//   generarFactura(ventaId)
//   enviarFacturaCliente(facturaId, medio)  → imprimir / guardar PDF
//   cargarHistorialFacturas(filtros)
// ============================================================

let configuracionEnMemoria = null;

// ---- 1. Configuración fiscal ----
async function cargarConfiguracionFiscal() {
  try {
    configuracionEnMemoria = await API.obtener('/api/facturacion/configuracion');
  } catch (err) {
    configuracionEnMemoria = null;
  }
  document.getElementById('avisoModo').hidden = false;
}

function abrirConfiguracion() {
  const c = configuracionEnMemoria || {};
  let modo = 'no';
  if (c.resolucion_numero) modo = 'si';
  else if (c.nit) modo = 'natural';
  document.getElementById('campoTieneRut').value = modo;
  document.getElementById('campoRazonSocial').value = c.razon_social || '';
  document.getElementById('campoNit').value = c.nit || '';
  document.getElementById('campoRegimen').value = c.regimen || '';
  document.getElementById('campoResolucionNumero').value = c.resolucion_numero || '';
  document.getElementById('campoResolucionPrefijo').value = c.resolucion_prefijo || '';
  document.getElementById('campoResolucionDesde').value = c.resolucion_desde || '';
  document.getElementById('campoResolucionHasta').value = c.resolucion_hasta || '';
  document.getElementById('campoResolucionVigencia').value = c.resolucion_vigencia || '';
  document.getElementById('campoNombrePersona').value = c.nombre_persona || '';
  document.getElementById('campoCedula').value = c.cedula || '';
  metodosPagoEnEdicion = Array.isArray(c.metodos_pago) ? c.metodos_pago.map(m => ({ ...m })) : [];
  pintarMetodosPago();
  alternarCamposRut();
  document.getElementById('modalConfiguracion').hidden = false;
}

// ---- Métodos de pago (hasta 5, para mostrar en la factura) ----
let metodosPagoEnEdicion = [];
const ETIQUETA_TIPO_PAGO = { cuenta: 'Número de cuenta', llave: 'Llave', nequi: 'Nequi' };

function agregarMetodoPago() {
  if (metodosPagoEnEdicion.length >= 5) {
    mostrarAviso('Máximo 5 métodos de pago', 'error');
    return;
  }
  metodosPagoEnEdicion.push({ tipo: 'cuenta', valor: '', etiqueta: '' });
  pintarMetodosPago();
}

function quitarMetodoPago(indice) {
  metodosPagoEnEdicion.splice(indice, 1);
  pintarMetodosPago();
}

// Se llama desde los inputs/selects de cada fila con oninput/onchange
function actualizarMetodoPago(indice, campo, valor) {
  metodosPagoEnEdicion[indice][campo] = valor;
}

function pintarMetodosPago() {
  const contenedor = document.getElementById('listaMetodosPago');
  if (metodosPagoEnEdicion.length === 0) {
    contenedor.innerHTML = '<p class="texto-secundario">Sin métodos de pago agregados.</p>';
  } else {
    contenedor.innerHTML = metodosPagoEnEdicion.map((m, i) => `
      <div class="agregar-material" style="align-items:flex-end">
        <label class="campo" style="margin:0;max-width:160px">
          <span class="campo__etiqueta">Tipo</span>
          <select onchange="actualizarMetodoPago(${i}, 'tipo', this.value)">
            <option value="cuenta" ${m.tipo === 'cuenta' ? 'selected' : ''}>Número de cuenta</option>
            <option value="llave" ${m.tipo === 'llave' ? 'selected' : ''}>Llave</option>
            <option value="nequi" ${m.tipo === 'nequi' ? 'selected' : ''}>Nequi</option>
          </select>
        </label>
        <label class="campo" style="margin:0">
          <span class="campo__etiqueta">Valor</span>
          <input type="text" value="${escaparHtml(m.valor || '')}" placeholder="Ej: 123-456789-00"
            oninput="actualizarMetodoPago(${i}, 'valor', this.value)">
        </label>
        <label class="campo" style="margin:0">
          <span class="campo__etiqueta">Detalle (opcional)</span>
          <input type="text" value="${escaparHtml(m.etiqueta || '')}" placeholder="Ej: Bancolombia ahorros"
            oninput="actualizarMetodoPago(${i}, 'etiqueta', this.value)">
        </label>
        <button type="button" class="boton boton--pequeno boton--peligro" onclick="quitarMetodoPago(${i})">Quitar</button>
      </div>`).join('');
  }
  document.getElementById('botonAgregarMetodoPago').disabled = metodosPagoEnEdicion.length >= 5;
}

// Muestra/oculta NIT, régimen y resolución según el modo elegido:
// "si" (empresa con resolución), "natural" (persona natural con RUT,
// sin resolución todavía) o "no" (sin RUT).
function alternarCamposRut() {
  const modo = document.getElementById('campoTieneRut').value;
  const tieneNit = modo === 'si' || modo === 'natural';
  const tieneResolucion = modo === 'si';
  document.getElementById('grupoNit').hidden = !tieneNit;
  document.getElementById('grupoRegimen').hidden = !tieneNit;
  document.getElementById('grupoResolucion').hidden = !tieneResolucion;
}

function cerrarConfiguracion() {
  document.getElementById('modalConfiguracion').hidden = true;
}

async function guardarConfiguracionFiscal() {
  const modo = document.getElementById('campoTieneRut').value;
  const tieneNit = modo === 'si' || modo === 'natural';
  const tieneResolucion = modo === 'si';

  const datos = {
    razon_social: document.getElementById('campoRazonSocial').value,
    nit: tieneNit ? document.getElementById('campoNit').value : '',
    regimen: tieneNit ? document.getElementById('campoRegimen').value : '',
    resolucion_numero: tieneResolucion ? document.getElementById('campoResolucionNumero').value : '',
    resolucion_prefijo: tieneResolucion ? document.getElementById('campoResolucionPrefijo').value : '',
    resolucion_desde: tieneResolucion ? document.getElementById('campoResolucionDesde').value : null,
    resolucion_hasta: tieneResolucion ? document.getElementById('campoResolucionHasta').value : null,
    resolucion_vigencia: tieneResolucion ? (document.getElementById('campoResolucionVigencia').value || null) : null,
    nombre_persona: document.getElementById('campoNombrePersona').value,
    cedula: document.getElementById('campoCedula').value,
    metodos_pago: metodosPagoEnEdicion
  };

  if (metodosPagoEnEdicion.some(m => !m.valor || !m.valor.trim())) {
    mostrarAviso('Completa el valor de cada método de pago (o quítalo si no lo vas a usar)', 'error');
    return;
  }

  if (!datos.razon_social.trim()) {
    mostrarAviso('El nombre es obligatorio', 'error');
    return;
  }
  if (tieneNit && !datos.nit.trim()) {
    mostrarAviso('El NIT es obligatorio en este modo', 'error');
    return;
  }
  if (tieneResolucion && (!datos.resolucion_numero.trim() || datos.resolucion_desde === '' || datos.resolucion_hasta === '')) {
    mostrarAviso('Completa la resolución y el rango de numeración', 'error');
    return;
  }

  try {
    configuracionEnMemoria = await API.enviar('/api/facturacion/configuracion', datos);
    mostrarAviso('Configuración guardada');
    cerrarConfiguracion();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 2. Ventas facturables ----
let facturablesEnMemoria = [];
let paginaFacturables = 1;
const FILAS_POR_PAGINA_FACT = 5;

async function cargarVentasFacturables() {
  const cuerpo = document.getElementById('cuerpoFacturables');
  try {
    facturablesEnMemoria = await API.obtener('/api/facturacion/facturables');
    paginaFacturables = 1;
    pintarKpisFacturacionParcial();
    pintarFacturablesFiltrado();
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function normalizarTextoFact(texto) {
  return (texto ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

function avatarFact(nombre) {
  const inicial = (nombre || '?').trim().charAt(0).toUpperCase();
  return `<span class="avatar-inicial">${escaparHtml(inicial)}</span>`;
}

function pintarFacturablesFiltrado() {
  const texto = normalizarTextoFact(document.getElementById('buscadorFacturables').value);
  let lista = facturablesEnMemoria;
  if (texto) {
    lista = lista.filter(v =>
      normalizarTextoFact(v.cliente).includes(texto) ||
      (v.ventas_items || []).some(i => normalizarTextoFact(i.productos ? i.productos.nombre : '').includes(texto)));
  }

  const cuerpo = document.getElementById('cuerpoFacturables');
  const paginacion = document.getElementById('paginacionFacturables');

  if (facturablesEnMemoria.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="tabla__vacio">Todas las ventas registradas ya tienen factura.</td></tr>';
    paginacion.innerHTML = '';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="6" class="tabla__vacio">Ninguna venta coincide con la búsqueda.</td></tr>';
    paginacion.innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / FILAS_POR_PAGINA_FACT));
  if (paginaFacturables > totalPaginas) paginaFacturables = totalPaginas;
  const inicio = (paginaFacturables - 1) * FILAS_POR_PAGINA_FACT;
  const pagina = lista.slice(inicio, inicio + FILAS_POR_PAGINA_FACT);

  cuerpo.innerHTML = pagina.map(v => `
    <tr>
      <td>${formatearFecha(v.fecha)}</td>
      <td><span class="celda-cliente">${avatarFact(v.cliente)}${escaparHtml(v.cliente || 'Consumidor final')}</span></td>
      <td>${(v.ventas_items || []).map(i => `${i.cantidad}× ${escaparHtml(i.productos ? i.productos.nombre : '')}`).join(', ')}</td>
      <td>${formatearPesos(v.total)}</td>
      <td>
        <select id="modoFacturar-${v.id}" style="width:auto;display:inline-block;">
          <option value="individual">Individual</option>
          <option value="categorias">Por categorías</option>
        </select>
      </td>
      <td><button type="button" class="boton boton--pequeno boton--primario" onclick="generarFactura('${v.id}')">Generar factura</button></td>
    </tr>`).join('');

  pintarPaginacionGenerica(paginacion, lista.length, totalPaginas, paginaFacturables, (p) => { paginaFacturables = p; pintarFacturablesFiltrado(); }, 'ventas por facturar');
}

// Paginación genérica reutilizada por las dos tablas de esta página.
function pintarPaginacionGenerica(contenedor, totalFilas, totalPaginas, paginaActual, irAPagina, nombre) {
  const inicio = totalFilas === 0 ? 0 : (paginaActual - 1) * FILAS_POR_PAGINA_FACT + 1;
  const fin = Math.min(paginaActual * FILAS_POR_PAGINA_FACT, totalFilas);
  const idBase = 'pg' + Math.random().toString(36).slice(2, 8);
  window[idBase] = irAPagina;

  const botones = [];
  for (let p = 1; p <= totalPaginas; p++) {
    botones.push(`<button type="button" class="${p === paginaActual ? 'paginacion__botones--activa' : ''}" onclick="window.${idBase}(${p})">${p}</button>`);
  }
  contenedor.innerHTML = `
    <span>Mostrando ${inicio} a ${fin} de ${totalFilas} ${nombre}</span>
    <span class="paginacion__botones">
      <button type="button" onclick="window.${idBase}(${paginaActual - 1})" ${paginaActual <= 1 ? 'disabled' : ''}>‹</button>
      ${botones.join('')}
      <button type="button" onclick="window.${idBase}(${paginaActual + 1})" ${paginaActual >= totalPaginas ? 'disabled' : ''}>›</button>
    </span>`;
}

// Conecta el buscador de la barra superior (tema.js) con el de la tab activa.
window.buscarDesdeTopbar = function (texto) {
  const tabActiva = document.querySelector('#tabsFacturacion .tabs-modulo__item--activo').dataset.tab;
  if (tabActiva === 'facturables') {
    document.getElementById('buscadorFacturables').value = texto;
    pintarFacturablesFiltrado();
  } else {
    document.getElementById('buscadorEmitidas').value = texto;
    pintarHistorialFiltrado();
  }
};

function cambiarTabFacturacion(tab) {
  document.querySelectorAll('#tabsFacturacion .tabs-modulo__item').forEach(b => b.classList.toggle('tabs-modulo__item--activo', b.dataset.tab === tab));
  document.getElementById('seccionFacturables').hidden = tab !== 'facturables';
  document.getElementById('seccionEmitidas').hidden = tab !== 'emitidas';
}

function pintarKpisFacturacionParcial() {
  // Se llama dos veces (al cargar cada tabla) y repinta con lo que ya
  // haya disponible de la otra — así no importa cuál termine primero.
  const contenedor = document.getElementById('kpisFacturacion');
  if (!contenedor) return;

  const totalFacturables = facturablesEnMemoria.length;
  const valorFacturables = facturablesEnMemoria.reduce((s, v) => s + Number(v.total || 0), 0);

  const historial = window.historialFacturasEnMemoria || [];
  const hoy = new Date();
  const esteMes = historial.filter(f => {
    const d = new Date(f.fecha);
    return d.getFullYear() === hoy.getFullYear() && d.getMonth() === hoy.getMonth();
  });
  const emitidasEsteMes = esteMes.length;
  const valorEsteMes = esteMes.reduce((s, f) => s + Number(f.ventas ? f.ventas.total : 0), 0);
  const anuladas = historial.filter(f => f.anulada).length;
  const totalHistoricoActivo = historial.filter(f => !f.anulada).reduce((s, f) => s + Number(f.ventas ? f.ventas.total : 0), 0);

  const ICONOS = {
    subir: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    doc: '<path d="M6 2h9l4 4v16H6Z"/><path d="M15 2v4h4"/><path d="M9 12h6M9 16h6"/>',
    x: '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
    moneda: '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'
  };

  const tarjetas = [
    { icono: 'subir', color: 'verde', etiqueta: 'Ventas por facturar', valor: String(totalFacturables), extra: formatearPesos(valorFacturables) },
    { icono: 'doc', color: 'azul', etiqueta: 'Facturas emitidas (este mes)', valor: String(emitidasEsteMes), extra: formatearPesos(valorEsteMes) },
    { icono: 'x', color: 'naranja', etiqueta: 'Facturas anuladas', valor: String(anuladas), extra: 'histórico' },
    { icono: 'moneda', color: 'morado', etiqueta: 'Total facturado (activas)', valor: formatearPesos(totalHistoricoActivo), extra: 'histórico' }
  ];

  contenedor.innerHTML = tarjetas.map(t => `
    <div class="kpi-tarjeta">
      <span class="kpi-tarjeta__icono indicador__icono--${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[t.icono]}</svg></span>
      <span class="kpi-tarjeta__etiqueta">${t.etiqueta}</span>
      <span class="kpi-tarjeta__valor">${t.valor}</span>
      <span class="kpi-tarjeta__delta">${t.extra}</span>
    </div>`).join('');

  document.getElementById('conteoTabFacturables').textContent = `(${totalFacturables})`;
  document.getElementById('conteoTabEmitidas').textContent = `(${historial.length})`;
}

async function generarFactura(ventaId) {
  const selectorModo = document.getElementById(`modoFacturar-${ventaId}`);
  const modo = selectorModo ? selectorModo.value : 'individual';
  try {
    const factura = await API.enviar('/api/facturacion/generar', { venta_id: ventaId, modo });
    mostrarAviso(`Factura ${factura.numero} generada`);
    if (factura.nota) setTimeout(() => mostrarAviso(factura.nota, 'error'), 1800);
    cargarVentasFacturables();
    cargarHistorialFacturas();
    verFactura(factura.id); // abre la vista imprimible de una vez
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 3. Historial de facturas ----
let paginaEmitidas = 1;

async function cargarHistorialFacturas() {
  const cuerpo = document.getElementById('cuerpoHistorialFacturas');
  try {
    window.historialFacturasEnMemoria = await API.obtener('/api/facturacion/historial');
    paginaEmitidas = 1;
    pintarKpisFacturacionParcial();
    pintarHistorialFiltrado();
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="7" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

const ICONO_OJO_FACT = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
const ICONO_IMPRIMIR = '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>';
const ICONO_COPIAR = '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>';
const ICONO_X_FACT = '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>';
const ICONO_BASURA_FACT = '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';

function copiarCufe(cufe) {
  navigator.clipboard.writeText(cufe).then(() => mostrarAviso('CUFE copiado'));
}

function pintarHistorialFiltrado() {
  const historial = window.historialFacturasEnMemoria || [];
  const texto = normalizarTextoFact(document.getElementById('buscadorEmitidas').value);
  let lista = historial;
  if (texto) {
    lista = lista.filter(f =>
      normalizarTextoFact(f.numero).includes(texto) ||
      normalizarTextoFact(f.ventas ? f.ventas.cliente : '').includes(texto));
  }

  const cuerpo = document.getElementById('cuerpoHistorialFacturas');
  const paginacion = document.getElementById('paginacionEmitidas');

  if (historial.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="7" class="tabla__vacio">Aún no se han emitido facturas.</td></tr>';
    paginacion.innerHTML = '';
    return;
  }
  if (lista.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="7" class="tabla__vacio">Ninguna factura coincide con la búsqueda.</td></tr>';
    paginacion.innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / FILAS_POR_PAGINA_FACT));
  if (paginaEmitidas > totalPaginas) paginaEmitidas = totalPaginas;
  const inicio = (paginaEmitidas - 1) * FILAS_POR_PAGINA_FACT;
  const pagina = lista.slice(inicio, inicio + FILAS_POR_PAGINA_FACT);

  cuerpo.innerHTML = pagina.map(f => `
    <tr>
      <td><strong>${escaparHtml(f.numero || '—')}</strong></td>
      <td>${formatearFecha(f.fecha)}</td>
      <td><span class="celda-cliente">${avatarFact(f.ventas ? f.ventas.cliente : '?')}${escaparHtml(f.ventas ? (f.ventas.cliente || 'Consumidor final') : '—')}</span></td>
      <td>${f.ventas ? formatearPesos(f.ventas.total) : '—'}</td>
      <td>${f.anulada ? '<span class="etiqueta-estado etiqueta-estado--critico">Anulada</span>' : '<span class="etiqueta-estado etiqueta-estado--listo">Activa</span>'}</td>
      <td>${f.cufe
        ? `<span class="celda-cliente">${escaparHtml(f.cufe.slice(0, 10))}… <button type="button" onclick="copiarCufe('${escaparHtml(f.cufe)}')" title="Copiar CUFE" style="background:none;border:none;cursor:pointer;color:var(--t-ink-tenue);display:inline-flex;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_COPIAR}</svg></button></span>`
        : '<span class="texto-secundario">Pendiente (modo interno)</span>'}</td>
      <td><span class="acciones-fila">
        <button type="button" onclick="verFactura('${f.id}')" title="Ver / imprimir"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_OJO_FACT}</svg></button>
        ${f.anulada
          ? `<button type="button" class="acciones-fila__peligro" onclick="eliminarFactura('${f.id}', '${escaparHtml(f.numero || '')}')" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_BASURA_FACT}</svg></button>`
          : `<button type="button" class="acciones-fila__peligro" onclick="anularFactura('${f.id}', '${escaparHtml(f.numero || '')}')" title="Anular"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_X_FACT}</svg></button>`}
      </span></td>
    </tr>`).join('');

  pintarPaginacionGenerica(paginacion, lista.length, totalPaginas, paginaEmitidas, (p) => { paginaEmitidas = p; pintarHistorialFiltrado(); }, 'facturas');
}

async function anularFactura(id, numero) {
  const motivo = prompt(`Vas a anular la factura ${numero || ''}. Esto no la borra (queda en el historial marcada como anulada, para conservar la numeración) y libera la venta para poder editar sus datos o facturarla de nuevo — no para eliminarla, la venta sigue ligada a esta factura anulada.\n\nEscribe el motivo:`);
  if (motivo === null) return; // canceló
  if (!motivo.trim()) { mostrarAviso('Necesitas escribir un motivo', 'error'); return; }

  try {
    await API.enviar(`/api/facturacion/${id}/anular`, { motivo });
    mostrarAviso('Factura anulada');
    cargarVentasFacturables();
    cargarHistorialFacturas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

async function eliminarFactura(id, numero) {
  const confirmar = confirm(`Vas a borrar DEFINITIVAMENTE la factura anulada ${numero || ''}. Esto deja un hueco en la numeración del consecutivo — aceptable en Modo interno, pero evítalo si ya validas ante la DIAN.\n\n¿Continuar?`);
  if (!confirmar) return;

  try {
    await API.eliminar(`/api/facturacion/${id}`);
    mostrarAviso('Factura eliminada');
    cargarHistorialFacturas();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Vista imprimible (para imprimir o guardar PDF y enviar al cliente) ----
let facturaEnMemoria = null;   // { factura, config } de la última factura abierta
let modoVistaFactura = 'individual'; // 'individual' | 'categorias'

async function verFactura(facturaId) {
  const modal = document.getElementById('modalFactura');
  const contenido = document.getElementById('contenidoFactura');
  contenido.innerHTML = '<p>Cargando…</p>';
  modal.hidden = false;

  try {
    facturaEnMemoria = await API.obtener(`/api/facturacion/${facturaId}/detalle`);
    modoVistaFactura = facturaEnMemoria.factura.modo_visualizacion === 'categorias' ? 'categorias' : 'individual';
    pintarFactura();
  } catch (err) {
    contenido.innerHTML = `<p class="tabla__vacio">Error: ${escaparHtml(err.message)}</p>`;
  }
}

// Cambia entre "Individual" (un renglón por cada línea tal como se
// vendió) y "Categorías" (agrupa y suma cantidades por categoría —
// ej: todas las "Amarilla" de la venta en un solo renglón, sin
// importar de qué producto vinieron). Queda guardado en la factura
// (no solo en la vista) para que la próxima vez que se abra o
// reimprima respete lo que pidió quien compró.
async function cambiarModoFactura(modo) {
  modoVistaFactura = modo;
  pintarFactura(); // respuesta visual inmediata, sin esperar al servidor

  if (facturaEnMemoria && facturaEnMemoria.factura.modo_visualizacion !== modo) {
    try {
      const actualizada = await API.actualizar(`/api/facturacion/${facturaEnMemoria.factura.id}/modo`, { modo });
      facturaEnMemoria.factura.modo_visualizacion = actualizada.modo_visualizacion;
    } catch (err) {
      mostrarAviso('No se pudo guardar el modo elegido: ' + err.message, 'error');
    }
  }
}

function agruparItemsPorCategoria(items) {
  const grupos = new Map();
  for (const i of items) {
    const clave = i.categoria ? i.categoria : (i.productos ? i.productos.nombre : 'Producto');
    const previo = grupos.get(clave) || { etiqueta: clave, cantidad: 0, subtotal: 0 };
    previo.cantidad += i.cantidad;
    previo.subtotal += i.cantidad * i.precio_unitario;
    grupos.set(clave, previo);
  }
  return [...grupos.values()];
}

function pintarFactura() {
  if (!facturaEnMemoria) return;
  const { factura, config } = facturaEnMemoria;
  const contenido = document.getElementById('contenidoFactura');
  const venta = factura.ventas;
  const items = venta.ventas_items || [];
  const tieneNit = !!(config && config.nit);
  const tieneResolucion = !!(config && config.resolucion_numero);

  const filasIndividual = items.map(i => `
    <tr>
      <td>${escaparHtml(i.productos ? i.productos.nombre : '')}${i.categoria ? ` <span class="texto-secundario">(${escaparHtml(i.categoria)})</span>` : ''}</td>
      <td>${i.cantidad}</td>
      <td>${formatearPesos(i.precio_unitario)}</td>
      <td>${formatearPesos(i.cantidad * i.precio_unitario)}</td>
    </tr>`).join('');

  const filasCategorias = agruparItemsPorCategoria(items).map(g => `
    <tr>
      <td>${escaparHtml(g.etiqueta)}</td>
      <td>${g.cantidad}</td>
      <td>${formatearPesos(g.cantidad > 0 ? g.subtotal / g.cantidad : 0)}</td>
      <td>${formatearPesos(g.subtotal)}</td>
    </tr>`).join('');

  contenido.innerHTML = `
      ${'' /* el toggle siempre se muestra: incluso sin categorías, "por categorías" agrupa por producto */}
      <div class="modal__acciones" style="margin-bottom:10px">
        <button type="button" class="boton boton--pequeno ${modoVistaFactura === 'individual' ? 'boton--primario' : ''}" onclick="cambiarModoFactura('individual')">Individual</button>
        <button type="button" class="boton boton--pequeno ${modoVistaFactura === 'categorias' ? 'boton--primario' : ''}" onclick="cambiarModoFactura('categorias')">Por categorías</button>
      </div>
      <div class="factura" id="areaImprimible">
        ${factura.anulada ? `<p class="indicador__valor--negativo" style="text-align:center;border:2px solid currentColor;padding:6px;margin:0 0 12px;font-weight:700">ANULADA — ${escaparHtml(factura.motivo_anulacion || '')} (${formatearFecha(factura.fecha_anulacion)})</p>` : ''}
        <header class="factura__encabezado">
          <div>
            <h2 style="margin:0">${escaparHtml(config ? config.razon_social : '')}</h2>
            ${tieneNit ? `<p class="texto-secundario" style="margin:2px 0">NIT: ${escaparHtml(config.nit)}</p>` : ''}
            ${tieneNit && config.regimen ? `<p class="texto-secundario" style="margin:2px 0">${escaparHtml(config.regimen)}</p>` : ''}
          </div>
          <div style="text-align:right">
            <h3 style="margin:0">${tieneResolucion ? 'Factura de venta' : 'Recibo'}</h3>
            <p style="margin:2px 0"><strong>${escaparHtml(factura.numero)}</strong></p>
            <p class="texto-secundario" style="margin:2px 0">${formatearFecha(factura.fecha)}</p>
          </div>
        </header>

        <p style="margin:12px 0 4px"><strong>Cliente:</strong> ${escaparHtml(venta.cliente || 'Consumidor final')}</p>

        <table class="tabla">
          <thead><tr><th>${modoVistaFactura === 'categorias' ? 'Categoría' : 'Producto'}</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${modoVistaFactura === 'categorias' ? filasCategorias : filasIndividual}
            <tr><td colspan="3" style="text-align:right"><strong>Total</strong></td><td><strong>${formatearPesos(venta.total)}</strong></td></tr>
          </tbody>
        </table>

        <footer class="texto-secundario" style="margin-top:16px">
          ${tieneResolucion
            ? `Resolución de facturación DIAN N° ${escaparHtml(config.resolucion_numero)} — numeración autorizada
               ${escaparHtml(String(config.resolucion_prefijo || ''))}${config.resolucion_desde} a
               ${escaparHtml(String(config.resolucion_prefijo || ''))}${config.resolucion_hasta}
               ${config.resolucion_vigencia ? ` — vigente hasta ${formatearFecha(config.resolucion_vigencia)}` : ''}.
               ${factura.cufe ? `<br>CUFE: ${escaparHtml(factura.cufe)}` : '<br>CUFE pendiente de validación ante la DIAN.'}`
            : ''}
        </footer>

        ${bloqueDatosPersonaYPago(config)}
      </div>`;
}

// Datos opcionales de la configuración: nombre de la persona, cédula y
// hasta 5 métodos de pago — solo se imprimen si de verdad se llenaron.
function bloqueDatosPersonaYPago(config) {
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
            <li>${ETIQUETA_TIPO_PAGO[m.tipo] || m.tipo}: ${escaparHtml(m.valor)}${m.etiqueta ? ` (${escaparHtml(m.etiqueta)})` : ''}</li>
          `).join('')}
        </ul>` : ''}
    </div>`;
}

function cerrarFactura() {
  document.getElementById('modalFactura').hidden = true;
  facturaEnMemoria = null;
}

// Imprime solo la factura (el CSS @media print oculta el resto).
// Desde el diálogo de impresión se puede "Guardar como PDF" y enviar
// al cliente por correo o WhatsApp.
function imprimirFactura() {
  window.print();
}

// ---- Utilidades ----
function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  cargarConfiguracionFiscal();
  cargarVentasFacturables();
  cargarHistorialFacturas();
});