// ============================================================
// MÓDULO 2 — PRODUCTOS / FICHAS TÉCNICAS  (/api/productos)
// Requiere sesión. Cada consulta se filtra por req.usuarioId.
// El costo de mano de obra ya NO se guarda por producto: se calcula
// con el precio de hora global (server/servicios/costos.js), así
// que cambiarlo en un solo lugar (Configuración) afecta a todos
// los productos automáticamente.
// - GET    /                    productos con costo, precio y margen
// - POST   /                    crear producto + su lista de materiales
// - PUT    /:id                 editar ficha técnica; recalcula costo y margen
// - DELETE /:id                 elimina solo si no tiene ventas históricas;
//                               si las tiene, se desactiva en vez de borrar
// - GET    /:id/costo           desglose de costo (materiales + mano de obra)
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { calcularCostoProducto, obtenerCostoMinutoManoObra } = require('../servicios/costos');
const router = express.Router();

function validarProducto(datos) {
  const errores = [];
  if (!datos.nombre || !datos.nombre.trim()) errores.push('El nombre es obligatorio');
  if (datos.precio_venta == null || isNaN(datos.precio_venta) || Number(datos.precio_venta) < 0)
    errores.push('El precio de venta debe ser un número mayor o igual a 0');
  if (datos.minutos_fabricacion != null && (isNaN(datos.minutos_fabricacion) || Number(datos.minutos_fabricacion) < 0))
    errores.push('Los minutos de fabricación deben ser un número válido');
  if (!Array.isArray(datos.materiales) || datos.materiales.length === 0)
    errores.push('La ficha técnica debe tener al menos un material');
  else {
    for (const m of datos.materiales) {
      if (!m.material_id) { errores.push('Cada fila de material debe indicar cuál material es'); break; }
      if (m.cantidad == null || isNaN(m.cantidad) || Number(m.cantidad) <= 0) {
        errores.push('La cantidad de cada material debe ser mayor a 0'); break;
      }
    }
  }
  return errores;
}

function conMargen(producto) {
  const costo = Number(producto.costo_calculado);
  const precio = Number(producto.precio_venta);
  const margenValor = Math.round((precio - costo) * 100) / 100;
  const margenPorcentaje = precio > 0 ? Math.round((margenValor / precio) * 1000) / 10 : 0;
  return { ...producto, margen_valor: margenValor, margen_porcentaje: margenPorcentaje };
}

// GET /api/productos
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('productos')
      .select('*')
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .order('nombre');
    if (error) throw new Error(error.message);
    res.json(data.map(conMargen));
  } catch (err) { next(err); }
});

