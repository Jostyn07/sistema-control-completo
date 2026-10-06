// ============================================================
// finanzas.js — pestaña Finanzas (rediseño según Figma "Finanzas")
// Orden de la página:
//   1. Resumen del mes: 4 indicadores, desglose y meta de ventas
//   2. Ingresos vs. costos (histórico, independiente del mes)
//   3. Flujo de caja del mes y rentabilidad por producto
//   4. Clientes · histórico
//   5. Configuración financiera: costos fijos, capital + ROI, inventario
// El mes del resumen se elige arriba (?mes=AAAA-MM en la API); el
// gráfico, los clientes, el ROI y el inventario no dependen de él.
// Sin librerías: el gráfico se dibuja con divs y CSS, igual que antes.
// ============================================================

let costosFijosEnMemoria = [];
let metaVentasActual = null;
let fechaInicioOperacionActual = null;
let clientesEnMemoria = [];
let mostrarTodosLosClientes = false;

const NOMBRES_MES_CORTO = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const NOMBRES_MES_LARGO = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const CLIENTES_VISIBLES = 15;

// ---- Utilidades ----
function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

function icono(paths, clase = '') {
  return `<svg class="fz-icono ${clase}" viewBox="0 0 24 24" aria-hidden="true">${paths}</svg>`;
}
const ICONO_CAJA_ABIERTA = '<path d="M12 22v-9"/><path d="M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z"/><path d="M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13"/><path d="M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z"/>';
const ICONO_FLECHA = '<path d="M7 7h10v10"/><path d="M7 17 17 7"/>';
const ICONO_RECIBO = '<path d="M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z"/><path d="M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8"/><path d="M12 17.5v-11"/>';
const ICONO_DINERO = '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';

function vacio(simbolo, titulo, detalle, accion = '') {
  return `
    <div class="fz-vacio">
      <span class="fz-vacio__simbolo">${icono(simbolo, 'fz-icono--22')}</span>
      <div class="fz-vacio__texto"><strong>${titulo}</strong><span>${detalle}</span></div>
      ${accion}
    </div>`;
}

function claseSigno(valor) {
  return Number(valor) < 0 ? 'fz-negativo' : '';
}

// "14 ago 2026". Una fecha sin hora (AAAA-MM-DD) se lee como fecha local,
// para que no se corra un día por la zona horaria.
const MESES_FECHA = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
function formatearFechaCorta(fecha) {
  if (!fecha) return '—';
  const texto = String(fecha);
  const d = /^\d{4}-\d{2}-\d{2}$/.test(texto) ? new Date(texto + 'T00:00:00') : new Date(texto);
  if (isNaN(d)) return '—';
  return `${d.getDate()} ${MESES_FECHA[d.getMonth()]} ${d.getFullYear()}`;
}

function formatearPorcentaje(valor) {
  return `${Number(valor).toLocaleString('es-CO', { maximumFractionDigits: 1 })}%`;
}
// Compatibilidad con otras partes que usaban este nombre
const formatearFechaCliente = formatearFechaCorta;

function poner(id, html) {
  const el = document.getElementById(id);
  if (el) el.innerHTML = html;
}

