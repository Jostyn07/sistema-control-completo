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

async function exportarCompras(empresaId) {
  const { data, error } = await supabase
    .from('compras')
    .select('fecha, proveedor, cantidad, precio_unitario, estado, notas, materiales(codigo), productos(codigo)')
    .eq('empresa_id', empresaId)
    .order('fecha', { ascending: false })
    .limit(LIMITE_HISTORIAL);
  if (error) throw new Error(error.message);

  const filas = (data || [])
    .filter((c) => (c.materiales && c.materiales.codigo) || (c.productos && c.productos.codigo))
    .map((c) => {
      const valores = {
        codigo: '', // el "Código compra" original no se guarda por separado, ver definiciones/compras.js
        fecha: new Date(c.fecha).toLocaleDateString('es-CO'),
        codigo_material: c.materiales ? c.materiales.codigo : '',
        codigo_producto: c.productos ? c.productos.codigo : '',
        proveedor: c.proveedor,
        cantidad: c.cantidad,
        precio_unitario: c.precio_unitario,
        estado: c.estado.toUpperCase(),
        notas: c.notas || ''
      };
      return COLUMNAS.map((col) => valores[col.clave] ?? '');
    });

  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, filas, advertencias: ADVERTENCIAS });
}

module.exports = { generarPlantilla, exportarCompras };
