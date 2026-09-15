// ============================================================
// EXPORTADOR — Facturación (server/servicios/exportadores/facturacion.js)
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibroMultiHoja } = require('../excel/generador');
const {
  TITULO, PARA_QUE_SIRVE, ADVERTENCIAS,
  HOJA_CONFIGURACION_FISCAL, HOJA_FACTURAS, COLUMNAS_CONFIGURACION_FISCAL, COLUMNAS_FACTURAS
} = require('../excel/definiciones/facturacion');

const LIMITE_HISTORIAL = 300;

function generarPlantilla() {
  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_CONFIGURACION_FISCAL, columnas: COLUMNAS_CONFIGURACION_FISCAL },
      { nombre: HOJA_FACTURAS, columnas: COLUMNAS_FACTURAS }
    ]
  });
}

async function exportarFacturacion(usuarioId) {
  const { data: config, error: eConfig } = await supabase
    .from('configuracion_fiscal').select('*').eq('usuario_id', usuarioId).maybeSingle();
  if (eConfig) throw new Error(eConfig.message);

  const filasConfig = config ? [[
    config.razon_social || '',
    config.nit || '',
    config.regimen || '',
    config.resolucion_numero || '',
    config.resolucion_prefijo || '',
    config.resolucion_desde != null ? config.resolucion_desde : '',
    config.resolucion_hasta != null ? config.resolucion_hasta : '',
    config.resolucion_vigencia ? new Date(config.resolucion_vigencia).toLocaleDateString('es-CO') : ''
  ]] : [];

  const { data: facturas, error: eFact } = await supabase
    .from('facturas')
    .select('numero, cufe, estado, fecha, ventas!inner(codigo, usuario_id)')
    .eq('usuario_id', usuarioId)
    .eq('ventas.usuario_id', usuarioId)
    .order('fecha', { ascending: false })
    .limit(LIMITE_HISTORIAL);
  if (eFact) throw new Error(eFact.message);

  const filasFacturas = (facturas || [])
    .filter((f) => f.ventas.codigo)
    .map((f) => [f.numero || '', f.ventas.codigo, f.cufe || '', f.estado, new Date(f.fecha).toLocaleDateString('es-CO')]);

  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_CONFIGURACION_FISCAL, columnas: COLUMNAS_CONFIGURACION_FISCAL, filas: filasConfig },
      { nombre: HOJA_FACTURAS, columnas: COLUMNAS_FACTURAS, filas: filasFacturas }
    ]
  });
}

module.exports = { generarPlantilla, exportarFacturacion };