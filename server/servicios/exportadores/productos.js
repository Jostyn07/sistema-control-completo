// ============================================================
// EXPORTADOR — Productos (server/servicios/exportadores/productos.js)
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibro } = require('../excel/generador');
const { TITULO, PARA_QUE_SIRVE, ADVERTENCIAS, COLUMNAS } = require('../excel/definiciones/productos');

function generarPlantilla() {
  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, advertencias: ADVERTENCIAS });
}

function filaDesdeProducto(producto) {
  const categoria = producto.categorias_productos ? producto.categorias_productos.nombre : '';
  return COLUMNAS.map((columna) => {
    if (columna.clave === 'categoria') return categoria;
    if (columna.clave === 'activo') return producto.activo ? 'SI' : 'NO';
    const valor = producto[columna.clave];
    return valor == null ? '' : valor;
  });
}

async function exportarProductos(usuarioId) {
  const { data, error } = await supabase
    .from('productos')
    .select('codigo, nombre, precio_venta, minutos_fabricacion, foto_url, activo, categorias_productos(nombre)')
    .eq('usuario_id', usuarioId)
    .order('nombre');
  if (error) throw new Error(error.message);

  const filas = (data || []).map(filaDesdeProducto);
  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, filas, advertencias: ADVERTENCIAS });
}

module.exports = { generarPlantilla, exportarProductos };