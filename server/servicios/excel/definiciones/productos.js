// ============================================================
// DEFINICIÓN DE COLUMNAS — Productos (02_Productos.xlsx)
// Cubre los datos básicos del producto. La ficha técnica (qué
// materiales necesita) se sigue manejando desde la plataforma o,
// más adelante, desde el Excel de Procesos — no desde aquí.
// ============================================================

const TITULO = 'Productos';

const PARA_QUE_SIRVE =
  'Usa este archivo para crear o actualizar el catálogo de productos que vendes: nombre, categoría, precio y tiempo de fabricación.';

const ADVERTENCIAS = [
  'Si dejas la columna "Código" vacía en una fila nueva, el sistema le asignará uno automáticamente (PROD001, PROD002, ...).',
  'Si escribes un Código que ya existe, esa fila ACTUALIZA el producto — no crea uno nuevo.',
  'Si la categoría que escribes no existe todavía, el sistema la crea automáticamente al importar.',
  'Los "Minutos de fabricación" solo se usan si el producto NO tiene Procesos configurados; si ya los tiene, ese tiempo se calcula solo y este valor se ignora.',
  'Este archivo no incluye la ficha técnica (qué materiales necesita cada producto) — eso se administra desde la plataforma.'
];

const COLUMNAS = [
  {
    clave: 'codigo',
    encabezado: 'Código',
    obligatorio: false,
    descripcion: 'Identificador para usar este producto en otros Excel (por ejemplo, en Ventas). Si lo dejas vacío en uno nuevo, el sistema le asigna uno.',
    ejemplo: 'PROD001'
  },
  {
    clave: 'nombre',
    encabezado: 'Producto',
    obligatorio: true,
    descripcion: 'Nombre comercial con el que aparecerá en la plataforma.',
    ejemplo: 'Bouquet Rosa'
  },
  {
    clave: 'categoria',
    encabezado: 'Categoría',
    obligatorio: false,
    descripcion: 'Categoría del producto. Si no existe, se crea automáticamente.',
    ejemplo: 'Flores'
  },
  {
    clave: 'precio_venta',
    encabezado: 'Precio venta',
    obligatorio: true,
    descripcion: 'Precio al que se comercializa. Debe ser mayor o igual a 0.',
    ejemplo: 85000
  },
  {
    clave: 'minutos_fabricacion',
    encabezado: 'Minutos fabricación',
    obligatorio: false,
    descripcion: 'Minutos que toma fabricar una unidad. Ver advertencia sobre productos con Procesos.',
    ejemplo: 30
  },
  {
    clave: 'foto_url',
    encabezado: 'Foto URL',
    obligatorio: false,
    descripcion: 'Enlace a una foto del producto (opcional).',
    ejemplo: ''
  },
  {
    clave: 'activo',
    encabezado: 'Activo',
    obligatorio: false,
    descripcion: 'SI o NO. Si lo dejas vacío, se asume SI.',
    ejemplo: 'SI'
  }
];

module.exports = { TITULO, PARA_QUE_SIRVE, ADVERTENCIAS, COLUMNAS };