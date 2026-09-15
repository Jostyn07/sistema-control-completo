// ============================================================
// DEFINICIÓN DE COLUMNAS — Facturación (08_Facturacion.xlsx)
// A propósito NO genera facturas electrónicas reales ante la DIAN:
// eso requeriría numeración autorizada y un CUFE real, que no se
// pueden improvisar desde un Excel sin arriesgar la numeración
// fiscal de verdad. Este archivo sirve para:
//   - CONFIGURACION_FISCAL → cargar los datos básicos del negocio
//   - FACTURAS             → registrar HISTORIAL de facturas que ya
//     existían en otro sistema (número y CUFE tal cual los tenías),
//     solo para efectos de consulta dentro de la plataforma.
// ============================================================

const TITULO = 'Facturación';

const PARA_QUE_SIRVE =
  'Usa este archivo para cargar la configuración fiscal de tu negocio y, si vienes de otro sistema, el historial de ' +
  'facturas que ya emitiste allá.';

const HOJA_CONFIGURACION_FISCAL = 'CONFIGURACION_FISCAL';
const HOJA_FACTURAS = 'FACTURAS';

const ADVERTENCIAS = [
  'FACTURAS: este archivo NO genera facturas electrónicas nuevas ante la DIAN ni usa tu numeración autorizada. Solo registra, como historial, el número y CUFE que ya tenías de otro sistema.',
  'Para generar una factura electrónica real, hazlo desde la pestaña Facturación de la plataforma — nunca desde este Excel.',
  'Una venta con "Código venta" ya facturada no se puede volver a registrar aquí — primero anula esa factura desde la plataforma.',
  'Si tienes Resolución número, el NIT es obligatorio y el rango Desde/Hasta también.'
];

const COLUMNAS_CONFIGURACION_FISCAL = [
  {
    clave: 'razon_social',
    encabezado: 'Razón social',
    obligatorio: true,
    descripcion: 'Nombre de tu negocio tal como aparecerá en las facturas.',
    ejemplo: 'Empresa XYZ SAS'
  },
  {
    clave: 'nit',
    encabezado: 'NIT',
    obligatorio: false,
    descripcion: 'Tu NIT, si tienes uno registrado.',
    ejemplo: '900123456'
  },
  {
    clave: 'regimen',
    encabezado: 'Régimen',
    obligatorio: false,
    descripcion: 'Tu régimen tributario (solo aplica si tienes NIT).',
    ejemplo: 'Régimen simple'
  },
  {
    clave: 'resolucion_numero',
    encabezado: 'Resolución número',
    obligatorio: false,
    descripcion: 'Número de tu resolución de facturación autorizada por la DIAN (si ya tienes una).',
    ejemplo: ''
  },
  {
    clave: 'resolucion_prefijo',
    encabezado: 'Resolución prefijo',
    obligatorio: false,
    descripcion: 'Prefijo de la numeración autorizada (ej: FV).',
    ejemplo: 'FV'
  },
  {
    clave: 'resolucion_desde',
    encabezado: 'Resolución desde',
    obligatorio: false,
    descripcion: 'Primer número autorizado del rango.',
    ejemplo: 1
  },
  {
    clave: 'resolucion_hasta',
    encabezado: 'Resolución hasta',
    obligatorio: false,
    descripcion: 'Último número autorizado del rango.',
    ejemplo: 5000
  },
  {
    clave: 'resolucion_vigencia',
    encabezado: 'Resolución vigencia',
    obligatorio: false,
    descripcion: 'Fecha hasta la que es válida la resolución, formato DD/MM/AAAA.',
    ejemplo: '31/12/2026'
  }
];

const COLUMNAS_FACTURAS = [
  {
    clave: 'numero',
    encabezado: 'Número factura',
    obligatorio: true,
    descripcion: 'Número de la factura tal como la emitiste en tu otro sistema.',
    ejemplo: 'FV001'
  },
  {
    clave: 'codigo_venta',
    encabezado: 'Código venta',
    obligatorio: true,
    descripcion: 'Código de la venta (de 06_Ventas.xlsx) a la que corresponde esta factura.',
    ejemplo: 'VEN001'
  },
  {
    clave: 'cufe',
    encabezado: 'CUFE',
    obligatorio: false,
    descripcion: 'Código único de facturación electrónica, si lo tienes.',
    ejemplo: ''
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    obligatorio: false,
    descripcion: 'Estado de la factura en tu sistema anterior. Si lo dejas vacío, se guarda como "historica".',
    ejemplo: 'generada'
  },
  {
    clave: 'fecha',
    encabezado: 'Fecha',
    obligatorio: false,
    descripcion: 'Fecha de emisión, formato DD/MM/AAAA. Si lo dejas vacío, se usa la fecha de hoy.',
    ejemplo: '10/09/2026'
  }
];

module.exports = {
  TITULO,
  PARA_QUE_SIRVE,
  ADVERTENCIAS,
  HOJA_CONFIGURACION_FISCAL,
  HOJA_FACTURAS,
  COLUMNAS_CONFIGURACION_FISCAL,
  COLUMNAS_FACTURAS
};