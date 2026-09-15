// ============================================================
// EXPORTADOR — Procesos (server/servicios/exportadores/procesos.js)
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibroMultiHoja } = require('../excel/generador');
const {
  TITULO, PARA_QUE_SIRVE, ADVERTENCIAS,
  HOJA_PROCESOS, HOJA_MATERIALES_PROCESO,
  COLUMNAS_PROCESOS, COLUMNAS_MATERIALES_PROCESO
} = require('../excel/definiciones/procesos');

function generarPlantilla() {
  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_PROCESOS, columnas: COLUMNAS_PROCESOS },
      { nombre: HOJA_MATERIALES_PROCESO, columnas: COLUMNAS_MATERIALES_PROCESO }
    ]
  });
}

async function exportarProcesos(usuarioId) {
  const { data: procesos, error } = await supabase
    .from('procesos')
    .select('codigo, nombre, orden, tiempo_minutos, repeticiones_por_unidad, activo, productos!inner(codigo, usuario_id)')
    .eq('usuario_id', usuarioId)
    .eq('productos.usuario_id', usuarioId)
    .order('orden');
  if (error) throw new Error(error.message);

  const filasProcesos = (procesos || []).map((p) => [
    p.productos.codigo || '',
    p.codigo || '',
    p.nombre,
    p.orden != null ? p.orden : '',
    p.tiempo_minutos,
    p.repeticiones_por_unidad != null ? p.repeticiones_por_unidad : '',
    p.activo ? 'SI' : 'NO'
  ]);

  const { data: materiales, error: eMat } = await supabase
    .from('procesos_materiales')
    .select('cantidad, procesos!inner(codigo, usuario_id), materiales(codigo)')
    .eq('procesos.usuario_id', usuarioId);
  if (eMat) throw new Error(eMat.message);

  const filasMateriales = (materiales || [])
    .filter((m) => m.procesos.codigo && m.materiales && m.materiales.codigo) // sin código no se puede referenciar en el Excel
    .map((m) => [m.procesos.codigo, m.materiales.codigo, m.cantidad]);

  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_PROCESOS, columnas: COLUMNAS_PROCESOS, filas: filasProcesos },
      { nombre: HOJA_MATERIALES_PROCESO, columnas: COLUMNAS_MATERIALES_PROCESO, filas: filasMateriales }
    ]
  });
}

module.exports = { generarPlantilla, exportarProcesos };