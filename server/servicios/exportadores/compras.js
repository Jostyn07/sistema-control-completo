// ============================================================
// EXPORTADOR — Compras (server/servicios/exportadores/compras.js)
// Igual que Inventario, "exportar información actual" aquí exporta
// el HISTORIAL reciente de compras (no hay un catálogo que mostrar).
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibro } = require('../excel/generador');
const { TITULO, PARA_QUE_SIRVE, ADVERTENCIAS, COLUMNAS } = require('../excel/definiciones/compras');

const LIMITE_HISTORIAL = 500;

function generarPlantilla() {
  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, advertencias: ADVERTENCIAS });
}

async function exportarCompras(usuarioId) {
  const { data, error } = await supabase
    .from('compras')
    .select('fecha, proveedor, cantidad, precio_unitario, estado, notas, materiales!inner(codigo, usuario_id)')
    .eq('usuario_id', usuarioId)
    .eq('materiales.usuario_id', usuarioId)
    .order('fecha', { ascending: false })
    .limit(LIMITE_HISTORIAL);
  if (error) throw new Error(error.message);

  const filas = (data || [])
    .filter((c) => c.materiales.codigo)
    .map((c) => [
      '', // el "Código compra" original no se guarda por separado, ver definiciones/compras.js
      new Date(c.fecha).toLocaleDateString('es-CO'),
      c.materiales.codigo,
      c.proveedor,
      c.cantidad,
      c.precio_unitario,
      c.estado.toUpperCase(),
      c.notas || ''
    ]);

  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, filas, advertencias: ADVERTENCIAS });
}

module.exports = { generarPlantilla, exportarCompras };