// POST /api/productos
router.post('/', async (req, res, next) => {
  try {
    const errores = validarProducto(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const costoCalculado = await calcularCostoProducto({
      materiales: req.body.materiales,
      minutosFabricacion: req.body.minutos_fabricacion,
      usuarioId: req.usuarioId
    });

    const { data: producto, error: eProd } = await supabase
      .from('productos')
      .insert({
        usuario_id: req.usuarioId,
        nombre: req.body.nombre.trim(),
        foto_url: req.body.foto_url || null,
        precio_venta: Number(req.body.precio_venta),
        minutos_fabricacion: Number(req.body.minutos_fabricacion || 0),
        costo_calculado: costoCalculado
      })
      .select().single();
    if (eProd) throw new Error(eProd.message);

    const filasMateriales = req.body.materiales.map(m => ({
      producto_id: producto.id,
      material_id: m.material_id,
      cantidad: Number(m.cantidad)
    }));
    const { error: eRel } = await supabase.from('productos_materiales').insert(filasMateriales);
    if (eRel) throw new Error(eRel.message);

    res.status(201).json(conMargen(producto));
  } catch (err) { next(err); }
});

// PUT /api/productos/:id
router.put('/:id', async (req, res, next) => {
  try {
    const errores = validarProducto(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const costoCalculado = await calcularCostoProducto({
      materiales: req.body.materiales,
      minutosFabricacion: req.body.minutos_fabricacion,
      usuarioId: req.usuarioId
    });

    const { data: producto, error: eProd } = await supabase
      .from('productos')
      .update({
        nombre: req.body.nombre.trim(),
        foto_url: req.body.foto_url || null,
        precio_venta: Number(req.body.precio_venta),
        minutos_fabricacion: Number(req.body.minutos_fabricacion || 0),
        costo_calculado: costoCalculado,
        actualizado_en: new Date().toISOString()
      })
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .select().single();
    if (eProd) throw new Error(eProd.message);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const { error: eDel } = await supabase.from('productos_materiales').delete().eq('producto_id', req.params.id);
    if (eDel) throw new Error(eDel.message);

    const filasMateriales = req.body.materiales.map(m => ({
      producto_id: req.params.id,
      material_id: m.material_id,
      cantidad: Number(m.cantidad)
    }));
    const { error: eRel } = await supabase.from('productos_materiales').insert(filasMateriales);
    if (eRel) throw new Error(eRel.message);

    res.json(conMargen(producto));
  } catch (err) { next(err); }
});

// DELETE /api/productos/:id
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: producto, error: eGet } = await supabase
      .from('productos').select('id').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const { count, error: eVentas } = await supabase
      .from('ventas_items')
      .select('id', { count: 'exact', head: true })
      .eq('producto_id', req.params.id);
    if (eVentas) throw new Error(eVentas.message);

    if (count > 0) {
      const { error } = await supabase
        .from('productos')
        .update({ activo: false, actualizado_en: new Date().toISOString() })
        .eq('id', req.params.id)
        .eq('usuario_id', req.usuarioId);
      if (error) throw new Error(error.message);
      return res.json({
        eliminado: false,
        desactivado: true,
        mensaje: `Este producto tiene ${count} venta(s) registradas, así que se desactivó en vez de borrarse (para no perder el historial).`
      });
    }

    const { error: eDelRel } = await supabase.from('productos_materiales').delete().eq('producto_id', req.params.id);
    if (eDelRel) throw new Error(eDelRel.message);
    const { error } = await supabase.from('productos').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);
    res.json({ eliminado: true, desactivado: false });
  } catch (err) { next(err); }
});

// GET /api/productos/:id/costo
router.get('/:id/costo', async (req, res, next) => {
  try {
    const { data: producto, error: eProd } = await supabase
      .from('productos').select('*').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eProd || !producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const { data: filas, error: eRel } = await supabase
      .from('productos_materiales')
      .select('cantidad, materiales(id, nombre, unidad, costo_unitario)')
      .eq('producto_id', req.params.id);
    if (eRel) throw new Error(eRel.message);

    const materiales = filas.map(f => ({
      material_id: f.materiales.id,
      nombre: f.materiales.nombre,
      unidad: f.materiales.unidad,
      cantidad: Number(f.cantidad),
      costo_unitario: Number(f.materiales.costo_unitario),
      subtotal: Math.round(Number(f.cantidad) * Number(f.materiales.costo_unitario) * 100) / 100
    }));
    const costoMateriales = Math.round(materiales.reduce((s, m) => s + m.subtotal, 0) * 100) / 100;

    const costoMinuto = await obtenerCostoMinutoManoObra(req.usuarioId);
    const costoManoObra = Math.round(Number(producto.minutos_fabricacion) * costoMinuto * 100) / 100;

    res.json({
      producto_id: producto.id,
      nombre: producto.nombre,
      materiales,
      costo_materiales: costoMateriales,
      costo_mano_obra: costoManoObra,
      costo_total: Math.round((costoMateriales + costoManoObra) * 100) / 100,
      precio_venta: Number(producto.precio_venta)
    });
  } catch (err) { next(err); }
});

module.exports = router;