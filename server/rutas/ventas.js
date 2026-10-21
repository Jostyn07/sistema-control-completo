// ============================================================
// MÓDULO 4 — VENTAS  (/api/ventas)
// Requiere sesión. Todo se filtra por req.empresa.id.
// - GET  /productos-disponibles  productos con capacidad producible actual
// - POST /                       registra la venta; descuenta materiales
// - GET  /                       historial con filtros (desde, hasta, estado)
// - PUT  /:id/estado             pendiente → en_produccion → listo → entregado
// - PUT  /:id/pago                confirmar/desconfirmar pago — independiente
//                                 del estado de entrega
// - PUT  /:id                     editar contacto/fecha, y opcionalmente
//                                 productos/cantidades (la categoría de
//                                 cada línea sale del producto, no se manda)
// - DELETE /:id                   elimina y revierte el stock consumido;
//                                 bloqueada si existe cualquier factura
//                                 asociada (incluso anulada)
// ============================================================
const express = require('express');
const log = require('../seguridad/log');
const supabase = require('../supabase/cliente');
const { cifrar, descifrar } = require('../servicios/cifrado');
const { obtenerCostoMinutoManoObra, obtenerFichasEfectivasParaProductos } = require('../servicios/costos');
const { consumirWIPYGenerarNecesidad } = require('../servicios/produccion');
const { registrarEntrega, eliminarEntrega, obtenerHistorial } = require('../servicios/entregas');
const { randomUUID } = require('crypto');
const libro = require('../servicios/inventario/libro');
const { planDeFabricacion } = require('../servicios/inventario/fabricacion');
const router = express.Router();

const ESTADOS_VALIDOS = ['pendiente', 'en_produccion', 'listo', 'entregado'];

// GET /api/ventas/productos-disponibles
// Incluye el desglose de costo POR UNIDAD (materiales vs. mano de obra)
// para que el formulario de venta pueda calcular en vivo, por
// categoría, cuánto se invirtió en materiales, cuánto en mano de obra
// y cuál es el margen — sin tener que pedirlo aparte por cada producto.
// También trae la categoría propia del producto (asignada en Productos)
// para que la venta la tome automáticamente, sin escribirla a mano.
router.get('/productos-disponibles', async (req, res, next) => {
  try {
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, costo_calculado, minutos_fabricacion, categoria_id, categorias_productos(nombre)')
      .eq('empresa_id', req.empresa.id)
      .eq('activo', true)
      .order('nombre');
    if (eProd) throw new Error(eProd.message);
    if (!productos || productos.length === 0) return res.json([]);

    const fichas = await obtenerFichasEfectivasParaProductos(productos.map(p => p.id), req.empresa.id);

    const costoMinuto = await obtenerCostoMinutoManoObra(req.empresa.id);
    const { data: stocks } = await supabase.from('inventario_productos')
      .select('producto_id, stock_actual').eq('empresa_id', req.empresa.id).eq('controla_stock', true);
    const stockTerminado = new Map((stocks || []).map(s => [s.producto_id, Number(s.stock_actual)]));

    const fichasPorProducto = new Map();
    for (const f of fichas || []) {
      if (!fichasPorProducto.has(f.producto_id)) fichasPorProducto.set(f.producto_id, []);
      fichasPorProducto.get(f.producto_id).push(f);
    }

    res.json(productos.map(p => {
      const filas = fichasPorProducto.get(p.id) || [];
      let fabricables = 0;
      if (filas.length > 0) {
        fabricables = Math.min(...filas.map(f =>
          Math.floor(Number(f.materiales.stock_actual) / Number(f.cantidad))));
      }
      // costo_calculado ya incluye materiales + mano de obra juntos;
      // la mano de obra se puede aislar porque es minutos × precio de
      // hora global, y lo que sobra son los materiales.
      const costoManoObraUnitario = Math.round(Number(p.minutos_fabricacion || 0) * costoMinuto * 100) / 100;
      const costoMaterialesUnitario = Math.round((Number(p.costo_calculado) - costoManoObraUnitario) * 100) / 100;
      return {
        ...p,
        categoria: p.categorias_productos ? p.categorias_productos.nombre : null,
        unidades_fabricables: fabricables,
        controla_stock: stockTerminado.has(p.id),
        stock_terminado: stockTerminado.has(p.id) ? stockTerminado.get(p.id) : null,
        costo_materiales_unitario: costoMaterialesUnitario,
        costo_mano_obra_unitario: costoManoObraUnitario
      };
    }));
  } catch (err) { next(err); }
});

// GET /api/ventas/categorias-por-producto
// Devuelve, por cada producto, las categorías (variantes) que ya se han
// usado antes en ventas de este usuario — para sugerirlas al vender de
// nuevo (ej: si ya vendiste "Gerberas / Amarilla", que la próxima vez
// aparezca sugerida en vez de tener que escribirla otra vez).
router.get('/categorias-por-producto', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('ventas_items')
      .select('producto_id, categoria, ventas!inner(empresa_id)')
      .eq('ventas.empresa_id', req.empresa.id)
      .not('categoria', 'is', null);
    if (error) throw new Error(error.message);

    const mapa = {};
    for (const fila of data || []) {
      if (!mapa[fila.producto_id]) mapa[fila.producto_id] = [];
      if (!mapa[fila.producto_id].includes(fila.categoria)) mapa[fila.producto_id].push(fila.categoria);
    }
    for (const id in mapa) mapa[id].sort((a, b) => a.localeCompare(b, 'es'));
    res.json(mapa);
  } catch (err) { next(err); }
});

