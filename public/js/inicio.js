// ============================================================
// inicio.js — página principal / dashboard
// No tiene backend propio: reúne en una sola vista los datos de
// los endpoints que ya existen en los 7 módulos.
//   /api/finanzas/resumen        → indicadores del mes
//   /api/compras/pendientes      → materiales por comprar
//   /api/ventas                  → pedidos activos
//   /api/inventario/capacidad    → cuánto se puede fabricar
//   /api/facturacion/facturables → ventas sin factura
// Se refresca solo cada 30 segundos y al volver a la pestaña.
// ============================================================

const SEGUNDOS_REFRESCO_INICIO = 30;
const CLAVE_PERIODO_GUARDADO = 'inicio_periodo_seleccionado';

// ---- Selector global de período ----
// Único estado de período para todo Inicio: cuando cambia, se vuelve a
// pedir el bloque de KPIs de Ventas (y, a futuro, cualquier otro bloque
// que dependa del mismo rango — gráfico ventas/utilidad, rendimiento
// por producto, etc., según se vayan agregando).
let periodoActual = localStorage.getItem(CLAVE_PERIODO_GUARDADO) || '30d';

function inicializarSelectorPeriodo() {
  const contenedor = document.getElementById('selectorPeriodo');
  if (!contenedor) return;

  function marcarBotonActivo() {
    contenedor.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('boton--activo', btn.dataset.periodo === periodoActual);
    });
  }
  marcarBotonActivo();

  contenedor.addEventListener('click', (ev) => {
    const boton = ev.target.closest('button[data-periodo]');
    if (!boton || boton.dataset.periodo === periodoActual) return;
    periodoActual = boton.dataset.periodo;
    localStorage.setItem(CLAVE_PERIODO_GUARDADO, periodoActual);
    marcarBotonActivo();
    cargarVentasPeriodo();
  });
}

// ---- KPIs de Ventas del período seleccionado, con comparación ----
function pintarKpiConVariacion(valorTexto, variacion, etiqueta) {
  const sinDatoPrevio = variacion.pct == null;
  const color = sinDatoPrevio ? '' : (variacion.pct >= 0 ? 'indicador__valor--positivo' : 'indicador__valor--negativo');
  const flecha = sinDatoPrevio ? '' : (variacion.pct >= 0 ? '▲ ' : '▼ ');
  return `
    <div class="indicador tarjeta">
      <span class="campo__etiqueta">${etiqueta}</span>
      <span class="indicador__valor">${valorTexto}</span>
      <span class="texto-secundario ${color}">${flecha}${variacion.texto}</span>
    </div>`;
}

