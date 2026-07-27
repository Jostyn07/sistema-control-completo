// ============================================================
// admin.js — Panel de administrador del SaaS
// Reutiliza el mismo patrón de selector de período que Inicio
// (server/servicios/periodo.js), pero mirando TODOS los
// suscriptores, no un solo tenant.
// ============================================================

let periodoAdminActual = '30d';

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

function formatearFecha(fecha) {
  if (!fecha) return '—';
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

const ETIQUETA_ESTADO_SUSCRIPCION = {
  prueba: 'Prueba', activa: 'Activa', cancelada: 'Cancelada', vencida: 'Vencida', pendiente_pago: 'Pendiente de pago'
};

function inicializarSelectorPeriodoAdmin() {
  const contenedor = document.getElementById('selectorPeriodoAdmin');
  if (!contenedor) return;

  function marcarBotonActivo() {
    contenedor.querySelectorAll('button').forEach(btn => {
      btn.classList.toggle('boton--activo', btn.dataset.periodo === periodoAdminActual);
    });
  }
  marcarBotonActivo();

  contenedor.addEventListener('click', (ev) => {
    const boton = ev.target.closest('button[data-periodo]');
    if (!boton || boton.dataset.periodo === periodoAdminActual) return;
    periodoAdminActual = boton.dataset.periodo;
    marcarBotonActivo();
    cargarMetricas();
  });
}

async function cargarMetricas() {
  const panel = document.getElementById('panelMetricasAdmin');
  const resumenPlan = document.getElementById('resumenPorPlan');
  try {
    const r = await API.obtener(`/api/admin/metricas?periodo=${encodeURIComponent(periodoAdminActual)}`);

    panel.innerHTML = `
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">MRR</span>
        <span class="indicador__valor">${formatearPesos(r.mrr)}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Usuarios activos</span>
        <span class="indicador__valor">${r.usuarios_activos}</span>
        <span class="texto-secundario">incluye pruebas gratuitas</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Nuevos clientes</span>
        <span class="indicador__valor">${r.nuevos_clientes}</span>
      </div>
      <div class="indicador tarjeta">
        <span class="campo__etiqueta">Churn</span>
        <span class="indicador__valor ${r.churn > 0 ? 'indicador__valor--negativo' : ''}">${r.churn}</span>
      </div>`;

    resumenPlan.innerHTML = r.por_plan.length
      ? `<table class="tabla"><thead><tr><th>Plan</th><th>Clientes</th></tr></thead><tbody>
          ${r.por_plan.map(p => `<tr><td>${escaparHtml(p.nombre)}</td><td>${p.cantidad}</td></tr>`).join('')}
         </tbody></table>
         <p class="texto-secundario" style="margin-top:8px">${r.pruebas_gratuitas} de esos están en prueba gratuita ahora mismo.</p>`
      : '<p class="tabla__vacio">Sin suscripciones registradas.</p>';
  } catch (err) {
    panel.innerHTML = `<p class="tabla__vacio">No se pudieron cargar las métricas: ${escaparHtml(err.message)}</p>`;
  }
}

async function cargarClientes() {
  const contenedor = document.getElementById('tablaClientes');
  try {
    const clientes = await API.obtener('/api/admin/clientes');
    if (!clientes.length) {
      contenedor.innerHTML = '<p class="tabla__vacio">Sin clientes todavía.</p>';
      return;
    }
    contenedor.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Cliente</th><th>Plan</th><th>MRR</th><th>Inicio</th><th>Próximo cobro</th><th>Estado</th></tr></thead>
        <tbody>
          ${clientes.map(c => `
            <tr>
              <td>${escaparHtml(c.correo)}</td>
              <td>${escaparHtml(c.plan)}</td>
              <td>${c.mrr > 0 ? formatearPesos(c.mrr) : '—'}</td>
              <td>${formatearFecha(c.fecha_inicio)}</td>
              <td>${formatearFecha(c.fecha_vencimiento)}</td>
              <td>${ETIQUETA_ESTADO_SUSCRIPCION[c.estado] || escaparHtml(c.estado)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

function iniciarPanelAdmin() {
  inicializarSelectorPeriodoAdmin();
  cargarMetricas();
  cargarClientes();
}