// ============================================================
// DEFINICIÓN DE COLUMNAS — Inventario (04_Inventario.xlsx)
// A diferencia de Materiales/Productos/Procesos, este archivo NO
// representa un catálogo que se actualiza — cada fila es un
// MOVIMIENTO nuevo (una entrada, salida o ajuste), igual que un
// ajuste manual hecho uno por uno desde la plataforma. No existe
// el concepto de "actualizar una fila que ya existe".
// ============================================================

const TITULO = 'Inventario';

const PARA_QUE_SIRVE =
  'Usa este archivo para registrar de una sola vez varias entradas, salidas o ajustes de stock de tus materiales ' +
  '(por ejemplo, tu inventario inicial o los resultados de un conteo físico).';

const TIPOS_VALIDOS = ['ENTRADA', 'SALIDA', 'AJUSTE'];

const ADVERTENCIAS = [
  'Este archivo NO crea materiales nuevos: el "Código material" debe existir ya (en la plataforma o en 01_Materiales.xlsx importado antes que este).',
  'ENTRADA y SALIDA: la Cantidad siempre se escribe en positivo — el sistema suma o resta sola según el Tipo.',
  'AJUSTE: la Cantidad es la diferencia a corregir (puede ser negativa), no el stock final. Ej: -5 significa "el conteo dio 5 menos de lo que había".',
  'Ninguna fila puede dejar el stock de un material en negativo — esas filas quedan marcadas con error y no se importan.',
  'La columna Fecha es solo informativa por ahora: el movimiento queda registrado con la fecha y hora en que importas el archivo.',
  'Cada fila queda en el historial de ajustes de inventario, igual que un ajuste manual hecho desde la plataforma.'
];

const COLUMNAS = [
  {
    clave: 'fecha',
    encabezado: 'Fecha',
    obligatorio: false,
    descripcion: 'Fecha del movimiento (informativa — ver advertencia arriba).',
    ejemplo: '01/09/2026'
  },
  {
    clave: 'codigo_material',
    encabezado: 'Código material',
    obligatorio: true,
    descripcion: 'Código del material (de 01_Materiales.xlsx) al que aplica este movimiento.',
    ejemplo: 'MAT001'
  },
  {
    clave: 'tipo',
    encabezado: 'Tipo',
    obligatorio: true,
    descripcion: `Uno de: ${TIPOS_VALIDOS.join(', ')}.`,
    ejemplo: 'ENTRADA'
  },
  {
    clave: 'cantidad',
    encabezado: 'Cantidad',
    obligatorio: true,
    descripcion: 'Para ENTRADA/SALIDA: positiva. Para AJUSTE: la diferencia a corregir (puede ser negativa). Ver advertencia arriba.',
    ejemplo: 100
  },
  {
    clave: 'motivo',
    encabezado: 'Motivo',
    obligatorio: true,
    descripcion: 'Por qué se registra este movimiento (queda en el historial, para trazabilidad).',
    ejemplo: 'Inventario inicial'
  }
];

module.exports = { TITULO, PARA_QUE_SIRVE, ADVERTENCIAS, TIPOS_VALIDOS, COLUMNAS };