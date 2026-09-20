// ============================================================
// finanzas.js — pestaña Finanzas y Punto de Equilibrio
// Funciones (según estructura funcional):
//   cargarResumenFinanciero()
//   cargarCostosFijos()
//   guardarCostoFijo(datos)
//   cargarGraficoMensual()
// El gráfico se dibuja con divs y CSS (sin librerías, fiel al stack).
// ============================================================

let costosFijosEnMemoria = [];

// ---- Meta de ventas del mes ----
let metaVentasActual = null;

function pintarPanelMeta(r) {
  const contenedor = document.getElementById('panelMeta');
  metaVentasActual = r.meta_ventas_mensual;

  if (r.meta_ventas_mensual == null) {
    contenedor.innerHTML = `
      <p class="texto-secundario">Aún no has definido una meta de ventas para este mes.</p>
      <p class="texto-secundario">Con lo vendido hasta hoy (${formatearPesos(r.ingresos_mes)}), el ritmo actual proyecta cerrar el mes en <strong>${formatearPesos(r.proyeccion_cierre_mes)}</strong>.</p>`;
    return;
  }

  const pct = Math.min(100, r.avance_meta_pct);
  const colorBarra = r.avance_meta_pct >= 100 ? '#16a34a' : r.avance_meta_pct >= 70 ? '#0088b0' : '#eab308';

  let textoRitmo;
  if (r.avance_meta_pct >= 100) {
    textoRitmo = '¡Meta cumplida este mes!';
  } else if (r.dias_restantes_mes <= 0) {
    textoRitmo = 'El mes ya terminó sin alcanzar la meta.';
  } else {
    textoRitmo = `Necesitas vender ${formatearPesos(r.ritmo_necesario_diario)}/día en los ${r.dias_restantes_mes} día(s) que quedan para alcanzarla.`;
  }

  contenedor.innerHTML = `
    <div class="barra-progreso">
      <div class="barra-progreso__relleno" style="width:${pct}%;background:${colorBarra}"></div>
    </div>
    <p style="margin:8px 0 4px">
      <strong>${formatearPesos(r.ingresos_mes)}</strong> de <strong>${formatearPesos(r.meta_ventas_mensual)}</strong>
      <span class="texto-secundario">(${r.avance_meta_pct}%)</span>
    </p>
    <p class="texto-secundario" style="margin:0">${textoRitmo}</p>
    <p class="texto-secundario" style="margin:4px 0 0">Proyección de cierre al ritmo actual: ${formatearPesos(r.proyeccion_cierre_mes)}</p>`;
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
  if (valor === '' || Number(valor) < 0) {
    mostrarAviso('La meta no es válida', 'error');
    return;
  }
  try {
    await API.actualizar('/api/configuracion/meta-ventas', { meta_ventas_mensual: valor });
    mostrarAviso('Meta de ventas actualizada');
    cerrarMetaVentas();
    cargarResumenFinanciero();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Fecha de inicio de operación (base del ROI acumulado) ----
let fechaInicioOperacionActual = null;

function abrirFechaInicioRoi() {
  document.getElementById('campoFechaInicioRoi').value = fechaInicioOperacionActual || '';
  document.getElementById('modalFechaInicioRoi').hidden = false;
}

function cerrarFechaInicioRoi() {
  document.getElementById('modalFechaInicioRoi').hidden = true;
}

async function guardarFechaInicioRoi() {
  const valor = document.getElementById('campoFechaInicioRoi').value;
  if (!valor) {
    mostrarAviso('Elige una fecha', 'error');
    return;
  }
  try {
    await API.actualizar('/api/configuracion/fecha-inicio-roi', { fecha_inicio_operacion: valor });
    mostrarAviso('Fecha de inicio actualizada');
    cerrarFechaInicioRoi();
    cargarResumenFinanciero();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 1. Panel resumen ----
async function cargarResumenFinanciero() {
  const panel = document.getElementById('panelResumen');
  try {
    const r = await API.obtener('/api/finanzas/resumen');
    pintarPanelMeta(r);
    fechaInicioOperacionActual = r.fecha_inicio_operacion;

    const colorUtilidad = r.utilidad_mes >= 0 ? 'indicador__valor--positivo' : 'indicador__valor--negativo';
    const colorFlujo = r.flujo_caja_mes >= 0 ? 'indicador__valor--positivo' : 'indicador__valor--negativo';

    let textoEquilibrio, subtextoEquilibrio = '';
    if (r.punto_equilibrio != null) {
      textoEquilibrio = formatearPesos(r.punto_equilibrio);
      subtextoEquilibrio = r.falta_para_equilibrio > 0
        ? `Faltan ${formatearPesos(r.falta_para_equilibrio)} en ventas este mes`
        : '¡Equilibrio superado este mes!';
    } else {
      textoEquilibrio = '—';
      subtextoEquilibrio = r.nota_equilibrio || '';
    }

    const textoRoi = r.roi_acumulado != null ? `${r.roi_acumulado}%` : '—';
    let subtextoRoi;
    if (r.roi_acumulado != null) {
      const baseFecha = r.fecha_inicio_operacion
        ? `desde ${formatearFechaCliente(r.fecha_inicio_operacion + 'T00:00:00')}`
        : `${r.meses_operando} mes(es), desde tu primera venta`;
      subtextoRoi = `Utilidad acumulada ${formatearPesos(r.utilidad_acumulada)} sobre ${formatearPesos(r.capital_invertido)} (${baseFecha})`;
      if (r.nota_roi) subtextoRoi += ` · ${r.nota_roi}`;
    } else {
      subtextoRoi = r.nota_roi || '';
    }

    const ICONO_MONEDA = '<path d="M12 1v22M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>';
    const ICONO_CARRITO_F = '<circle cx="9" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2 3h2l2.6 12.4a2 2 0 0 0 2 1.6h9a2 2 0 0 0 2-1.6L22 7H6"/>';
    const ICONO_PERSONAS_F = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>';
    const ICONO_TENDENCIA = '<path d="M3 17 9 11l4 4 8-8"/><path d="M15 7h6v6"/>';
    const ICONO_ETIQUETA_F = '<path d="M20.59 13.41 12 22l-10-10L11.59 2.41A2 2 0 0 1 13 2h7a2 2 0 0 1 2 2v7a2 2 0 0 1-.41 1.41Z"/><circle cx="16" cy="8" r="1.5"/>';
    const ICONO_BLANCO_F = '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>';
    const ICONO_RELOJ_F = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';
    const ICONO_CAPAS_F = '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>';

    function iconoInd(color, svg) {
      return `<span class="indicador__icono indicador__icono--${color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${svg}</svg></span>`;
    }

    panel.innerHTML = `
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Ingresos del mes (${r.ventas_del_mes} venta(s))</span>
        <span class="indicador__valor">${formatearPesos(r.ingresos_mes)}</span>
        ${iconoInd('azul', ICONO_MONEDA)}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Costo de ventas</span>
        <span class="indicador__valor">${formatearPesos(r.costo_ventas_mes)}</span>
        <span class="texto-secundario">materiales + mano de obra de lo vendido</span>
        ${iconoInd('naranja', ICONO_CARRITO_F)}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Nómina pagada</span>
        <span class="indicador__valor">${formatearPesos(r.costos_nomina_mes)}</span>
        <span class="texto-secundario">confirmada como pagada en Nóminas este mes — cuenta como gasto variable</span>
        ${iconoInd('morado', ICONO_PERSONAS_F)}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Utilidad bruta</span>
        <span class="indicador__valor ${r.utilidad_bruta_mes >= 0 ? 'indicador__valor--positivo' : 'indicador__valor--negativo'}">${formatearPesos(r.utilidad_bruta_mes)}</span>
        ${r.margen_bruto_pct != null ? `<span class="texto-secundario">Margen bruto: ${r.margen_bruto_pct}%</span>` : ''}
        ${iconoInd('verde', ICONO_TENDENCIA)}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Costos fijos del mes</span>
        <span class="indicador__valor">${formatearPesos(r.costos_fijos_mes)}</span>
        ${iconoInd('naranja', ICONO_ETIQUETA_F)}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Utilidad operativa</span>
        <span class="indicador__valor ${colorUtilidad}">${formatearPesos(r.utilidad_operativa_mes)}</span>
        <span class="texto-secundario">utilidad bruta − costos fijos</span>
        ${iconoInd('azul', ICONO_TENDENCIA)}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Punto de equilibrio mensual</span>
        <span class="indicador__valor">${textoEquilibrio}</span>
        <span class="texto-secundario">${subtextoEquilibrio}</span>
        ${iconoInd('azul', ICONO_BLANCO_F)}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">ROI acumulado</span>
        <span class="indicador__valor ${r.roi_acumulado != null && r.roi_acumulado < 0 ? 'indicador__valor--negativo' : ''}">${textoRoi}</span>
        <span class="texto-secundario">${subtextoRoi}</span>
        ${iconoInd('morado', ICONO_RELOJ_F)}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Valor del inventario</span>
        <span class="indicador__valor">${formatearPesos(r.valor_inventario)}</span>
        <span class="texto-secundario">materiales sin vender, a su costo actual</span>
        ${iconoInd('verde', ICONO_CAPAS_F)}
      </div>`;

    document.getElementById('panelFlujoCaja').innerHTML = `
      <p class="texto-secundario" style="margin:0 0 10px">
        Esto es distinto a la "Utilidad del mes" de arriba: ahí se mide cuánto costó fabricar lo que <strong>se vendió</strong>.
        Aquí se mide el dinero que realmente <strong>entró y salió</strong> este mes, incluyendo lo que gastaste comprando materiales
        (los hayas usado ya o no).
      </p>
      <div class="panel-finanzas" style="margin-bottom:0">
        <div class="indicador tarjeta">
          <span class="campo__etiqueta">Ingresos del mes</span>
          <span class="indicador__valor">${formatearPesos(r.ingresos_mes)}</span>
          ${iconoInd('verde', ICONO_MONEDA)}
        </div>
        <div class="indicador tarjeta">
          <span class="campo__etiqueta">Compras de materiales</span>
          <span class="indicador__valor">${formatearPesos(r.compras_mes)}</span>
          <span class="texto-secundario">materiales comprados, hayan llegado o no</span>
          ${iconoInd('naranja', ICONO_CARRITO_F)}
        </div>
        <div class="indicador tarjeta">
          <span class="campo__etiqueta">Costos fijos</span>
          <span class="indicador__valor">${formatearPesos(r.costos_fijos_mes)}</span>
          ${iconoInd('morado', ICONO_ETIQUETA_F)}
        </div>
        <div class="indicador tarjeta">
          <span class="campo__etiqueta">Nómina pagada</span>
          <span class="indicador__valor">${formatearPesos(r.costos_nomina_mes)}</span>
          ${iconoInd('azul', ICONO_PERSONAS_F)}
        </div>
        <div class="indicador tarjeta">
          <span class="campo__etiqueta">Flujo de caja neto</span>
          <span class="indicador__valor ${colorFlujo}">${formatearPesos(r.flujo_caja_mes)}</span>
          <span class="texto-secundario">ingresos − compras − costos fijos − nómina pagada</span>
          ${iconoInd('verde', ICONO_MONEDA)}
        </div>
      </div>`;
  } catch (err) {
    panel.innerHTML = `<p class="tabla__vacio">No se pudo cargar el resumen: ${escaparHtml(err.message)}</p>`;
    document.getElementById('panelFlujoCaja').innerHTML = '';
    document.getElementById('panelMeta').innerHTML = '';
  }
}

// ---- Rentabilidad por producto (con lo REALMENTE vendido este mes) ----
// ---- Análisis de clientes ----
async function cargarAnalisisClientes() {
  const resumen = document.getElementById('resumenClientes');
  const cuerpo = document.getElementById('cuerpoClientes');
  try {
    const r = await API.obtener('/api/finanzas/clientes');

    resumen.innerHTML = `
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Clientes distintos</span>
        <span class="indicador__valor">${r.resumen.total_clientes}</span>
        <span class="indicador__icono indicador__icono--azul"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg></span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Clientes recurrentes</span>
        <span class="indicador__valor">${r.resumen.clientes_recurrentes}</span>
        <span class="texto-secundario">${r.resumen.pct_recurrentes}% del total</span>
        <span class="indicador__icono indicador__icono--verde"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg></span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Ticket promedio general</span>
        <span class="indicador__valor">${formatearPesos(r.resumen.ticket_promedio_general)}</span>
        <span class="indicador__icono indicador__icono--morado"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V6l-3-4Z"/><path d="M16 10a4 4 0 0 1-8 0"/></svg></span>
      </div>`;

    if (r.clientes.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="tabla__vacio">Aún no hay ventas registradas.</td></tr>';
      return;
    }

    cuerpo.innerHTML = r.clientes.map((c, i) => `
      <tr>
        <td${i === 0 ? ' style="font-weight:600"' : ''}><span class="celda-cliente"><span class="avatar-inicial">${escaparHtml((c.nombre || '?').trim().charAt(0).toUpperCase())}</span>${escaparHtml(c.nombre)}</span></td>
        <td>${c.compras}</td>
        <td>${formatearPesos(c.total_gastado)}</td>
        <td>${formatearPesos(c.ticket_promedio)}</td>
        <td>${formatearFechaCliente(c.primera_compra)}</td>
        <td>${formatearFechaCliente(c.ultima_compra)}</td>
        <td>${c.recurrente ? '<span class="etiqueta-estado etiqueta-estado--listo">Recurrente</span>' : ''}</td>
      </tr>`).join('');
  } catch (err) {
    resumen.innerHTML = '';
    cuerpo.innerHTML = `<tr><td colspan="7" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function formatearFechaCliente(fecha) {
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

async function cargarRentabilidadProductos() {
  const cuerpo = document.getElementById('cuerpoRentabilidad');
  try {
    const [lista, productos] = await Promise.all([
      API.obtener('/api/finanzas/rentabilidad-productos'),
      API.obtener('/api/productos').catch(() => [])
    ]);
    const fotoPorProducto = new Map(productos.map(p => [p.id, p.foto_url]));

    if (lista.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="6" class="tabla__vacio">Aún no hay ventas este mes para analizar.</td></tr>';
      return;
    }
    cuerpo.innerHTML = lista.map((p, i) => {
      let clase = '';
      if (p.margen < 0) clase = ' style="color:#b91c1c"';
      else if (i === 0) clase = ' style="color:#16a34a;font-weight:600"';
      const foto = fotoPorProducto.get(p.producto_id);
      const miniatura = foto
        ? `<img src="${escaparHtml(foto)}" class="miniatura" alt="">`
        : `<span class="miniatura miniatura--vacia"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/></svg></span>`;
      return `
      <tr>
        <td${clase}><span class="celda-cliente">${miniatura}${escaparHtml(p.nombre)}</span></td>
        <td>${p.unidades}</td>
        <td>${formatearPesos(p.ingresos)}</td>
        <td>${formatearPesos(p.costo)}</td>
        <td${clase}>${formatearPesos(p.margen)} (${p.margen_pct}%)</td>
        <td>${p.porcentaje_del_margen_total}%</td>
      </tr>`;
    }).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

// ---- 2. Costos fijos ----
async function cargarCostosFijos() {
  const cuerpo = document.getElementById('cuerpoCostosFijos');
  try {
    const r = await API.obtener('/api/finanzas/costos-fijos');
    costosFijosEnMemoria = r.lista;

    if (r.lista.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Sin costos fijos registrados. Agrégalos para que la utilidad y el punto de equilibrio sean reales.</td></tr>';
      return;
    }
    cuerpo.innerHTML = r.lista.map(c => `
      <tr>
        <td>${escaparHtml(c.nombre)}</td>
        <td>${formatearPesos(c.valor_mensual)}</td>
        <td class="tabla__acciones">
          <button type="button" class="boton boton--pequeno" onclick="abrirCostoFijo('${c.id}')">Editar</button>
          <button type="button" class="boton boton--pequeno boton--peligro" onclick="quitarCostoFijo('${c.id}')">Quitar</button>
        </td>
      </tr>`).join('')
      + `<tr><td><strong>Total mensual</strong></td><td><strong>${formatearPesos(r.total)}</strong></td><td></td></tr>`;
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="3" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
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
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

async function quitarCostoFijo(id) {
  const c = costosFijosEnMemoria.find(x => x.id === id);
  if (!c) return;
  if (!confirm(`¿Quitar "${c.nombre}" de los costos fijos?`)) return;
  try {
    await API.eliminar(`/api/finanzas/costos-fijos/${id}`);
    mostrarAviso('Costo fijo quitado');
    refrescarTodo();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Capital invertido ----
async function cargarCapital() {
  const cuerpo = document.getElementById('cuerpoCapital');
  try {
    const r = await API.obtener('/api/finanzas/capital');
    if (r.lista.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="3" class="tabla__vacio">Sin aportes registrados. El ROI necesita el capital invertido.</td></tr>';
      return;
    }
    cuerpo.innerHTML = r.lista.map(c => `
      <tr>
        <td>${new Date(c.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
        <td>${escaparHtml(c.concepto)}</td>
        <td>${formatearPesos(c.valor)}</td>
      </tr>`).join('')
      + `<tr><td></td><td><strong>Total</strong></td><td><strong>${formatearPesos(r.total)}</strong></td></tr>`;
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="3" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
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
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 3. Gráfico mensual (divs + CSS, sin librerías) ----
async function cargarGraficoMensual() {
  const contenedor = document.getElementById('graficoMensual');
  const selector = document.getElementById('selectorMesesGrafico');
  const meses = selector ? selector.value : 6;
  try {
    const historico = await API.obtener(`/api/finanzas/historico-mensual?meses=${meses}`);
    const maximo = Math.max(1, ...historico.map(h => Math.max(h.ingresos, h.costos_totales)));

    const NOMBRES_MES = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

    contenedor.innerHTML = historico.map(h => {
      const [anio, mes] = h.mes.split('-');
      const alturaIngresos = Math.round((h.ingresos / maximo) * 100);
      const alturaCostos = Math.round((h.costos_totales / maximo) * 100);
      return `
        <div class="grafico__mes" title="Ingresos: ${formatearPesos(h.ingresos)} · Costos: ${formatearPesos(h.costos_totales)} · Utilidad: ${formatearPesos(h.utilidad)}">
          <div class="grafico__barras">
            <div class="grafico__barra grafico__barra--ingresos" style="height:${alturaIngresos}%"></div>
            <div class="grafico__barra grafico__barra--costos" style="height:${alturaCostos}%"></div>
          </div>
          <span class="grafico__etiqueta">${NOMBRES_MES[Number(mes) - 1]} ${anio.slice(2)}</span>
        </div>`;
    }).join('');
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar el gráfico: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- Utilidades ----
function refrescarTodo() {
  cargarResumenFinanciero();
  cargarRentabilidadProductos();
  cargarAnalisisClientes();
  cargarCostosFijos();
  cargarCapital();
  cargarGraficoMensual();
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', refrescarTodo);