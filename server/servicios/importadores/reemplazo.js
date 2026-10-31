// ============================================================
// REEMPLAZO AL IMPORTAR (opción "Reemplazar" en lugar de "Sumar")
//
// - Catálogos (materiales, productos, procesos, colaboradores, costos
//   fijos): DESPUÉS de importar, se desactivan (activo = false) los
//   registros que no venían en el Excel. No se borra nada: si se usan en
//   compras, ventas o procesos, ese historial sigue intacto y se pueden
//   volver a activar.
// - Historial (compras, ventas, facturas, capital, encargos): ANTES de
//   importar, se borran los registros actuales del módulo. No revierte el
//   stock que esos registros ya movieron.
// - Inventario: lo maneja el propio importador (la cantidad del Excel
//   pasa a ser el stock final).
// ============================================================
const supabase = require('../../supabase/cliente');

const texto = (v) => String(v ?? '').trim().toUpperCase();

// Cada catálogo: tabla, lista de filas dentro de lo que llega a /importar,
// campo que identifica la fila existente y campo de texto para comparar.
const CATALOGOS = {
  materiales: { tabla: 'materiales', filas: (f) => f, id: 'material_id', campo: 'codigo' },
  productos: { tabla: 'productos', filas: (f) => f, id: 'producto_id', campo: 'codigo' },
  procesos: { tabla: 'procesos', filas: (f) => f, id: 'proceso_id', campo: 'codigo' },
  nominas: { tabla: 'colaboradores', filas: (f) => f.filas_colaboradores, id: 'colaborador_id', campo: 'codigo' },
  finanzas: { tabla: 'costos_fijos', filas: (f) => f.filas_costos_fijos, id: 'costo_fijo_id', campo: 'nombre' }
};

// ANTES de importar: qué registros activos actuales NO vienen en el Excel
// (ni por id ni por código/nombre). Los creados por la importación no
// existen todavía, así que nunca quedan en esta lista.
async function registrosFaltantes(modulo, empresaId, filasImportar) {
  const cat = CATALOGOS[modulo];
  if (!cat) return [];
  const filas = cat.filas(filasImportar) || [];
  const ids = new Set(filas.map((f) => f[cat.id]).filter(Boolean));
  const textos = new Set(filas.map((f) => texto(f[cat.campo])).filter(Boolean));
  const { data, error } = await supabase
    .from(cat.tabla).select(`id, ${cat.campo}`).eq('empresa_id', empresaId).eq('activo', true);
  if (error) throw error;
  return (data || []).filter((r) => !ids.has(r.id) && !textos.has(texto(r[cat.campo]))).map((r) => r.id);
}

async function desactivar(modulo, empresaId, ids) {
  if (!ids || !ids.length) return 0;
  const { error } = await supabase
    .from(CATALOGOS[modulo].tabla).update({ activo: false }).eq('empresa_id', empresaId).in('id', ids);
  if (error) throw error;
  return ids.length;
}

async function borrarTodo(tabla, empresaId) {
  const { error, count } = await supabase
    .from(tabla).delete({ count: 'exact' }).eq('empresa_id', empresaId);
  if (error) {
    if (error.code === '23503') {
      throw Object.assign(new Error(`No se puede reemplazar: hay registros de "${tabla}" que otros módulos usan (por ejemplo, ventas con factura). Usa "Sumar".`), { status: 409 });
    }
    throw error;
  }
  return count || 0;
}

async function borrarEncargos(empresaId) {
  const { data, error } = await supabase.from('colaboradores_encargos').select('id').eq('empresa_id', empresaId);
  if (error) throw error;
  const ids = (data || []).map((r) => r.id);
  if (ids.length) {
    const { error: eMat } = await supabase.from('colaboradores_encargos_materiales').delete().in('encargo_id', ids);
    if (eMat) throw eMat;
  }
  return borrarTodo('colaboradores_encargos', empresaId);
}

// Se ejecuta ANTES de importar. Devuelve lo que necesita despuesDeImportar.
async function antesDeImportar(modulo, empresaId, filas) {
  // Ya NO se desactivan registros que falten en el Excel (desactivaba catálogos enteros).
  const pendientes = [];
  let borrados = 0;
  switch (modulo) {
    case 'compras': borrados = await borrarTodo('compras', empresaId); break;
    case 'ventas': borrados = await borrarTodo('ventas', empresaId); break;
    case 'facturacion': borrados = await borrarTodo('facturas', empresaId); break;
    case 'finanzas': borrados = await borrarTodo('capital_invertido', empresaId); break;
    case 'nominas': borrados = await borrarEncargos(empresaId); break;
  }
  return { pendientes, borrados };
}

// Se ejecuta DESPUÉS de importar (solo si la importación no falló).
async function despuesDeImportar(modulo, empresaId, previo) {
  return { desactivados: await desactivar(modulo, empresaId, previo.pendientes) };
}

// Módulos donde "Reemplazar" borra historial (el front pide confirmación extra).
const BORRAN_HISTORIAL = ['compras', 'ventas', 'facturacion', 'finanzas', 'nominas'];

// Para preguntar antes: cuántos registros desactivaría "Reemplazar".
async function contarAfectados(modulo, empresaId, filas) {
  return { desactivaria: 0 };
}

module.exports = { antesDeImportar, despuesDeImportar, contarAfectados, BORRAN_HISTORIAL };