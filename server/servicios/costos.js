// ============================================================
// SERVICIO DE COSTOS — server/servicios/costos.js
// Calcula el costo de un producto usando SIEMPRE el precio de hora
// global del usuario, nunca un valor guardado por producto.
//
// Un producto tiene DOS formas posibles de costearse (campo
// productos.usa_costeo_por_procesos):
//   - null  → sin resolver todavía (ver resolverModoCosteo)
//   - false → "por ficha técnica": productos_materiales + minutos × precio hora
//             (el modo de siempre — para productos sin procesos)
//   - true  → "por procesos": suma del costo de cada proceso activo
//             (mano de obra + materiales de ESE proceso). La pestaña
//             Materiales de la ficha técnica pasa a ser de solo lectura.
//
// procesos.costo_unitario = SOLO mano de obra (tiempo × precio hora).
// procesos.costo_materiales = materiales de ese proceso (aparte).
// Se mantienen separados porque costo_unitario también se usa para
// pagarle al colaborador en Nóminas — ahí NUNCA debe incluir material,
// solo lo que se le paga por su tiempo.
// ============================================================
const supabase = require('../supabase/cliente');

// Devuelve el costo por MINUTO (la config se guarda por hora, más natural para el usuario)
async function obtenerCostoMinutoManoObra(usuarioId) {
  const { data, error } = await supabase
    .from('configuracion_produccion')
    .select('costo_hora_mano_obra')
    .eq('usuario_id', usuarioId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  const costoHora = data ? Number(data.costo_hora_mano_obra) : 0;
  return costoHora / 60;
}

async function calcularCostoMateriales(materiales, usuarioId) {
  if (!materiales || materiales.length === 0) return 0;
  const ids = materiales.map(m => m.material_id);
  const { data: filas, error } = await supabase
    .from('materiales')
    .select('id, costo_unitario')
    .eq('usuario_id', usuarioId)
    .in('id', ids);
  if (error) throw new Error(error.message);

  const costoPorId = new Map(filas.map(m => [m.id, Number(m.costo_unitario)]));
  let total = 0;
  for (const m of materiales) {
    const costoUnitario = costoPorId.get(m.material_id);
    if (costoUnitario == null) throw new Error('Uno de los materiales no existe o no te pertenece');
    total += costoUnitario * Number(m.cantidad);
  }
  return total;
}

// Costo total de un producto en modo "por ficha técnica" = materiales
// directos + (minutos de fabricación × precio de hora global ÷ 60)
async function calcularCostoProducto({ materiales, minutosFabricacion, usuarioId }) {
  const costoMateriales = await calcularCostoMateriales(materiales, usuarioId);
  const costoMinuto = await obtenerCostoMinutoManoObra(usuarioId);
  const costoManoObra = Number(minutosFabricacion || 0) * costoMinuto;
  return Math.round((costoMateriales + costoManoObra) * 100) / 100;
}

// Recalcula y guarda procesos.costo_materiales de UN proceso a partir de
// su lista actual de procesos_materiales. Se llama cada vez que cambian
// los materiales de un proceso, o cuando cambia el costo de un material
// que algún proceso usa.
async function recalcularCostoMaterialesDeProceso(procesoId, usuarioId) {
  const { data: filas, error: eMat } = await supabase
    .from('procesos_materiales')
    .select('material_id, cantidad')
    .eq('proceso_id', procesoId);
  if (eMat) throw new Error(eMat.message);

  const costoMateriales = Math.round(
    await calcularCostoMateriales((filas || []).map(f => ({ material_id: f.material_id, cantidad: f.cantidad })), usuarioId) * 100
  ) / 100;

  const { error: eUpd } = await supabase
    .from('procesos')
    .update({ costo_materiales: costoMateriales })
    .eq('id', procesoId)
    .eq('usuario_id', usuarioId);
  if (eUpd) throw new Error(eUpd.message);

  return costoMateriales;
}

// Suma el tiempo (minutos) de todos los procesos activos de un producto.
async function obtenerMinutosDesdeProcesos(productoId) {
  const { data, error } = await supabase
    .from('procesos')
    .select('tiempo_minutos')
    .eq('producto_id', productoId)
    .eq('activo', true);
  if (error) throw new Error(error.message);
  return (data || []).reduce((s, p) => s + Number(p.tiempo_minutos || 0), 0);
}

// Decide (y si hace falta, resuelve) el modo de costeo de un producto:
//   - Si ya está resuelto (true/false), lo respeta.
//   - Si está sin resolver (null): sin materiales propios en la ficha
//     técnica → no hay conflicto posible, se resuelve solo en "por
//     procesos". Con materiales propios → se deja pendiente (aparece en
//     el reporte de conflictos) y, mientras tanto, se sigue costeando
//     "por ficha técnica" para no romper el número que el usuario ya
//     está viendo.
// Devuelve { modo: true|false, resuelto_ahora: boolean }.
async function resolverModoCosteo(producto, tieneProcesos) {
  if (producto.usa_costeo_por_procesos != null) {
    return { modo: producto.usa_costeo_por_procesos, resuelto_ahora: false };
  }
  if (!tieneProcesos) return { modo: false, resuelto_ahora: false };

  const { count, error } = await supabase
    .from('productos_materiales')
    .select('id', { count: 'exact', head: true })
    .eq('producto_id', producto.id);
  if (error) throw new Error(error.message);

  if (count === 0) return { modo: true, resuelto_ahora: true };
  return { modo: false, resuelto_ahora: false }; // pendiente — queda en el reporte de conflictos
}

// Recalcula minutos_fabricacion y costo_calculado de UN producto, y
// guarda el resultado. Se llama cada vez que se crea/edita/elimina un
// proceso de ese producto, o cuando cambia el costo de un material que
// afecta a ese producto (directo o vía procesos).
async function recalcularProductoDesdeSusProcesos(productoId, usuarioId) {
  const { data: producto, error: eProd } = await supabase
    .from('productos')
    .select('id, usa_costeo_por_procesos, minutos_fabricacion')
    .eq('id', productoId)
    .eq('usuario_id', usuarioId)
    .single();
  if (eProd || !producto) throw new Error('Producto no encontrado');

  const { data: procesos, error: eProc } = await supabase
    .from('procesos')
    .select('tiempo_minutos, costo_unitario, costo_materiales, repeticiones_por_unidad')
    .eq('producto_id', productoId)
    .eq('activo', true);
  if (eProc) throw new Error(eProc.message);

  const tieneProcesos = (procesos || []).length > 0;
  // Los minutos SOLO se recalculan desde los procesos cuando el
  // producto de verdad tiene procesos. Sin procesos, se respeta lo que
  // ya había guardado (mano de obra puesta a mano en la ficha técnica)
  // — antes esto se pisaba con 0 cada vez que esta función se llamaba
  // por cualquier motivo (ej: cambiar el precio de un material), y así
  // se perdía la mano de obra de productos que todavía no usan procesos.
  //
  // `repeticiones_por_unidad` es cuántas veces se repite ESE proceso
  // por cada unidad del producto terminado (ej: 12 pétalos por
  // girasol) — su tiempo/costo/material se cuenta esa misma cantidad
  // de veces al sumarlo a la ficha técnica.
  const minutosFabricacion = tieneProcesos
    ? (procesos || []).reduce((s, p) => s + Number(p.tiempo_minutos || 0) * Number(p.repeticiones_por_unidad || 1), 0)
    : Number(producto.minutos_fabricacion || 0);

  const { modo: usaCosteoPorProcesos, resuelto_ahora } =
    await resolverModoCosteo(producto, (procesos || []).length > 0);

  let costo;
  if (usaCosteoPorProcesos) {
    costo = Math.round(
      (procesos || []).reduce((s, p) =>
        s + (Number(p.costo_unitario || 0) + Number(p.costo_materiales || 0)) * Number(p.repeticiones_por_unidad || 1), 0
      ) * 100
    ) / 100;
  } else {
    const { data: filasMateriales, error: eMat } = await supabase
      .from('productos_materiales')
      .select('material_id, cantidad')
      .eq('producto_id', productoId);
    if (eMat) throw new Error(eMat.message);

    costo = await calcularCostoProducto({
      materiales: (filasMateriales || []).map(f => ({ material_id: f.material_id, cantidad: f.cantidad })),
      minutosFabricacion,
      usuarioId
    });
  }

  const cambios = {
    minutos_fabricacion: minutosFabricacion,
    costo_calculado: costo,
    actualizado_en: new Date().toISOString()
  };
  if (resuelto_ahora) cambios.usa_costeo_por_procesos = true;

  const { error: eUpd } = await supabase
    .from('productos')
    .update(cambios)
    .eq('id', productoId)
    .eq('usuario_id', usuarioId);
  if (eUpd) throw new Error(eUpd.message);

  return { minutos_fabricacion: minutosFabricacion, costo_calculado: costo, usa_costeo_por_procesos: usaCosteoPorProcesos };
}

// Recalcula TODOS los productos activos de un usuario (cuando cambia el
// precio de hora global — afecta a todos, tengan o no procesos).
async function recalcularTodosLosProductos(usuarioId) {
  const { data: productos, error } = await supabase
    .from('productos')
    .select('id')
    .eq('usuario_id', usuarioId)
    .eq('activo', true);
  if (error) throw new Error(error.message);

  let contador = 0;
  for (const producto of productos || []) {
    await recalcularProductoDesdeSusProcesos(producto.id, usuarioId);
    contador++;
  }
  return contador;
}

// Devuelve las filas de "material que necesita cada producto" listas
// para chequear/descontar stock, combinando los dos modos posibles:
//   - "por ficha técnica": productos_materiales tal cual
//   - "por procesos": procesos_materiales de sus procesos activos,
//     agregado por material (sumando lo que aparezca repetido en varios
//     procesos del mismo producto)
// Lo usa Ventas para no depender solo de productos_materiales — así el
// descuento de inventario funciona igual sin importar cómo se costeó
// el producto.
async function obtenerFichasEfectivasParaProductos(productoIds, usuarioId) {
  if (!productoIds || productoIds.length === 0) return [];
  const idsUnicos = [...new Set(productoIds)];

  const { data: productos, error: eProd } = await supabase
    .from('productos')
    .select('id, usa_costeo_por_procesos')
    .eq('usuario_id', usuarioId)
    .in('id', idsUnicos);
  if (eProd) throw new Error(eProd.message);

  const idsFicha = (productos || []).filter(p => !p.usa_costeo_por_procesos).map(p => p.id);
  const idsProcesos = (productos || []).filter(p => p.usa_costeo_por_procesos).map(p => p.id);

  const filas = [];

  if (idsFicha.length > 0) {
    const { data, error } = await supabase
      .from('productos_materiales')
      .select('producto_id, material_id, cantidad, materiales(id, nombre, unidad, stock_actual)')
      .in('producto_id', idsFicha);
    if (error) throw new Error(error.message);
    filas.push(...(data || []));
  }

  if (idsProcesos.length > 0) {
    const { data: procesos, error: eProc } = await supabase
      .from('procesos')
      .select('id, producto_id')
      .eq('usuario_id', usuarioId)
      .in('producto_id', idsProcesos)
      .eq('activo', true);
    if (eProc) throw new Error(eProc.message);
    const productoDeProceso = new Map((procesos || []).map(p => [p.id, p.producto_id]));
    const procesoIds = [...productoDeProceso.keys()];

    if (procesoIds.length > 0) {
      const { data: matsProcesos, error: eMatsP } = await supabase
        .from('procesos_materiales')
        .select('proceso_id, material_id, cantidad, materiales(id, nombre, unidad, stock_actual)')
        .in('proceso_id', procesoIds);
      if (eMatsP) throw new Error(eMatsP.message);

      const agregadas = new Map();
      for (const f of matsProcesos || []) {
        const productoId = productoDeProceso.get(f.proceso_id);
        const clave = productoId + '|' + f.material_id;
        const actual = agregadas.get(clave) || { producto_id: productoId, material_id: f.material_id, cantidad: 0, materiales: f.materiales };
        actual.cantidad += Number(f.cantidad);
        agregadas.set(clave, actual);
      }
      filas.push(...agregadas.values());
    }
  }

  return filas;
}

module.exports = {
  obtenerCostoMinutoManoObra,
  calcularCostoMateriales,
  calcularCostoProducto,
  recalcularCostoMaterialesDeProceso,
  obtenerMinutosDesdeProcesos,
  obtenerFichasEfectivasParaProductos,
  recalcularTodosLosProductos,
  recalcularProductoDesdeSusProcesos
};