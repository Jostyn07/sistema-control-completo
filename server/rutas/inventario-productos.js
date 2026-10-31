// ============================================================
// INVENTARIO DE PRODUCTOS TERMINADOS (/api/inventario/productos)
// server/rutas/inventario-productos.js — Fase 3
//
//  GET  /                       productos con su stock, mínimo y estado
//  PUT  /:id/config             controla_stock, stock_minimo, politica_descuento, recordar_decision
//  POST /:id/vista-previa       { cantidad }  qué materiales o etapa final consumiría
//  POST /:id/ingreso            { cantidad, descontar_materiales?, recordar?, forzar?, motivo?, clave? }
//  POST /:id/compra-reventa     { cantidad, costo_unitario, proveedor, decision_costo?, clave? }
//  POST /:id/salida             { cantidad, motivo, forzar?, clave? }   (inventario.editar)
//  POST /:id/ajuste             { cantidad_nueva, motivo, clave? }      (inventario.editar)
//  GET  /:id/movimientos        últimos 100 movimientos del producto
//
// Todo movimiento pasa por el núcleo (migración 008). Los costos los
// oculta ocultarCostos a quien no tenga costos.ver.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { supabaseAdminBase } = require('../supabase/cliente');
const requierePermiso = require('../middleware/permissions');
const libro = require('../servicios/inventario/libro');
const { redondear } = require('../servicios/inventario/nucleo');
const fabricacion = require('../servicios/inventario/fabricacion');
const costoCompra = require('../servicios/costo-compra');
const router = express.Router();

const POLITICAS = ['preguntar', 'automatico', 'no_descontar'];

function estadoStock(stock, minimo, controla) {
  if (!controla) return 'sin_control';
  if (stock <= 0) return 'rojo';
  if (minimo > 0 && stock <= minimo) return 'amarillo';
  return 'verde';
}

async function productoDeEmpresa(id, empresaId) {
  const { data } = await supabase.from('productos')
    .select('id, nombre, tipo, costo_calculado, precio_venta, activo')
    .eq('id', id).eq('empresa_id', empresaId).maybeSingle();
  return data;
}

function cantidadPositiva(valor) {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? redondear(n) : null;
}

// Costo promedio de lo que ENTRÓ (valor al costo de ingreso, no el actual)
async function costoPromedioDeIngresos(empresaId) {
  const { data, error } = await supabase.from('inventario_movimientos')
    .select('producto_id, cantidad, costo_unitario')
    .eq('empresa_id', empresaId).not('producto_id', 'is', null).gt('cantidad', 0)
    .not('costo_unitario', 'is', null);
  if (error) throw new Error(error.message);
  const acumulado = new Map();
  for (const m of data || []) {
    const a = acumulado.get(m.producto_id) || { unidades: 0, valor: 0 };
    a.unidades += Number(m.cantidad);
    a.valor += Number(m.cantidad) * Number(m.costo_unitario);
    acumulado.set(m.producto_id, a);
  }
  const promedio = new Map();
  for (const [id, a] of acumulado) if (a.unidades > 0) promedio.set(id, a.valor / a.unidades);
  return promedio;
}

