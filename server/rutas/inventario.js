// ============================================================
// MÓDULO 3 — INVENTARIO EN TIEMPO REAL  (/api/inventario)
// Requiere sesión. Todo se filtra por req.empresa.id.
// - GET  /materiales   stock, punto de reorden y estado (semáforo)
// - GET  /capacidad    cuántas unidades de cada producto se pueden
//                      fabricar ahora + cuál material es el limitante
// - GET  /wip          producción en proceso (unidades a medio hacer,
//                      por producto y etapa) — de solo lectura, se
//                      llena sola cuando se registran entregas en Nóminas
// - POST /ajuste       ajuste manual tras un conteo físico (motivo obligatorio)
// - /productos/*       stock de productos terminados (ver inventario-productos.js)
// ============================================================
const express = require('express');
const log = require('../seguridad/log');
const supabase = require('../supabase/cliente');
const servicioInventario = require('../servicios/inventario');
const { obtenerWIPParaInventario } = require('../servicios/produccion');
const { randomUUID } = require('crypto');
const libro = require('../servicios/inventario/libro');
const router = express.Router();

// Productos terminados (Fase 3)
router.use('/productos', require('./inventario-productos'));
// Historial unificado (Fase 6)
router.use('/', require('./inventario-historial'));

// GET /api/inventario/materiales
router.get('/materiales', async (req, res, next) => {
  try {
    const inventario = await servicioInventario.obtenerInventarioMateriales(req.empresa.id);
    res.json(inventario);
  } catch (err) { next(err); }
});

// GET /api/inventario/wip
router.get('/wip', async (req, res, next) => {
  try {
    const wip = await obtenerWIPParaInventario(req.empresa.id);
    res.json(wip);
  } catch (err) { next(err); }
});

// GET /api/inventario/capacidad
router.get('/capacidad', async (req, res, next) => {
  try {
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, foto_url, precio_venta')
      .eq('empresa_id', req.empresa.id)
      .eq('activo', true)
      .order('nombre');
    if (eProd) throw new Error(eProd.message);

    if (!productos || productos.length === 0) return res.json([]);

    const { data: fichas, error: eFichas } = await supabase
      .from('productos_materiales')
      .select('producto_id, cantidad, materiales(id, nombre, unidad, stock_actual)')
      .in('producto_id', productos.map(p => p.id));
    if (eFichas) throw new Error(eFichas.message);

    const fichasPorProducto = new Map();
    for (const fila of fichas || []) {
      if (!fichasPorProducto.has(fila.producto_id)) fichasPorProducto.set(fila.producto_id, []);
      fichasPorProducto.get(fila.producto_id).push(fila);
    }

    const resultado = productos.map(p => {
      const filas = fichasPorProducto.get(p.id) || [];
      if (filas.length === 0) {
        return { ...p, unidades_fabricables: 0, material_limitante: null,
                 detalle: 'Este producto no tiene materiales en su ficha técnica' };
      }
      let minimo = Infinity;
      let limitante = null;
      for (const fila of filas) {
        const posibles = Math.floor(Number(fila.materiales.stock_actual) / Number(fila.cantidad));
        if (posibles < minimo) {
          minimo = posibles;
          limitante = {
            material_id: fila.materiales.id,
            nombre: fila.materiales.nombre,
            unidad: fila.materiales.unidad,
            stock_actual: Number(fila.materiales.stock_actual),
            cantidad_por_unidad: Number(fila.cantidad)
          };
        }
      }
      return { ...p, unidades_fabricables: minimo === Infinity ? 0 : minimo, material_limitante: limitante };
    });

    res.json(resultado);
  } catch (err) { next(err); }
});

// POST /api/inventario/ajuste
router.post('/ajuste', async (req, res, next) => {
  try {
    const { material_id, cantidad_nueva, motivo } = req.body;
    if (!material_id) return res.status(400).json({ error: 'Falta indicar el material' });
    if (cantidad_nueva == null || isNaN(cantidad_nueva) || Number(cantidad_nueva) < 0)
      return res.status(400).json({ error: 'La cantidad nueva debe ser un número mayor o igual a 0' });
    if (!motivo || !motivo.trim())
      return res.status(400).json({ error: 'El motivo del ajuste es obligatorio (para trazabilidad)' });

    const { data: material, error: eGet } = await supabase
      .from('materiales').select('id, costo_unitario').eq('id', material_id).eq('empresa_id', req.empresa.id).single();
    if (eGet || !material) return res.status(404).json({ error: 'Material no encontrado' });

    // El valor exacto se fija en la base con la fila bloqueada: si entre
    // tanto entró una venta, la diferencia se calcula sobre el stock real.
    const ajusteId = randomUUID();
    const operacion = await libro.aplicarOperacion({
      empresaId: req.empresa.id, usuarioId: req.usuarioId,
      tipo: 'ajuste', origenTabla: 'inventario_ajustes', origenId: ajusteId,
      motivo: motivo.trim(), clave: libro.claveDe(req, 'ajuste'),
      movimientos: [{ material_id, stock_objetivo: Number(cantidad_nueva), costo_unitario: Number(material.costo_unitario) }]
    });
    if (operacion.sinCambios) return res.json({ ajustado: false, sin_cambios: true, stock_nuevo: Number(cantidad_nueva) });
    const mov = (operacion.movimientos || [])[0];
    if (!mov) return res.json({ ajustado: true, repetido: true });

    const { error: eAjuste } = await supabase.from('inventario_ajustes').insert({
      id: ajusteId,
      empresa_id: req.empresa.id, usuario_id: req.usuarioId,
      material_id,
      stock_anterior: mov.stock_anterior,
      stock_nuevo: mov.stock_nuevo,
      motivo: motivo.trim(),
      usuario: req.usuarioEmail || null
    });
    if (eAjuste) log.error('[inventario_ajustes] No se pudo guardar la copia del ajuste:', eAjuste);

    res.json({ ajustado: true, stock_anterior: mov.stock_anterior, stock_nuevo: mov.stock_nuevo });
  } catch (err) { next(err); }
});

// GET /api/inventario/ajustes — historial de ajustes manuales
router.get('/ajustes', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('inventario_ajustes')
      .select('*, materiales(nombre, unidad)')
      .eq('empresa_id', req.empresa.id)
      .order('fecha', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

module.exports = router;