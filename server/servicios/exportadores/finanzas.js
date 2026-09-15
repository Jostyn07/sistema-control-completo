// ============================================================
// EXPORTADOR — Finanzas (server/servicios/exportadores/finanzas.js)
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibroMultiHoja } = require('../excel/generador');
const {
  TITULO, PARA_QUE_SIRVE, ADVERTENCIAS, PARAMETROS_VALIDOS,
  HOJA_COSTOS_FIJOS, HOJA_CAPITAL, HOJA_CONFIGURACION,
  COLUMNAS_COSTOS_FIJOS, COLUMNAS_CAPITAL, COLUMNAS_CONFIGURACION
} = require('../excel/definiciones/finanzas');

const LIMITE_CAPITAL = 300;

function generarPlantilla() {
  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_COSTOS_FIJOS, columnas: COLUMNAS_COSTOS_FIJOS },
      { nombre: HOJA_CAPITAL, columnas: COLUMNAS_CAPITAL },
      { nombre: HOJA_CONFIGURACION, columnas: COLUMNAS_CONFIGURACION, filas: PARAMETROS_VALIDOS.map((p) => [p, '']) }
    ]
  });
}

async function exportarFinanzas(usuarioId) {
  const { data: costosFijos, error: eCostos } = await supabase
    .from('costos_fijos').select('nombre, valor_mensual, activo').eq('usuario_id', usuarioId).order('nombre');
  if (eCostos) throw new Error(eCostos.message);
  const filasCostos = (costosFijos || []).map((c) => [c.nombre, c.valor_mensual, c.activo ? 'SI' : 'NO']);

  const { data: capital, error: eCapital } = await supabase
    .from('capital_invertido').select('fecha, concepto, valor').eq('usuario_id', usuarioId)
    .order('fecha', { ascending: false }).limit(LIMITE_CAPITAL);
  if (eCapital) throw new Error(eCapital.message);
  const filasCapital = (capital || []).map((c) => [new Date(c.fecha).toLocaleDateString('es-CO'), c.concepto, c.valor]);

  const { data: config, error: eConfig } = await supabase
    .from('configuracion_produccion')
    .select('costo_hora_mano_obra, meta_ventas_mensual, fecha_inicio_operacion')
    .eq('usuario_id', usuarioId).maybeSingle();
  if (eConfig) throw new Error(eConfig.message);
  const filasConfig = [
    ['Costo hora mano de obra', config && config.costo_hora_mano_obra != null ? config.costo_hora_mano_obra : ''],
    ['Meta ventas mensual', config && config.meta_ventas_mensual != null ? config.meta_ventas_mensual : ''],
    ['Fecha inicio operación', config && config.fecha_inicio_operacion ? new Date(config.fecha_inicio_operacion).toLocaleDateString('es-CO') : '']
  ];

  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_COSTOS_FIJOS, columnas: COLUMNAS_COSTOS_FIJOS, filas: filasCostos },
      { nombre: HOJA_CAPITAL, columnas: COLUMNAS_CAPITAL, filas: filasCapital },
      { nombre: HOJA_CONFIGURACION, columnas: COLUMNAS_CONFIGURACION, filas: filasConfig }
    ]
  });
}

module.exports = { generarPlantilla, exportarFinanzas };