// ---- Selector de mes (últimos 12 meses, el actual primero) ----
function claveMes(fecha) {
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, '0')}`;
}
function nombreMes(clave) {
  const [anio, mes] = clave.split('-').map(Number);
  return `${NOMBRES_MES_LARGO[mes - 1]} ${anio}`;
}
function mesSeleccionado() {
  const sel = document.getElementById('selectorMes');
  return sel && sel.value ? sel.value : claveMes(new Date());
}

function prepararSelectorMes() {
  const sel = document.getElementById('selectorMes');
  if (!sel || sel.options.length) return;
  const hoy = new Date();
  for (let i = 0; i < 12; i++) {
    const f = new Date(hoy.getFullYear(), hoy.getMonth() - i, 1);
    const opcion = document.createElement('option');
    opcion.value = claveMes(f);
    opcion.textContent = nombreMes(opcion.value);
    sel.appendChild(opcion);
  }
}

function cambiarMes() {
  cargarResumenFinanciero();
  cargarRentabilidadProductos();
}

function pintarEtiquetasDeMes() {
  const nombre = nombreMes(mesSeleccionado());
  document.querySelectorAll('[data-mes-etiqueta]').forEach(el => { el.textContent = nombre; });
  poner('subtituloGrafico', `Evolución histórica · independiente del resumen de ${escaparHtml(nombre.split(' ')[0].toLowerCase())}`);
}

// ============================================================
// 1. Resumen del mes + flujo de caja + ROI + inventario
//    (todo sale de GET /api/finanzas/resumen)
// ============================================================
async function cargarResumenFinanciero() {
  pintarEtiquetasDeMes();
  try {
    const r = await API.obtener(`/api/finanzas/resumen?mes=${encodeURIComponent(mesSeleccionado())}`);
    fechaInicioOperacionActual = r.fecha_inicio_operacion;

    // Indicadores principales
    poner('kpiIngresos', formatearPesos(r.ingresos_mes));
    poner('kpiIngresosNota', `${r.ventas_del_mes} venta${r.ventas_del_mes === 1 ? '' : 's'} registrada${r.ventas_del_mes === 1 ? '' : 's'}`);
    poner('kpiUtilidad', formatearPesos(r.utilidad_operativa_mes));
    document.getElementById('kpiUtilidad').className = `fz-indicador__valor ${claseSigno(r.utilidad_operativa_mes)}`;
    poner('kpiFlujo', formatearPesos(r.flujo_caja_mes));
    document.getElementById('kpiFlujo').className = `fz-indicador__valor ${claseSigno(r.flujo_caja_mes)}`;

    if (r.punto_equilibrio != null) {
      poner('kpiEquilibrio', formatearPesos(r.punto_equilibrio));
      poner('kpiEquilibrioNota', r.falta_para_equilibrio > 0
        ? `Faltan ${formatearPesos(r.falta_para_equilibrio)} en ventas`
        : 'Equilibrio superado este mes');
    } else {
      poner('kpiEquilibrio', '—');
      poner('kpiEquilibrioNota', escaparHtml(r.nota_equilibrio ? 'Se calcula con el mix real de lo vendido' : ''));
      document.getElementById('kpiEquilibrioNota').title = r.nota_equilibrio || '';
    }

    // Desglose del resultado
    poner('valorCostoVentas', formatearPesos(r.costo_ventas_mes));
    poner('valorNomina', formatearPesos(r.costos_nomina_mes));
    poner('valorUtilidadBruta', formatearPesos(r.utilidad_bruta_mes));
    document.getElementById('valorUtilidadBruta').className = `fz-desglose__valor ${claseSigno(r.utilidad_bruta_mes)}`;
    poner('detalleUtilidadBruta', r.margen_bruto_pct != null
      ? `Ingresos − costo de ventas − nómina · margen ${r.margen_bruto_pct}%`
      : 'Ingresos − costo de ventas − nómina');

    pintarPanelMeta(r);

    // Flujo de caja (ecuación)
    poner('cajaIngresos', formatearPesos(r.ingresos_mes));
    poner('cajaCompras', formatearPesos(r.compras_mes));
    poner('cajaFijos', formatearPesos(r.costos_fijos_mes));
    poner('cajaNomina', formatearPesos(r.costos_nomina_mes));
    poner('cajaNeta', formatearPesos(r.flujo_caja_mes));
    document.getElementById('cajaNeta').className = `fz-ecuacion__importe ${claseSigno(r.flujo_caja_mes)}`;

    // ROI acumulado (no depende del mes)
    const roi = document.getElementById('roiValor');
    if (r.roi_acumulado != null) {
      roi.textContent = formatearPorcentaje(r.roi_acumulado);
      roi.className = `fz-roi__valor ${r.roi_acumulado < 0 ? 'fz-negativo' : ''}`;
      poner('roiBase', r.fecha_inicio_operacion
        ? `${r.meses_operando} mes${r.meses_operando === 1 ? '' : 'es'} · desde ${escaparHtml(formatearFechaCorta(r.fecha_inicio_operacion))}`
        : `${r.meses_operando} mes${r.meses_operando === 1 ? '' : 'es'} · desde tu primera venta`);
    } else {
      roi.textContent = '—';
      roi.className = 'fz-roi__valor';
      poner('roiBase', 'Registra el capital invertido para calcularlo');
    }
    poner('roiUtilidad', formatearPesos(r.utilidad_acumulada));
    const nota = document.getElementById('notaRoi');
    if (r.nota_roi && r.roi_acumulado != null) {
      document.getElementById('notaRoiTexto').textContent = r.nota_roi;
      nota.hidden = false;
    } else {
      nota.hidden = true;
    }

    // Patrimonio
    poner('valorInventario', formatearPesos(r.valor_inventario));
  } catch (err) {
    poner('panelMeta', `<p class="fz-cargando">No se pudo cargar el resumen: ${escaparHtml(err.message)}</p>`);
    ['kpiIngresos', 'kpiUtilidad', 'kpiFlujo', 'kpiEquilibrio'].forEach(id => poner(id, '—'));
  }
}

// ---- Meta de ventas ----
function pintarPanelMeta(r) {
  metaVentasActual = r.meta_ventas_mensual;
  document.getElementById('botonMeta').textContent = r.meta_ventas_mensual == null ? 'Definir meta' : 'Cambiar meta';

  if (r.meta_ventas_mensual == null) {
    poner('panelMeta', `
      <div class="fz-meta__detalle">
        <div class="fz-meta__progreso">
          <div class="fz-meta__cifras"><span>${formatearPesos(r.ingresos_mes)} <span class="fz-texto-2">vendidos · sin meta definida</span></span></div>
          <div class="fz-barra"><div class="fz-barra__relleno" style="width:0%"></div></div>
        </div>
      </div>
      <p class="fz-meta__pie" style="margin-top:15px">Proyección de cierre al ritmo actual: ${formatearPesos(r.proyeccion_cierre_mes)}. Define una meta para ver cuánto necesitas vender por día.</p>`);
    return;
  }

  const pct = Math.min(100, r.avance_meta_pct || 0);
  const cumplida = (r.avance_meta_pct || 0) >= 100;

  let diaria;
  if (cumplida) diaria = `<span>Meta del mes</span><strong class="fz-positivo">Cumplida</strong>`;
  else if (r.dias_restantes_mes <= 0) diaria = `<span>Mes cerrado</span><strong>${formatearPesos(r.faltante_meta)}</strong>`;
  else diaria = `<span>Venta diaria necesaria · ${r.dias_restantes_mes} día${r.dias_restantes_mes === 1 ? '' : 's'}</span><strong>${formatearPesos(r.ritmo_necesario_diario)}</strong>`;

  const textoPie = r.ventas_del_mes > 0
    ? `Proyección de cierre al ritmo actual: ${formatearPesos(r.proyeccion_cierre_mes)}`
    : `Proyección de cierre al ritmo actual: ${formatearPesos(r.proyeccion_cierre_mes)} · Aún no hay ventas este mes.`;

  poner('panelMeta', `
    <div class="fz-meta__detalle">
      <div class="fz-meta__progreso">
        <div class="fz-meta__cifras">
          <span>${formatearPesos(r.ingresos_mes)} <span class="fz-texto-2">de ${formatearPesos(r.meta_ventas_mensual)}</span></span>
          <span class="fz-meta__pct">${formatearPorcentaje(r.avance_meta_pct)}</span>
        </div>
        <div class="fz-barra" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}">
          <div class="fz-barra__relleno ${cumplida ? 'fz-barra__relleno--cumplida' : ''}" style="width:${pct}%"></div>
        </div>
      </div>
      <span class="fz-meta__separador"></span>
      <div class="fz-meta__diaria">${diaria}</div>
    </div>
    <p class="fz-meta__pie" style="margin-top:15px">${textoPie}</p>`);
}

function abrirMetaVentas() {
  document.getElementById('campoMetaVentas').value = metaVentasActual ?? '';
  document.getElementById('modalMeta').hidden = false;
}
function cerrarMetaVentas() {
  document.getElementById('modalMeta').hidden = true;
}
async function guardarMetaVentas() {
  const valor = document.getElementById('campoMetaVentas').value;
  if (valor === '' || Number(valor) < 0) { mostrarAviso('La meta no es válida', 'error'); return; }
  try {
    await API.actualizar('/api/configuracion/meta-ventas', { meta_ventas_mensual: valor });
    mostrarAviso('Meta de ventas actualizada');
    cerrarMetaVentas();
    cargarResumenFinanciero();
  } catch (err) { mostrarAviso(err.message, 'error'); }
}

// ---- Fecha de inicio de operación (base del ROI) ----
function abrirFechaInicioRoi() {
  document.getElementById('campoFechaInicioRoi').value = fechaInicioOperacionActual || '';
  document.getElementById('modalFechaInicioRoi').hidden = false;
}
function cerrarFechaInicioRoi() {
  document.getElementById('modalFechaInicioRoi').hidden = true;
}
async function guardarFechaInicioRoi() {
  const valor = document.getElementById('campoFechaInicioRoi').value;
  if (!valor) { mostrarAviso('Elige una fecha', 'error'); return; }
  try {
    await API.actualizar('/api/configuracion/fecha-inicio-roi', { fecha_inicio_operacion: valor });
    mostrarAviso('Fecha de inicio actualizada');
    cerrarFechaInicioRoi();
    cargarResumenFinanciero();
  } catch (err) { mostrarAviso(err.message, 'error'); }
}

// ============================================================
// 2. Ingresos vs. costos (barras con divs, escala relativa)
// ============================================================
async function cargarGraficoMensual() {
  const contenedor = document.getElementById('graficoMensual');
  const etiquetas = document.getElementById('graficoMeses');
  const meses = document.getElementById('selectorMesesGrafico').value || 6;
  try {
    const historico = await API.obtener(`/api/finanzas/historico-mensual?meses=${meses}`);
    const maximo = Math.max(1, ...historico.map(h => Math.max(h.ingresos, h.costos_totales)));
    const guias = [0, 33.3, 66.6, 99.2].map(top => `<span class="fz-grafico__guia" style="top:${top}%"></span>`).join('');

    contenedor.innerHTML = guias + historico.map(h => {
      const [anio, mes] = h.mes.split('-');
      const alto = (v) => Math.max(1, Math.round((v / maximo) * 100));
      const titulo = `${NOMBRES_MES_LARGO[Number(mes) - 1]} ${anio} · Ingresos ${formatearPesos(h.ingresos)} · Costos ${formatearPesos(h.costos_totales)} · Utilidad ${formatearPesos(h.utilidad)}`;
      return `
        <div class="fz-grafico__mes" title="${escaparHtml(titulo)}">
          <div class="fz-grafico__barra fz-grafico__barra--ingresos" style="height:${alto(h.ingresos)}%"></div>
          <div class="fz-grafico__barra fz-grafico__barra--costos" style="height:${alto(h.costos_totales)}%"></div>
        </div>`;
    }).join('');

    etiquetas.innerHTML = historico.map(h => {
      const [anio, mes] = h.mes.split('-');
      return `<span>${NOMBRES_MES_CORTO[Number(mes) - 1]} ${anio.slice(2)}</span>`;
    }).join('');
  } catch (err) {
    contenedor.innerHTML = `<p class="fz-cargando">No se pudo cargar el gráfico: ${escaparHtml(err.message)}</p>`;
    etiquetas.innerHTML = '';
  }
}

// ============================================================
// 3. Rentabilidad por producto (lo realmente vendido en el mes)
// ============================================================
async function cargarRentabilidadProductos() {
  const cuerpo = document.getElementById('cuerpoRentabilidad');
  try {
    const [lista, productos] = await Promise.all([
      API.obtener(`/api/finanzas/rentabilidad-productos?mes=${encodeURIComponent(mesSeleccionado())}`),
      API.obtener('/api/productos').catch(() => [])
    ]);
    const fotoPorProducto = new Map((productos || []).map(p => [p.id, p.foto_url]));

    if (!lista.length) {
      cuerpo.innerHTML = vacio(ICONO_CAJA_ABIERTA,
        'Aún no hay ventas este mes para analizar',
        'Registra una venta para ver ingresos, costos y margen por producto.',
        `<a href="./ventas.html" class="fz-boton">${icono(ICONO_FLECHA)} Ir a Ventas</a>`);
      return;
    }

    cuerpo.innerHTML = lista.map(p => {
      const foto = fotoPorProducto.get(p.producto_id);
      const inicial = foto
        ? `<span class="fz-inicial"><img src="${escaparHtml(foto)}" alt=""></span>`
        : `<span class="fz-inicial">${escaparHtml((p.nombre || '?').trim().charAt(0).toUpperCase())}</span>`;
      return `
        <div class="fz-tabla__fila">
          <span class="fz-identidad">${inicial}<span>${escaparHtml(p.nombre)}</span></span>
          <span class="fz-derecha">${p.unidades}</span>
          <span class="fz-derecha">${formatearPesos(p.ingresos)}</span>
          <span class="fz-derecha fz-tenue">${formatearPesos(p.costo)}</span>
          <span class="fz-derecha ${claseSigno(p.margen)}">${formatearPesos(p.margen)} <span class="fz-tenue">(${p.margen_pct}%)</span></span>
          <span class="fz-derecha">${p.porcentaje_del_margen_total}%</span>
        </div>`;
    }).join('');
  } catch (err) {
    cuerpo.innerHTML = `<p class="fz-cargando">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