// GET /api/inventario/productos
router.get('/', async (req, res, next) => {
  try {
    const [{ data: productos, error: eP }, { data: configs, error: eC }, promedios] = await Promise.all([
      supabase.from('productos').select('id, nombre, tipo, costo_calculado, precio_venta, activo, categorias_productos(nombre)')
        .eq('empresa_id', req.empresa.id).order('nombre'),
      supabase.from('inventario_productos').select('*').eq('empresa_id', req.empresa.id),
      costoPromedioDeIngresos(req.empresa.id)
    ]);
    if (eP) throw new Error(eP.message);
    if (eC) throw new Error(eC.message);
    const porId = new Map((configs || []).map(c => [c.producto_id, c]));
    res.json((productos || []).map(p => {
      const c = porId.get(p.id) || {};
      const stock = Number(c.stock_actual || 0);
      const minimo = Number(c.stock_minimo || 0);
      const controla = !!c.controla_stock;
      const costoUnidad = promedios.has(p.id) ? promedios.get(p.id) : Number(p.costo_calculado || 0);
      return {
        producto_id: p.id,
        nombre: p.nombre,
        tipo: p.tipo || 'fabricado',
        categoria: p.categorias_productos ? p.categorias_productos.nombre : null,
        activo: p.activo,
        controla_stock: controla,
        stock_actual: stock,
        stock_minimo: minimo,
        politica_descuento: c.politica_descuento || 'preguntar',
        recordar_decision: !!c.recordar_decision,
        estado: estadoStock(stock, minimo, controla),
        precio_venta: Number(p.precio_venta || 0),
        costo_unitario_promedio: Math.round(costoUnidad * 100) / 100,
        valor_inventario: Math.round(Math.max(0, stock) * costoUnidad)
      };
    }));
  } catch (err) { next(err); }
});

