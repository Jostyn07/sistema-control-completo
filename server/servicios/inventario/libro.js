// ============================================================
// LIBRO DE INVENTARIO — server/servicios/inventario/libro.js
// Ayudas para que las rutas muevan stock por el núcleo y reviertan
// desde el historial (no desde la ficha técnica actual).
// ============================================================
const supabase = require('../../supabase/cliente');
const { aplicarOperacion, revertirOperacion, redondear } = require('./nucleo');

// Map material_id -> { material, requerido }  →  movimientos para el núcleo.
// signo -1 = sale del stock (consumo), +1 = entra.
function movimientosDeMateriales(mapa, signo = -1) {
  const movimientos = [];
  for (const [materialId, { material, requerido }] of mapa) {
    const cantidad = redondear(signo * Number(requerido));
    if (!cantidad) continue;
    const mov = { material_id: materialId, cantidad };
    if (material && material.costo_unitario != null) mov.costo_unitario = Number(material.costo_unitario);
    movimientos.push(mov);
  }
  return movimientos;
}

// Faltantes del núcleo → formato que ya entienden las pantallas
// ({ material, unidad, stock_actual, disponible, requerido }).
function faltantesLegibles(faltantes, unidadesPorMaterial = new Map()) {
  return (faltantes || []).map((f) => ({
    tipo: f.producto_id ? 'producto' : 'material',
    material_id: f.material_id,
    producto_id: f.producto_id,
    material: f.nombre,
    producto: f.producto_id ? f.nombre : undefined,
    unidad: unidadesPorMaterial.get(f.material_id) || undefined,
    stock_actual: Number(f.disponible),
    disponible: Number(f.disponible),
    requerido: redondear(Number(f.requerido)),
    falta: redondear(Number(f.falta))
  }));
}

function unidadesDe(mapa) {
  const u = new Map();
  for (const [id, { material }] of mapa) if (material && material.unidad) u.set(id, material.unidad);
  return u;
}

// Lo que el historial dice que movió un origen (venta, compra, entrega…):
// suma con signo por artículo. Incluye movimientos viejos (antes del
// núcleo) porque esos también guardaban referencia_id.
async function saldoRegistrado(empresaId, referenciaId) {
  const { data, error } = await supabase
    .from('inventario_movimientos')
    .select('material_id, producto_id, cantidad')
    .eq('empresa_id', empresaId)
    .eq('referencia_id', referenciaId);
  if (error) throw new Error(error.message);
  const materiales = new Map();
  const productos = new Map();
  for (const m of data || []) {
    const destino = m.producto_id ? productos : materiales;
    const id = m.producto_id || m.material_id;
    destino.set(id, redondear((destino.get(id) || 0) + Number(m.cantidad)));
  }
  return { materiales, productos, hayRegistro: (data || []).length > 0 };
}

async function operacionesAplicadas(empresaId, origenTabla, origenId) {
  const { data, error } = await supabase
    .from('inventario_operaciones')
    .select('id, tipo, creado_en')
    .eq('empresa_id', empresaId)
    .eq('origen_tabla', origenTabla)
    .eq('origen_id', origenId)
    .eq('estado', 'aplicada')
    .neq('tipo', 'reversion')
    .order('creado_en', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

// Revierte (desde el libro) todas las operaciones de un origen.
// Devuelve { encontradas, ok, faltantes }.
async function revertirOrigen({ empresaId, usuarioId, origenTabla, origenId, motivo, permitirNegativo }) {
  const ops = await operacionesAplicadas(empresaId, origenTabla, origenId);
  for (const op of ops) {
    const r = await revertirOperacion({ empresaId, usuarioId, operacionId: op.id, motivo, permitirNegativo });
    if (!r.ok) return { encontradas: ops.length, ok: false, faltantes: r.faltantes };
  }
  return { encontradas: ops.length, ok: true, faltantes: [] };
}

// Clave de idempotencia que manda el navegador (cuerpo o encabezado)
function claveDe(req, prefijo) {
  const clave = (req.body && req.body.clave) || req.get('Idempotency-Key');
  if (!clave || !/^[A-Za-z0-9_-]{8,80}$/.test(String(clave))) return null;
  return `${prefijo}:${clave}`;
}

module.exports = {
  aplicarOperacion, movimientosDeMateriales, faltantesLegibles, unidadesDe,
  saldoRegistrado, operacionesAplicadas, revertirOrigen, claveDe
};