async function cargarVentasPeriodo() {
  const panel = document.getElementById('panelVentasPeriodo');
  if (!panel) return;
  panel.innerHTML = '<p class="tabla__vacio">Cargando…</p>';
  try {
    const r = await API.obtener(`/api/dashboard/ventas?periodo=${encodeURIComponent(periodoActual)}`);

    if (!r.comparable) {
      panel.innerHTML = `<p class="tabla__vacio">Aún no hay un período anterior completo para comparar en este rango — es muy pronto para ver variaciones aquí. Mientras tanto, los números en bruto ya están en "Indicadores del mes" más abajo.</p>`;
      return;
    }

    panel.innerHTML =
      pintarKpiConVariacion(formatearPesos(r.ventas.valor), r.ventas.variacion, 'Ventas del período') +
      pintarKpiConVariacion(String(r.pedidos.valor), r.pedidos.variacion, 'Pedidos') +
      pintarKpiConVariacion(formatearPesos(r.ticket_promedio.valor), r.ticket_promedio.variacion, 'Ticket promedio') +
      pintarKpiConVariacion(r.margen_bruto_pct.valor != null ? `${r.margen_bruto_pct.valor}%` : '—', r.margen_bruto_pct.variacion, 'Margen bruto');
  } catch (err) {
    panel.innerHTML = `<p class="tabla__vacio">No se pudieron cargar los KPIs de ventas: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- KPIs de Inventario (foto del momento, sin período) ----
async function cargarInventarioKpis() {
  const panel = document.getElementById('panelInventarioKpis');
  if (!panel) return { stockBajo: 0, agotados: 0 };
  try {
    const r = await API.obtener('/api/dashboard/inventario');
    panel.innerHTML = `
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Valor del inventario</span>
        <span class="indicador__valor">${formatearPesos(r.valor_inventario)}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Materiales</span>
        <span class="indicador__valor">${r.total_materiales}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Stock bajo</span>
        <span class="indicador__valor ${r.stock_bajo > 0 ? 'indicador__valor--negativo' : ''}">${r.stock_bajo}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Agotados</span>
        <span class="indicador__valor ${r.agotados > 0 ? 'indicador__valor--negativo' : ''}">${r.agotados}</span>
      </div>`;
    return { stockBajo: r.stock_bajo, agotados: r.agotados };
  } catch (err) {
    panel.innerHTML = `<p class="tabla__vacio">No se pudieron cargar los KPIs de inventario: ${escaparHtml(err.message)}</p>`;
    return { stockBajo: 0, agotados: 0 };
  }
}

// ---- Indicadores financieros del mes ----
async function cargarIndicadores() {
  const panel = document.getElementById('panelIndicadores');
  try {
    const r = await API.obtener('/api/finanzas/resumen');
    const colorUtilidad = r.utilidad_mes >= 0 ? 'indicador__valor--positivo' : 'indicador__valor--negativo';

    let equilibrio = '—', subEquilibrio = r.nota_equilibrio || '';
    if (r.punto_equilibrio != null) {
      if (r.falta_para_equilibrio > 0) {
        equilibrio = formatearPesos(r.falta_para_equilibrio);
        subEquilibrio = 'faltan en ventas para el equilibrio del mes';
      } else {
        equilibrio = '✓ Superado';
        subEquilibrio = `punto de equilibrio: ${formatearPesos(r.punto_equilibrio)}`;
      }
    }

    panel.innerHTML = `
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Ingresos del mes</span>
        <span class="indicador__valor">${formatearPesos(r.ingresos_mes)}</span>
        <span class="texto-secundario">${r.ventas_del_mes} venta(s)</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Utilidad del mes</span>
        <span class="indicador__valor ${colorUtilidad}">${formatearPesos(r.utilidad_mes)}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Punto de equilibrio</span>
        <span class="indicador__valor">${equilibrio}</span>
        <span class="texto-secundario">${subEquilibrio}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">ROI acumulado</span>
        <span class="indicador__valor ${r.roi_acumulado != null && r.roi_acumulado < 0 ? 'indicador__valor--negativo' : ''}">${r.roi_acumulado != null ? r.roi_acumulado + '%' : '—'}</span>
        ${r.roi_acumulado == null ? `<span class="texto-secundario">${r.nota_roi || ''}</span>` : ''}
      </div>`;
    return r;
  } catch (err) {
    panel.innerHTML = `<p class="tabla__vacio">No se pudieron cargar los indicadores: ${escaparHtml(err.message)}</p>`;
    return null;
  }
}

// ---- Pedidos activos ----
async function cargarResumenPedidos() {
  const contenedor = document.getElementById('resumenPedidos');
  try {
    const ventas = await API.obtener('/api/ventas');
    const activos = ventas.filter(v => v.estado !== 'entregado');
    if (activos.length === 0) {
      contenedor.innerHTML = '<p class="texto-secundario">Sin pedidos pendientes de entregar.</p>';
      return 0;
    }
    const porEstado = { pendiente: 0, en_produccion: 0, listo: 0 };
    for (const v of activos) porEstado[v.estado] = (porEstado[v.estado] || 0) + 1;

    contenedor.innerHTML = `
      <p class="numero-resumen">${activos.length} <span class="texto-secundario">pedido(s) activo(s)</span></p>
      <p class="texto-secundario" style="margin:4px 0 0">
        ${porEstado.pendiente} pendiente(s) · ${porEstado.en_produccion} en producción · ${porEstado.listo} listo(s) para entregar
      </p>`;
    return activos.length;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">${escaparHtml(err.message)}</p>`;
    return 0;
  }
}

