// ============================================================
// EXPORTADOR — Inventario (server/servicios/exportadores/inventario.js)
// A diferencia de Materiales/Productos, "exportar información
// actual" aquí no tiene un catálogo que mostrar (el stock ya se ve
// en el Excel de Materiales) — en su lugar, exporta el HISTORIAL
// reciente de movimientos, como referencia de lo último importado
// o ajustado manualmente.
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibro } = require('../excel/generador');
const { TITULO, PARA_QUE_SIRVE, ADVERTENCIAS, COLUMNAS } = require('../excel/definiciones/inventario');

const LIMITE_HISTORIAL = 500;

function generarPlantilla() {
  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, advertencias: ADVERTENCIAS });
}

// El motivo que guarda el importador va prefijado con "[TIPO]" (ver
// importadores/inventario.js) — de ahí se recupera el tipo original
// para mostrarlo en esta exportación. Los ajustes hechos a mano desde
// la plataforma no tienen ese prefijo, así que se muestran como AJUSTE.
function tipoYMotivoDesde(motivoGuardado) {
  const coincidencia = /^\[(ENTRADA|SALIDA|AJUSTE)\]\s*(.*)$/.exec(motivoGuardado || '');
  if (coincidencia) return { tipo: coincidencia[1], motivo: coincidencia[2] };
  return { tipo: 'AJUSTE', motivo: motivoGuardado || '' };
}

async function exportarInventario(usuarioId) {
  const { data, error } = await supabase
    .from('inventario_ajustes')
    .select('fecha, stock_anterior, stock_nuevo, motivo, materiales!inner(codigo, usuario_id)')
    .eq('usuario_id', usuarioId)
    .eq('materiales.usuario_id', usuarioId)
    .order('fecha', { ascending: false })
    .limit(LIMITE_HISTORIAL);
  if (error) throw new Error(error.message);

  const filas = (data || [])
    .filter((a) => a.materiales.codigo) // sin código no se puede referenciar en el Excel
    .map((a) => {
      const { tipo, motivo } = tipoYMotivoDesde(a.motivo);
      const cantidad = tipo === 'AJUSTE'
        ? Math.round((Number(a.stock_nuevo) - Number(a.stock_anterior)) * 10000) / 10000
        : Math.abs(Math.round((Number(a.stock_nuevo) - Number(a.stock_anterior)) * 10000) / 10000);
      return [new Date(a.fecha).toLocaleDateString('es-CO'), a.materiales.codigo, tipo, cantidad, motivo];
    });

  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, filas, advertencias: ADVERTENCIAS });
}

module.exports = { generarPlantilla, exportarInventario };