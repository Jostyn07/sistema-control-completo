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

// ---- 1. Panel resumen ----
async function cargarResumenFinanciero() {
  const panel = document.getElementById('panelResumen');
  try {
    const r = await API.obtener('/api/finanzas/resumen');

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
    const subtextoRoi = r.roi_acumulado != null
      ? `Utilidad acumulada ${formatearPesos(r.utilidad_acumulada)} sobre ${formatearPesos(r.capital_invertido)} (${r.meses_operando} mes(es))`
      : (r.nota_roi || '');

    panel.innerHTML = `
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Ingresos del mes (${r.ventas_del_mes} venta(s))</span>
        <span class="indicador__valor">${formatearPesos(r.ingresos_mes)}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Costo de ventas</span>
        <span class="indicador__valor">${formatearPesos(r.costo_ventas_mes)}</span>
        <span class="texto-secundario">materiales + mano de obra de lo vendido</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Utilidad bruta</span>
        <span class="indicador__valor ${r.utilidad_bruta_mes >= 0 ? 'indicador__valor--positivo' : 'indicador__valor--negativo'}">${formatearPesos(r.utilidad_bruta_mes)}</span>
        ${r.margen_bruto_pct != null ? `<span class="texto-secundario">Margen bruto: ${r.margen_bruto_pct}%</span>` : ''}
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Costos fijos del mes</span>
        <span class="indicador__valor">${formatearPesos(r.costos_fijos_mes)}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Utilidad operativa</span>
        <span class="indicador__valor ${colorUtilidad}">${formatearPesos(r.utilidad_operativa_mes)}</span>
        <span class="texto-secundario">utilidad bruta − costos fijos</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Punto de equilibrio mensual</span>
        <span class="indicador__valor">${textoEquilibrio}</span>
        <span class="texto-secundario">${subtextoEquilibrio}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">ROI acumulado</span>
        <span class="indicador__valor ${r.roi_acumulado != null && r.roi_acumulado < 0 ? 'indicador__valor--negativo' : ''}">${textoRoi}</span>
        <span class="texto-secundario">${subtextoRoi}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Valor del inventario</span>
        <span class="indicador__valor">${formatearPesos(r.valor_inventario)}</span>
        <span class="texto-secundario">materiales sin vender, a su costo actual</span>
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
        </div>
        <div class="indicador tarjeta">
          <span class="campo__etiqueta">Compras del mes</span>
          <span class="indicador__valor">${formatearPesos(r.compras_mes)}</span>
          <span class="texto-secundario">materiales comprados, hayan llegado o no</span>
        </div>
        <div class="indicador tarjeta">
          <span class="campo__etiqueta">Costos fijos del mes</span>
          <span class="indicador__valor">${formatearPesos(r.costos_fijos_mes)}</span>
        </div>
        <div class="indicador tarjeta">
          <span class="campo__etiqueta">Flujo de caja neto</span>
          <span class="indicador__valor ${colorFlujo}">${formatearPesos(r.flujo_caja_mes)}</span>
          <span class="texto-secundario">ingresos − compras − costos fijos</span>
        </div>
      </div>`;
  } catch (err) {
    panel.innerHTML = `<p class="tabla__vacio">No se pudo cargar el resumen: ${escaparHtml(err.message)}</p>`;
    document.getElementById('panelFlujoCaja').innerHTML = '';
  }
}

// ---- Rentabilidad por producto (con lo REALMENTE vendido este mes) ----
async function cargarRentabilidadProductos() {
  const cuerpo = document.getElementById('cuerpoRentabilidad');
  try {
    const lista = await API.obtener('/api/finanzas/rentabilidad-productos');
    if (lista.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="6" class="tabla__vacio">Aún no hay ventas este mes para analizar.</td></tr>';
      return;
    }
    cuerpo.innerHTML = lista.map((p, i) => {
      let clase = '';
      if (p.margen < 0) clase = ' style="color:#b91c1c"';
      else if (i === 0) clase = ' style="color:#16a34a;font-weight:600"';
      return `
      <tr>
        <td${clase}>${escaparHtml(p.nombre)}</td>
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
  try {
    const historico = await API.obtener('/api/finanzas/historico-mensual?meses=6');
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