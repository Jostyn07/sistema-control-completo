// ============================================================
// DEFINICIÓN DE COLUMNAS — Nóminas (09_Nominas.xlsx)
// Dos hojas:
//   - COLABORADORES → crea/actualiza por Código (como Materiales)
//   - ENCARGOS      → registra trabajo YA COMPLETADO, para llevar el
//     historial de nómina. NO genera trabajo pendiente ni participa
//     en la cola de producción en tiempo real (eso se sigue
//     asignando desde la plataforma, donde el sistema ya sabe qué
//     hay pendiente según las ventas).
// ============================================================

const TITULO = 'Nóminas';

const PARA_QUE_SIRVE =
  'Usa este archivo para cargar tus colaboradores y, si vienes de otro sistema, el historial de trabajo ya completado y pagado (o por pagar).';

const HOJA_COLABORADORES = 'COLABORADORES';
const HOJA_ENCARGOS = 'ENCARGOS';

const ADVERTENCIAS = [
  'ENCARGOS registra trabajo YA COMPLETADO (para el historial de nómina) — no genera trabajo pendiente ni participa en la cola de producción en tiempo real. Para asignar trabajo pendiente a un colaborador, usa la plataforma.',
  'Si dejas el Código de un colaborador nuevo vacío, el sistema le asigna uno automáticamente (COL001, COL002, ...).',
  'El Costo de un encargo es exactamente el que escribas — no se recalcula a partir del tiempo del proceso (útil para migrar datos históricos donde el valor pagado pudo ser distinto).',
  'La Cédula se guarda cifrada, igual que si la escribieras en la plataforma.'
];

const COLUMNAS_COLABORADORES = [
  {
    clave: 'codigo',
    encabezado: 'Código',
    obligatorio: false,
    descripcion: 'Identificador para usar este colaborador en la hoja ENCARGOS. Si lo dejas vacío en uno nuevo, el sistema le asigna uno.',
    ejemplo: 'COL001'
  },
  {
    clave: 'nombre',
    encabezado: 'Nombre',
    obligatorio: true,
    descripcion: 'Nombre del colaborador.',
    ejemplo: 'María Pérez'
  },
  {
    clave: 'cedula',
    encabezado: 'Cédula',
    obligatorio: false,
    descripcion: 'Documento de identidad (se guarda cifrado).',
    ejemplo: ''
  },
  {
    clave: 'direccion',
    encabezado: 'Dirección',
    obligatorio: false,
    descripcion: 'Dirección de contacto (se guarda cifrada).',
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

const COLUMNAS_ENCARGOS = [
  {
    clave: 'codigo_colaborador',
    encabezado: 'Código colaborador',
    obligatorio: true,
    descripcion: 'Código del colaborador (de la hoja COLABORADORES de este archivo, o ya existente) que hizo el trabajo.',
    ejemplo: 'COL001'
  },
  {
    clave: 'codigo_proceso',
    encabezado: 'Código proceso',
    obligatorio: true,
    descripcion: 'Código del proceso (de 03_Procesos.xlsx) que se completó.',
    ejemplo: 'PROC001'
  },
  {
    clave: 'fecha',
    encabezado: 'Fecha',
    obligatorio: false,
    descripcion: 'Fecha en que se entregó el trabajo, formato DD/MM/AAAA. Si lo dejas vacío, se usa la fecha de hoy.',
    ejemplo: '10/09/2026'
  },
  {
    clave: 'cantidad',
    encabezado: 'Cantidad',
    obligatorio: true,
    descripcion: 'Unidades del proceso que se completaron. Debe ser mayor a 0.',
    ejemplo: 20
  },
  {
    clave: 'costo',
    encabezado: 'Costo',
    obligatorio: true,
    descripcion: 'Total pagado (o por pagar) por este trabajo. Debe ser mayor o igual a 0.',
    ejemplo: 50000
  },
  {
    clave: 'pagado',
    encabezado: 'Pagado',
    obligatorio: false,
    descripcion: 'SI o NO. Si lo dejas vacío, se asume NO.',
    ejemplo: 'SI'
  }
];

module.exports = {
  TITULO,
  PARA_QUE_SIRVE,
  ADVERTENCIAS,
  HOJA_COLABORADORES,
  HOJA_ENCARGOS,
  COLUMNAS_COLABORADORES,
  COLUMNAS_ENCARGOS
};