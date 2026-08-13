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
async function cargarVentasFacturables() {
  const cuerpo = document.getElementById('cuerpoFacturables');
  try {
    const ventas = await API.obtener('/api/facturacion/facturables');
    if (ventas.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="6" class="tabla__vacio">Todas las ventas registradas ya tienen factura.</td></tr>';
      return;
    }
    cuerpo.innerHTML = ventas.map(v => `
      <tr>
        <td>${formatearFecha(v.fecha)}</td>
        <td>${escaparHtml(v.cliente || 'Consumidor final')}</td>
        <td>${(v.ventas_items || []).map(i => `${i.cantidad}× ${escaparHtml(i.productos ? i.productos.nombre : '')}`).join(', ')}</td>
        <td>${formatearPesos(v.total)}</td>
        <td>${escaparHtml(v.estado)}</td>
        <td>
          <select id="modoFacturar-${v.id}" style="width:auto;display:inline-block;margin-right:6px">
            <option value="individual">Individual</option>
            <option value="categorias">Por categorías</option>
          </select>
          <button type="button" class="boton boton--pequeno boton--primario" onclick="generarFactura('${v.id}')">Generar factura</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
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
async function cargarHistorialFacturas() {
  const cuerpo = document.getElementById('cuerpoHistorialFacturas');
  try {
    const facturas = await API.obtener('/api/facturacion/historial');
    if (facturas.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="tabla__vacio">Aún no se han emitido facturas.</td></tr>';
      return;
    }
    cuerpo.innerHTML = facturas.map(f => `
      <tr>
        <td><strong>${escaparHtml(f.numero || '—')}</strong></td>
        <td>${formatearFecha(f.fecha)}</td>
        <td>${escaparHtml(f.ventas ? (f.ventas.cliente || 'Consumidor final') : '—')}</td>
        <td>${f.ventas ? formatearPesos(f.ventas.total) : '—'}</td>
        <td>${f.anulada ? '<span class="indicador__valor--negativo">Anulada</span>' : (f.estado === 'recibo_interno' ? 'Recibo interno' : f.estado === 'generada_interna' ? 'Generada (sin validar DIAN)' : escaparHtml(f.estado))}</td>
        <td>${f.cufe ? escaparHtml(f.cufe.slice(0, 12)) + '…' : 'Pendiente'}</td>
        <td>
          <button type="button" class="boton boton--pequeno" onclick="verFactura('${f.id}')">Ver / Imprimir</button>
          ${f.anulada
            ? `<button type="button" class="boton boton--pequeno boton--peligro" onclick="eliminarFactura('${f.id}', '${escaparHtml(f.numero || '')}')">Eliminar</button>`
            : `<button type="button" class="boton boton--pequeno boton--peligro" onclick="anularFactura('${f.id}', '${escaparHtml(f.numero || '')}')">Anular</button>`}
        </td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="7" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
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
      <td colspan="1"></td>
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