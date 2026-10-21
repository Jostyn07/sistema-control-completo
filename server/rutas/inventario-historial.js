// ============================================================
// HISTORIAL UNIFICADO DE INVENTARIO — server/rutas/inventario-historial.js
// Fase 6. Se monta dentro de /api/inventario.
//
//  GET  /movimientos?articulo=material|producto&articulo_id=&origen=&usuario_id=
//                    &desde=YYYY-MM-DD&hasta=YYYY-MM-DD&q=&pagina=1
//  GET  /operaciones/:id            operación + todos sus movimientos
//  POST /operaciones/:id/revertir   { motivo, forzar? }   (inventario.editar)
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { supabaseAdminBase } = require('../supabase/cliente');
const requierePermiso = require('../middleware/permissions');
const { revertirOperacion } = require('../servicios/inventario/nucleo');
const { faltantesLegibles } = require('../servicios/inventario/libro');
const router = express.Router();

const POR_PAGINA = 50;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f-]{36}$/i;

// Operaciones que se revierten desde su propio documento (no desde aquí)
const SE_REVIERTEN_EN_SU_ORIGEN = {
  venta: 'Elimina o edita la venta', venta_edicion: 'Elimina o edita la venta', venta_eliminacion: 'Ya es una reversión',
  compra: 'Elimina la compra', entrega_proceso: 'Elimina la entrega en Nóminas', importacion: 'Corrígela con un ajuste',
  reversion: 'Ya es una reversión', produccion: 'Elimina la entrega en Nóminas'
};

// Correos de usuarios (caché corta en memoria)
const cacheUsuarios = new Map();
async function nombresDeUsuarios(ids) {
  const resultado = new Map();
  await Promise.all([...new Set(ids.filter(Boolean))].map(async (id) => {
    const c = cacheUsuarios.get(id);
    if (c && c.vence > Date.now()) { resultado.set(id, c.nombre); return; }
    try {
      const { data } = await supabaseAdminBase.auth.admin.getUserById(id);
      const u = data && data.user;
      const m = (u && u.user_metadata) || {};
      const nombre = m.nombre_visible || [m.nombre, m.apellido].filter(Boolean).join(' ') || (u && u.email) || 'Usuario';
      cacheUsuarios.set(id, { nombre, vence: Date.now() + 10 * 60 * 1000 });
      resultado.set(id, nombre);
    } catch { resultado.set(id, 'Usuario'); }
  }));
  return resultado;
}

function enlaceOrigen(op) {
  if (!op || !op.origen_tabla || !op.origen_id) return null;
  const rutas = { ventas: '/ventas.html', compras: '/compras.html', productos: '/inventario.html', materiales: '/materiales.html',
                  entregas_parciales: '/nomina.html', inventario_ajustes: '/inventario.html' };
  return rutas[op.origen_tabla] || null;
}

// GET /api/inventario/movimientos
router.get('/movimientos', async (req, res, next) => {
  try {
    const q = req.query;
    const pagina = Math.max(1, parseInt(q.pagina, 10) || 1);
    let consulta = supabase.from('inventario_movimientos')
      .select('id, fecha, tipo, origen, cantidad, stock_anterior, stock_nuevo, motivo, costo_unitario, operacion_id, usuario_id, referencia_id, material_id, producto_id, materiales(nombre, unidad), productos(nombre)', { count: 'exact' })
      .eq('empresa_id', req.empresa.id)
      .order('fecha', { ascending: false })
      .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA - 1);

    if (q.articulo === 'material') consulta = consulta.not('material_id', 'is', null);
    if (q.articulo === 'producto') consulta = consulta.not('producto_id', 'is', null);
    if (q.articulo_id && UUID.test(q.articulo_id)) {
      consulta = q.articulo === 'producto' ? consulta.eq('producto_id', q.articulo_id) : consulta.eq('material_id', q.articulo_id);
    }
    if (q.origen && /^[a-z_]{2,30}$/.test(q.origen)) consulta = consulta.eq('origen', q.origen);
    if (q.usuario_id && UUID.test(q.usuario_id)) consulta = consulta.eq('usuario_id', q.usuario_id);
    if (q.desde && FECHA.test(q.desde)) consulta = consulta.gte('fecha', q.desde);
    if (q.hasta && FECHA.test(q.hasta)) consulta = consulta.lte('fecha', q.hasta + 'T23:59:59');
    if (q.q) {
      const texto = String(q.q).replace(/[%,()*]/g, ' ').trim().slice(0, 60);
      if (texto) consulta = consulta.ilike('motivo', `%${texto}%`);
    }

    const { data, error, count } = await consulta;
    if (error) throw new Error(error.message);
    const nombres = await nombresDeUsuarios((data || []).map(m => m.usuario_id));
    res.json({
      pagina, por_pagina: POR_PAGINA, total: count || 0,
      movimientos: (data || []).map(m => ({
        id: m.id, fecha: m.fecha, origen: m.origen || m.tipo, tipo: m.tipo,
        articulo: m.producto_id ? 'producto' : 'material',
        articulo_id: m.producto_id || m.material_id,
        nombre: m.producto_id ? (m.productos && m.productos.nombre) : (m.materiales && m.materiales.nombre),
        unidad: m.materiales ? m.materiales.unidad : null,
        cantidad: Number(m.cantidad), stock_anterior: Number(m.stock_anterior), stock_nuevo: Number(m.stock_nuevo),
        motivo: m.motivo, costo_unitario: m.costo_unitario != null ? Number(m.costo_unitario) : null,
        operacion_id: m.operacion_id, usuario: nombres.get(m.usuario_id) || 'Usuario', usuario_id: m.usuario_id
      }))
    });
  } catch (err) { next(err); }
});

