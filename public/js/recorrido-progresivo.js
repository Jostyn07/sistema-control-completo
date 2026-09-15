// ============================================================
// recorrido-progresivo.js — mini-recorridos de 2-3 pasos, uno por
// pestaña, que aparecen solo la PRIMERA vez que la persona entra a
// esa sección (a diferencia del recorrido inicial, que es uno solo
// y pasea por todas las pestañas desde Inicio). Usa el mismo motor
// genérico de recorrido.js.
//
// Se guarda en localStorage (no en el servidor): es una ayuda menor
// de "ya viste esto" por sección, no un estado de negocio — perderlo
// al cambiar de navegador no tiene consecuencias reales.
// ============================================================

const PASOS_PROGRESIVOS = {
  materiales: [
    { selector: '[onclick="abrirFormularioMaterial()"]', titulo: 'Agregar un material',
      texto: 'Aquí creas un material nuevo a mano: nombre, unidad, costo, proveedor y stock.' },
    { selector: '#buscadorMateriales', titulo: 'Buscar',
      texto: 'Filtra la lista por nombre, unidad o proveedor mientras escribes.' },
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Cargar muchos de una vez',
      texto: 'Si tienes muchos materiales, puedes cargarlos todos desde Excel en vez de uno por uno.' }
  ],
  productos: [
    { selector: '[onclick="abrirFichaProducto()"]', titulo: 'Nueva ficha técnica',
      texto: 'Aquí creas un producto: nombre, categoría, precio, tiempo de fabricación y los materiales que necesita.' },
    { selector: '[onclick="abrirPrecioHora()"]', titulo: 'Precio de tu hora de trabajo',
      texto: 'Este valor se usa para calcular el costo de mano de obra de TODOS tus productos — cámbialo aquí una sola vez.' },
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Cargar muchos de una vez',
      texto: 'Puedes cargar tu catálogo completo desde Excel.' }
  ],
  procesos: [
    { selector: '[onclick="abrirFormularioProceso()"]', titulo: 'Agregar un proceso',
      texto: 'Define una etapa de fabricación: nombre, minutos que toma, y qué materiales necesita.' },
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Cargar muchos de una vez',
      texto: 'Puedes definir procesos y sus materiales desde Excel, relacionándolos entre sí por código.' }
  ],
  inventario: [
    { selector: '[onclick="refrescarInventario()"]', titulo: 'Actualizar ahora',
      texto: 'Vuelve a calcular el stock y el punto de reorden de cada material al instante.' },
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Cargar muchos movimientos',
      texto: 'Registra muchas entradas, salidas o ajustes de una sola vez desde Excel.' }
  ],
  compras: [
    { selector: '[onclick="abrirFormularioCompra()"]', titulo: 'Registrar una compra',
      texto: 'Registra un pedido a un proveedor. El stock se suma solo cuando confirmes que llegó.' },
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Cargar muchas de una vez',
      texto: 'Sube tu historial de compras (o pedidos nuevos) desde Excel.' }
  ],
  ventas: [
    { selector: '[onclick="abrirNuevaVenta()"]', titulo: 'Nueva venta',
      texto: 'Registra un pedido de un cliente: productos, cantidades y datos de contacto.' },
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Cargar muchas de una vez',
      texto: 'Sube varios pedidos a la vez desde Excel — el teléfono y la cédula se cifran igual que aquí.' }
  ],
  finanzas: [
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Cargar información financiera',
      texto: 'Puedes cargar tus costos fijos, tu capital invertido y tu configuración general desde Excel.' }
  ],
  facturacion: [
    { selector: '[onclick="abrirConfiguracion()"]', titulo: 'Configuración fiscal',
      texto: 'Antes de generar tu primera factura, carga aquí los datos de tu negocio (razón social, NIT, resolución si tienes una).' },
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Historial desde otro sistema',
      texto: 'Si vienes de otro sistema, puedes cargar tu historial de facturas aquí (esto no genera facturas nuevas).' }
  ],
  nominas: [
    { selector: '[onclick="abrirFormularioColaborador()"]', titulo: 'Crear colaborador',
      texto: 'Registra a alguien que trabaja contigo — su nombre y, si quieres, su cédula y dirección (se guardan cifradas).' },
    { selector: 'a[href="./importar-exportar.html"]', titulo: 'Cargar muchos de una vez',
      texto: 'Sube tus colaboradores y el historial de encargos ya completados desde Excel.' }
  ]
};

function iniciarRecorridoProgresivoSiPrimeraVez(clave, intentosRestantes = 5) {
  const pasos = PASOS_PROGRESIVOS[clave];
  if (!pasos) return;

  const llave = `recorrido_progresivo_${clave}`;
  if (localStorage.getItem(llave)) return;

  // Pequeña espera para que la página ya haya pintado sus botones y
  // datos (evita que el recorrido arranque sobre una pantalla vacía
  // mientras todavía se está cargando la lista).
  setTimeout(() => {
    // Si el elemento del primer paso ni siquiera existe todavía, se
    // reintenta unas pocas veces más tarde en vez de mostrar el
    // recorrido "flotando" sin nada que resaltar, o de insistir para siempre.
    const primerPaso = pasos[0];
    if (primerPaso.selector && !document.querySelector(primerPaso.selector)) {
      if (intentosRestantes > 0) setTimeout(() => iniciarRecorridoProgresivoSiPrimeraVez(clave, intentosRestantes - 1), 800);
      return;
    }
    iniciarRecorrido(pasos, { alTerminar: () => localStorage.setItem(llave, '1') });
  }, 400);
}