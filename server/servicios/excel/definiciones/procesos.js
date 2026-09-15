// ============================================================
// DEFINICIÓN DE COLUMNAS — Procesos (03_Procesos.xlsx)
// Este archivo tiene DOS hojas de datos relacionadas entre sí:
//   - PROCESOS           → las etapas de fabricación de cada producto
//   - MATERIALES_PROCESO → qué materiales necesita cada proceso
// Ambas usan códigos (de este mismo archivo o ya existentes en la
// plataforma) para relacionarse entre sí y con Materiales/Productos,
// en vez de UUIDs internos.
// ============================================================

const TITULO = 'Procesos';

const PARA_QUE_SIRVE =
  'Usa este archivo para definir las etapas de fabricación de tus productos (hoja PROCESOS) y, si quieres, qué materiales ' +
  'necesita cada etapa (hoja MATERIALES_PROCESO).';

const HOJA_PROCESOS = 'PROCESOS';
const HOJA_MATERIALES_PROCESO = 'MATERIALES_PROCESO';

const ADVERTENCIAS = [
  'Si dejas la columna "Código" vacía en un proceso nuevo, el sistema le asignará uno automáticamente (PROC001, PROC002, ...).',
  'Si vas a asignarle materiales a un proceso NUEVO en la hoja MATERIALES_PROCESO, primero escríbele tú mismo un Código en ' +
    'la hoja PROCESOS (no lo dejes en blanco), para poder relacionarlos dentro del mismo archivo.',
  'Los materiales de un proceso solo se reemplazan si ese proceso aparece en la hoja MATERIALES_PROCESO. Si no aparece, ' +
    'se deja tal cual estaba (no se borra nada).',
  'El "Código producto" debe existir ya en la plataforma o en 02_Productos.xlsx importado antes que este archivo.'
];

const COLUMNAS_PROCESOS = [
  {
    clave: 'codigo_producto',
    encabezado: 'Código producto',
    obligatorio: true,
    descripcion: 'Código del producto (de 02_Productos.xlsx) al que pertenece este proceso.',
    ejemplo: 'PROD001'
  },
  {
    clave: 'codigo',
    encabezado: 'Código proceso',
    obligatorio: false,
    descripcion: 'Identificador de este proceso, usado para asignarle materiales en la hoja MATERIALES_PROCESO. Si lo dejas vacío en uno nuevo, el sistema le asigna uno.',
    ejemplo: 'PROC001'
  },
  {
    clave: 'nombre',
    encabezado: 'Nombre proceso',
    obligatorio: true,
    descripcion: 'Nombre de la etapa de fabricación.',
    ejemplo: 'Preparar flores'
  },
  {
    clave: 'orden',
    encabezado: 'Orden',
    obligatorio: false,
    descripcion: 'Posición de este proceso dentro de la ficha técnica (1 = primero). Si lo dejas vacío, se agrega al final.',
    ejemplo: 1
  },
  {
    clave: 'minutos',
    encabezado: 'Minutos',
    obligatorio: true,
    descripcion: 'Minutos que toma completar este proceso una vez. Debe ser mayor a 0.',
    ejemplo: 10
  },
  {
    clave: 'repeticiones_por_unidad',
    encabezado: 'Repeticiones por unidad',
    obligatorio: false,
    descripcion: 'Cuántas veces se repite este proceso por cada unidad del producto (ej: 12 pétalos por flor). Si lo dejas vacío, se asume 1.',
    ejemplo: 1
  },
  {
    clave: 'activo',
    encabezado: 'Activo',
    obligatorio: false,
    descripcion: 'SI o NO. Si lo dejas vacío, se asume SI.',
    ejemplo: 'SI'
  }
];

const COLUMNAS_MATERIALES_PROCESO = [
  {
    clave: 'codigo_proceso',
    encabezado: 'Código proceso',
    obligatorio: true,
    descripcion: 'Código del proceso (de la hoja PROCESOS de este mismo archivo, o ya existente en la plataforma) que usa este material.',
    ejemplo: 'PROC001'
  },
  {
    clave: 'codigo_material',
    encabezado: 'Código material',
    obligatorio: true,
    descripcion: 'Código del material (de 01_Materiales.xlsx) que necesita este proceso.',
    ejemplo: 'MAT001'
  },
  {
    clave: 'cantidad',
    encabezado: 'Cantidad',
    obligatorio: true,
    descripcion: 'Cantidad de ese material que se necesita cada vez que se ejecuta el proceso. Debe ser mayor a 0.',
    ejemplo: 12
  }
];

module.exports = {
  TITULO,
  PARA_QUE_SIRVE,
  ADVERTENCIAS,
  HOJA_PROCESOS,
  HOJA_MATERIALES_PROCESO,
  COLUMNAS_PROCESOS,
  COLUMNAS_MATERIALES_PROCESO
};