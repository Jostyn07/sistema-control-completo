// ============================================================
// DEFINICIÓN DE COLUMNAS — Materiales (01_Materiales.xlsx)
// Una sola fuente de verdad para el orden de columnas, sus
// encabezados y su explicación — la usan tanto el exportador
// (server/servicios/exportadores/materiales.js) como el
// importador (server/servicios/importadores/materiales.js), así
// nunca quedan desincronizados entre sí.
// ============================================================

const TITULO = 'Materiales';

const PARA_QUE_SIRVE =
  'Usa este archivo para crear o actualizar los materiales que utilizas para fabricar o entregar tus productos: ' +
  'su costo, proveedor, tiempo de entrega y existencias.';

const ADVERTENCIAS = [
  'Si dejas la columna "Código" vacía en una fila nueva, el sistema le asignará uno automáticamente (MAT001, MAT002, ...).',
  'Si escribes un Código que ya existe, esa fila ACTUALIZA el material — no crea uno nuevo.',
  'El "Stock actual" solo se usa para materiales NUEVOS. Para materiales que ya existen, ese cambio se ignora: registra ' +
    'entradas, salidas o ajustes de stock desde Inventario, para que quede el historial correspondiente.'
];

const COLUMNAS = [
  {
    clave: 'codigo',
    encabezado: 'Código',
    obligatorio: false,
    descripcion:
      'Identificador para usar este material en otros Excel (por ejemplo, en la ficha técnica de un producto). ' +
      'Si lo dejas vacío en un material nuevo, el sistema le asigna uno.',
    ejemplo: 'MAT001'
  },
  {
    clave: 'nombre',
    encabezado: 'Nombre',
    obligatorio: true,
    descripcion: 'Nombre con el que aparecerá el material en la plataforma.',
    ejemplo: 'Rosa roja'
  },
  {
    clave: 'unidad',
    encabezado: 'Unidad',
    obligatorio: true,
    descripcion: 'Unidad con la que se controla el inventario de este material (ej: unidad, metro, gramo, kilogramo, litro).',
    ejemplo: 'unidad'
  },
  {
    clave: 'costo_unitario',
    encabezado: 'Costo unitario',
    obligatorio: true,
    descripcion: 'Valor que normalmente pagas por una unidad del material. Debe ser mayor o igual a 0.',
    ejemplo: 2500
  },
  {
    clave: 'proveedor',
    encabezado: 'Proveedor',
    obligatorio: true,
    descripcion: 'Proveedor habitual de este material.',
    ejemplo: 'Flores SAS'
  },
  {
    clave: 'tiempo_entrega_dias',
    encabezado: 'Tiempo entrega (días)',
    obligatorio: false,
    descripcion: 'Cantidad de días que normalmente tarda en llegar. Si lo dejas vacío, se asume 1 día.',
    ejemplo: 2
  },
  {
    clave: 'stock_actual',
    encabezado: 'Stock actual',
    obligatorio: false,
    descripcion: 'Cantidad disponible al momento de crear el material. Si lo dejas vacío, se asume 0. Ver advertencia arriba.',
    ejemplo: 100
  },
  {
    clave: 'stock_seguridad',
    encabezado: 'Stock de seguridad',
    obligatorio: false,
    descripcion: 'Cantidad mínima que quieres mantener como reserva. Si lo dejas vacío, se asume 0.',
    ejemplo: 20
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