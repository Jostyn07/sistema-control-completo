// ============================================================
// ayuda-contextual.js — el botón "❓ ¿Cómo funciona?" de cada pestaña.
// A diferencia del recorrido inicial (recorrido.js), esto no resalta
// nada ni pasea por varias pantallas: es una explicación puntual de
// ESTA sección, disponible en cualquier momento (no solo la primera
// vez). El modal se crea una sola vez y se reutiliza para todas.
// ============================================================

const AYUDA_CONTEXTUAL = {
  inicio: {
    titulo: 'Inicio — tu resumen del negocio',
    html: `
      <p>Aquí encuentras una vista general de cómo está funcionando tu negocio: ventas, utilidad, inventario,
      pedidos, compras, producción y otros indicadores importantes.</p>
      <p>Úsala como tu pantalla principal para saber qué está pasando y qué necesita tu atención hoy — no hace
      falta entrar a cada pestaña por separado para tener una idea general.</p>`
  },
  materiales: {
    titulo: 'Materiales',
    html: `
      <p>Los materiales son los elementos que utilizas para crear tus productos.</p>
      <ol>
        <li><strong>Registra el material:</strong> indica su nombre, unidad, costo y proveedor.</li>
        <li><strong>Define el inventario:</strong> indica cuánto tienes disponible y cuál es tu stock de seguridad.</li>
        <li><strong>Utilízalo en tus productos:</strong> en Productos indicas qué cantidad de este material necesita cada uno.</li>
        <li><strong>Mantén actualizado el stock:</strong> las compras, ventas y ajustes modifican las existencias solas.</li>
      </ol>
      <p>💡 Puedes cargar muchos materiales de una sola vez desde <a href="./importar-exportar.html">Importar/Exportar</a>.</p>`
  },
  productos: {
    titulo: 'Productos',
    html: `
      <p>Aquí registras todo lo que vendes: nombre, categoría, precio de venta, tiempo de fabricación y los
      materiales necesarios para producirlo.</p>
      <p>El sistema usa esa información para calcular automáticamente el costo de cada producto y ayudarte a
      conocer su rentabilidad:</p>
      <p class="texto-secundario">Materiales → Ficha técnica → Producto → Costo → Rentabilidad</p>`
  },
  procesos: {
    titulo: 'Procesos',
    html: `
      <p>Si la fabricación de tus productos tiene distintas etapas, aquí puedes organizarlas — por ejemplo:
      Preparar → Armar → Empacar → Entregar.</p>
      <p>Puedes definir qué necesita cada proceso, cuánto tarda y en qué orden va, para controlar la producción
      paso a paso. Esto también permite generar producción pendiente automáticamente cuando se registra una venta.</p>`
  },
  inventario: {
    titulo: 'Inventario',
    html: `
      <p>Aquí controlas las existencias de tus materiales. El sistema te avisa cuando un material tiene un
      nivel de stock bajo o necesita comprarse.</p>
      <p class="texto-secundario">Compra → Entrada &nbsp;·&nbsp; Venta → Salida &nbsp;·&nbsp; Conteo físico → Ajuste</p>
      <p>Los ajustes manuales quedan siempre registrados en el historial, para que puedas rastrear qué cambió y por qué.</p>`
  },
  compras: {
    titulo: 'Compras',
    html: `
      <p>Aquí registras los pedidos que haces a tus proveedores: qué compraste, cuánto pagaste, qué está
      pendiente de recibir y qué ya llegó.</p>
      <p>Un pedido queda "pendiente" hasta que se confirma su llegada (a mano, o automáticamente cuando se
      cumple la fecha estimada) — el stock solo se suma en ese momento, no al registrar el pedido.</p>`
  },
  ventas: {
    titulo: 'Ventas',
    html: `
      <p>Aquí registras los pedidos de tus clientes: qué productos compraron, cantidades, datos de contacto,
      fecha de entrega y estado.</p>
      <p>El sistema calcula el total y el costo automáticamente. Dependiendo de cómo esté configurado cada
      producto, la venta también puede descontar materiales o generar producción pendiente en Procesos/Nóminas.</p>`
  },
  finanzas: {
    titulo: 'Finanzas',
    html: `
      <p>Aquí puedes conocer la situación económica de tu negocio: ingresos, costos, utilidad, flujo de caja,
      punto de equilibrio, capital invertido y ROI.</p>
      <p>Esta sección no pide información nueva — usa lo que ya registraste en Ventas, Compras, Materiales y
      Nóminas para explicarte cómo va el negocio.</p>`
  },
  facturacion: {
    titulo: 'Facturación',
    html: `
      <p>Aquí gestionas la facturación de tus ventas: la configuración fiscal de tu negocio (razón social, NIT,
      resolución de numeración) y las facturas generadas.</p>
      <p>⚠️ Úsala con cuidado — puede contener información fiscal y de facturación electrónica ante la DIAN.
      Una factura nunca se borra directamente: primero se anula, y solo entonces se puede eliminar.</p>`
  },
  nominas: {
    titulo: 'Nóminas',
    html: `
      <p>Aquí gestionas tus colaboradores y el trabajo (encargos) que realizan: cuánto corresponde pagar, qué
      está pendiente y qué ya se pagó.</p>
      <p>Los encargos completados y pagados también influyen en Finanzas — se cuentan como un costo variable
      real del negocio, igual que el costo de los materiales vendidos.</p>`
  },
  excel: {
    titulo: 'Importar y exportar por Excel',
    html: `
      <p>No necesitas registrar toda tu información a mano. Cada módulo tiene su propia plantilla de Excel:
      descarga → completa → sube → revisa el resultado → confirma.</p>
      <p>También puedes descargar tu información actual para editarla y volver a subirla — el sistema detecta
      solo qué es nuevo y qué ya existía.</p>`
  }
};

let modalAyudaContextual = null;

function crearModalAyudaContextualSiNoExiste() {
  if (modalAyudaContextual) return modalAyudaContextual;

  const modal = document.createElement('div');
  modal.className = 'modal';
  modal.hidden = true;
  modal.innerHTML = `
    <div class="modal__contenido tarjeta">
      <h2 id="tituloAyudaContextual"></h2>
      <div id="contenidoAyudaContextual"></div>
      <div class="modal__acciones">
        <button type="button" class="boton boton--primario" onclick="cerrarAyudaContextual()">Entendido</button>
      </div>
    </div>`;
  document.body.appendChild(modal);
  modalAyudaContextual = modal;
  return modal;
}

function abrirAyudaContextual(clave) {
  const contenido = AYUDA_CONTEXTUAL[clave];
  if (!contenido) return;
  const modal = crearModalAyudaContextualSiNoExiste();
  modal.querySelector('#tituloAyudaContextual').textContent = contenido.titulo;
  modal.querySelector('#contenidoAyudaContextual').innerHTML = contenido.html;
  modal.hidden = false;
}

function cerrarAyudaContextual() {
  if (modalAyudaContextual) modalAyudaContextual.hidden = true;
}