// ============================================================
// SERVICIO DE COSTOS — server/servicios/costos.js
// Calcula el costo de un producto (materiales + mano de obra) usando
// SIEMPRE el precio de hora global del usuario, nunca un valor guardado
// por producto. Así, cambiar el precio de hora en un solo lugar
// (configuracion_produccion) afecta a todos los productos.
// Lo usan el módulo Productos y el módulo Materiales (cuando cambia
// el costo de un material, hay que recalcular lo que lo usa).
// ============================================================
const supabase = require('../supabase/cliente');

// Devuelve el costo por MINUTO (la config se guarda por hora, más natural para el usuario)
async function obtenerCostoMinutoManoObra(usuarioId) {
  const { data, error } = await supabase
    .from('configuracion_produccion')
    .select('costo_hora_mano_obra')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const costoHora = data ? Number(data.costo_hora_mano_obra) : 0;
  return costoHora / 60;
}

async function calcularCostoMateriales(materiales, usuarioId) {
  const ids = materiales.map(m => m.material_id);
  const { data: filas, error } = await supabase
    .from('materiales')
    .select('id, costo_unitario')
    .eq('usuario_id', usuarioId)
    .in('id', ids);
  if (error) throw new Error(error.message);

  const costoPorId = new Map(filas.map(m => [m.id, Number(m.costo_unitario)]));
  let total = 0;
  for (const m of materiales) {
    const costoUnitario = costoPorId.get(m.material_id);
    if (costoUnitario == null) throw new Error('Uno de los materiales no existe o no te pertenece');
    total += costoUnitario * Number(m.cantidad);
  }
  return total;
}

// Costo total de un producto = materiales + (minutos de fabricación × precio de hora global ÷ 60)
async function calcularCostoProducto({ materiales, minutosFabricacion, usuarioId }) {
  const costoMateriales = await calcularCostoMateriales(materiales, usuarioId);
  const costoMinuto = await obtenerCostoMinutoManoObra(usuarioId);
  const costoManoObra = Number(minutosFabricacion || 0) * costoMinuto;
  return Math.round((costoMateriales + costoManoObra) * 100) / 100;
}

// Recalcula TODOS los productos activos de un usuario. Se usa cuando
// cambia el precio de hora global (afecta a todos, no solo a uno).
async function recalcularTodosLosProductos(usuarioId) {
  const { data: productos, error } = await supabase
    .from('productos')
    .select('id, minutos_fabricacion')
    .eq('usuario_id', usuarioId)
    .eq('activo', true);
  if (error) throw new Error(error.message);

  let contador = 0;
  for (const producto of productos || []) {
    const { data: filas, error: eFilas } = await supabase
      .from('productos_materiales')
      .select('material_id, cantidad')
      .eq('producto_id', producto.id);
    if (eFilas) throw new Error(eFilas.message);

    const costo = await calcularCostoProducto({
      materiales: (filas || []).map(f => ({ material_id: f.material_id, cantidad: f.cantidad })),
      minutosFabricacion: producto.minutos_fabricacion,
      usuarioId
    });

    const { error: eUpd } = await supabase
      .from('productos')
      .update({ costo_calculado: costo, actualizado_en: new Date().toISOString() })
      .eq('id', producto.id)
      .eq('usuario_id', usuarioId);
    if (eUpd) throw new Error(eUpd.message);
    contador++;
  }
  return contador;
}

module.exports = {
  obtenerCostoMinutoManoObra,
  calcularCostoMateriales,
  calcularCostoProducto,
  recalcularTodosLosProductos
};