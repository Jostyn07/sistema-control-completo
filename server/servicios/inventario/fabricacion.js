// ============================================================
// FABRICACIÓN DE PRODUCTOS TERMINADOS — server/servicios/inventario/fabricacion.js
// Fase 4. Qué consume fabricar N unidades y cómo se aplica.
//  - Producto SIN procesos, con ficha: descuenta sus materiales (una sola
//    operación: entra el producto y salen los materiales).
//  - Producto CON procesos: consume lo terminado de la ÚLTIMA etapa
//    (WIP). Los materiales ya se descontaron al entregar cada etapa.
//  - Sin ficha ni procesos: solo entra el producto.
// ============================================================
const supabase = require('../../supabase/cliente');
const { obtenerFichasEfectivasParaProductos } = require('../costos');
const { obtenerRutaProcesos, obtenerWIPPorProducto, ajustarWIP } = require('../produccion');
const { aplicarOperacion, redondear } = require('./nucleo');
const { faltantesLegibles } = require('./libro');

const rep = (p) => Number(p.repeticiones_por_unidad || 1);

async function planDeFabricacion(productoId, cantidad, empresaId) {
  const ruta = await obtenerRutaProcesos(productoId, empresaId);
  if (ruta.length > 0) {
    const ultimo = ruta[ruta.length - 1];
    const wip = await obtenerWIPPorProducto(productoId, empresaId);
    const requerido = redondear(cantidad * rep(ultimo));
    const disponible = redondear(wip.get(ultimo.id) || 0);
    return {
      tipo: 'procesos',
      etapa: { proceso_id: ultimo.id, nombre: ultimo.nombre, requerido, disponible,
               falta: redondear(Math.max(0, requerido - disponible)),
               unidades_posibles: Math.floor(disponible / rep(ultimo)) },
      materiales: [],
      faltan: disponible < requerido
    };
  }

  const fichas = await obtenerFichasEfectivasParaProductos([productoId], empresaId);
  const porMaterial = new Map();
  for (const f of (fichas || []).filter(f => f.producto_id === productoId)) {
    const previo = porMaterial.get(f.material_id) || { material: f.materiales, porUnidad: 0 };
    previo.porUnidad += Number(f.cantidad);
    porMaterial.set(f.material_id, previo);
  }
  if (porMaterial.size === 0) return { tipo: 'ninguno', materiales: [], faltan: false };

  const materiales = [...porMaterial].map(([id, { material, porUnidad }]) => {
    const requerido = redondear(porUnidad * cantidad);
    const disponible = Number(material.stock_actual);
    return {
      material_id: id, nombre: material.nombre, unidad: material.unidad,
      requerido, disponible, falta: redondear(Math.max(0, requerido - disponible)),
      costo_unitario: material.costo_unitario != null ? Number(material.costo_unitario) : undefined
    };
  }).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  const posibles = Math.min(...[...porMaterial.values()].map(({ material, porUnidad }) =>
    porUnidad > 0 ? Math.floor(Number(material.stock_actual) / porUnidad) : Infinity));
  return { tipo: 'materiales', materiales, unidades_posibles: Number.isFinite(posibles) ? Math.max(0, posibles) : null,
           faltan: materiales.some(m => m.falta > 0) };
}

// Aplica la fabricación. Devuelve { ok, ...resultado } o { ok:false, faltantes, etapa? }
async function fabricar({ empresaId, usuarioId, productoId, cantidad, costoUnitario, clave, motivo, forzar }) {
  const plan = await planDeFabricacion(productoId, cantidad, empresaId);
  const entrada = { producto_id: productoId, cantidad, costo_unitario: costoUnitario };

  if (plan.tipo === 'procesos') {
    // Lo terminado de la última etapa no puede quedar negativo: no se fuerza.
    if (plan.faltan) return { ok: false, etapa: plan.etapa, faltantes: [] };
    const operacion = await aplicarOperacion({
      empresaId, usuarioId, tipo: 'fabricacion', origenTabla: 'productos', origenId: productoId,
      motivo: motivo || `Fabricación desde ${plan.etapa.nombre}`, clave, movimientos: [entrada]
    });
    if (operacion.ok && !operacion.repetida) {
      await ajustarWIP(productoId, plan.etapa.proceso_id, empresaId, -plan.etapa.requerido);
    }
    return { ...operacion, plan };
  }

  const movimientos = [entrada];
  for (const m of plan.materiales) {
    if (m.requerido > 0) movimientos.push({ material_id: m.material_id, cantidad: -m.requerido, costo_unitario: m.costo_unitario });
  }
  const operacion = await aplicarOperacion({
    empresaId, usuarioId, tipo: 'fabricacion', origenTabla: 'productos', origenId: productoId,
    motivo: motivo || 'Fabricación con descuento de materiales', clave, movimientos,
    permitirNegativo: !!forzar, detalleForzado: { confirmado: true }
  });
  if (!operacion.ok) {
    const unidades = new Map(plan.materiales.map(m => [m.material_id, m.unidad]));
    return { ok: false, faltantes: faltantesLegibles(operacion.faltantes, unidades), plan };
  }
  return { ...operacion, plan };
}

// Política guardada del producto
async function politicaDe(productoId, empresaId) {
  const { data } = await supabase.from('inventario_productos')
    .select('politica_descuento, recordar_decision').eq('producto_id', productoId).eq('empresa_id', empresaId).maybeSingle();
  return data || { politica_descuento: 'preguntar', recordar_decision: false };
}

module.exports = { planDeFabricacion, fabricar, politicaDe };