// ---- Materiales por comprar ----
async function cargarResumenCompras() {
  const contenedor = document.getElementById('resumenCompras');
  try {
    const pendientes = await API.obtener('/api/compras/pendientes');
    if (pendientes.length === 0) {
      contenedor.innerHTML = '<p class="texto-secundario">Todos los materiales están por encima de su punto de reorden.</p>';
      return { rojos: 0, total: 0 };
    }
    const rojos = pendientes.filter(p => p.estado === 'rojo');
    const costoTotal = pendientes.reduce((s, p) => s + p.costo_estimado, 0);

    contenedor.innerHTML = `
      <p class="numero-resumen">${pendientes.length} <span class="texto-secundario">material(es) por comprar</span></p>
      <p class="texto-secundario" style="margin:4px 0 0">
        ${rojos.length > 0 ? `<strong style="color:#b91c1c">${rojos.length} urgente(s): ${rojos.map(r => escaparHtml(r.nombre)).join(', ')}</strong> · ` : ''}
        costo estimado ${formatearPesos(costoTotal)}
      </p>`;
    return { rojos: rojos.length, total: pendientes.length };
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">${escaparHtml(err.message)}</p>`;
    return { rojos: 0, total: 0 };
  }
}

// ---- Capacidad de producción ----
async function cargarResumenCapacidad() {
  const contenedor = document.getElementById('resumenCapacidad');
  try {
    const capacidad = await API.obtener('/api/inventario/capacidad');
    if (capacidad.length === 0) {
      contenedor.innerHTML = '<p class="texto-secundario">Sin productos registrados todavía.</p>';
      return 0;
    }
    const sinStock = capacidad.filter(p => p.unidades_fabricables === 0);
    contenedor.innerHTML = capacidad.slice(0, 4).map(p => `
      <p style="margin:4px 0">
        <strong>${p.unidades_fabricables}</strong>× ${escaparHtml(p.nombre)}
        ${p.unidades_fabricables === 0 && p.material_limitante ? `<span class="texto-secundario" style="color:#b91c1c"> — falta ${escaparHtml(p.material_limitante.nombre)}</span>` : ''}
      </p>`).join('')
      + (capacidad.length > 4 ? `<p class="texto-secundario">y ${capacidad.length - 4} producto(s) más…</p>` : '');
    return sinStock.length;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">${escaparHtml(err.message)}</p>`;
    return 0;
  }
}

// ---- Por facturar ----
async function cargarResumenFacturacion() {
  const contenedor = document.getElementById('resumenFacturacion');
  try {
    const facturables = await API.obtener('/api/facturacion/facturables');
    if (facturables.length === 0) {
      contenedor.innerHTML = '<p class="texto-secundario">Todas las ventas tienen su factura.</p>';
      return 0;
    }
    const total = facturables.reduce((s, v) => s + Number(v.total), 0);
    contenedor.innerHTML = `
      <p class="numero-resumen">${facturables.length} <span class="texto-secundario">venta(s) sin factura</span></p>
      <p class="texto-secundario" style="margin:4px 0 0">por un total de ${formatearPesos(total)}</p>`;
    return facturables.length;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">${escaparHtml(err.message)}</p>`;
    return 0;
  }
}

