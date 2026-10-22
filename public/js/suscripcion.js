// ============================================================
// suscripcion.js — pestaña Suscripción
// Funciones:
//   cargarEstadoActual()
//   cargarPlanes()
//   elegirPlan(planId)   → abre el Widget de pago de Wompi
// La activación real NUNCA se decide aquí — el navegador solo avisa
// qué transacción se cerró; quien confirma y activa es el backend
// (en /confirmar-pago, reconsultando contra la API de Wompi, y por el
// webhook, que valida el checksum antes de activar nada).
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
    let notaFecha = '';
    let botonAccion = '';

    if (r.fecha_vencimiento) {
      const fechaTexto = new Date(r.fecha_vencimiento).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
      if (r.estado === 'activa') {
        // Honesto: el cobro NO es automático todavía, así que no decimos
        // "próximo cobro" — eso prometería algo que el sistema no hace hoy.
        notaFecha = `<p class="texto-secundario" style="margin:4px 0 0">Acceso vigente hasta el ${fechaTexto}. El cobro no es automático todavía: vuelve aquí antes de esa fecha para renovar manualmente.</p>`;
      } else if (r.estado === 'cancelada') {
        notaFecha = `<p class="texto-secundario" style="margin:4px 0 0">Cancelada. Conservas el acceso hasta el ${fechaTexto}.</p>`;
      }
    }

    if (r.estado === 'prueba' && r.fecha_vencimiento) {
      const diasRestantes = Math.max(0, Math.ceil((new Date(r.fecha_vencimiento) - new Date()) / 86400000));
      notaEstado = diasRestantes > 0
        ? `<p class="texto-secundario" style="margin:4px 0 0">Te quedan ${diasRestantes} día(s) de prueba gratis.</p>`
        : '<p class="texto-secundario" style="margin:4px 0 0">Tu prueba gratis ya terminó.</p>';
    } else if (r.estado === 'vencida') {
      notaEstado = r.bloqueada
        ? '<p class="texto-secundario" style="margin:4px 0 0;color:#b91c1c">Ya no puedes crear ni editar información. Puedes seguir viendo todo — elige un plan para volver a editar.</p>'
        : `<p class="texto-secundario" style="margin:4px 0 0;color:#c2410c">Venció, pero puedes seguir editando ${r.diasGraciaRestantes} día(s) más antes de pasar a solo lectura.</p>`;
    }

    if (r.estado === 'activa' || r.estado === 'prueba') {
      botonAccion = '<button type="button" class="boton boton--pequeno" style="margin-top:10px" onclick="cancelarSuscripcion()">Cancelar suscripción</button>';
    } else if (r.estado === 'cancelada') {
      botonAccion = '<button type="button" class="boton boton--pequeno boton--primario" style="margin-top:10px" onclick="reactivarSuscripcion()">Reactivar</button>';
    }

    contenedor.innerHTML = `
      <div class="indicador">
        <span class="campo__etiqueta">Estado</span>
        <strong style="font-size:1.2rem">${ETIQUETA_ESTADO_SUSCRIPCION[r.estado] || r.estado}</strong>
      </div>
      ${plan ? `<p style="margin:8px 0 0">Plan actual: <strong>${escaparHtml(plan.nombre)}</strong> — ${r.periodo === 'anual' ? `${formatearPesos(precioAnual(plan.precio_mensual))}/año (pago anual)` : `${formatearPesos(plan.precio_mensual)}/mes`}</p>` : ''}
      ${notaFecha}
      ${notaEstado}
      ${botonAccion}
    `;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

const MOTIVOS_CANCELACION = [
  ['muy_caro', 'Es muy caro para mí'],
  ['dificil_de_usar', 'Es difícil de usar'],
  ['falta_funcion', 'Le falta algo que necesito'],
  ['no_lo_uso', 'No lo estoy usando'],
  ['otro_sistema', 'Me cambio a otro sistema'],
  ['cierre_negocio', 'Cerré o pausé el negocio'],
  ['otro', 'Otro motivo']
];

