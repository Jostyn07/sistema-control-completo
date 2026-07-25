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
//
// IMPORTANTE — esto se llama desde varias rutas distintas, y ahora
// Inicio dispara varias de esas rutas EN PARALELO (Promise.all). Si
// dos peticiones llegan casi al mismo tiempo para la misma compra
// vencida, un simple "SELECT para ver el estado, luego UPDATE" deja
// una ventana donde ambas leen "pendiente" antes de que cualquiera
// alcance a guardar "recibida" — y las dos suman el stock (bug real
// que se reportó: el inventario quedaba con el doble de lo comprado).
//
// La forma correcta es reclamar la compra con un solo UPDATE
// condicionado a `estado = 'pendiente'`: Postgres solo deja que UNA
// de las peticiones concurrentes gane esa condición — la otra no
// actualiza ninguna fila y se detiene ahí, sin duplicar nada.
async function recibirCompra(compraId, usuarioId) {
  const { data: reclamada, error: eReclamo } = await supabase
    .from('compras')
    .update({ estado: 'recibida', fecha_llegada: new Date().toISOString() })
    .eq('id', compraId)
    .eq('usuario_id', usuarioId)
    .eq('estado', 'pendiente')
    .select()
    .maybeSingle();
  if (eReclamo) throw new Error(eReclamo.message);

  if (!reclamada) {
    // No se pudo reclamar: o el id no existe, o ya estaba recibida de
    // antes, o la ganó otra petición concurrente hace un instante.
    // Solo el primer caso es un error real — los otros dos significan
    // que el stock de esta compra ya se sumó (o se está sumando en la
    // otra llamada), y no hay nada más que hacer aquí.
    const { data: actual } = await supabase
      .from('compras').select('*').eq('id', compraId).eq('usuario_id', usuarioId).maybeSingle();
    if (!actual) throw new Error('Compra no encontrada');
    return actual;
  }

  const { data: material, error: eMat } = await supabase
    .from('materiales').select('stock_actual').eq('id', reclamada.material_id).eq('usuario_id', usuarioId).single();
  if (eMat || !material) throw new Error('El material de esta compra ya no existe');

  const stockAnterior = Number(material.stock_actual);
  const nuevoStock = Math.round((stockAnterior + Number(reclamada.cantidad)) * 100) / 100;
  const { error: eStock } = await supabase
    .from('materiales')
    .update({ stock_actual: nuevoStock, actualizado_en: new Date().toISOString() })
    .eq('id', reclamada.material_id)
    .eq('usuario_id', usuarioId);
  if (eStock) throw new Error(eStock.message);

  // Bitácora (Fase 2) — misma regla: si falla, no se revierte la
  // recepción de la compra, solo queda sin registrar en el historial.
  const { error: eMov } = await supabase.from('inventario_movimientos').insert({
    usuario_id: usuarioId,
    material_id: reclamada.material_id,
    tipo: 'compra',
    cantidad: Number(reclamada.cantidad),
    stock_anterior: stockAnterior,
    stock_nuevo: nuevoStock,
    referencia_id: reclamada.id
  });
  if (eMov) console.error('[inventario_movimientos] No se pudo registrar el movimiento de compra:', eMov.message);

  return reclamada;
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