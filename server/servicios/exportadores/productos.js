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
    if (columna.clave === 'tipo') return producto.tipo === 'reventa' ? 'REVENTA' : 'FABRICADO';
    if (columna.clave === 'costo_compra') return producto.tipo === 'reventa' ? Number(producto.costo_calculado || 0) : '';
    if (columna.clave === 'existencias') return ''; // solo se usa al crear
    const valor = producto[columna.clave];
    return valor == null ? '' : valor;
  });
}

async function exportarProductos(empresaId) {
  const { data, error } = await supabase
    .from('productos')
    .select('codigo, nombre, tipo, costo_calculado, precio_venta, minutos_fabricacion, foto_url, activo, categorias_productos(nombre)')
    .eq('empresa_id', empresaId)
    .order('nombre');
  if (error) throw new Error(error.message);

  const filas = (data || []).map(filaDesdeProducto);
  return crearLibro({ titulo: TITULO, paraQueSirve: PARA_QUE_SIRVE, columnas: COLUMNAS, filas, advertencias: ADVERTENCIAS });
}

module.exports = { generarPlantilla, exportarProductos };