// ============================================================
// 4. Clientes · histórico (todo el historial)
// ============================================================
async function cargarAnalisisClientes() {
  try {
    const r = await API.obtener('/api/finanzas/clientes');
    const total = r.resumen.total_clientes;
    poner('resumenClientes', `
      <div class="fz-historico"><span>Clientes distintos</span><strong>${total}</strong><small>En todo el historial</small></div>
      <div class="fz-historico"><span>Clientes recurrentes</span><strong>${r.resumen.clientes_recurrentes}</strong><small>${formatearPorcentaje(r.resumen.pct_recurrentes)} del total</small></div>
      <div class="fz-historico"><span>Ticket promedio general</span><strong>${formatearPesos(r.resumen.ticket_promedio_general)}</strong><small>Por compra registrada</small></div>`);
    clientesEnMemoria = r.clientes || [];
    pintarClientes();
  } catch (err) {
    poner('cuerpoClientes', `<p class="fz-cargando">No se pudo cargar: ${escaparHtml(err.message)}</p>`);
    poner('pieClientes', '');
  }
}

function pintarClientes() {
  const lista = clientesEnMemoria;
  if (!lista.length) {
    poner('cuerpoClientes', vacio(ICONO_CAJA_ABIERTA, 'Aún no hay clientes', 'Aparecerán aquí cuando registres ventas con el nombre del cliente.'));
    poner('pieClientes', '');
    return;
  }
  const visibles = mostrarTodosLosClientes ? lista : lista.slice(0, CLIENTES_VISIBLES);
  poner('cuerpoClientes', visibles.map(c => `
    <div class="fz-tabla__fila">
      <span class="fz-identidad"><span class="fz-inicial">${escaparHtml((c.nombre || '?').trim().charAt(0).toUpperCase())}</span><span>${escaparHtml(c.nombre)}</span></span>
      <span class="fz-derecha">${c.compras}</span>
      <span class="fz-derecha">${formatearPesos(c.total_gastado)}</span>
      <span class="fz-derecha">${formatearPesos(c.ticket_promedio)}</span>
      <span class="fz-tenue">${escaparHtml(formatearFechaCorta(c.primera_compra))}</span>
      <span class="fz-tenue">${escaparHtml(formatearFechaCorta(c.ultima_compra))}</span>
      <span>${c.recurrente ? '<span class="fz-etiqueta">Recurrente</span>' : ''}</span>
    </div>`).join(''));

  const alternar = lista.length > CLIENTES_VISIBLES
    ? ` · <button type="button" class="fz-boton fz-boton--enlace" onclick="alternarClientes()">${mostrarTodosLosClientes ? 'Ver menos' : 'Ver todos'}</button>`
    : '';
  poner('pieClientes', `
    <span>${visibles.length} cliente${visibles.length === 1 ? '' : 's'} mostrado${visibles.length === 1 ? '' : 's'} · ${lista.length} en el historial${alternar}</span>
    <span>Ordenado por total gastado</span>`);
}

