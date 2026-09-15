// ============================================================
// recorrido-inicial.js — contenido del recorrido de bienvenida.
// Usa el motor genérico de recorrido.js. Este archivo solo define
// QUÉ dice cada paso y CUÁNDO se dispara — no sabe cómo dibujar nada.
// ============================================================

const PASOS_RECORRIDO_INICIAL = [
  {
    selector: null,
    titulo: '¡Bienvenido a tu Sistema de Control!',
    texto: 'Vamos a mostrarte rápidamente cómo funciona la plataforma y para qué sirve cada sección. Este recorrido te tomará unos minutos.',
    textoBotonSiguiente: 'Comenzar recorrido →'
  },
  {
    selector: 'a[href="./index.html"]',
    titulo: 'Inicio — tu resumen del negocio',
    texto: 'Aquí encontrarás una vista general de cómo está funcionando tu negocio: ventas, utilidad, inventario, pedidos, compras, producción y otros indicadores importantes. Es tu pantalla principal para saber qué está pasando y qué requiere atención.'
  },
  {
    selector: 'a[href="./materiales.html"]',
    titulo: 'Materiales',
    texto: 'Aquí registras todo lo que necesitas para fabricar o entregar tus productos: costo, proveedor, stock y stock de seguridad. Esta información alimenta después el inventario, las fichas técnicas y los costos de tus productos. 💡 También puedes cargar muchos materiales de una sola vez usando Excel.'
  },
  {
    selector: 'a[href="./productos.html"]',
    titulo: 'Productos',
    texto: 'Aquí registras todo lo que vendes: nombre, categoría, precio de venta, tiempo de fabricación y los materiales necesarios. El sistema calcula automáticamente el costo y la rentabilidad de cada producto.',
    diagrama: 'Materiales → Ficha técnica → Producto → Costo → Rentabilidad'
  },
  {
    selector: 'a[href="./procesos.html"]',
    titulo: 'Procesos',
    texto: 'Si la fabricación de tus productos tiene varias etapas, aquí las organizas (ej: Preparar → Armar → Empacar → Entregar). Puedes definir qué necesita cada proceso, cuánto tarda y quién puede realizarlo — esto permite controlar la producción paso a paso.'
  },
  {
    selector: 'a[href="./inventario.html"]',
    titulo: 'Inventario',
    texto: 'Aquí controlas las existencias de tus materiales: entradas, salidas y ajustes. El sistema te avisa cuando un material tiene stock bajo o necesita comprarse.',
    diagrama: 'Compra → Entrada &nbsp;·&nbsp; Venta → Salida &nbsp;·&nbsp; Conteo físico → Ajuste'
  },
  {
    selector: 'a[href="./compras.html"]',
    titulo: 'Compras',
    texto: 'Aquí registras los pedidos que haces a tus proveedores: qué compraste, cuánto pagaste, qué está pendiente de recibir y qué ya llegó. Las compras recibidas pueden sumar automáticamente al inventario.'
  },
  {
    selector: 'a[href="./ventas.html"]',
    titulo: 'Ventas',
    texto: 'Aquí registras los pedidos de tus clientes: productos, cantidades, datos de contacto, fecha de entrega y estado. El sistema calcula el total y el costo solo, y puede descontar materiales o generar producción según cómo esté configurado cada producto.'
  },
  {
    selector: 'a[href="./finanzas.html"]',
    titulo: 'Finanzas',
    texto: 'Aquí conoces la situación económica de tu negocio: ingresos, costos, utilidad, flujo de caja, punto de equilibrio, capital invertido y ROI. Esta sección usa la información registrada en las demás áreas para explicarte cómo va el negocio.'
  },
  {
    selector: 'a[href="./facturacion.html"]',
    titulo: 'Facturación',
    texto: 'Aquí gestionas la facturación de tus ventas: la configuración fiscal de tu negocio y las facturas asociadas. Úsala con cuidado — puede contener información fiscal y de facturación electrónica.'
  },
  {
    selector: 'a[href="./nomina.html"]',
    titulo: 'Nóminas',
    texto: 'Aquí gestionas tus colaboradores y el trabajo (encargos) que realizan: cuánto corresponde pagar, qué está pendiente y qué ya se pagó. Esta información también puede influir en tus costos e indicadores financieros.'
  },
  {
    selector: 'a[href="./importar-exportar.html"]',
    titulo: 'Trabajar con Excel',
    texto: 'No necesitas registrar toda tu información a mano. Cada sección tiene su propio archivo Excel para cargar grandes cantidades de datos de una sola vez: descarga la plantilla, complétala, súbela, revisa el resultado y confirma. También puedes descargar todas las plantillas juntas en un solo ZIP.'
  },
  {
    selector: null,
    titulo: '¿Cómo funciona todo junto?',
    texto: 'Las secciones están conectadas: cuando registras información en una sección, se usa automáticamente en otras. Un material puede formar parte de un producto, ese producto puede venderse, y la venta puede afectar inventario, producción, costos y resultados financieros. No son nueve sistemas separados.',
    diagrama: '<strong>Materiales</strong> → <strong>Productos</strong> → <strong>Procesos</strong> → <strong>Inventario</strong> → <strong>Compras</strong> / <strong>Ventas</strong> → <strong>Finanzas</strong>'
  },
  {
    selector: null,
    titulo: '🎉 ¡Listo!',
    texto: 'Ya conoces las principales funciones de tu sistema. Ahora puedes comenzar a registrar tu información, o usar Excel para cargarla rápidamente. Puedes volver a ver este recorrido cuando quieras desde el enlace "❓ Ayuda" del menú.',
    textoBotonFinal: 'Comenzar a trabajar →'
  }
];

function iniciarRecorridoInicial() {
  iniciarRecorrido(PASOS_RECORRIDO_INICIAL, {
    alTerminar: () => {
      // Se marca completado tanto si lo termina como si lo salta a mitad
      // de camino — en ambos casos ya decidió que no lo quiere ver de
      // nuevo automáticamente; siempre puede volver a abrirlo desde Ayuda.
      API.actualizar('/api/configuracion/onboarding', { completado: true }).catch(() => {});
    }
  });
}

// Se llama al cargar una página que quiera ofrecer el recorrido
// automático (por ahora, Inicio). Revisa el servidor UNA vez; si el
// usuario llega con ?recorrido=1 en la URL (desde el enlace "Ayuda"),
// lo muestra sin importar si ya lo había completado antes.
async function revisarSiMostrarRecorridoInicial() {
  const forzar = new URLSearchParams(window.location.search).get('recorrido') === '1';
  if (forzar) { iniciarRecorridoInicial(); return; }

  try {
    const estado = await API.obtener('/api/configuracion/onboarding');
    if (!estado.completado) iniciarRecorridoInicial();
  } catch {
    // Si falla la consulta (ej. sin conexión momentánea), no se
    // interrumpe la carga de la página con el recorrido.
  }
}