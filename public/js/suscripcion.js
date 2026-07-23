// ============================================================
// suscripcion.js — pestaña Suscripción
// Funciones:
//   cargarEstadoActual()
//   cargarPlanes()
//   elegirPlan(planId)   → abre el checkout de ePayco
// La activación real NUNCA pasa por aquí — solo por el webhook del
// backend, que valida la firma de ePayco antes de activar nada.
// ============================================================

const ETIQUETA_ESTADO_SUSCRIPCION = {
  prueba: 'Prueba gratis',
  activa: 'Activa',
  vencida: 'Vencida',
  cancelada: 'Cancelada',
  pendiente_pago: 'Pendiente de pago',
  sin_suscripcion: 'Sin suscripción todavía'
};

async function cargarEstadoActual() {
  const contenedor = document.getElementById('estadoActual');
  try {
    const r = await API.obtener('/api/suscripcion/mi-suscripcion');
    const plan = r.planes_suscripcion;

    if (r.estado === 'sin_suscripcion') {
      contenedor.innerHTML = '<p class="texto-secundario">Aún no tienes ningún plan activo. Elige uno abajo para empezar.</p>';
      return;
    }

    let notaEstado = '';
    if (r.estado === 'prueba' && r.fecha_vencimiento) {
      const diasRestantes = Math.max(0, Math.ceil((new Date(r.fecha_vencimiento) - new Date()) / 86400000));
      notaEstado = diasRestantes > 0
        ? `<p class="texto-secundario" style="margin:4px 0 0">Te quedan ${diasRestantes} día(s) de prueba gratis.</p>`
        : '<p class="texto-secundario" style="margin:4px 0 0">Tu prueba gratis ya terminó.</p>';
    } else if (r.estado === 'vencida') {
      notaEstado = '<p class="texto-secundario" style="margin:4px 0 0;color:#b91c1c">Elige un plan para seguir usando el sistema sin interrupciones.</p>';
    }

    contenedor.innerHTML = `
      <div class="indicador">
        <span class="campo__etiqueta">Estado</span>
        <strong style="font-size:1.2rem">${ETIQUETA_ESTADO_SUSCRIPCION[r.estado] || r.estado}</strong>
      </div>
      ${plan ? `<p style="margin:8px 0 0">Plan actual: <strong>${escaparHtml(plan.nombre)}</strong> — ${formatearPesos(plan.precio_mensual)}/mes</p>` : ''}
      ${r.fecha_vencimiento ? `<p class="texto-secundario" style="margin:4px 0 0">Vence: ${new Date(r.fecha_vencimiento).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}</p>` : ''}
      ${notaEstado}
    `;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

async function cargarPlanes() {
  const contenedor = document.getElementById('listaPlanes');
  try {
    const planes = await API.obtener('/api/suscripcion/planes');
    if (planes.length === 0) {
      contenedor.innerHTML = '<p class="tabla__vacio">No hay planes disponibles todavía.</p>';
      return;
    }

    // El plan más caro se marca como recomendado — misma lógica que
    // usamos para decidir el plan de la prueba gratis.
    const idMasCaro = planes.reduce((a, b) => Number(b.precio_mensual) > Number(a.precio_mensual) ? b : a).id;

    contenedor.innerHTML = `<div class="planes-comparacion">` + planes.map(p => {
      const destacado = p.id === idMasCaro;
      const filas = [
        { texto: p.limite_materiales != null ? `Hasta ${p.limite_materiales} materiales` : 'Materiales ilimitados', si: true },
        { texto: p.limite_productos != null ? `Hasta ${p.limite_productos} productos` : 'Productos ilimitados', si: true },
        { texto: p.limite_ventas_mes != null ? `Hasta ${p.limite_ventas_mes} ventas al mes` : 'Ventas ilimitadas', si: true },
        { texto: 'Rentabilidad por producto', si: p.incluye_rentabilidad_productos },
        { texto: 'Análisis de clientes', si: p.incluye_analisis_clientes },
        { texto: 'Meta de ventas y proyección', si: p.incluye_meta_ventas },
        { texto: 'Valor del inventario', si: p.incluye_valor_inventario }
      ];

      return `
      <article class="tarjeta-plan${destacado ? ' tarjeta-plan--destacado' : ''}">
        ${destacado ? '<span class="tarjeta-plan__badge">Recomendado</span>' : ''}
        <h3 class="tarjeta-plan__nombre">${escaparHtml(p.nombre)}</h3>
        <p class="tarjeta-plan__precio">${formatearPesos(p.precio_mensual)}<span>/mes</span></p>
        <p class="tarjeta-plan__descuento">50% de descuento tu primer mes</p>
        <p class="tarjeta-plan__descripcion">${escaparHtml(p.descripcion || '')}</p>
        <ul class="tarjeta-plan__lista">
          ${filas.map(f => `
            <li class="tarjeta-plan__fila${f.si ? '' : ' tarjeta-plan__fila--no'}">
              <span class="tarjeta-plan__icono tarjeta-plan__icono--${f.si ? 'si' : 'no'}">${f.si ? '✓' : '–'}</span>
              <span>${escaparHtml(f.texto)}</span>
            </li>`).join('')}
        </ul>
        <button type="button" class="boton ${destacado ? 'boton--primario' : ''} boton--ancho" onclick="elegirPlan('${p.id}')">Elegir ${escaparHtml(p.nombre)}</button>
      </article>`;
    }).join('') + `</div>`;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

async function elegirPlan(planId) {
  try {
    const datos = await API.enviar('/api/suscripcion/iniciar-pago', { plan_id: planId });

    if (datos.descuento_aplicado) {
      mostrarAviso(`Precio con 50% de descuento de tu primer mes: ${formatearPesos(datos.monto)} (normalmente ${formatearPesos(datos.monto_original)})`);
    }

    const handler = ePayco.checkout.configure({
      key: datos.public_key,
      test: datos.modo_prueba
    });

    handler.open({
      name: datos.descripcion,
      description: datos.descripcion,
      invoice: datos.factura,
      currency: datos.moneda,
      amount: String(datos.monto),
      tax_base: '0',
      tax: '0',
      country: 'co',
      lang: 'es',
      external: 'false',
      confirmation: window.location.origin + '/api/webhooks/epayco',
      response: window.location.origin + '/suscripcion-gracias.html',
      extra1: datos.extra1,
      extra2: datos.extra2
    });
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  cargarEstadoActual();
  cargarPlanes();
});