// La venta creada por una operación de inventario (para reintentos)
async function ventaDeOperacion(operacionId, empresaId) {
  const { data: op } = await supabase.from('inventario_operaciones')
    .select('origen_id').eq('id', operacionId).eq('empresa_id', empresaId).maybeSingle();
  if (!op || !op.origen_id) return null;
  for (let intento = 0; intento < 4; intento++) {
    const { data } = await supabase.from('ventas').select('*').eq('id', op.origen_id).eq('empresa_id', empresaId).maybeSingle();
    if (data) return data;
    await new Promise(r => setTimeout(r, 500));
  }
  return null;
}

// Si algo falla después de mover stock, se devuelve exacto desde el libro
async function deshacerOperacion(operacion, req, motivo) {
  if (!operacion || !operacion.ok || !operacion.operacionId) return;
  try {
    const { revertirOperacion } = require('../servicios/inventario/nucleo');
    await revertirOperacion({ empresaId: req.empresa.id, usuarioId: req.usuarioId,
      operacionId: operacion.operacionId, motivo, permitirNegativo: true });
  } catch (err) { log.error('[inventario] No se pudo deshacer la operación', operacion.operacionId, err); }
}

// Productos que llevan stock de terminados (Fase 5): la venta descuenta
// el producto, no materiales ni WIP.
async function idsConStock(productoIds, empresaId) {
  if (!productoIds.length) return new Set();
  const { data, error } = await supabase.from('inventario_productos')
    .select('producto_id').eq('empresa_id', empresaId).eq('controla_stock', true).in('producto_id', productoIds);
  if (error) throw new Error(error.message);
  return new Set((data || []).map(f => f.producto_id));
}

function unidadesPorProducto(listaItems, ids) {
  const mapa = new Map();
  for (const i of listaItems) if (ids.has(i.producto_id)) mapa.set(i.producto_id, (mapa.get(i.producto_id) || 0) + Number(i.cantidad));
  return mapa;
}

// 409 de productos terminados: cuánto hay y, si se fabrica, cuánto falta fabricar
async function respuestaFaltanProductos(res, faltantes, empresaId, puedeForzar = true) {
  const detalle = [];
  for (const f of faltantes) {
    const plan = await planDeFabricacion(f.producto_id, Number(f.falta), empresaId);
    detalle.push({
      producto_id: f.producto_id, producto: f.nombre,
      disponible: Math.max(0, Number(f.disponible)), requerido: Number(f.requerido), falta: Number(f.falta),
      se_fabrica: plan.tipo !== 'ninguno',
      fabricables_ahora: plan.tipo === 'procesos' ? plan.etapa.unidades_posibles : (plan.unidades_posibles ?? null)
    });
  }
  return res.status(409).json({
    error: 'No hay suficientes unidades terminadas para esta venta',
    faltantes_productos: detalle, puede_vender_disponible: true, puede_forzar: puedeForzar
  });
}

// Consumo de material por item, con la ficha efectiva
function requeridoPorMaterialDe(listaItems, fichas) {
  const mapa = new Map();
  for (const item of listaItems) {
    for (const f of (fichas || []).filter(f => f.producto_id === item.producto_id)) {
      const previo = mapa.get(f.material_id) || { material: f.materiales, requerido: 0 };
      previo.requerido += Number(f.cantidad) * Number(item.cantidad);
      mapa.set(f.material_id, previo);
    }
  }
  return mapa;
}

