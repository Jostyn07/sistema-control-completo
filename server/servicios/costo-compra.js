// ============================================================
// DECISIÓN DE COSTO AL COMPRAR — server/servicios/costo-compra.js
// Cuando se compra un material o un producto de reventa a un precio
// distinto de su costo registrado, la persona decide:
//   'mantener'  deja el costo como estaba
//   'nuevo'     usa el precio de esta compra
//   'promedio'  promedio ponderado con lo que hay en stock
// Si no llega la decisión y hace falta, la ruta responde 409 con
// requiere_decision_costo y las tres cifras para mostrarlas.
// ============================================================
const supabase = require('../supabase/cliente');
const { recalcularProductosQueUsanMaterial } = require('./costos');

const DECISIONES = ['mantener', 'nuevo', 'promedio'];
const redondear = (n) => Math.round(Number(n) * 100) / 100;

// Calcula qué costo queda. Devuelve { requiereDecision, costo, opciones }
function resolverCosto({ costoActual, stockActual, cantidad, precio, decision }) {
  const actual = Number(costoActual) || 0;
  const nuevo = Number(precio);
  const stock = Math.max(0, Number(stockActual) || 0);
  const cant = Number(cantidad) || 0;
  const promedio = stock + cant > 0 ? redondear((stock * actual + cant * nuevo) / (stock + cant)) : nuevo;
  const opciones = { costo_actual: redondear(actual), costo_nuevo: redondear(nuevo), costo_promedio: promedio };

  if (redondear(actual) === redondear(nuevo)) return { requiereDecision: false, costo: actual, cambia: false, opciones };
  // Sin costo previo no hay nada que decidir: se usa el de la compra
  if (actual <= 0) return { requiereDecision: false, costo: redondear(nuevo), cambia: true, opciones };
  if (!DECISIONES.includes(decision)) return { requiereDecision: true, opciones };

  const costo = decision === 'mantener' ? actual : decision === 'nuevo' ? redondear(nuevo) : promedio;
  return { requiereDecision: false, costo, cambia: redondear(costo) !== redondear(actual), opciones };
}

function respuestaDecision(res, opciones, extra = {}) {
  return res.status(409).json({
    error: 'El precio de esta compra es distinto al costo registrado',
    requiere_decision_costo: true, ...opciones, ...extra
  });
}

// Material: cambia el costo, deja historial y recalcula los productos que lo usan
async function aplicarCostoMaterial({ material, costo, empresaId, usuarioId }) {
  const { error } = await supabase.from('materiales')
    .update({ costo_unitario: costo, actualizado_en: new Date().toISOString() })
    .eq('id', material.id).eq('empresa_id', empresaId);
  if (error) throw new Error(error.message);
  const { error: eHist } = await supabase.from('materiales_historial_precio').insert({
    empresa_id: empresaId, usuario_id: usuarioId, material_id: material.id,
    costo_anterior: material.costo_unitario, costo_nuevo: costo, origen: 'compra'
  });
  if (eHist) throw new Error(eHist.message);
  return recalcularProductosQueUsanMaterial(material.id, empresaId);
}

// Producto de reventa: su costo es el de compra
async function aplicarCostoProducto({ productoId, costo, empresaId }) {
  const { error } = await supabase.from('productos')
    .update({ costo_calculado: costo, actualizado_en: new Date().toISOString() })
    .eq('id', productoId).eq('empresa_id', empresaId).eq('tipo', 'reventa');
  if (error) throw new Error(error.message);
}

async function stockDeProducto(productoId, empresaId) {
  const { data } = await supabase.from('inventario_productos')
    .select('stock_actual').eq('producto_id', productoId).eq('empresa_id', empresaId).maybeSingle();
  return Number((data && data.stock_actual) || 0);
}

module.exports = { DECISIONES, resolverCosto, respuestaDecision, aplicarCostoMaterial, aplicarCostoProducto, stockDeProducto };