// ---- Entregas próximas ----
async function cargarResumenEntregas() {
  const contenedor = document.getElementById('resumenEntregas');
  try {
    const entregas = await API.obtener('/api/ventas/por-entregar');
    if (entregas.length === 0) {
      contenedor.innerHTML = '<p class="texto-secundario">No hay entregas con fecha programada.</p>';
      return { vencidas: 0 };
    }
    const vencidas = entregas.filter(e => e.vencido);
    const hoy = entregas.filter(e => e.es_hoy);
    const proximas = entregas.filter(e => !e.vencido && !e.es_hoy).slice(0, 3);

    contenedor.innerHTML = `
      <p class="numero-resumen">${entregas.length} <span class="texto-secundario">entrega(s) programada(s)</span></p>
      <p class="texto-secundario" style="margin:4px 0 8px">
        ${vencidas.length > 0 ? `<strong style="color:#b91c1c">${vencidas.length} vencida(s)</strong> · ` : ''}
        ${hoy.length > 0 ? `<strong style="color:#c2410c">${hoy.length} hoy</strong> · ` : ''}
        ${proximas.length} próxima(s)
      </p>
      ${proximas.map(e => `<p style="margin:2px 0" class="texto-secundario">${escaparHtml(e.cliente || 'Sin nombre')} — ${new Date(e.fecha_entrega + 'T00:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}</p>`).join('')}`;
    return { vencidas: vencidas.length };
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">${escaparHtml(err.message)}</p>`;
    return { vencidas: 0 };
  }
}

// ---- Alertas: lo que requiere acción hoy ----
function pintarAlertas({ rojosCompra, sinStock, sinFacturar, entregasVencidas }) {
  const seccion = document.getElementById('seccionAlertas');
  const alertas = [];

  if (entregasVencidas > 0)
    alertas.push({ texto: `${entregasVencidas} entrega(s) vencida(s), sin marcar como entregadas.`, enlace: '/ventas.html', accion: 'Ver ventas' });
  if (rojosCompra > 0)
    alertas.push({ texto: `${rojosCompra} material(es) en zona roja: hay que comprar ya para no frenar la producción.`, enlace: '/compras.html', accion: 'Ver compras' });
  if (sinStock > 0)
    alertas.push({ texto: `${sinStock} producto(s) no se pueden fabricar con el stock actual.`, enlace: '/inventario.html', accion: 'Ver inventario' });
  if (sinFacturar > 0)
    alertas.push({ texto: `${sinFacturar} venta(s) sin factura generada.`, enlace: '/facturacion.html', accion: 'Facturar' });

  if (alertas.length === 0) {
    seccion.innerHTML = '';
    return;
  }
  seccion.innerHTML = alertas.map(a => `
    <div class="alerta">
      <span>${a.texto}</span>
      <a href="${a.enlace}" class="boton boton--pequeno">${a.accion}</a>
    </div>`).join('');
}

// ---- Orquestación ----
// ---- Estado de la suscripción: siempre visible, no como alerta ----
async function cargarEstadoSuscripcion() {
  const contenedor = document.getElementById('seccionSuscripcion');
  try {
    const r = await API.obtener('/api/suscripcion/mi-suscripcion');

    if (r.estado === 'prueba') {
      const diasRestantes = r.fecha_vencimiento
        ? Math.max(0, Math.ceil((new Date(r.fecha_vencimiento) - new Date()) / 86400000))
        : null;
      contenedor.innerHTML = `
        <div class="banner-suscripcion">
          <span>Prueba gratis${diasRestantes != null ? ` — quedan ${diasRestantes} día(s)` : ''}. No se te ha cobrado nada todavía.</span>
          <a href="suscripcion.html" class="boton boton--pequeno">Ver planes</a>
        </div>`;
      return;
    }
    if (r.estado === 'vencida' || r.estado === 'pendiente_pago' || r.estado === 'sin_suscripcion') {
      contenedor.innerHTML = `
        <div class="alerta">
          <span>${r.estado === 'sin_suscripcion' ? 'Aún no tienes ningún plan.' : 'Tu suscripción no está activa.'} Elige un plan para seguir usando el sistema sin interrupciones.</span>
          <a href="suscripcion.html" class="boton boton--pequeno">Ver planes</a>
        </div>`;
      return;
    }
    // estado === 'activa': no se muestra nada, no hace falta molestar a quien ya paga
    contenedor.innerHTML = '';
  } catch (err) {
    contenedor.innerHTML = '';
  }
}

async function refrescarInicio() {
  const [, , compras, sinStock, sinFacturar, entregas] = await Promise.all([
    cargarIndicadores(),
    cargarResumenPedidos(),
    cargarResumenCompras(),
    cargarResumenCapacidad(),
    cargarResumenFacturacion(),
    cargarResumenEntregas(),
    cargarVentasPeriodo(),
    cargarInventarioKpis()
  ]);
  pintarAlertas({ rojosCompra: compras.rojos, sinStock, sinFacturar, entregasVencidas: entregas.vencidas });
  cargarEstadoSuscripcion();

  document.getElementById('indicadorFecha').textContent =
    new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  inicializarSelectorPeriodo();
  refrescarInicio();
  setInterval(refrescarInicio, SEGUNDOS_REFRESCO_INICIO * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refrescarInicio();
  });
});