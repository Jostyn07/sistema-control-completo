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
  document.getElementById('campoRazonSocial').value = c.razon_social || '';
  document.getElementById('campoNit').value = c.nit || '';
  document.getElementById('campoRegimen').value = c.regimen || '';
  document.getElementById('campoResolucionNumero').value = c.resolucion_numero || '';
  document.getElementById('campoResolucionPrefijo').value = c.resolucion_prefijo || '';
  document.getElementById('campoResolucionDesde').value = c.resolucion_desde || '';
  document.getElementById('campoResolucionHasta').value = c.resolucion_hasta || '';
  document.getElementById('campoResolucionVigencia').value = c.resolucion_vigencia || '';
  document.getElementById('modalConfiguracion').hidden = false;
}

function cerrarConfiguracion() {
  document.getElementById('modalConfiguracion').hidden = true;
}

async function guardarConfiguracionFiscal() {
  const datos = {
    razon_social: document.getElementById('campoRazonSocial').value,
    nit: document.getElementById('campoNit').value,
    regimen: document.getElementById('campoRegimen').value,
    resolucion_numero: document.getElementById('campoResolucionNumero').value,
    resolucion_prefijo: document.getElementById('campoResolucionPrefijo').value,
    resolucion_desde: document.getElementById('campoResolucionDesde').value,
    resolucion_hasta: document.getElementById('campoResolucionHasta').value,
    resolucion_vigencia: document.getElementById('campoResolucionVigencia').value || null
  };

  if (!datos.razon_social.trim() || !datos.nit.trim() || !datos.resolucion_numero.trim()
      || datos.resolucion_desde === '' || datos.resolucion_hasta === '') {
    mostrarAviso('Completa los campos obligatorios: razón social, NIT, resolución y rango de numeración', 'error');
    return;
  }

  try {
    configuracionEnMemoria = await API.enviar('/api/facturacion/configuracion', datos);
    mostrarAviso('Configuración fiscal guardada');
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
        <td><button type="button" class="boton boton--pequeno boton--primario" onclick="generarFactura('${v.id}')">Generar factura</button></td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="6" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

async function generarFactura(ventaId) {
  try {
    const factura = await API.enviar('/api/facturacion/generar', { venta_id: ventaId });
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
        <td>${f.estado === 'generada_interna' ? 'Generada (sin validar DIAN)' : escaparHtml(f.estado)}</td>
        <td>${f.cufe ? escaparHtml(f.cufe.slice(0, 12)) + '…' : 'Pendiente'}</td>
        <td><button type="button" class="boton boton--pequeno" onclick="verFactura('${f.id}')">Ver / Imprimir</button></td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="7" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

// ---- Vista imprimible (para imprimir o guardar PDF y enviar al cliente) ----
async function verFactura(facturaId) {
  const modal = document.getElementById('modalFactura');
  const contenido = document.getElementById('contenidoFactura');
  contenido.innerHTML = '<p>Cargando…</p>';
  modal.hidden = false;

  try {
    const { factura, config } = await API.obtener(`/api/facturacion/${facturaId}/detalle`);
    const venta = factura.ventas;
    const items = venta.ventas_items || [];

    contenido.innerHTML = `
      <div class="factura" id="areaImprimible">
        <header class="factura__encabezado">
          <div>
            <h2 style="margin:0">${escaparHtml(config ? config.razon_social : '')}</h2>
            <p class="texto-secundario" style="margin:2px 0">NIT: ${escaparHtml(config ? config.nit : '')}</p>
            ${config && config.regimen ? `<p class="texto-secundario" style="margin:2px 0">${escaparHtml(config.regimen)}</p>` : ''}
          </div>
          <div style="text-align:right">
            <h3 style="margin:0">Factura de venta</h3>
            <p style="margin:2px 0"><strong>${escaparHtml(factura.numero)}</strong></p>
            <p class="texto-secundario" style="margin:2px 0">${formatearFecha(factura.fecha)}</p>
          </div>
        </header>

        <p style="margin:12px 0 4px"><strong>Cliente:</strong> ${escaparHtml(venta.cliente || 'Consumidor final')}</p>

        <table class="tabla">
          <thead><tr><th>Producto</th><th>Cantidad</th><th>Precio unitario</th><th>Subtotal</th></tr></thead>
          <tbody>
            ${items.map(i => `
              <tr>
                <td>${escaparHtml(i.productos ? i.productos.nombre : '')}</td>
                <td>${i.cantidad}</td>
                <td>${formatearPesos(i.precio_unitario)}</td>
                <td>${formatearPesos(i.cantidad * i.precio_unitario)}</td>
              </tr>`).join('')}
            <tr><td colspan="3" style="text-align:right"><strong>Total</strong></td><td><strong>${formatearPesos(venta.total)}</strong></td></tr>
          </tbody>
        </table>

        <footer class="texto-secundario" style="margin-top:16px">
          ${config ? `Resolución de facturación DIAN N° ${escaparHtml(config.resolucion_numero)} — numeración autorizada
          ${escaparHtml(String(config.resolucion_prefijo || ''))}${config.resolucion_desde} a
          ${escaparHtml(String(config.resolucion_prefijo || ''))}${config.resolucion_hasta}
          ${config.resolucion_vigencia ? ` — vigente hasta ${formatearFecha(config.resolucion_vigencia)}` : ''}.` : ''}
          ${factura.cufe ? `<br>CUFE: ${escaparHtml(factura.cufe)}` : '<br>CUFE pendiente de validación ante la DIAN.'}
        </footer>
      </div>`;
  } catch (err) {
    contenido.innerHTML = `<p class="tabla__vacio">Error: ${escaparHtml(err.message)}</p>`;
  }
}

function cerrarFactura() {
  document.getElementById('modalFactura').hidden = true;
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
