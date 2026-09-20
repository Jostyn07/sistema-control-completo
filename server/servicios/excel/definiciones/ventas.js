// ============================================================
// DEFINICIÓN DE COLUMNAS — Ventas (06_Ventas.xlsx)
// Dos hojas, igual de relacionadas que en Procesos:
//   - VENTAS       → un pedido de un cliente
//   - VENTAS_ITEMS → qué productos y cantidades incluye cada pedido
// El "Código venta" relaciona ambas hojas DENTRO de este mismo archivo,
// y además se guarda con la venta — así 08_Facturacion.xlsx puede
// referenciar una venta ya importada sin usar su UUID interno.
// Igual que Inventario/Compras: cada fila de VENTAS crea una venta
// NUEVA, nunca actualiza una que ya existe.
// ============================================================

const TITULO = 'Ventas';

const PARA_QUE_SIRVE =
  'Usa este archivo para registrar de una sola vez varios pedidos de clientes (hoja VENTAS) junto con los productos ' +
  'que incluye cada uno (hoja VENTAS_ITEMS).';

const HOJA_VENTAS = 'VENTAS';
const HOJA_VENTAS_ITEMS = 'VENTAS_ITEMS';

const ESTADOS_VALIDOS = ['pendiente', 'en_produccion', 'listo', 'entregado'];

const ADVERTENCIAS = [
  'El "Código venta" relaciona esta hoja con VENTAS_ITEMS dentro del mismo archivo, y se guarda con la venta para poder referenciarla luego desde Facturación.',
  'Cada fila de VENTAS crea un pedido NUEVO — este archivo no sirve para editar pedidos que ya existen.',
  'El Teléfono y la Cédula se guardan cifrados, igual que si los escribieras a mano en la plataforma.',
  'Cada producto vendido debe tener ya una categoría asignada en Productos — si no la tiene, esa venta no se puede registrar.',
  'Si no hay material suficiente para completar una venta, se registra igual (el stock de ese material queda en 0) y queda marcada como advertencia — revisa el inventario después de importar.',
  'Los productos con Procesos activos no descuentan material aquí: generan producción pendiente automáticamente, igual que una venta normal.'
];

const COLUMNAS_VENTAS = [
  {
    clave: 'codigo',
    encabezado: 'Código venta',
    obligatorio: true,
    descripcion: 'Identificador de este pedido — relaciona esta fila con sus productos en VENTAS_ITEMS y queda guardado con la venta.',
    ejemplo: 'VEN001'
  },
  {
    clave: 'fecha',
    encabezado: 'Fecha',
    obligatorio: false,
    descripcion: 'Fecha del pedido, formato DD/MM/AAAA. Si lo dejas vacío, se usa la fecha de hoy.',
    ejemplo: '10/09/2026'
  },
  {
    clave: 'cliente',
    encabezado: 'Cliente',
    obligatorio: false,
    descripcion: 'Nombre del cliente.',
    ejemplo: 'Juan Pérez'
  },
  {
    clave: 'telefono',
    encabezado: 'Teléfono',
    obligatorio: false,
    descripcion: 'Teléfono de contacto (se guarda cifrado).',
    ejemplo: '3332380765'
  },
  {
    clave: 'cedula',
    encabezado: 'Cédula',
    obligatorio: false,
    descripcion: 'Documento de identidad del cliente (se guarda cifrado).',
    ejemplo: ''
  },
  {
    clave: 'fecha_entrega',
    encabezado: 'Fecha entrega',
    obligatorio: false,
    descripcion: 'Fecha comprometida de entrega, formato DD/MM/AAAA.',
    ejemplo: '12/09/2026'
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    obligatorio: false,
    descripcion: `Uno de: ${ESTADOS_VALIDOS.join(', ')}. Si lo dejas vacío, se asume "pendiente".`,
    ejemplo: 'entregado'
  },
  {
    clave: 'pagada',
    encabezado: 'Pagada',
    obligatorio: false,
    descripcion: 'SI o NO. Si lo dejas vacío, se asume NO.',
    ejemplo: 'SI'
  }
];

const COLUMNAS_VENTAS_ITEMS = [
  {
    clave: 'codigo_venta',
    encabezado: 'Código venta',
    obligatorio: true,
    descripcion: 'Código del pedido (de la hoja VENTAS de este mismo archivo) al que pertenece esta línea.',
    ejemplo: 'VEN001'
  },
  {
    clave: 'codigo_producto',
    encabezado: 'Código producto',
    obligatorio: true,
    descripcion: 'Código del producto (de 02_Productos.xlsx) que se vendió.',
    ejemplo: 'PROD001'
  },
  {
    clave: 'cantidad',
    encabezado: 'Cantidad',
    obligatorio: true,
    descripcion: 'Unidades vendidas de ese producto. Debe ser mayor a 0.',
    ejemplo: 2
  }
];

module.exports = {
  TITULO,
  PARA_QUE_SIRVE,
  ADVERTENCIAS,
  ESTADOS_VALIDOS,
  HOJA_VENTAS,
  HOJA_VENTAS_ITEMS,
  COLUMNAS_VENTAS,
  COLUMNAS_VENTAS_ITEMS
};