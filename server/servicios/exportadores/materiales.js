// ============================================================
// EXPORTADOR — Materiales (server/servicios/exportadores/materiales.js)
// Genera los dos archivos que el usuario puede descargar desde la
// pestaña Materiales:
//   - generarPlantilla()        → Excel vacío, con una fila de ejemplo
//   - exportarMateriales(id)    → Excel con TODOS los materiales
//     activos del usuario, listos para editar y volver a subir
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibro } = require('../excel/generador');
const { TITULO, PARA_QUE_SIRVE, ADVERTENCIAS, COLUMNAS } = require('../excel/definiciones/materiales');

function generarPlantilla() {
  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, advertencias: ADVERTENCIAS });
}

// Convierte un material de la base de datos en una fila en el mismo
// orden que COLUMNAS, lista para escribirse en la hoja de Datos.
function filaDesdeMaterial(material) {
  return COLUMNAS.map((columna) => {
    const valor = material[columna.clave];
    if (columna.clave === 'activo') return valor ? 'SI' : 'NO';
    return valor == null ? '' : valor;
  });
}

async function exportarMateriales(usuarioId) {
  const { data, error } = await supabase
    .from('materiales')
    .select('codigo, nombre, unidad, costo_unitario, proveedor, tiempo_entrega_dias, stock_actual, stock_seguridad, activo')
    .eq('usuario_id', usuarioId)
    .order('nombre');
  if (error) throw new Error(error.message);

  const filas = (data || []).map(filaDesdeMaterial);
  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, filas, advertencias: ADVERTENCIAS });
}

module.exports = { generarPlantilla, exportarMateriales };