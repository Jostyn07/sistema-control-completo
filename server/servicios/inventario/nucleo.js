// ============================================================
// NÚCLEO DE INVENTARIO — server/servicios/inventario/nucleo.js
// Única puerta para mover stock (materiales y productos terminados).
// Llama a las funciones de la base (migración 008), que aplican todo
// o nada, bloquean filas y no dejan negativos salvo que se pida.
//
//   aplicarOperacion({ empresaId, usuarioId, tipo, origenTabla, origenId,
//                      motivo, clave, movimientos, permitirNegativo, detalleForzado })
//     movimientos: [{ material_id | producto_id, cantidad (+ entra / − sale),
//                     costo_unitario?, motivo? }]
//     → { ok:true, operacionId, repetida, forzada, movimientos }
//     → { ok:false, faltantes:[{ material_id|producto_id, nombre, disponible, requerido, falta }] }
//
//   revertirOperacion({ empresaId, usuarioId, operacionId, motivo, permitirNegativo })
//
// ============================================================
const { supabaseAdminBase } = require('../../supabase/cliente');
const { usuarioActual } = require('../../contexto');

const TIPOS = new Set([
  'venta', 'venta_edicion', 'venta_eliminacion', 'compra', 'compra_reventa', 'ajuste',
  'produccion', 'fabricacion', 'ingreso_producto', 'salida_producto', 'entrega_proceso', 'importacion'
]);
const CON_MOTIVO = new Set(['ajuste', 'salida_producto']);

class ErrorInventario extends Error {
  constructor(mensaje, estado = 400) { super(mensaje); this.status = estado; this.expose = true; }
}

// 4 decimales: evita restos tipo 0.30000000000000004 en el libro
const redondear = (n) => Math.round(n * 10000) / 10000;

function normalizarMovimientos(movimientos) {
  if (!Array.isArray(movimientos) || movimientos.length === 0)
    throw new ErrorInventario('La operación no tiene movimientos');
  return movimientos.map((m) => {
    const esProducto = !!m.producto_id;
    if (esProducto === !!m.material_id)
      throw new ErrorInventario('Cada movimiento lleva material_id o producto_id, no ambos');
    const salida = {};
    if (m.stock_objetivo != null) {
      const objetivo = redondear(Number(m.stock_objetivo));
      if (!Number.isFinite(objetivo) || objetivo < 0) throw new ErrorInventario('Stock objetivo no válido');
      salida.stock_objetivo = objetivo;
    } else {
      const cantidad = redondear(Number(m.cantidad));
      if (!Number.isFinite(cantidad) || cantidad === 0)
        throw new ErrorInventario('Cantidad no válida');
      salida.cantidad = cantidad;
    }
    salida[esProducto ? 'producto_id' : 'material_id'] = String(esProducto ? m.producto_id : m.material_id);
    if (m.costo_unitario != null && Number.isFinite(Number(m.costo_unitario))) salida.costo_unitario = Number(m.costo_unitario);
    if (m.motivo) salida.motivo = String(m.motivo).slice(0, 300);
    return salida;
  });
}

function traducirError(error) {
  if (error.code === '42501') return new ErrorInventario('Ese artículo no pertenece a tu negocio', 403);
  if (error.code === '22023') return new ErrorInventario(error.message, 400);
  return new Error(error.message || 'Error de inventario');
}

function resultado(data) {
  if (!data.ok) return { ok: false, faltantes: data.faltantes || [] };
  if (data.sin_cambios) return { ok: true, sinCambios: true, operacionId: null, repetida: false, forzada: false, movimientos: [] };
  return {
    ok: true,
    operacionId: data.operacion_id,
    repetida: !!data.repetida,
    forzada: !!data.forzada,
    movimientos: data.movimientos || []
  };
}

async function aplicarOperacion(op, cliente = supabaseAdminBase) {
  const { empresaId, tipo } = op;
  const usuarioId = op.usuarioId || usuarioActual();
  if (!empresaId || !usuarioId) throw new ErrorInventario('Falta empresa o usuario', 500);
  if (!TIPOS.has(tipo)) throw new ErrorInventario(`Tipo de operación no válido: ${tipo}`);
  const motivo = op.motivo ? String(op.motivo).trim().slice(0, 300) : null;
  if (CON_MOTIVO.has(tipo) && !motivo) throw new ErrorInventario('Escribe el motivo');

  const { data, error } = await cliente.rpc('inventario_aplicar_operacion', {
    p_empresa: empresaId,
    p_usuario: usuarioId,
    p_tipo: tipo,
    p_origen_tabla: op.origenTabla || null,
    p_origen_id: op.origenId || null,
    p_motivo: motivo,
    p_clave: op.clave ? String(op.clave).slice(0, 120) : null,
    p_movimientos: normalizarMovimientos(op.movimientos),
    p_permitir_negativo: !!op.permitirNegativo,
    p_detalle_forzado: op.permitirNegativo ? (op.detalleForzado || {}) : null
  });
  if (error) throw traducirError(error);
  return resultado(data);
}

async function revertirOperacion(op, cliente = supabaseAdminBase) {
  const motivo = String(op.motivo || '').trim();
  if (!motivo) throw new ErrorInventario('Escribe el motivo de la reversión');
  const { data, error } = await cliente.rpc('inventario_revertir_operacion', {
    p_empresa: op.empresaId,
    p_usuario: op.usuarioId || usuarioActual(),
    p_operacion: op.operacionId,
    p_motivo: motivo.slice(0, 300),
    p_permitir_negativo: !!op.permitirNegativo
  });
  if (error) throw traducirError(error);
  return resultado(data);
}

module.exports = { aplicarOperacion, revertirOperacion, ErrorInventario, redondear, _interno: { normalizarMovimientos } };
