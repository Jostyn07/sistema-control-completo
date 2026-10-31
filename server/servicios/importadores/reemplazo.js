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

function codigosDe(filas, campo = 'codigo') {
  return new Set((filas || []).map((f) => texto(f[campo])).filter(Boolean));
}

// Desactiva los registros activos de `tabla` cuyo `campo` no esté en `conservar`.
async function desactivarFaltantes(tabla, empresaId, conservar, campo = 'codigo') {
  const { data, error } = await supabase
    .from(tabla).select(`id, ${campo}`).eq('empresa_id', empresaId).eq('activo', true);
  if (error) throw error;
  const ids = (data || []).filter((r) => !conservar.has(texto(r[campo]))).map((r) => r.id);
  if (!ids.length) return 0;
  const { error: eUpd } = await supabase
    .from(tabla).update({ activo: false }).eq('empresa_id', empresaId).in('id', ids);
  if (eUpd) throw eUpd;
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

// Se ejecuta ANTES de importar.
async function antesDeImportar(modulo, empresaId) {
  switch (modulo) {
    case 'compras': return { borrados: await borrarTodo('compras', empresaId) };
    case 'ventas': return { borrados: await borrarTodo('ventas', empresaId) };
    case 'facturacion': return { borrados: await borrarTodo('facturas', empresaId) };
    case 'finanzas': return { borrados: await borrarTodo('capital_invertido', empresaId) };
    case 'nominas': return { borrados: await borrarEncargos(empresaId) };
    default: return {};
  }
}

// Se ejecuta DESPUÉS de importar. `filas` es lo mismo que llegó a /importar.
async function despuesDeImportar(modulo, empresaId, filas) {
  switch (modulo) {
    case 'materiales': return { desactivados: await desactivarFaltantes('materiales', empresaId, codigosDe(filas)) };
    case 'productos': return { desactivados: await desactivarFaltantes('productos', empresaId, codigosDe(filas)) };
    case 'procesos': return { desactivados: await desactivarFaltantes('procesos', empresaId, codigosDe(filas)) };
    case 'nominas': return { desactivados: await desactivarFaltantes('colaboradores', empresaId, codigosDe(filas.filas_colaboradores)) };
    case 'finanzas': return { desactivados: await desactivarFaltantes('costos_fijos', empresaId, codigosDe(filas.filas_costos_fijos, 'nombre'), 'nombre') };
    default: return {};
  }
}

// Módulos donde "Reemplazar" borra historial (el front pide confirmación extra).
const BORRAN_HISTORIAL = ['compras', 'ventas', 'facturacion', 'finanzas', 'nominas'];

module.exports = { antesDeImportar, despuesDeImportar, BORRAN_HISTORIAL };