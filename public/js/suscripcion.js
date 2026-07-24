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
      ${plan ? `<p style="margin:8px 0 0">Plan actual: <strong>${escaparHtml(plan.nombre)}</strong> — ${formatearPesos(plan.precio_mensual)}/mes</p>` : ''}
      ${notaFecha}
      ${notaEstado}
      ${botonAccion}
    `;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

async function cancelarSuscripcion() {
  if (!confirm('¿Cancelar tu suscripción? Conservas el acceso hasta la fecha ya pagada; después no se renovará.')) return;
  try {
    await API.enviar('/api/suscripcion/cancelar', {});
    mostrarAviso('Suscripción cancelada. Conservas el acceso hasta la fecha ya pagada.');
    cargarEstadoActual();
  } catch (err) {
    mostrarAviso(err.message, 'error');
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
        { texto: 'Valor del inventario', si: p.incluye_valor_inventario }
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
        <p class="tarjeta-plan__precio">${formatearPesos(p.precio_mensual)}<span>/mes</span></p>
        <p class="tarjeta-plan__descuento">50% de descuento tu primer mes</p>
        <p class="tarjeta-plan__descripcion">${escaparHtml(p.descripcion || '')}</p>
        <ul class="tarjeta-plan__lista">
          ${filasComunes.map(t => filaHtml(t, true)).join('')}
        </ul>
        <p class="tarjeta-plan__subtitulo">Según tu plan</p>
        <ul class="tarjeta-plan__lista">
          ${filasDiferenciadas.map(f => filaHtml(f.texto, f.si)).join('')}
        </ul>
        <button type="button" class="boton ${destacado ? 'boton--primario' : ''} boton--ancho" onclick="elegirPlan('${p.id}')">Elegir ${escaparHtml(p.nombre)}</button>
      </article>`;
    }).join('') + `</div>`;
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- Pago con el Brick de tarjeta de Mercado Pago ----
// Reemplaza el popup que abría antes ePayco.checkout.configure().
// El SDK (mp) se crea una sola vez; el Brick sí hay que destruirlo
// y volver a crearlo cada vez que se abre el modal, o Mercado Pago
// termina montando formularios encima unos de otros.
let clienteMercadoPago = null;
let brickTarjetaActual = null;

async function obtenerClienteMercadoPago() {
  if (clienteMercadoPago) return clienteMercadoPago;
  const { public_key: llavePublica } = await API.obtener('/api/suscripcion/llave-publica-mercadopago');
  clienteMercadoPago = new MercadoPago(llavePublica, { locale: 'es-CO' });
  return clienteMercadoPago;
}

async function elegirPlan(planId) {
  try {
    const datos = await API.enviar('/api/suscripcion/iniciar-pago', { plan_id: planId });

    document.getElementById('modalPagoResumen').textContent = datos.descuento_aplicado
      ? `${datos.descripcion} — ${formatearPesos(datos.monto)} con 50% de descuento tu primer mes (normalmente ${formatearPesos(datos.monto_original)})`
      : `${datos.descripcion} — ${formatearPesos(datos.monto)}/mes`;
    document.getElementById('modalPagoError').hidden = true;

    const modal = document.getElementById('modalPago');
    modal.hidden = false;

    if (brickTarjetaActual) {
      await brickTarjetaActual.unmount();
      brickTarjetaActual = null;
    }

    const mp = await obtenerClienteMercadoPago();
    brickTarjetaActual = await mp.bricks().create('cardPayment', 'brickTarjeta', {
      initialization: { amount: datos.monto },
      callbacks: {
        onReady: () => {
          // El Brick ya terminó de renderizar su formulario — no hay
          // nada más que hacer aquí, pero Mercado Pago exige el
          // callback igual, aunque quede vacío.
        },
        onSubmit: (formularioTarjeta) => new Promise((resolve, reject) => {
          API.enviar('/api/suscripcion/procesar-pago', {
            plan_id: planId,
            token: formularioTarjeta.token,
            payment_method_id: formularioTarjeta.payment_method_id,
            installments: formularioTarjeta.installments
          }).then((resultado) => {
            manejarResultadoPago(resultado);
            resolve();
          }).catch((err) => {
            mostrarErrorEnModal(err.message);
            reject(err);
          });
        }),
        onError: () => mostrarErrorEnModal('No se pudo validar la tarjeta. Revisa los datos e intenta de nuevo.')
      }
    });
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

function mostrarErrorEnModal(mensaje) {
  const error = document.getElementById('modalPagoError');
  error.textContent = mensaje;
  error.hidden = false;
}

function manejarResultadoPago(resultado) {
  if (resultado.status === 'approved') {
    cerrarModalPago();
    mostrarAviso('¡Pago aprobado! Tu suscripción ya está activa.');
    cargarEstadoActual();
  } else if (resultado.status === 'in_process' || resultado.status === 'pending') {
    cerrarModalPago();
    mostrarAviso('Tu pago está en proceso de confirmación. Te avisamos aquí en cuanto se apruebe.');
  } else {
    mostrarErrorEnModal('El pago fue rechazado. Intenta con otra tarjeta.');
  }
}

async function cerrarModalPago() {
  document.getElementById('modalPago').hidden = true;
  if (brickTarjetaActual) {
    await brickTarjetaActual.unmount();
    brickTarjetaActual = null;
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