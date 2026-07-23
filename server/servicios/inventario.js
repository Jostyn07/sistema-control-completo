// ============================================================
// SERVICIO INTERNO DE INVENTARIO — no es un endpoint.
// Lo usan el módulo 3 (Inventario) y el módulo 5 (Compras).
// Todas las funciones reciben usuarioId y filtran por él, para
// que el punto de reorden se calcule solo con los datos de ese usuario.
// ============================================================
const supabase = require('../supabase/cliente');
const { procesarComprasVencidas } = require('./compras');

const DIAS_VENTANA_CONSUMO = 30;

// Devuelve un Map material_id -> consumo diario promedio, solo del usuario dado
async function calcularConsumoDiarioPromedio(usuarioId) {
  const desde = new Date();
  desde.setDate(desde.getDate() - DIAS_VENTANA_CONSUMO);

  const { data: items, error: eItems } = await supabase
    .from('ventas_items')
    .select('producto_id, cantidad, ventas!inner(fecha, usuario_id)')
    .eq('ventas.usuario_id', usuarioId)
    .gte('ventas.fecha', desde.toISOString());
  if (eItems) throw new Error(eItems.message);

  if (!items || items.length === 0) return new Map();

  const unidadesPorProducto = new Map();
  for (const item of items) {
    unidadesPorProducto.set(item.producto_id,
      (unidadesPorProducto.get(item.producto_id) || 0) + Number(item.cantidad));
  }

  const productoIds = [...unidadesPorProducto.keys()];
  const { data: fichas, error: eFichas } = await supabase
    .from('productos_materiales')
    .select('producto_id, material_id, cantidad')
    .in('producto_id', productoIds);
  if (eFichas) throw new Error(eFichas.message);

  const consumoTotal = new Map();
  for (const ficha of fichas || []) {
    const unidades = unidadesPorProducto.get(ficha.producto_id) || 0;
    consumoTotal.set(ficha.material_id,
      (consumoTotal.get(ficha.material_id) || 0) + unidades * Number(ficha.cantidad));
  }

  const consumoDiario = new Map();
  for (const [materialId, total] of consumoTotal) {
    consumoDiario.set(materialId, total / DIAS_VENTANA_CONSUMO);
  }
  return consumoDiario;
}

function calcularPuntoReorden(material, consumoDiario) {
  const consumo = Number(consumoDiario || 0);
  const entrega = Number(material.tiempo_entrega_dias || 0);
  const seguridad = Number(material.stock_seguridad || 0);
  return Math.round((consumo * entrega + seguridad) * 100) / 100;
}

function estadoSemaforo(stockActual, puntoReorden) {
  const stock = Number(stockActual);
  if (puntoReorden <= 0) return stock > 0 ? 'verde' : 'rojo';
  if (stock <= puntoReorden) return 'rojo';
  if (stock <= puntoReorden * 1.5) return 'amarillo';
  return 'verde';
}

// Vista completa de inventario por material, solo del usuario dado
async function obtenerInventarioMateriales(usuarioId) {
  await procesarComprasVencidas(usuarioId); // suma stock de pedidos que ya deberían haber llegado

  const { data: materiales, error } = await supabase
    .from('materiales')
    .select('*')
    .eq('usuario_id', usuarioId)
    .eq('activo', true)
    .order('nombre');
  if (error) throw new Error(error.message);

  const consumoDiario = await calcularConsumoDiarioPromedio(usuarioId);

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