// ============================================================
// MÓDULO — PRODUCTOS / FICHAS TÉCNICAS  (/api/productos)
//
// Un producto se costea de una de dos formas (ver servicios/costos.js):
//   - "por ficha técnica" (usa_costeo_por_procesos = false o null): el
//     usuario llena productos_materiales a mano — el modo de siempre.
//   - "por procesos" (usa_costeo_por_procesos = true): los materiales
//     salen solos de sumar los procesos_materiales de cada proceso de
//     este producto. En este modo, productos_materiales ya NO se edita
//     desde aquí — se ignora cualquier `materiales` que llegue en el
//     body de PUT.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { calcularCostoProducto, obtenerCostoMinutoManoObra, recalcularProductoDesdeSusProcesos } = require('../servicios/costos');
const router = express.Router();

function validarProducto(datos) {
  const errores = [];
  if (!datos.nombre || !datos.nombre.trim()) errores.push('El nombre es obligatorio');
  if (datos.precio_venta == null || isNaN(datos.precio_venta) || Number(datos.precio_venta) < 0)
    errores.push('El precio de venta debe ser un número mayor o igual a 0');
  // Los materiales ya NO son obligatorios al crear: un producto puede
  // arrancar vacío y llenarse luego desde Procesos (modo "por procesos").
  if (datos.materiales != null && !Array.isArray(datos.materiales))
    errores.push('La lista de materiales no es válida');
  else if (Array.isArray(datos.materiales)) {
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

// Lista agregada de materiales (sumados por material) desde los
// procesos activos de un producto — es lo que se muestra de solo
// lectura cuando usa_costeo_por_procesos = true.
async function materialesAgregadosDesdeProcesos(productoId, usuarioId) {
  const { data: procesos, error: eProc } = await supabase
    .from('procesos').select('id, repeticiones_por_unidad').eq('producto_id', productoId).eq('usuario_id', usuarioId).eq('activo', true);
  if (eProc) throw new Error(eProc.message);
  if ((procesos || []).length === 0) return [];
  const repeticionesPorProceso = new Map(procesos.map(p => [p.id, Number(p.repeticiones_por_unidad || 1)]));

  const { data: filas, error: eMat } = await supabase
    .from('procesos_materiales')
    .select('proceso_id, material_id, cantidad, materiales(id, nombre, unidad, costo_unitario)')
    .in('proceso_id', [...repeticionesPorProceso.keys()]);
  if (eMat) throw new Error(eMat.message);

  // Cada material se multiplica por las repeticiones del proceso al que
  // pertenece antes de sumarlo — un proceso que se repite 8 veces por
  // unidad (ej: "pétalo" en una flor) gasta 8 veces lo que gasta UNA
  // ejecución, aunque en procesos_materiales solo quede guardado el
  // gasto de una sola vez.
  const porMaterial = new Map();
  for (const f of filas || []) {
    const repeticiones = repeticionesPorProceso.get(f.proceso_id) || 1;
    const cantidadReal = Number(f.cantidad) * repeticiones;
    const actual = porMaterial.get(f.material_id) || { material_id: f.material_id, nombre: f.materiales.nombre, unidad: f.materiales.unidad, costo_unitario: Number(f.materiales.costo_unitario), cantidad: 0 };
    actual.cantidad += cantidadReal;
    porMaterial.set(f.material_id, actual);
  }
  return [...porMaterial.values()].map(m => ({
    ...m,
    cantidad: Math.round(m.cantidad * 10000) / 10000,
    subtotal: Math.round(m.cantidad * m.costo_unitario * 100) / 100
  }));
}

// GET /api/productos
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('productos')
      .select('*, categorias_productos(id, nombre)')
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .order('nombre');
    if (error) throw new Error(error.message);

    const { data: procesos, error: eProc } = await supabase
      .from('procesos').select('producto_id').eq('usuario_id', req.usuarioId).eq('activo', true);
    if (eProc) throw new Error(eProc.message);
    const idsConProcesos = new Set((procesos || []).map(p => p.producto_id));

    res.json(data.map(p => ({ ...conMargen(p), tiene_procesos: idsConProcesos.has(p.id) })));
  } catch (err) { next(err); }
});

