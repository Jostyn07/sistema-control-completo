// ============================================================
// EXPORTADOR — Nóminas (server/servicios/exportadores/nominas.js)
// Igual que Ventas con los datos del cliente: la Cédula y la
// Dirección NUNCA se exportan (van cifradas y son datos sensibles
// del colaborador) — se exportan vacías a propósito.
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibroMultiHoja } = require('../excel/generador');
const {
  TITULO, PARA_QUE_SIRVE, ADVERTENCIAS,
  HOJA_COLABORADORES, HOJA_ENCARGOS, COLUMNAS_COLABORADORES, COLUMNAS_ENCARGOS
} = require('../excel/definiciones/nominas');

const LIMITE_ENCARGOS = 300;

function generarPlantilla() {
  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_COLABORADORES, columnas: COLUMNAS_COLABORADORES },
      { nombre: HOJA_ENCARGOS, columnas: COLUMNAS_ENCARGOS }
    ]
  });
}

async function exportarNominas(usuarioId) {
  const { data: colaboradores, error } = await supabase
    .from('colaboradores').select('codigo, nombre, activo').eq('usuario_id', usuarioId).order('nombre');
  if (error) throw new Error(error.message);

  const filasColaboradores = (colaboradores || [])
    .filter((c) => c.codigo)
    .map((c) => [c.codigo, c.nombre, '', '', c.activo ? 'SI' : 'NO']);

  const { data: encargos, error: eEnc } = await supabase
    .from('colaboradores_encargos')
    .select('fecha_entrega, cantidad_entregada, costo_total_proceso, pagado, colaboradores!inner(codigo, usuario_id), procesos(codigo)')
    .eq('usuario_id', usuarioId)
    .eq('colaboradores.usuario_id', usuarioId)
    .order('fecha_entrega', { ascending: false })
    .limit(LIMITE_ENCARGOS);
  if (eEnc) throw new Error(eEnc.message);

  const filasEncargos = (encargos || [])
    .filter((e) => e.colaboradores.codigo && e.procesos && e.procesos.codigo)
    .map((e) => [
      e.colaboradores.codigo,
      e.procesos.codigo,
      e.fecha_entrega ? new Date(e.fecha_entrega).toLocaleDateString('es-CO') : '',
      e.cantidad_entregada,
      e.costo_total_proceso,
      e.pagado ? 'SI' : 'NO'
    ]);

  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_COLABORADORES, columnas: COLUMNAS_COLABORADORES, filas: filasColaboradores },
      { nombre: HOJA_ENCARGOS, columnas: COLUMNAS_ENCARGOS, filas: filasEncargos }
    ]
  });
}

module.exports = { generarPlantilla, exportarNominas };