// GET /api/inventario/operaciones/:id
router.get('/operaciones/:id', async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Operación no encontrada' });
    const { data: op, error } = await supabase.from('inventario_operaciones').select('*')
      .eq('id', req.params.id).eq('empresa_id', req.empresa.id).maybeSingle();
    if (error) throw new Error(error.message);
    if (!op) return res.status(404).json({ error: 'Operación no encontrada' });

    const [{ data: movs, error: eM }, { data: reversion }] = await Promise.all([
      supabase.from('inventario_movimientos')
        .select('id, cantidad, stock_anterior, stock_nuevo, costo_unitario, material_id, producto_id, materiales(nombre, unidad), productos(nombre)')
        .eq('operacion_id', op.id).eq('empresa_id', req.empresa.id),
      supabase.from('inventario_operaciones').select('id, creado_en, motivo')
        .eq('revierte_operacion_id', op.id).eq('empresa_id', req.empresa.id).maybeSingle()
    ]);
    if (eM) throw new Error(eM.message);
    const nombres = await nombresDeUsuarios([op.usuario_id]);
    const motivoBloqueo = op.estado === 'revertida' ? 'Ya fue revertida' : SE_REVIERTEN_EN_SU_ORIGEN[op.tipo] || null;
    res.json({
      id: op.id, tipo: op.tipo, estado: op.estado, motivo: op.motivo, creado_en: op.creado_en,
      forzada: op.forzada, usuario: nombres.get(op.usuario_id) || 'Usuario',
      origen_tabla: op.origen_tabla, origen_id: op.origen_id, enlace_origen: enlaceOrigen(op),
      revierte_operacion_id: op.revierte_operacion_id, revertida_por: reversion || null,
      reversible: !motivoBloqueo, motivo_no_reversible: motivoBloqueo,
      movimientos: (movs || []).map(m => ({
        articulo: m.producto_id ? 'producto' : 'material',
        nombre: m.producto_id ? (m.productos && m.productos.nombre) : (m.materiales && m.materiales.nombre),
        unidad: m.materiales ? m.materiales.unidad : null,
        cantidad: Number(m.cantidad), stock_anterior: Number(m.stock_anterior), stock_nuevo: Number(m.stock_nuevo),
        costo_unitario: m.costo_unitario != null ? Number(m.costo_unitario) : null
      }))
    });
  } catch (err) { next(err); }
});

// POST /api/inventario/operaciones/:id/revertir
router.post('/operaciones/:id/revertir', requierePermiso('inventario', 'editar'), async (req, res, next) => {
  try {
    if (!UUID.test(req.params.id)) return res.status(404).json({ error: 'Operación no encontrada' });
    const motivo = String((req.body && req.body.motivo) || '').trim();
    if (!motivo) return res.status(400).json({ error: 'Escribe el motivo de la reversión' });

    const { data: op } = await supabase.from('inventario_operaciones').select('id, tipo, estado')
      .eq('id', req.params.id).eq('empresa_id', req.empresa.id).maybeSingle();
    if (!op) return res.status(404).json({ error: 'Operación no encontrada' });
    if (SE_REVIERTEN_EN_SU_ORIGEN[op.tipo]) return res.status(400).json({ error: `Esta operación no se revierte aquí. ${SE_REVIERTEN_EN_SU_ORIGEN[op.tipo]}.` });

    // Fabricación desde la etapa final: revertirla sin devolver el WIP descuadraría producción
    if (op.tipo === 'fabricacion') {
      const { count } = await supabase.from('inventario_movimientos').select('id', { count: 'exact', head: true })
        .eq('operacion_id', op.id).not('material_id', 'is', null);
      if (!count) return res.status(400).json({ error: 'Esta fabricación tomó unidades de la etapa final. Corrígela con una salida o un ajuste.' });
    }

    const r = await revertirOperacion({ empresaId: req.empresa.id, usuarioId: req.usuarioId,
      operacionId: op.id, motivo, permitirNegativo: !!(req.body && req.body.forzar) });
    if (!r.ok) {
      return res.status(409).json({ error: 'Revertir dejaría stock en negativo', faltantes: faltantesLegibles(r.faltantes), puede_forzar: true });
    }
    res.json({ revertida: true, operacion_id: r.operacionId, repetida: r.repetida });
  } catch (err) { next(err); }
});

module.exports = router;
module.exports._interno = { SE_REVIERTEN_EN_SU_ORIGEN, enlaceOrigen };
