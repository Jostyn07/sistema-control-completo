// ============================================================
// SERVICIO DE COMPRAS EN TRÁNSITO — server/servicios/compras.js
// Una compra ya NO suma stock al registrarse: queda "pendiente" con
// una fecha estimada de llegada (hoy + tiempo_entrega_dias del
// material). El stock se suma solo cuando se confirma la llegada:
//   - automáticamente, cuando se cumple la fecha estimada (se revisa
//     de forma perezosa cada vez que se consulta inventario/materiales,
//     sin necesidad de un proceso programado aparte)
//   - manualmente, si el usuario marca "Llegó" antes de esa fecha
// ============================================================
const supabase = require('../supabase/cliente');

// Fecha estimada de llegada = hoy + días de entrega del material
function calcularFechaEstimada(tiempoEntregaDias) {
  const fecha = new Date();
  fecha.setDate(fecha.getDate() + Number(tiempoEntregaDias || 0));
  return fecha.toISOString().slice(0, 10); // YYYY-MM-DD
}

// Confirma la llegada de UNA compra puntual: la marca "recibida" y
// suma su cantidad al stock del material. Se usa tanto para el botón
// manual "Marcar como llegada" como desde el proceso automático.
async function recibirCompra(compraId, usuarioId) {
  const { data: compra, error: eGet } = await supabase
    .from('compras').select('*').eq('id', compraId).eq('usuario_id', usuarioId).single();
  if (eGet || !compra) throw new Error('Compra no encontrada');
  if (compra.estado === 'recibida') return compra; // ya estaba recibida, no duplicar

  const { data: material, error: eMat } = await supabase
    .from('materiales').select('stock_actual').eq('id', compra.material_id).eq('usuario_id', usuarioId).single();
  if (eMat || !material) throw new Error('El material de esta compra ya no existe');

  const nuevoStock = Math.round((Number(material.stock_actual) + Number(compra.cantidad)) * 100) / 100;
  const { error: eStock } = await supabase
    .from('materiales')
    .update({ stock_actual: nuevoStock, actualizado_en: new Date().toISOString() })
    .eq('id', compra.material_id)
    .eq('usuario_id', usuarioId);
  if (eStock) throw new Error(eStock.message);

  const { data: actualizada, error: eUpd } = await supabase
    .from('compras')
    .update({ estado: 'recibida', fecha_llegada: new Date().toISOString() })
    .eq('id', compraId)
    .eq('usuario_id', usuarioId)
    .select().single();
  if (eUpd) throw new Error(eUpd.message);

  return actualizada;
}

// Revisa todas las compras pendientes de un usuario cuya fecha estimada
// ya pasó, y las marca como recibidas automáticamente (sumando su stock).
// Se llama al principio de cualquier consulta que muestre stock, para
// que siempre esté al día sin depender de un proceso programado aparte.
async function procesarComprasVencidas(usuarioId) {
  const hoy = new Date().toISOString().slice(0, 10);
  const { data: vencidas, error } = await supabase
    .from('compras')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('estado', 'pendiente')
    .lte('fecha_estimada_llegada', hoy);
  if (error) throw new Error(error.message);

  for (const compra of vencidas || []) {
    await recibirCompra(compra.id, usuarioId);
  }
  return (vencidas || []).length;
}

module.exports = { calcularFechaEstimada, recibirCompra, procesarComprasVencidas };