function cancelarSuscripcion() {
  let modal = document.getElementById('modalCancelarSuscripcion');
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'modalCancelarSuscripcion';
    modal.dataset.sinMedicion = '';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="modal__contenido tarjeta">
        <h2>¿Por qué cancelas?</h2>
        <div id="opcionesCancelacion">
          ${MOTIVOS_CANCELACION.map(([v, txt]) => `
            <label style="display:flex;align-items:center;gap:8px;margin:8px 0;cursor:pointer;">
              <input type="radio" name="motivoCancelacion" value="${v}" style="width:auto;margin:0;"> ${txt}
            </label>`).join('')}
        </div>
        <label class="campo">
          <span class="campo__etiqueta">¿Qué podríamos mejorar?</span>
          <textarea id="comentarioCancelacion" rows="3" maxlength="500"></textarea>
        </label>
        <div class="modal__acciones">
          <button type="button" class="boton" onclick="document.getElementById('modalCancelarSuscripcion').hidden = true">Volver</button>
          <button type="button" class="boton boton--primario" id="botonConfirmarCancelacion">Cancelar suscripción</button>
        </div>
      </div>`;
    document.body.appendChild(modal);
    modal.querySelector('#botonConfirmarCancelacion').onclick = confirmarCancelacion;
  }
  modal.querySelectorAll('input[name="motivoCancelacion"]').forEach(r => { r.checked = false; });
  modal.querySelector('#comentarioCancelacion').value = '';
  modal.hidden = false;
}

async function confirmarCancelacion() {
  const elegido = document.querySelector('input[name="motivoCancelacion"]:checked');
  if (!elegido) { mostrarAviso('Elige un motivo', 'error'); return; }
  const boton = document.getElementById('botonConfirmarCancelacion');
  boton.disabled = true;
  try {
    await API.enviar('/api/suscripcion/cancelar', {
      motivo: elegido.value,
      comentario: document.getElementById('comentarioCancelacion').value.trim()
    });
    document.getElementById('modalCancelarSuscripcion').hidden = true;
    mostrarAviso('Suscripción cancelada. Conservas el acceso hasta la fecha ya pagada.');
    cargarEstadoActual();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  } finally {
    boton.disabled = false;
  }
}

async function reactivarSuscripcion() {
  try {
    await API.enviar('/api/suscripcion/reactivar', {});
    mostrarAviso('Suscripción reactivada');
    cargarEstadoActual();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// Planes cargados, por id — para saber el nombre del plan elegido al
// reportar la conversión al Pixel de Meta.
const planesPorId = {};
let periodoPago = 'mensual';
const DESCUENTO_ANUAL = 0.30; // debe coincidir con server/servicios/precios.js
const precioAnual = (mensual) => Math.round(Number(mensual) * 12 * (1 - DESCUENTO_ANUAL));

document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-periodo-pago]');
  if (!b) return;
  periodoPago = b.dataset.periodoPago;
  document.querySelectorAll('[data-periodo-pago]').forEach(x => x.classList.toggle('activo', x === b));
  cargarPlanes();
});

async function cargarPlanes() {
  const contenedor = document.getElementById('listaPlanes');
  try {
    const planes = await API.obtener('/api/suscripcion/planes');
    planes.forEach(p => { planesPorId[p.id] = p; });
    if (planes.length === 0) {
      contenedor.innerHTML = '<p class="tabla__vacio">No hay planes disponibles todavía.</p>';
      return;
    }

    // El plan más caro se marca como recomendado — misma lógica que
    // usamos para decidir el plan de la prueba gratis.
    const idMasCaro = planes.reduce((a, b) => Number(b.precio_mensual) > Number(a.precio_mensual) ? b : a).id;

    contenedor.innerHTML = `<div class="planes-comparacion">` + planes.map(p => {
      const destacado = p.id === idMasCaro;

      // Lo que traen los dos planes por igual — se muestra primero para
      // que Básico se vea como una herramienta completa, no recortada.
      const filasComunes = [
        'Materiales, productos e inventario en tiempo real',
        'Compras con seguimiento de pedidos',
        'Ventas con fecha de entrega y estados',
        'Facturación electrónica / recibos',
        'Finanzas: utilidad, punto de equilibrio y flujo de caja',
        'Datos de tus clientes cifrados',
        'Cuentas de usuario ilimitadas'
      ];

      // Lo que sí diferencia a los planes
      const filasDiferenciadas = [
        { texto: p.limite_materiales != null ? `Hasta ${p.limite_materiales} materiales` : 'Materiales ilimitados', si: true },
        { texto: p.limite_productos != null ? `Hasta ${p.limite_productos} productos` : 'Productos ilimitados', si: true },
        { texto: p.limite_ventas_mes != null ? `Hasta ${p.limite_ventas_mes} ventas al mes` : 'Ventas ilimitadas', si: true },
        { texto: 'Rentabilidad por producto', si: p.incluye_rentabilidad_productos },
        { texto: 'Análisis de clientes', si: p.incluye_analisis_clientes },
        { texto: 'Meta de ventas y proyección', si: p.incluye_meta_ventas },
        { texto: 'Valor del inventario', si: p.incluye_valor_inventario },
        { texto: 'Importar cualquier Excel con IA', si: !!p.incluye_importacion_ia }
      ];

      const filaHtml = (texto, si) => `
            <li class="tarjeta-plan__fila${si ? '' : ' tarjeta-plan__fila--no'}">
              <span class="tarjeta-plan__icono tarjeta-plan__icono--${si ? 'si' : 'no'}">${si ? '✓' : '–'}</span>
              <span>${escaparHtml(texto)}</span>
            </li>`;

      return `
      <article class="tarjeta-plan${destacado ? ' tarjeta-plan--destacado' : ''}">
        ${destacado ? '<span class="tarjeta-plan__badge">Recomendado</span>' : ''}
        <h3 class="tarjeta-plan__nombre">${escaparHtml(p.nombre)}</h3>
        ${periodoPago === 'anual'
          ? `<p class="tarjeta-plan__precio">${formatearPesos(precioAnual(p.precio_mensual))}<span>/año</span></p>
        <p class="tarjeta-plan__descuento">Equivale a ${formatearPesos(Math.round(precioAnual(p.precio_mensual) / 12))}/mes · ahorras ${formatearPesos(Number(p.precio_mensual) * 12 - precioAnual(p.precio_mensual))}</p>`
          : `<p class="tarjeta-plan__precio">${formatearPesos(p.precio_mensual)}<span>/mes</span></p>
        <p class="tarjeta-plan__descuento">50% de descuento tu primer mes</p>`}
        <p class="tarjeta-plan__descripcion">${escaparHtml(p.descripcion || '')}</p>
        <ul class="tarjeta-plan__lista">
          ${filasComunes.map(t => filaHtml(t, true)).join('')}
        </ul>
        <p class="tarjeta-plan__subtitulo">Según tu plan</p>
        <ul class="tarjeta-plan__lista">
          ${filasDiferenciadas.map(f => filaHtml(f.texto, f.si)).join('')}
        </ul>
        <button type="button" class="boton ${destacado ? 'boton--primario' : ''} boton--ancho" onclick="elegirPlan('${p.id}')">Elegir ${escaparHtml(p.nombre)}${periodoPago === 'anual' ? ' anual' : ''}</button>
      </article>`;
    }).join('') + `</div>`;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- Pago con el Widget de Wompi ----
// El Widget abre su propio overlay encima de esta misma página (no
// navega a otro sitio) y soporta tarjeta, PSE, Nequi, etc. sin que
// nosotros tengamos que construir un formulario para cada uno.
async function elegirPlan(planId) {
  try {
    const datos = await API.enviar('/api/suscripcion/iniciar-pago', { plan_id: planId, periodo: periodoPago });

    const checkout = new WidgetCheckout({
      currency: datos.moneda,
      amountInCents: datos.monto_en_centavos,
      reference: datos.referencia,
      publicKey: datos.public_key,
      signature: { integrity: datos.firma },
      customerData: { email: datos.correo }
    });

    checkout.open((resultado) => {
      const transaccion = resultado && resultado.transaction;
      if (!transaccion || !transaccion.id) {
        // El usuario cerró el Widget sin completar el pago — no hay
        // nada que confirmar.
        return;
      }
      confirmarPago(planId, transaccion.id);
    });
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

async function confirmarPago(planId, transactionId) {
  try {
    const resultado = await API.enviar('/api/suscripcion/confirmar-pago', {
      plan_id: planId,
      transaction_id: transactionId
    });
    manejarResultadoPago(resultado, planId, transactionId);
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

function manejarResultadoPago(resultado, planId, transactionId) {
  if (resultado.status === 'APPROVED') {
    // Conversión para Meta: el valor es el monto REAL cobrado (ya con el
    // 50% de descuento del primer mes si aplicó), confirmado por el
    // servidor contra Wompi — no el precio de lista.
    const plan = planesPorId[planId] || {};
    if (window.rastrearMeta) {
      rastrearMeta('Subscribe', {
        value: Number(resultado.monto) || Number(plan.precio_mensual) || 0,
        currency: 'COP',
        content_ids: [planId],
        content_name: plan.nombre || 'Plan',
        content_type: 'product'
      }, { eventID: 'sub_' + transactionId });
    }
    mostrarAviso(resultado.periodo === 'anual' ? '¡Pago aprobado! Tu plan anual ya está activo.' : '¡Pago aprobado! Tu suscripción ya está activa.');
    cargarEstadoActual();
  } else if (resultado.status === 'PENDING') {
    mostrarAviso('Tu pago está en proceso de confirmación. Te avisamos aquí en cuanto se apruebe.');
  } else {
    mostrarAviso('El pago fue rechazado o no se pudo completar. Intenta de nuevo.', 'error');
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