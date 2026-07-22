// ============================================================
// SERVICIO INTERNO DE INVENTARIO — no es un endpoint.
// Lo usan el módulo 3 (Inventario) y el módulo 5 (Compras).
//
// Fórmula del documento:
//   punto_reorden = (consumo_diario_promedio × tiempo_entrega_proveedor)
//                   + stock_seguridad
//
// El consumo diario promedio se calcula con datos reales: cuánto
// material consumieron las ventas de los últimos N días (según las
// fichas técnicas de los productos vendidos). Si aún no hay ventas,
// el consumo es 0 y el punto de reorden queda en el stock de seguridad.
// ============================================================
const supabase = require('../supabase/cliente');

const DIAS_VENTANA_CONSUMO = 30; // ventana para promediar el consumo

// Devuelve un Map material_id -> consumo diario promedio (unidades/día)
async function calcularConsumoDiarioPromedio() {
  const desde = new Date();
  desde.setDate(desde.getDate() - DIAS_VENTANA_CONSUMO);

  // Ventas de la ventana con sus items
  const { data: items, error: eItems } = await supabase
    .from('ventas_items')
    .select('producto_id, cantidad, ventas!inner(fecha)')
    .gte('ventas.fecha', desde.toISOString());
  if (eItems) throw new Error(eItems.message);

  if (!items || items.length === 0) return new Map();

  // Unidades vendidas por producto en la ventana
  const unidadesPorProducto = new Map();
  for (const item of items) {
    unidadesPorProducto.set(item.producto_id,
      (unidadesPorProducto.get(item.producto_id) || 0) + Number(item.cantidad));
  }

  // Fichas técnicas de esos productos
  const productoIds = [...unidadesPorProducto.keys()];
  const { data: fichas, error: eFichas } = await supabase
    .from('productos_materiales')
    .select('producto_id, material_id, cantidad')
    .in('producto_id', productoIds);
  if (eFichas) throw new Error(eFichas.message);

  // Consumo total de cada material en la ventana = Σ unidades_vendidas × cantidad_por_unidad
  const consumoTotal = new Map();
  for (const ficha of fichas || []) {
    const unidades = unidadesPorProducto.get(ficha.producto_id) || 0;
    consumoTotal.set(ficha.material_id,
      (consumoTotal.get(ficha.material_id) || 0) + unidades * Number(ficha.cantidad));
  }

  // Promedio diario
  const consumoDiario = new Map();
  for (const [materialId, total] of consumoTotal) {
    consumoDiario.set(materialId, total / DIAS_VENTANA_CONSUMO);
  }
  return consumoDiario;
}

// Punto de reorden de UN material (recibe la fila del material y su consumo diario)
function calcularPuntoReorden(material, consumoDiario) {
  const consumo = Number(consumoDiario || 0);
  const entrega = Number(material.tiempo_entrega_dias || 0);
  const seguridad = Number(material.stock_seguridad || 0);
  return Math.round((consumo * entrega + seguridad) * 100) / 100;
}

// Estado semáforo según stock vs punto de reorden
//   rojo:    stock <= punto de reorden (ya hay que comprar)
//   amarillo: stock <= punto de reorden × 1.5 (se acerca)
//   verde:   lo demás
function estadoSemaforo(stockActual, puntoReorden) {
  const stock = Number(stockActual);
  if (puntoReorden <= 0) return stock > 0 ? 'verde' : 'rojo';
  if (stock <= puntoReorden) return 'rojo';
  if (stock <= puntoReorden * 1.5) return 'amarillo';
  return 'verde';
}

// Vista completa de inventario por material: stock + reorden + estado + consumo
async function obtenerInventarioMateriales() {
  const { data: materiales, error } = await supabase
    .from('materiales')
    .select('*')
    .eq('activo', true)
    .order('nombre');
  if (error) throw new Error(error.message);

  const consumoDiario = await calcularConsumoDiarioPromedio();

  return (materiales || []).map(m => {
    const consumo = consumoDiario.get(m.id) || 0;
    const puntoReorden = calcularPuntoReorden(m, consumo);
    return {
      id: m.id,
      nombre: m.nombre,
      unidad: m.unidad,
      proveedor: m.proveedor,
      tiempo_entrega_dias: m.tiempo_entrega_dias,
      stock_actual: Number(m.stock_actual),
      stock_seguridad: Number(m.stock_seguridad),
      consumo_diario_promedio: Math.round(consumo * 100) / 100,
      punto_reorden: puntoReorden,
      estado: estadoSemaforo(m.stock_actual, puntoReorden),
      costo_unitario: Number(m.costo_unitario)
    };
  });
}

module.exports = {
  calcularConsumoDiarioPromedio,
  calcularPuntoReorden,
  estadoSemaforo,
  obtenerInventarioMateriales,
  DIAS_VENTANA_CONSUMO
};