// GET /api/productos/conflictos-materiales — productos con procesos
// cuyo modo de costeo aún no está resuelto (tienen materiales propios
// en la ficha técnica Y también procesos con sus propios materiales,
// y el sistema no puede decidir solo cuál lista es la correcta).
router.get('/conflictos-materiales', async (req, res, next) => {
  try {
    const { data: productos, error } = await supabase
      .from('productos')
      .select('id, nombre')
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .is('usa_costeo_por_procesos', null);
    if (error) throw new Error(error.message);

    const conflictos = [];
    for (const producto of productos || []) {
      const { data: propios, error: eProp } = await supabase
        .from('productos_materiales')
        .select('cantidad, materiales(id, nombre, unidad, costo_unitario)')
        .eq('producto_id', producto.id);
      if (eProp) throw new Error(eProp.message);
      if (!propios || propios.length === 0) continue; // sin materiales propios: no hay conflicto, se resuelve solo

      const desdeProcesos = await materialesAgregadosDesdeProcesos(producto.id, req.usuarioId);
      if (desdeProcesos.length === 0) continue; // el producto tiene procesos pero ninguno tiene materiales aún

      conflictos.push({
        producto_id: producto.id,
        nombre: producto.nombre,
        materiales_ficha_tecnica: propios.map(p => ({
          material_id: p.materiales.id, nombre: p.materiales.nombre, unidad: p.materiales.unidad,
          cantidad: Number(p.cantidad), subtotal: Math.round(Number(p.cantidad) * Number(p.materiales.costo_unitario) * 100) / 100
        })),
        materiales_desde_procesos: desdeProcesos
      });
    }
    res.json(conflictos);
  } catch (err) { next(err); }
});

// PUT /api/productos/:id/costeo-materiales — cuerpo: { usar_procesos: boolean }
// Resuelve manualmente cuál lista de materiales manda para este producto.
router.put('/:id/costeo-materiales', async (req, res, next) => {
  try {
    if (typeof req.body.usar_procesos !== 'boolean')
      return res.status(400).json({ error: '"usar_procesos" debe ser true o false' });

    const { data: producto, error: eGet } = await supabase
      .from('productos').select('id').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const { error } = await supabase
      .from('productos')
      .update({ usa_costeo_por_procesos: req.body.usar_procesos, actualizado_en: new Date().toISOString() })
      .eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);

    const ficha = await recalcularProductoDesdeSusProcesos(req.params.id, req.usuarioId);
    res.json(ficha);
  } catch (err) { next(err); }
});