function alternarClientes() {
  mostrarTodosLosClientes = !mostrarTodosLosClientes;
  pintarClientes();
}

// ============================================================
// 5. Configuración financiera: costos fijos y capital
// ============================================================
async function cargarCostosFijos() {
  const cuerpo = document.getElementById('cuerpoCostosFijos');
  try {
    const r = await API.obtener('/api/finanzas/costos-fijos');
    costosFijosEnMemoria = r.lista;

    if (!r.lista.length) {
      cuerpo.innerHTML = `
        <div class="fz-vacio">
          <span class="fz-vacio__simbolo" style="background:none;width:auto;height:auto">${icono(ICONO_RECIBO, 'fz-icono--22')}</span>
          <div class="fz-vacio__texto"><strong style="font-size:13px">Sin costos fijos registrados</strong><span>Agrégalos para que la utilidad y el punto de equilibrio sean reales.</span></div>
          <span style="font-size:21px">${formatearPesos(0)}</span>
        </div>`;
      return;
    }
    cuerpo.innerHTML = r.lista.map(c => `
      <div class="fz-tabla__fila">
        <span>${escaparHtml(c.nombre)}</span>
        <span class="fz-derecha">${formatearPesos(c.valor_mensual)}</span>
        <span class="fz-costos__acciones">
          <button type="button" class="fz-boton fz-boton--mini" onclick="abrirCostoFijo('${c.id}')">Editar</button>
          <button type="button" class="fz-boton fz-boton--mini fz-boton--peligro" onclick="quitarCostoFijo('${c.id}')">Quitar</button>
        </span>
      </div>`).join('')
      + `<div class="fz-total"><span>Total mensual</span><strong>${formatearPesos(r.total)}</strong></div>`;
  } catch (err) {
    cuerpo.innerHTML = `<p class="fz-cargando">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

function abrirCostoFijo(id) {
  const titulo = document.getElementById('tituloCostoFijo');
  if (id) {
    const c = costosFijosEnMemoria.find(x => x.id === id);
    if (!c) return;
    titulo.textContent = 'Editar costo fijo';
    document.getElementById('campoCostoFijoId').value = c.id;
    document.getElementById('campoCostoFijoNombre').value = c.nombre;
    document.getElementById('campoCostoFijoValor').value = c.valor_mensual;
  } else {
    titulo.textContent = 'Nuevo costo fijo';
    document.getElementById('campoCostoFijoId').value = '';
    document.getElementById('campoCostoFijoNombre').value = '';
    document.getElementById('campoCostoFijoValor').value = '';
  }
  document.getElementById('modalCostoFijo').hidden = false;
}
function cerrarCostoFijo() {
  document.getElementById('modalCostoFijo').hidden = true;
}
async function guardarCostoFijo() {
  const datos = {
    id: document.getElementById('campoCostoFijoId').value || undefined,
    nombre: document.getElementById('campoCostoFijoNombre').value,
    valor_mensual: document.getElementById('campoCostoFijoValor').value
  };
  if (!datos.nombre.trim()) { mostrarAviso('El nombre es obligatorio', 'error'); return; }
  if (datos.valor_mensual === '' || Number(datos.valor_mensual) < 0) { mostrarAviso('El valor mensual no es válido', 'error'); return; }
  try {
    await API.enviar('/api/finanzas/costos-fijos', datos);
    mostrarAviso(datos.id ? 'Costo fijo actualizado' : 'Costo fijo agregado');
    cerrarCostoFijo();
    refrescarTodo();
  } catch (err) { mostrarAviso(err.message, 'error'); }
}
async function quitarCostoFijo(id) {
  const c = costosFijosEnMemoria.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`¿Quitar "${c.nombre}" de los costos fijos?`)) return;
  try {
    await API.eliminar(`/api/finanzas/costos-fijos/${id}`);
    mostrarAviso('Costo fijo quitado');
    refrescarTodo();
  } catch (err) { mostrarAviso(err.message, 'error'); }
}

async function cargarCapital() {
  const cuerpo = document.getElementById('cuerpoCapital');
  const total = document.getElementById('totalCapital');
  try {
    const r = await API.obtener('/api/finanzas/capital');
    if (!r.lista.length) {
      cuerpo.innerHTML = vacio(ICONO_DINERO, 'Sin aportes registrados', 'El ROI necesita el capital que has invertido en el negocio.');
      total.innerHTML = '';
      return;
    }
    cuerpo.innerHTML = r.lista.map(c => `
      <div class="fz-tabla__fila">
        <span class="fz-tenue">${escaparHtml(formatearFechaCorta(c.fecha))}</span>
        <span>${escaparHtml(c.concepto)}</span>
        <span class="fz-derecha ${claseSigno(c.valor)}" style="font-size:13px">${formatearPesos(c.valor)}</span>
      </div>`).join('');
    total.innerHTML = `<span>Total invertido</span><strong>${formatearPesos(r.total)}</strong>`;
  } catch (err) {
    cuerpo.innerHTML = `<p class="fz-cargando">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
    total.innerHTML = '';
  }
}

