// ============================================================
// DEFINICIÓN DE COLUMNAS — Finanzas (07_Finanzas.xlsx)
// Tres hojas independientes entre sí (no se relacionan por código):
//   - COSTOS_FIJOS  → catálogo (se crea o actualiza por Nombre)
//   - CAPITAL       → historial (cada fila es un movimiento nuevo)
//   - CONFIGURACION → 3 parámetros globales de un solo valor cada uno
// ============================================================

const TITULO = 'Finanzas';

const PARA_QUE_SIRVE =
  'Usa este archivo para cargar tus costos fijos mensuales, tu historial de capital invertido y la configuración ' +
  'general que usa Finanzas para calcular rentabilidad, flujo de caja y punto de equilibrio.';

const HOJA_COSTOS_FIJOS = 'COSTOS_FIJOS';
const HOJA_CAPITAL = 'CAPITAL';
const HOJA_CONFIGURACION = 'CONFIGURACION';

const PARAMETROS_VALIDOS = ['Costo hora mano de obra', 'Meta ventas mensual', 'Fecha inicio operación'];

const ADVERTENCIAS = [
  'COSTOS_FIJOS: si el Nombre ya existe (sin importar mayúsculas), esa fila ACTUALIZA el costo fijo; si no existe, crea uno nuevo.',
  'CAPITAL: cada fila SIEMPRE crea un movimiento nuevo — no existe "actualizar" un registro de capital ya importado. Si vuelves a importar el mismo archivo, se duplicarán las filas.',
  'CONFIGURACION: deja la columna Valor vacía en un parámetro para no tocarlo — solo se aplican los parámetros con un valor escrito.',
  'Cambiar el "Costo hora mano de obra" recalcula automáticamente el costo de todos tus productos, igual que hacerlo desde la plataforma.'
];

const COLUMNAS_COSTOS_FIJOS = [
  {
    clave: 'nombre',
    encabezado: 'Nombre',
    obligatorio: true,
    descripcion: 'Nombre del costo fijo.',
    ejemplo: 'Arriendo'
  },
  {
    clave: 'valor_mensual',
    encabezado: 'Valor mensual',
    obligatorio: true,
    descripcion: 'Valor mensual de este costo. Debe ser mayor o igual a 0.',
    ejemplo: 800000
  },
  {
    clave: 'activo',
    encabezado: 'Activo',
    obligatorio: false,
    descripcion: 'SI o NO. Si lo dejas vacío, se asume SI.',
    ejemplo: 'SI'
  }
];

const COLUMNAS_CAPITAL = [
  {
    clave: 'fecha',
    encabezado: 'Fecha',
    obligatorio: false,
    descripcion: 'Fecha del movimiento, formato DD/MM/AAAA. Si lo dejas vacío, se usa la fecha de hoy.',
    ejemplo: '01/01/2026'
  },
  {
    clave: 'concepto',
    encabezado: 'Concepto',
    obligatorio: true,
    descripcion: 'De qué se trata este movimiento de capital.',
    ejemplo: 'Capital inicial'
  },
  {
    clave: 'valor',
    encabezado: 'Valor',
    obligatorio: true,
    descripcion: 'Positivo si es un aporte, negativo si es un retiro. No puede ser 0.',
    ejemplo: 5000000
  }
];

const COLUMNAS_CONFIGURACION = [
  {
    clave: 'parametro',
    encabezado: 'Parámetro',
    obligatorio: true,
    descripcion: `Uno de: ${PARAMETROS_VALIDOS.join(', ')}.`,
    ejemplo: 'Costo hora mano de obra'
  },
  {
    clave: 'valor',
    encabezado: 'Valor',
    obligatorio: false,
    descripcion: 'El valor de ese parámetro. Déjalo vacío para no modificarlo. Fechas en formato DD/MM/AAAA.',
    ejemplo: 15000
  }
];

module.exports = {
  TITULO,
  PARA_QUE_SIRVE,
  ADVERTENCIAS,
  PARAMETROS_VALIDOS,
  HOJA_COSTOS_FIJOS,
  HOJA_CAPITAL,
  HOJA_CONFIGURACION,
  COLUMNAS_COSTOS_FIJOS,
  COLUMNAS_CAPITAL,
  COLUMNAS_CONFIGURACION
};