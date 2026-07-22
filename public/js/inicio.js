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

// ---- Alertas: lo que requiere acción hoy ----
function pintarAlertas({ rojosCompra, sinStock, sinFacturar }) {
  const seccion = document.getElementById('seccionAlertas');
  const alertas = [];

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
async function refrescarInicio() {
  const [, , compras, sinStock, sinFacturar] = await Promise.all([
    cargarIndicadores(),
    cargarResumenPedidos(),
    cargarResumenCompras(),
    cargarResumenCapacidad(),
    cargarResumenFacturacion()
  ]);
  pintarAlertas({ rojosCompra: compras.rojos, sinStock, sinFacturar });

  document.getElementById('indicadorFecha').textContent =
    new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  refrescarInicio();
  setInterval(refrescarInicio, SEGUNDOS_REFRESCO_INICIO * 1000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refrescarInicio();
  });
});