function abrirCapital() {
  document.getElementById('campoCapitalConcepto').value = '';
  document.getElementById('campoCapitalValor').value = '';
  document.getElementById('modalCapital').hidden = false;
}
function cerrarCapital() {
  document.getElementById('modalCapital').hidden = true;
}
async function guardarCapital() {
  const datos = {
    concepto: document.getElementById('campoCapitalConcepto').value,
    valor: document.getElementById('campoCapitalValor').value
  };
  if (!datos.concepto.trim()) { mostrarAviso('El concepto es obligatorio', 'error'); return; }
  if (datos.valor === '' || Number(datos.valor) === 0) { mostrarAviso('El valor debe ser distinto de 0', 'error'); return; }
  try {
    await API.enviar('/api/finanzas/capital', datos);
    mostrarAviso('Aporte registrado');
    cerrarCapital();
    refrescarTodo();
  } catch (err) { mostrarAviso(err.message, 'error'); }
}

// ---- Carga general ----
function refrescarTodo() {
  prepararSelectorMes();
  cargarResumenFinanciero();
  cargarGraficoMensual();
  cargarRentabilidadProductos();
  cargarAnalisisClientes();
  cargarCostosFijos();
  cargarCapital();
}

document.addEventListener('DOMContentLoaded', refrescarTodo);