// POST /api/ventas
router.post('/', async (req, res, next) => {
  try {
    const { cliente, cliente_telefono, cliente_cedula, fecha_entrega, items, forzar } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
    for (const item of items) {
      if (!item.producto_id || !item.cantidad || Number(item.cantidad) <= 0)
        return res.status(400).json({ error: 'Cada producto de la venta necesita una cantidad mayor a 0' });
    }

    const productoIds = items.map(i => i.producto_id);
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, costo_calculado, activo, categoria_id, categorias_productos(nombre)')
      .eq('empresa_id', req.empresa.id)
      .in('id', productoIds);
    if (eProd) throw new Error(eProd.message);
    const productoPorId = new Map((productos || []).map(p => [p.id, p]));
    for (const item of items) {
      const p = productoPorId.get(item.producto_id);
      if (!p) return res.status(404).json({ error: 'Uno de los productos ya no existe o no te pertenece' });
      if (!p.activo) return res.status(400).json({ error: `"${p.nombre}" está desactivado y no se puede vender` });
      if (!p.categoria_id) return res.status(400).json({ error: `"${p.nombre}" no tiene categoría asignada. Asígnale una en Productos antes de venderlo.` });
    }

    const fichas = await obtenerFichasEfectivasParaProductos(productoIds, req.empresa.id);

    // Productos con procesos activos van por el flujo de WIP (el
    // material se descuenta cuando se entrega cada proceso, no aquí,
    // así que se excluyen del chequeo de material de abajo). Los
    // demás siguen el flujo clásico: material directo en la venta.
    const { data: procesosActivos, error: eProcActivos } = await supabase
      .from('procesos')
      .select('producto_id')
      .eq('empresa_id', req.empresa.id)
      .eq('activo', true)
      .in('producto_id', productoIds);
    if (eProcActivos) throw new Error(eProcActivos.message);
    const idsConProcesos = new Set((procesosActivos || []).map(p => p.producto_id));
    const conStock = await idsConStock(productoIds, req.empresa.id);

    const itemsSinProcesos = items.filter(i => !conStock.has(i.producto_id) && !idsConProcesos.has(i.producto_id));
    const itemsConProcesos = items.filter(i => !conStock.has(i.producto_id) && idsConProcesos.has(i.producto_id));

    const requeridoPorMaterial = new Map();
    for (const item of itemsSinProcesos) {
      const filasDelProducto = (fichas || []).filter(f => f.producto_id === item.producto_id);
      for (const f of filasDelProducto) {
        const previo = requeridoPorMaterial.get(f.material_id) || { material: f.materiales, requerido: 0 };
        previo.requerido += Number(f.cantidad) * Number(item.cantidad);
        requeridoPorMaterial.set(f.material_id, previo);
      }
    }

    // El stock se mueve en la base, todo o nada. Si falta material y no
    // se confirma, no se crea nada. La venta se guarda con el id de la
    // operación ya hecha (origen = ventas/ventaId).
    const ventaId = randomUUID();
    const clave = libro.claveDe(req, 'venta');
    const movimientos = libro.movimientosDeMateriales(requeridoPorMaterial, -1);
    for (const [productoId, unidades] of unidadesPorProducto(items, conStock)) {
      const p = productoPorId.get(productoId);
      movimientos.push({ producto_id: productoId, cantidad: -unidades, costo_unitario: Number(p.costo_calculado || 0) });
    }
    let faltantes = [];
    let operacion = null;
    if (movimientos.length > 0) {
      operacion = await libro.aplicarOperacion({
        empresaId: req.empresa.id, usuarioId: req.usuarioId,
        tipo: 'venta', origenTabla: 'ventas', origenId: ventaId, clave,
        movimientos, permitirNegativo: !!forzar,
        detalleForzado: { confirmado: true }
      });
      if (!operacion.ok) {
        const deProductos = operacion.faltantes.filter(f => f.producto_id);
        if (deProductos.length > 0) return respuestaFaltanProductos(res, deProductos, req.empresa.id);
        return res.status(409).json({
          error: 'No hay material suficiente para esta venta',
          faltantes: libro.faltantesLegibles(operacion.faltantes, libro.unidadesDe(requeridoPorMaterial)),
          puede_forzar: true
        });
      }
      if (operacion.repetida) {
        // Doble clic / reintento: la venta ya existe (o se está guardando)
        const existente = await ventaDeOperacion(operacion.operacionId, req.empresa.id);
        if (existente) return res.status(200).json({ ...existente, repetida: true, facturable: true });
        return res.status(409).json({ error: 'Esta venta ya se está registrando. Revisa el historial antes de intentarlo de nuevo.' });
      }
      if (operacion.forzada) {
        faltantes = (operacion.movimientos || []).filter(m => m.stock_nuevo < 0)
          .map(m => ({ [m.producto_id ? 'producto' : 'material']: m.nombre, stock_actual: m.stock_anterior, requerido: -m.cantidad }));
      }
    }

    let total = 0, costoTotal = 0;
    const filasItems = items.map(item => {
      const p = productoPorId.get(item.producto_id);
      const cantidad = Number(item.cantidad);
      total += Number(p.precio_venta) * cantidad;
      costoTotal += Number(p.costo_calculado) * cantidad;
      return {
        producto_id: item.producto_id,
        cantidad,
        precio_unitario: Number(p.precio_venta),
        costo_unitario: Number(p.costo_calculado),
        // La categoría SIEMPRE sale de la que tiene asignada el producto
        // (categoria_id) — no de lo que mande el navegador. Ya se validó
        // arriba que todo producto vendido tiene categoría asignada.
        categoria: p.categorias_productos ? p.categorias_productos.nombre : null
      };
    });
    total = Math.round(total * 100) / 100;
    costoTotal = Math.round(costoTotal * 100) / 100;

    const { data: venta, error: eVenta } = await supabase
      .from('ventas')
      .insert({
        id: ventaId,
        empresa_id: req.empresa.id, usuario_id: req.usuarioId,
        cliente: (cliente || '').trim() || null,
        cliente_telefono_cifrado: cifrar(cliente_telefono),
        cliente_cedula_cifrada: cifrar(cliente_cedula),
        fecha_entrega: fecha_entrega || null,
        total, costo_total: costoTotal, estado: 'pendiente'
      })
      .select().single();
    if (eVenta) {
      await deshacerOperacion(operacion, req, 'No se pudo guardar la venta');
      throw new Error(eVenta.message);
    }

    const { error: eItems } = await supabase
      .from('ventas_items')
      .insert(filasItems.map(f => ({ ...f, venta_id: venta.id })));
    if (eItems) {
      await supabase.from('ventas').delete().eq('id', venta.id).eq('empresa_id', req.empresa.id);
      await deshacerOperacion(operacion, req, 'No se pudieron guardar los productos de la venta');
      throw new Error(eItems.message);
    }

    // Productos CON procesos: se toma de WIP terminado lo que haya, y
    // si falta, se genera sola la cola de procesos pendientes (sin
    // asignar todavía) — esto NUNCA bloquea la venta, a diferencia del
    // chequeo de material de arriba.
    const produccionGenerada = [];
    for (const item of itemsConProcesos) {
      const resultado = await consumirWIPYGenerarNecesidad({
        productoId: item.producto_id,
        cantidadVendida: Number(item.cantidad),
        empresaId: req.empresa.id
      });
      if (resultado.generado.length > 0) {
        produccionGenerada.push({
          producto: productoPorId.get(item.producto_id).nombre,
          procesos: resultado.generado.map(g => ({ nombre: g.nombre, cantidad: g.cantidad }))
        });
      }
    }

    res.status(201).json({
      ...venta,
      forzada: faltantes.length > 0,
      faltantes: faltantes.length > 0 ? faltantes : undefined,
      produccion_generada: produccionGenerada.length > 0 ? produccionGenerada : undefined,
      facturable: true
    });
  } catch (err) { next(err); }
});

