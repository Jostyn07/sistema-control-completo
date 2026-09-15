// ============================================================
// EXPORTADOR — Ventas (server/servicios/exportadores/ventas.js)
// Igual que Compras/Inventario: "exportar información actual"
// exporta el HISTORIAL reciente, no un catálogo. El teléfono y la
// cédula NUNCA se exportan (van cifrados y son datos sensibles del
// cliente) — se exportan vacíos a propósito.
// ============================================================
const supabase = require('../../supabase/cliente');
const { crearLibroMultiHoja } = require('../excel/generador');
const {
  TITULO, PARA_QUE_SIRVE, ADVERTENCIAS,
  HOJA_VENTAS, HOJA_VENTAS_ITEMS, COLUMNAS_VENTAS, COLUMNAS_VENTAS_ITEMS
} = require('../excel/definiciones/ventas');

const LIMITE_HISTORIAL = 300;

function generarPlantilla() {
  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_VENTAS, columnas: COLUMNAS_VENTAS },
      { nombre: HOJA_VENTAS_ITEMS, columnas: COLUMNAS_VENTAS_ITEMS }
    ]
  });
}

async function exportarVentas(usuarioId) {
  const { data: ventas, error } = await supabase
    .from('ventas')
    .select('id, codigo, fecha, cliente, fecha_entrega, estado, pagado')
    .eq('usuario_id', usuarioId)
    .order('fecha', { ascending: false })
    .limit(LIMITE_HISTORIAL);
  if (error) throw new Error(error.message);

  const filasVentas = (ventas || [])
    .filter((v) => v.codigo) // sin código no se puede referenciar en el Excel
    .map((v) => [
      v.codigo,
      new Date(v.fecha).toLocaleDateString('es-CO'),
      v.cliente || '',
      '', // teléfono: nunca se exporta (dato cifrado del cliente)
      '', // cédula: nunca se exporta (dato cifrado del cliente)
      v.fecha_entrega ? new Date(v.fecha_entrega).toLocaleDateString('es-CO') : '',
      v.estado,
      v.pagado ? 'SI' : 'NO'
    ]);

  const ventaIds = (ventas || []).filter((v) => v.codigo).map((v) => v.id);
  const codigoPorVentaId = new Map((ventas || []).map((v) => [v.id, v.codigo]));
  let filasItems = [];
  if (ventaIds.length > 0) {
    const { data: items, error: eItems } = await supabase
      .from('ventas_items')
      .select('venta_id, cantidad, productos(codigo)')
      .in('venta_id', ventaIds);
    if (eItems) throw new Error(eItems.message);
    filasItems = (items || [])
      .filter((i) => i.productos && i.productos.codigo)
      .map((i) => [codigoPorVentaId.get(i.venta_id), i.productos.codigo, i.cantidad]);
  }

  return crearLibroMultiHoja({
    titulo: TITULO,
    paraQueSirve: PARA_QUE_SIRVE,
    advertencias: ADVERTENCIAS,
    hojas: [
      { nombre: HOJA_VENTAS, columnas: COLUMNAS_VENTAS, filas: filasVentas },
      { nombre: HOJA_VENTAS_ITEMS, columnas: COLUMNAS_VENTAS_ITEMS, filas: filasItems }
    ]
  });
}

module.exports = { generarPlantilla, exportarVentas };