// POST /api/productos
router.post('/', async (req, res, next) => {
  try {
    const errores = validarProducto(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    // Los minutos de fabricación arrancan en 0: un producto recién
    // creado todavía no tiene procesos.
    const minutosFabricacion = req.body.minutos_fabricacion != null && !isNaN(req.body.minutos_fabricacion)
      ? Number(req.body.minutos_fabricacion) : 0;

    const costoCalculado = await calcularCostoProducto({
      materiales: req.body.materiales || [],
      minutosFabricacion,
      usuarioId: req.usuarioId
    });

    const { data: producto, error: eProd } = await supabase
      .from('productos')
      .insert({
        usuario_id: req.usuarioId,
        nombre: req.body.nombre.trim(),
        foto_url: req.body.foto_url || null,
        categoria_id: req.body.categoria_id || null,
        precio_venta: Number(req.body.precio_venta),
        minutos_fabricacion: minutosFabricacion,
        costo_calculado: costoCalculado
      })
      .select('*, categorias_productos(id, nombre)').single();
    if (eProd) throw new Error(eProd.message);

    if (req.body.materiales && req.body.materiales.length > 0) {
      const filasMateriales = req.body.materiales.map(m => ({
        producto_id: producto.id,
        material_id: m.material_id,
        cantidad: Number(m.cantidad)
      }));
      const { error: eRel } = await supabase.from('productos_materiales').insert(filasMateriales);
      if (eRel) throw new Error(eRel.message);
    }

    res.status(201).json(conMargen(producto));
  } catch (err) { next(err); }
});

// PUT /api/productos/:id
// Los minutos de fabricación solo se editan a mano aquí cuando el
// producto NO tiene procesos — si los tiene, se derivan solos de ellos
// (pestaña Procesos) y lo que llegue en el body se ignora.
router.put('/:id', async (req, res, next) => {
  try {
    const errores = validarProducto(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const { data: actual, error: eActual } = await supabase
      .from('productos').select('minutos_fabricacion, usa_costeo_por_procesos').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eActual || !actual) return res.status(404).json({ error: 'Producto no encontrado' });

    const { count: countProcesos, error: eCountProc } = await supabase
      .from('procesos').select('id', { count: 'exact', head: true })
      .eq('producto_id', req.params.id).eq('usuario_id', req.usuarioId).eq('activo', true);
    if (eCountProc) throw new Error(eCountProc.message);
    const tieneProcesos = countProcesos > 0;

    const minutosFabricacion = tieneProcesos
      ? Number(actual.minutos_fabricacion) // se deriva de los procesos, no se toca aquí
      : (req.body.minutos_fabricacion != null && !isNaN(req.body.minutos_fabricacion)
          ? Number(req.body.minutos_fabricacion) : Number(actual.minutos_fabricacion));

    // En modo "por procesos" la ficha técnica de materiales es de solo
    // lectura: se ignora lo que venga en el body y no se toca la tabla.
    const editaMaterialesAqui = actual.usa_costeo_por_procesos !== true;

    const costoCalculado = editaMaterialesAqui
      ? await calcularCostoProducto({
          materiales: req.body.materiales || [],
          minutosFabricacion,
          usuarioId: req.usuarioId
        })
      : null; // se recalcula abajo con recalcularProductoDesdeSusProcesos

    const cambios = {
      nombre: req.body.nombre.trim(),
      foto_url: req.body.foto_url || null,
      categoria_id: req.body.categoria_id || null,
      precio_venta: Number(req.body.precio_venta),
      minutos_fabricacion: minutosFabricacion,
      actualizado_en: new Date().toISOString()
    };
    if (costoCalculado != null) cambios.costo_calculado = costoCalculado;

    const { data: producto, error: eProd } = await supabase
      .from('productos')
      .update(cambios)
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .select('*, categorias_productos(id, nombre)').single();
    if (eProd) throw new Error(eProd.message);
    if (!producto) return res.status(404).json({ error: 'Producto no encontrado' });

    if (editaMaterialesAqui) {
      const { error: eDel } = await supabase.from('productos_materiales').delete().eq('producto_id', req.params.id);
      if (eDel) throw new Error(eDel.message);

      if (req.body.materiales && req.body.materiales.length > 0) {
        const filasMateriales = req.body.materiales.map(m => ({
          producto_id: req.params.id,
          material_id: m.material_id,
          cantidad: Number(m.cantidad)
        }));
        const { error: eRel } = await supabase.from('productos_materiales').insert(filasMateriales);
        if (eRel) throw new Error(eRel.message);
      }
    } else {
      // El precio pudo cambiar el margen aunque el costo no cambió aquí;
      // y por seguridad, sincroniza el costo con lo que digan los procesos.
      const ficha = await recalcularProductoDesdeSusProcesos(req.params.id, req.usuarioId);
      producto.costo_calculado = ficha.costo_calculado;
      producto.minutos_fabricacion = ficha.minutos_fabricacion;
    }

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

// GET /api/productos/:id/costo — desglose de costos para mostrar en pantalla
router.get('/:id/costo', async (req, res, next) => {
  try {
    const { data: producto, error: eProd } = await supabase
      .from('productos').select('*').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eProd || !producto) return res.status(404).json({ error: 'Producto no encontrado' });

    const materiales = producto.usa_costeo_por_procesos
      ? await materialesAgregadosDesdeProcesos(req.params.id, req.usuarioId)
      : (await (async () => {
          const { data: filas, error: eRel } = await supabase
            .from('productos_materiales')
            .select('cantidad, materiales(id, nombre, unidad, costo_unitario)')
            .eq('producto_id', req.params.id);
          if (eRel) throw new Error(eRel.message);
          return filas.map(f => ({
            material_id: f.materiales.id,
            nombre: f.materiales.nombre,
            unidad: f.materiales.unidad,
            cantidad: Number(f.cantidad),
            costo_unitario: Number(f.materiales.costo_unitario),
            subtotal: Math.round(Number(f.cantidad) * Number(f.materiales.costo_unitario) * 100) / 100
          }));
        })());
    const costoMateriales = Math.round(materiales.reduce((s, m) => s + m.subtotal, 0) * 100) / 100;

    const costoMinuto = await obtenerCostoMinutoManoObra(req.usuarioId);
    const costoManoObra = Math.round(Number(producto.minutos_fabricacion) * costoMinuto * 100) / 100;

    res.json({
      producto_id: producto.id,
      nombre: producto.nombre,
      usa_costeo_por_procesos: !!producto.usa_costeo_por_procesos,
      materiales,
      costo_materiales: costoMateriales,
      costo_mano_obra: costoManoObra,
      costo_total: Math.round((costoMateriales + costoManoObra) * 100) / 100,
      precio_venta: Number(producto.precio_venta)
    });
  } catch (err) { next(err); }
});

module.exports = router;