// GET /api/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD&estado=...
router.get('/', async (req, res, next) => {
  try {
    let consulta = supabase
      .from('ventas')
      .select('*, ventas_items(id, producto_id, cantidad, cantidad_entregada, precio_unitario, costo_unitario, categoria, productos(nombre))')
      .eq('empresa_id', req.empresa.id)
      .order('fecha', { ascending: false })
      .limit(200);

    if (req.query.desde) consulta = consulta.gte('fecha', req.query.desde);
    if (req.query.hasta) consulta = consulta.lte('fecha', req.query.hasta + 'T23:59:59');
    if (req.query.estado && ESTADOS_VALIDOS.includes(req.query.estado))
      consulta = consulta.eq('estado', req.query.estado);

    const { data, error } = await consulta;
    if (error) throw new Error(error.message);

    // Se descifra solo aquí, en el momento de responder al usuario dueño
    // de estos datos (la ruta ya exige sesión y filtra por usuario_id).
    const conDatosDescifrados = (data || []).map(v => ({
      ...v,
      cliente_telefono: descifrar(v.cliente_telefono_cifrado),
      cliente_cedula: descifrar(v.cliente_cedula_cifrada),
      cliente_telefono_cifrado: undefined,
      cliente_cedula_cifrada: undefined
    }));
    res.json(conDatosDescifrados);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id/estado
router.put('/:id/estado', async (req, res, next) => {
  try {
    const { estado } = req.body;
    if (!ESTADOS_VALIDOS.includes(estado))
      return res.status(400).json({ error: `Estado inválido. Debe ser uno de: ${ESTADOS_VALIDOS.join(', ')}` });

    const { data, error } = await supabase
      .from('ventas')
      .update({ estado })
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa.id)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id/pago — cuerpo: { pagado: boolean }
// Independiente del estado de entrega — se puede marcar como pagado en
// cualquier punto de la secuencia pendiente/en_produccion/listo/entregado.
router.put('/:id/pago', async (req, res, next) => {
  try {
    const { pagado } = req.body;
    if (typeof pagado !== 'boolean')
      return res.status(400).json({ error: '"pagado" debe ser true o false' });

    const { data, error } = await supabase
      .from('ventas')
      .update({ pagado, fecha_pago: pagado ? new Date().toISOString() : null })
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa.id)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id/fecha-entrega — cuerpo: { fecha_entrega } (null para quitarla)
router.put('/:id/fecha-entrega', async (req, res, next) => {
  try {
    const { fecha_entrega } = req.body;
    const { data, error } = await supabase
      .from('ventas')
      .update({ fecha_entrega: fecha_entrega || null })
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa.id)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Venta no encontrada' });
    res.json(data);
  } catch (err) { next(err); }
});

// PUT /api/ventas/:id — edita datos de contacto/fecha, y OPCIONALMENTE
// los productos/cantidades (mandando "items" en el body).
// Si se mandan items, se recalcula el inventario de forma segura:
// se "revierte" el consumo de los items viejos y se aplica el de los
// nuevos, en un solo neto por material (no revierte todo y vuelve a
// consumir por separado, para no pasar por un estado intermedio raro).
// Bloqueado si la venta ya tiene factura generada — hay que anularla
// primero, porque una factura ya emitida no puede quedar desincronizada
// de lo que realmente se vendió.
router.put('/:id', async (req, res, next) => {
  try {
    const { cliente, cliente_telefono, cliente_cedula, fecha_entrega, items, forzar } = req.body;

    const cambiosVenta = {};
    if (cliente !== undefined) cambiosVenta.cliente = (cliente || '').trim() || null;
    if (cliente_telefono !== undefined) cambiosVenta.cliente_telefono_cifrado = cifrar(cliente_telefono);
    if (cliente_cedula !== undefined) cambiosVenta.cliente_cedula_cifrada = cifrar(cliente_cedula);
    if (fecha_entrega !== undefined) cambiosVenta.fecha_entrega = fecha_entrega || null;

    if (!Array.isArray(items) && Object.keys(cambiosVenta).length === 0)
      return res.status(400).json({ error: 'No se mandó ningún campo para editar' });

    // ---- Rama simple: solo contacto/fecha (comportamiento anterior) ----
    if (!Array.isArray(items)) {
      const { data, error } = await supabase
        .from('ventas')
        .update(cambiosVenta)
        .eq('id', req.params.id)
        .eq('empresa_id', req.empresa.id)
        .select().single();
      if (error) throw new Error(error.message);
      if (!data) return res.status(404).json({ error: 'Venta no encontrada' });

      return res.json({
        ...data,
        cliente_telefono: descifrar(data.cliente_telefono_cifrado),
        cliente_cedula: descifrar(data.cliente_cedula_cifrada),
        cliente_telefono_cifrado: undefined,
        cliente_cedula_cifrada: undefined
      });
    }

    // ---- Rama completa: también cambian productos/cantidades ----
    if (items.length === 0)
      return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
    for (const item of items) {
      if (!item.producto_id || !item.cantidad || Number(item.cantidad) <= 0)
        return res.status(400).json({ error: 'Cada producto de la venta necesita una cantidad mayor a 0' });
    }

    const { data: ventaActual, error: eGet } = await supabase
      .from('ventas').select('*, ventas_items(producto_id, cantidad)')
      .eq('id', req.params.id).eq('empresa_id', req.empresa.id).single();
    if (eGet || !ventaActual) return res.status(404).json({ error: 'Venta no encontrada' });

    const { data: facturasAsociadas, error: eFact } = await supabase
      .from('facturas').select('id, numero').eq('venta_id', req.params.id).eq('anulada', false);
    if (eFact) throw new Error(eFact.message);
    if (facturasAsociadas && facturasAsociadas.length > 0) {
      return res.status(400).json({
        error: `Esta venta ya tiene factura generada (${facturasAsociadas[0].numero || 'sin número'}). Anúlala primero para poder editar los productos.`
      });
    }

    const productoIds = items.map(i => i.producto_id);
    const { data: productos, error: eProd } = await supabase
      .from('productos')
      .select('id, nombre, precio_venta, costo_calculado, activo, categoria_id, categorias_productos(nombre)')
      .eq('empresa_id', req.empresa.id)
      .in('id', productoIds);
    if (eProd) throw new Error(eProd.message);
    const productoPorId = new Map((productos || []).map(p => [p.id, p]));
    for (const item of items) {
      const p = productoPorId.get(item.producto_id);
      if (!p) return res.status(404).json({ error: 'Uno de los productos ya no existe o no te pertenece' });
      if (!p.activo) return res.status(400).json({ error: `"${p.nombre}" está desactivado y no se puede vender` });
      if (!p.categoria_id) return res.status(400).json({ error: `"${p.nombre}" no tiene categoría asignada. Asígnale una en Productos antes de venderlo.` });
    }

    // Fichas técnicas de TODOS los productos involucrados (viejos + nuevos)
    // para poder revertir el consumo anterior y aplicar el nuevo.
    const idsProductosViejos = (ventaActual.ventas_items || []).map(i => i.producto_id);
    const idsUnion = [...new Set([...idsProductosViejos, ...productoIds])];

    // Los productos con procesos van por WIP, no por material directo
    // en la venta — editar cantidades ahí implicaría revertir/generar
    // WIP y encargos, algo que esta versión todavía no soporta. Se
    // bloquea con un mensaje claro en vez de dejar el WIP inconsistente.
    if (idsUnion.length > 0) {
      const { data: procesosActivos, error: eProcActivos } = await supabase
        .from('procesos')
        .select('producto_id')
        .eq('empresa_id', req.empresa.id)
        .eq('activo', true)
        .in('producto_id', idsUnion);
      if (eProcActivos) throw new Error(eProcActivos.message);
      const conStockEdicion = await idsConStock(idsUnion, req.empresa.id);
      if (procesosActivos && procesosActivos.some(p => !conStockEdicion.has(p.producto_id))) {
        return res.status(400).json({
          error: 'Esta venta incluye un producto con procesos (producción por etapas) — todavía no se puede editar productos/cantidades en ese caso. Elimínala y regístrala de nuevo con los datos correctos.'
        });
      }
    }

    const fichas = idsUnion.length ? await obtenerFichasEfectivasParaProductos(idsUnion, req.empresa.id) : [];

    // Lo ya descontado sale del HISTORIAL de esta venta (no de la ficha
    // actual). Ventas viejas sin historial: se usa la ficha, como antes.
    const conStockEd = await idsConStock(idsUnion, req.empresa.id);
    const requeridoNuevo = requeridoPorMaterialDe(items.filter(i => !conStockEd.has(i.producto_id)), fichas);
    const registrado = await libro.saldoRegistrado(req.empresa.id, req.params.id);
    const actualPorMaterial = new Map(registrado.materiales); // negativo = consumido
    if (!registrado.hayRegistro) {
      const viejosSinStock = (ventaActual.ventas_items || []).filter(i => !conStockEd.has(i.producto_id));
      for (const [id, { requerido }] of requeridoPorMaterialDe(viejosSinStock, fichas))
        actualPorMaterial.set(id, -requerido);
    }
    const ajuste = new Map(); // material_id -> { material, requerido } (requerido > 0 = consume más)
    for (const id of new Set([...actualPorMaterial.keys(), ...requeridoNuevo.keys()])) {
      const objetivo = -(requeridoNuevo.get(id)?.requerido || 0);
      const diferencia = objetivo - (actualPorMaterial.get(id) || 0); // negativo = sale más
      if (Math.abs(diferencia) < 0.00005) continue;
      ajuste.set(id, { material: requeridoNuevo.get(id)?.material, requerido: -diferencia });
    }

    let faltantes = [];
    const movimientos = libro.movimientosDeMateriales(ajuste, -1);
    // Productos terminados: objetivo = −unidades vendidas; se mueve la diferencia
    const objetivoProductos = unidadesPorProducto(items, conStockEd);
    for (const id of new Set([...registrado.productos.keys(), ...objetivoProductos.keys()])) {
      const diferencia = -(objetivoProductos.get(id) || 0) - (registrado.productos.get(id) || 0);
      if (Math.abs(diferencia) >= 0.00005) movimientos.push({ producto_id: id, cantidad: Math.round(diferencia * 10000) / 10000 });
    }
    if (movimientos.length > 0) {
      const operacion = await libro.aplicarOperacion({
        empresaId: req.empresa.id, usuarioId: req.usuarioId,
        tipo: 'venta_edicion', origenTabla: 'ventas', origenId: req.params.id,
        motivo: `Venta editada (${ventaActual.cliente || 'sin cliente'})`,
        clave: libro.claveDe(req, 'venta-edicion'),
        movimientos, permitirNegativo: !!forzar, detalleForzado: { confirmado: true }
      });
      if (!operacion.ok) {
        const deProductos = operacion.faltantes.filter(f => f.producto_id);
        if (deProductos.length > 0) return respuestaFaltanProductos(res, deProductos, req.empresa.id);
        return res.status(409).json({
          error: 'No hay material suficiente para estos cambios',
          faltantes: libro.faltantesLegibles(operacion.faltantes, libro.unidadesDe(requeridoNuevo)),
          puede_forzar: true
        });
      }
      if (operacion.forzada) faltantes = operacion.movimientos.filter(m => m.stock_nuevo < 0);
    }

    let total = 0, costoTotal = 0;
    const filasItemsNuevos = items.map(item => {
      const p = productoPorId.get(item.producto_id);
      const cantidad = Number(item.cantidad);
      total += Number(p.precio_venta) * cantidad;
      costoTotal += Number(p.costo_calculado) * cantidad;
      return {
        venta_id: req.params.id,
        producto_id: item.producto_id,
        cantidad,
        precio_unitario: Number(p.precio_venta),
        costo_unitario: Number(p.costo_calculado),
        categoria: p.categorias_productos ? p.categorias_productos.nombre : null
      };
    });
    total = Math.round(total * 100) / 100;
    costoTotal = Math.round(costoTotal * 100) / 100;

    const { error: eDelItems } = await supabase
      .from('ventas_items').delete().eq('venta_id', req.params.id);
    if (eDelItems) throw new Error(eDelItems.message);

    const { error: eInsItems } = await supabase.from('ventas_items').insert(filasItemsNuevos);
    if (eInsItems) throw new Error(eInsItems.message);

    const { data: ventaActualizada, error: eUpd } = await supabase
      .from('ventas')
      .update({ ...cambiosVenta, total, costo_total: costoTotal })
      .eq('id', req.params.id)
      .eq('empresa_id', req.empresa.id)
      .select().single();
    if (eUpd) throw new Error(eUpd.message);

    res.json({
      ...ventaActualizada,
      cliente_telefono: descifrar(ventaActualizada.cliente_telefono_cifrado),
      cliente_cedula: descifrar(ventaActualizada.cliente_cedula_cifrada),
      cliente_telefono_cifrado: undefined,
      cliente_cedula_cifrada: undefined,
      forzada: faltantes.length > 0
    });
  } catch (err) { next(err); }
});

// DELETE /api/ventas/:id — cuerpo: { motivo, forzar? }
// Devuelve el stock EXACTO que el historial dice que la venta movió
// (aunque la ficha haya cambiado), en una sola operación. Bloqueada si
// la venta tiene factura: borrar una venta facturada es un problema
// legal, no solo de inventario.
router.delete('/:id', async (req, res, next) => {
  try {
    const { motivo } = req.body;
    if (!motivo || !motivo.trim())
      return res.status(400).json({ error: 'Escribe el motivo de la eliminación (para trazabilidad)' });

    const { data: venta, error: eGet } = await supabase
      .from('ventas').select('*, ventas_items(producto_id, cantidad)')
      .eq('id', req.params.id).eq('empresa_id', req.empresa.id).single();
    if (eGet || !venta) return res.status(404).json({ error: 'Venta no encontrada' });

    // OJO: se revisa si existe CUALQUIER factura (aunque esté anulada),
    // no solo venta.facturada — porque la factura anulada NUNCA se borra
    // (para no perder el consecutivo) y la base de datos sigue
    // impidiendo el borrado mientras esa fila exista, sin importar su
    // estado. Anular libera la venta para editarla o facturarla de
    // nuevo, pero no para eliminarla.
    const { data: facturasAsociadas, error: eFact } = await supabase
      .from('facturas').select('id, numero, anulada').eq('venta_id', req.params.id);
    if (eFact) throw new Error(eFact.message);
    if (facturasAsociadas && facturasAsociadas.length > 0) {
      const numeros = facturasAsociadas.map(f => f.numero || '(sin número)').join(', ');
      return res.status(400).json({
        error: `Esta venta tiene factura(s) asociada(s) (${numeros}) — no se puede eliminar, ni siquiera si están anuladas, para conservar el historial contable. Sí puedes seguir editando sus datos de contacto.`
      });
    }

    // Los productos con procesos no descontaron material en la venta
    // (van por WIP) — se excluyen de esta reversión. Limitación
    // conocida: eliminar la venta NO revierte el WIP consumido ni
    // cancela los encargos que se hayan generado automáticamente; si
    // hace falta, revísalos a mano en Nóminas.
    const productoIds = (venta.ventas_items || []).map(i => i.producto_id);
    const { data: procesosActivos, error: eProcActivos } = await supabase
      .from('procesos')
      .select('producto_id')
      .eq('empresa_id', req.empresa.id)
      .eq('activo', true)
      .in('producto_id', productoIds.length ? productoIds : ['00000000-0000-0000-0000-000000000000']);
    if (eProcActivos) throw new Error(eProcActivos.message);
    const idsConProcesos = new Set((procesosActivos || []).map(p => p.producto_id));

    // Se devuelve EXACTO lo que el historial dice que esta venta movió.
    // Ventas viejas sin historial: se recalcula con la ficha, como antes.
    const registrado = await libro.saldoRegistrado(req.empresa.id, venta.id);
    const movimientos = [];
    for (const [id, saldo] of registrado.materiales) if (saldo) movimientos.push({ material_id: id, cantidad: -saldo });
    for (const [id, saldo] of registrado.productos) if (saldo) movimientos.push({ producto_id: id, cantidad: -saldo });
    if (!registrado.hayRegistro) {
      const itemsSinProcesos = (venta.ventas_items || []).filter(i => !idsConProcesos.has(i.producto_id));
      const fichas = itemsSinProcesos.length ? await obtenerFichasEfectivasParaProductos(itemsSinProcesos.map(i => i.producto_id), req.empresa.id) : [];
      movimientos.push(...libro.movimientosDeMateriales(requeridoPorMaterialDe(itemsSinProcesos, fichas), +1));
    }

    if (movimientos.length > 0) {
      const operacion = await libro.aplicarOperacion({
        empresaId: req.empresa.id, usuarioId: req.usuarioId,
        tipo: 'venta_eliminacion', origenTabla: 'ventas', origenId: venta.id,
        motivo: `Venta eliminada (${venta.cliente || 'sin cliente'}): ${motivo.trim()}`,
        clave: `venta-eliminacion:${venta.id}`,
        movimientos, permitirNegativo: !!req.body.forzar, detalleForzado: { confirmado: true }
      });
      if (!operacion.ok) {
        return res.status(409).json({
          error: 'Eliminar esta venta dejaría stock en negativo',
          faltantes: libro.faltantesLegibles(operacion.faltantes), puede_forzar: true
        });
      }
    }

    const { error: eDel } = await supabase
      .from('ventas').delete().eq('id', req.params.id).eq('empresa_id', req.empresa.id);
    if (eDel) throw new Error(eDel.message);

    res.json({ eliminada: true, stock_revertido: movimientos.length > 0 });
  } catch (err) { next(err); }
});

// GET /api/ventas/por-entregar — pedidos con fecha de entrega, aún no entregados,
// ordenados por fecha (los más urgentes primero). Lo usa también el dashboard.
router.get('/por-entregar', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('ventas')
      .select('id, cliente, fecha_entrega, estado, total, ventas_items(cantidad, productos(nombre))')
      .eq('empresa_id', req.empresa.id)
      .neq('estado', 'entregado')
      .not('fecha_entrega', 'is', null)
      .order('fecha_entrega', { ascending: true });
    if (error) throw new Error(error.message);

    const hoy = new Date().toISOString().slice(0, 10);
    const conUrgencia = (data || []).map(v => ({
      ...v,
      vencido: v.fecha_entrega < hoy,
      es_hoy: v.fecha_entrega === hoy
    }));
    res.json(conUrgencia);
  } catch (err) { next(err); }
});

// POST /api/ventas/:id/entregas — cuerpo: { fecha, items: [{ venta_item_id, cantidad }] }
// Registra UNA visita/entrega física: puede cubrir uno, varios, o todos
// los productos de la venta (no obliga a entregar todo a la vez). Todas
// las filas quedan amarradas con el mismo grupo_id, para poder ver e
// imprimir esa visita como un solo comprobante (ver entrega C).
router.post('/:id/entregas', async (req, res, next) => {
  try {
    const { fecha, items } = req.body;
    if (!fecha) return res.status(400).json({ error: 'La fecha de esta entrega es obligatoria' });
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'Elige al menos un producto para esta entrega' });

    const { data: venta, error: eVenta } = await supabase
      .from('ventas').select('id, ventas_items(id)').eq('id', req.params.id).eq('empresa_id', req.empresa.id).single();
    if (eVenta || !venta) return res.status(404).json({ error: 'Venta no encontrada' });

    const idsDeLaVenta = new Set((venta.ventas_items || []).map(i => i.id));
    for (const item of items) {
      if (!idsDeLaVenta.has(item.venta_item_id))
        return res.status(400).json({ error: 'Uno de los productos no pertenece a esta venta' });
    }

    const grupoId = randomUUID();
    const registradas = [];
    for (const item of items) {
      const resultado = await registrarEntrega({
        tipo: 'venta_item',
        referenciaId: item.venta_item_id,
        cantidad: item.cantidad,
        fecha,
        empresaId: req.empresa.id,
        grupoId
      });
      registradas.push(resultado.entrega);
    }

    res.status(201).json({ grupo_id: grupoId, entregas: registradas });
  } catch (err) { next(err); }
});

// GET /api/ventas/:id/entregas — historial de entregas de una venta,
// agrupado por visita (grupo_id) — cada grupo puede tener uno o varios productos.
router.get('/:id/entregas', async (req, res, next) => {
  try {
    const { data: venta, error: eVenta } = await supabase
      .from('ventas').select('id, ventas_items(id, producto_id, categoria, productos(nombre))').eq('id', req.params.id).eq('empresa_id', req.empresa.id).single();
    if (eVenta || !venta) return res.status(404).json({ error: 'Venta no encontrada' });

    // Nombre Y categoría de cada línea (la categoría es la que tenía el
    // producto al momento de la venta) — permite luego imprimir el
    // comprobante de la entrega agrupado por categoría o por producto.
    const infoPorItem = new Map((venta.ventas_items || []).map(i => [
      i.id,
      { nombre: i.productos ? i.productos.nombre : 'Producto', categoria: i.categoria || null }
    ]));
    const idsItems = (venta.ventas_items || []).map(i => i.id);
    if (idsItems.length === 0) return res.json([]);

    const { data: filas, error } = await supabase
      .from('entregas_parciales')
      .select('*')
      .eq('tipo', 'venta_item')
      .eq('empresa_id', req.empresa.id)
      .in('referencia_id', idsItems)
      .order('fecha', { ascending: false })
      .order('creado_en', { ascending: false });
    if (error) throw new Error(error.message);

    const porGrupo = new Map();
    for (const fila of filas || []) {
      const clave = fila.grupo_id || fila.id; // por si alguna quedó sin grupo
      if (!porGrupo.has(clave)) porGrupo.set(clave, { grupo_id: fila.grupo_id, fecha: fila.fecha, items: [] });
      const info = infoPorItem.get(fila.referencia_id) || {};
      porGrupo.get(clave).items.push({
        entrega_id: fila.id,
        venta_item_id: fila.referencia_id,
        producto: info.nombre || 'Producto',
        categoria: info.categoria || null,
        cantidad: Number(fila.cantidad)
      });
    }
    res.json([...porGrupo.values()]);
  } catch (err) { next(err); }
});

// DELETE /api/ventas/entregas/:id — borra UN registro puntual (corrección).
router.delete('/entregas/:id', async (req, res, next) => {
  try {
    const resultado = await eliminarEntrega(req.params.id, req.empresa.id);
    res.json(resultado);
  } catch (err) { next(err); }
});

// DELETE /api/ventas/entregas/grupo/:grupoId — borra TODA una visita
// (todos los productos que se entregaron juntos ese día) de una sola vez.
router.delete('/entregas/grupo/:grupoId', async (req, res, next) => {
  try {
    const { data: filas, error } = await supabase
      .from('entregas_parciales')
      .select('id')
      .eq('grupo_id', req.params.grupoId)
      .eq('empresa_id', req.empresa.id);
    if (error) throw new Error(error.message);
    if (!filas || filas.length === 0) return res.status(404).json({ error: 'Ese grupo de entregas no existe' });

    for (const fila of filas) {
      await eliminarEntrega(fila.id, req.empresa.id);
    }
    res.json({ eliminado: true, cantidad: filas.length });
  } catch (err) { next(err); }
});

module.exports = router;