// PUT /api/inventario/productos/:id/config
router.put('/:id/config', async (req, res, next) => {
  try {
    const producto = await productoDeEmpresa(req.params.id, req.empresa.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    const b = req.body || {};
    const cambios = { producto_id: producto.id, empresa_id: req.empresa.id, actualizado_en: new Date().toISOString(), actualizado_por: req.usuarioId };
    if (b.controla_stock !== undefined) cambios.controla_stock = !!b.controla_stock;
    if (b.stock_minimo !== undefined) {
      const m = Number(b.stock_minimo);
      if (!Number.isFinite(m) || m < 0) return res.status(400).json({ error: 'El stock mínimo debe ser 0 o más' });
      cambios.stock_minimo = m;
    }
    if (b.politica_descuento !== undefined) {
      if (!POLITICAS.includes(b.politica_descuento)) return res.status(400).json({ error: 'Política no válida' });
      cambios.politica_descuento = b.politica_descuento;
    }
    if (b.recordar_decision !== undefined) cambios.recordar_decision = !!b.recordar_decision;

    // stock_actual NUNCA se escribe aquí: solo el núcleo lo mueve
    const { data, error } = await supabaseAdminBase.from('inventario_productos')
      .upsert(cambios, { onConflict: 'producto_id' })
      .select('producto_id, controla_stock, stock_actual, stock_minimo, politica_descuento, recordar_decision').single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

async function mover(req, res, { tipo, movimiento, motivo, forzar, prefijoClave }) {
  const operacion = await libro.aplicarOperacion({
    empresaId: req.empresa.id, usuarioId: req.usuarioId,
    tipo, origenTabla: 'productos', origenId: req.params.id, motivo,
    clave: libro.claveDe(req, prefijoClave),
    movimientos: [{ producto_id: req.params.id, ...movimiento }],
    permitirNegativo: !!forzar, detalleForzado: { confirmado: true }
  });
  if (!operacion.ok) {
    const [f] = libro.faltantesLegibles(operacion.faltantes);
    return res.status(409).json({
      error: `No hay suficiente stock: hay ${f.disponible} y se necesitan ${f.requerido}`,
      faltantes: [f], puede_forzar: true
    });
  }
  if (operacion.sinCambios) return res.json({ sin_cambios: true });
  // Mover stock de un producto lo pone bajo control de stock
  await supabaseAdminBase.from('inventario_productos').update({ controla_stock: true })
    .eq('producto_id', req.params.id).eq('empresa_id', req.empresa.id).eq('controla_stock', false);
  const m = (operacion.movimientos || [])[0] || {};
  res.status(201).json({ operacion_id: operacion.operacionId, repetida: operacion.repetida, forzada: operacion.forzada,
    stock_anterior: m.stock_anterior, stock_nuevo: m.stock_nuevo });
}

// POST /api/inventario/productos/:id/vista-previa — { cantidad }
// Qué consumiría fabricar esas unidades (materiales o última etapa).
router.post('/:id/vista-previa', async (req, res, next) => {
  try {
    const producto = await productoDeEmpresa(req.params.id, req.empresa.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    const cantidad = cantidadPositiva(req.body.cantidad) || 1;
    const [plan, politica] = await Promise.all([
      fabricacion.planDeFabricacion(producto.id, cantidad, req.empresa.id),
      fabricacion.politicaDe(producto.id, req.empresa.id)
    ]);
    res.json({ cantidad, ...plan, politica_descuento: politica.politica_descuento });
  } catch (err) { next(err); }
});

// POST /api/inventario/productos/:id/ingreso
// { cantidad, descontar_materiales?, recordar?, forzar?, motivo?, clave? }
// Si el producto tiene ficha o procesos y la política es "preguntar",
// sin descontar_materiales responde 409 { requiere_decision, plan }.
router.post('/:id/ingreso', async (req, res, next) => {
  try {
    const producto = await productoDeEmpresa(req.params.id, req.empresa.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    const cantidad = cantidadPositiva(req.body.cantidad);
    if (!cantidad) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    const costo = Number(producto.costo_calculado || 0); // valor al costo de HOY
    const motivoLibre = (req.body.motivo || '').trim();

    const plan = await fabricacion.planDeFabricacion(producto.id, cantidad, req.empresa.id);
    if (plan.tipo === 'ninguno') {
      return mover(req, res, { tipo: 'ingreso_producto', prefijoClave: 'ingreso',
        motivo: motivoLibre || 'Ingreso de producto terminado', movimiento: { cantidad, costo_unitario: costo } });
    }

    let descontar = typeof req.body.descontar_materiales === 'boolean' ? req.body.descontar_materiales : undefined;
    if (descontar === undefined) {
      const { politica_descuento } = await fabricacion.politicaDe(producto.id, req.empresa.id);
      if (politica_descuento === 'automatico') descontar = true;
      else if (politica_descuento === 'no_descontar') descontar = false;
      else return res.status(409).json({ error: 'Elige si se descuentan los materiales', requiere_decision: true, ...plan });
    }

    if (req.body.recordar) {
      await supabaseAdminBase.from('inventario_productos').upsert({
        producto_id: producto.id, empresa_id: req.empresa.id, controla_stock: true,
        politica_descuento: descontar ? 'automatico' : 'no_descontar', recordar_decision: true,
        actualizado_en: new Date().toISOString(), actualizado_por: req.usuarioId
      }, { onConflict: 'producto_id' });
    }

    if (!descontar) {
      return mover(req, res, { tipo: 'ingreso_producto', prefijoClave: 'ingreso',
        motivo: motivoLibre || 'Ingreso sin consumo de materiales', movimiento: { cantidad, costo_unitario: costo } });
    }

    const r = await fabricacion.fabricar({
      empresaId: req.empresa.id, usuarioId: req.usuarioId, productoId: producto.id, cantidad,
      costoUnitario: costo, clave: libro.claveDe(req, 'fabricar'), motivo: motivoLibre || null, forzar: req.body.forzar
    });
    if (!r.ok) {
      if (r.etapa) {
        return res.status(409).json({
          error: `Solo hay ${r.etapa.unidades_posibles} listas en la etapa final (${r.etapa.nombre}). Faltan ${r.etapa.falta}.`,
          etapa: r.etapa, puede_forzar: false
        });
      }
      return res.status(409).json({ error: 'No hay material suficiente para fabricar', faltantes: r.faltantes, puede_forzar: true });
    }
    await supabaseAdminBase.from('inventario_productos').update({ controla_stock: true })
      .eq('producto_id', producto.id).eq('empresa_id', req.empresa.id).eq('controla_stock', false);
    const entrada = (r.movimientos || []).find(m => m.producto_id === producto.id) || {};
    res.status(201).json({ operacion_id: r.operacionId, repetida: r.repetida, forzada: r.forzada, fabricado: true,
      stock_anterior: entrada.stock_anterior, stock_nuevo: entrada.stock_nuevo });
  } catch (err) { next(err); }
});

// POST /api/inventario/productos/:id/compra-reventa
router.post('/:id/compra-reventa', async (req, res, next) => {
  try {
    const producto = await productoDeEmpresa(req.params.id, req.empresa.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    const cantidad = cantidadPositiva(req.body.cantidad);
    if (!cantidad) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    const costo = Number(req.body.costo_unitario);
    if (!Number.isFinite(costo) || costo < 0) return res.status(400).json({ error: 'El costo unitario debe ser 0 o más' });
    const proveedor = (req.body.proveedor || '').trim();
    if (!proveedor) return res.status(400).json({ error: 'El proveedor es obligatorio' });

    // Solo los de reventa tienen costo de compra; decide la persona si difiere
    let decision = null;
    if (producto.tipo === 'reventa') {
      decision = costoCompra.resolverCosto({
        costoActual: producto.costo_calculado, stockActual: await costoCompra.stockDeProducto(producto.id, req.empresa.id),
        cantidad, precio: costo, decision: req.body.decision_costo
      });
      if (decision.requiereDecision) return costoCompra.respuestaDecision(res, decision.opciones, { articulo: producto.nombre });
    }
    if (decision && decision.cambia) {
      await costoCompra.aplicarCostoProducto({ productoId: producto.id, costo: decision.costo, empresaId: req.empresa.id });
    }
    await mover(req, res, {
      tipo: 'compra_reventa', prefijoClave: 'reventa',
      motivo: `Compra para reventa a ${proveedor.slice(0, 120)}`,
      movimiento: { cantidad, costo_unitario: costo }
    });
  } catch (err) { next(err); }
});

// POST /api/inventario/productos/:id/salida
router.post('/:id/salida', requierePermiso('inventario', 'editar'), async (req, res, next) => {
  try {
    const producto = await productoDeEmpresa(req.params.id, req.empresa.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    const cantidad = cantidadPositiva(req.body.cantidad);
    if (!cantidad) return res.status(400).json({ error: 'La cantidad debe ser mayor a 0' });
    const motivo = (req.body.motivo || '').trim();
    if (!motivo) return res.status(400).json({ error: 'El motivo es obligatorio' });
    await mover(req, res, { tipo: 'salida_producto', prefijoClave: 'salida', motivo, forzar: req.body.forzar,
      movimiento: { cantidad: -cantidad } });
  } catch (err) { next(err); }
});

// POST /api/inventario/productos/:id/ajuste
router.post('/:id/ajuste', requierePermiso('inventario', 'editar'), async (req, res, next) => {
  try {
    const producto = await productoDeEmpresa(req.params.id, req.empresa.id);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });
    const objetivo = Number(req.body.cantidad_nueva);
    if (!Number.isFinite(objetivo) || objetivo < 0) return res.status(400).json({ error: 'La cantidad contada debe ser 0 o más' });
    const motivo = (req.body.motivo || '').trim();
    if (!motivo) return res.status(400).json({ error: 'El motivo es obligatorio' });
    await mover(req, res, { tipo: 'ajuste', prefijoClave: 'ajuste-producto', motivo,
      movimiento: { stock_objetivo: objetivo, costo_unitario: Number(producto.costo_calculado || 0) } });
  } catch (err) { next(err); }
});

// GET /api/inventario/productos/:id/movimientos
router.get('/:id/movimientos', async (req, res, next) => {
  try {
    const { data, error } = await supabase.from('inventario_movimientos')
      .select('id, fecha, tipo, origen, cantidad, stock_anterior, stock_nuevo, motivo, costo_unitario, operacion_id, usuario_id')
      .eq('empresa_id', req.empresa.id).eq('producto_id', req.params.id)
      .order('fecha', { ascending: false }).limit(100);
    if (error) throw new Error(error.message);
    res.json(data || []);
  } catch (err) { next(err); }
});

module.exports = router;
module.exports._interno = { estadoStock };
