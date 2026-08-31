// ============================================================
// SERVICIO DE PRODUCCIÓN — server/servicios/produccion.js
// Todo lo relacionado con el WIP (inventario en proceso) y con
// generar/consumir la cola de trabajo entre procesos de una ficha
// técnica. El WIP es un pool GLOBAL por producto+proceso — no se
// rastrea por venta individual (decisión tomada con el usuario).
//
// Dos momentos que usan este servicio:
//  1) Se registra una VENTA de un producto con procesos → si no hay
//     suficiente WIP terminado (último proceso), se genera solo la
//     cola de encargos que faltan, sin asignar a nadie todavía
//     (colaborador_id = null), en cascada hacia atrás por la ruta.
//  2) Se registra la ENTREGA de un encargo → se descuenta el material
//     de ESE proceso y se consume WIP del proceso anterior (si no es
//     el primero de la ruta); el resultado avanza el WIP de este
//     proceso.
//
// Límite conocido de esta versión: el WIP como "techo" para decidir
// cuánta cola nueva generar (paso 1) NO se reserva/bloquea en el
// momento — si dos ventas se registran casi al mismo tiempo, ambas
// podrían ver el mismo WIP disponible como techo. Para el volumen de
// un solo usuario esto es aceptable; si más adelante hay varios
// usuarios registrando ventas en simultáneo sobre el mismo negocio,
// habría que revisar esto.
// ============================================================
const supabase = require('../supabase/cliente');

// Procesos activos de un producto, en el orden de su ruta de
// producción. Los procesos sin `orden` asignado quedan al final (por
// fecha de creación) — es solo para que la lista se vea ordenada, NO
// para decidir dependencias entre etapas (ver procesoAnteriorDe).
async function obtenerRutaProcesos(productoId, usuarioId) {
  const { data, error } = await supabase
    .from('procesos')
    .select('id, nombre, orden, costo_unitario, repeticiones_por_unidad, procesos_materiales(material_id, cantidad, materiales(id, nombre, unidad, stock_actual))')
    .eq('producto_id', productoId)
    .eq('usuario_id', usuarioId)
    .eq('activo', true)
    .order('orden', { ascending: true, nullsFirst: false })
    .order('creado_en', { ascending: true });
  if (error) throw new Error(error.message);
  return data || [];
}

// Devuelve el proceso "anterior" a ruta[indice] SOLO si la dependencia
// es confiable: el proceso en cuestión tiene `orden` puesto Y existe,
// en algún punto anterior de la ruta, otro proceso que también tiene
// `orden` puesto. Si algo de esto falta, devuelve null — es decir, NO
// se le exige WIP de ninguna etapa anterior.
//
// Por qué: obtenerRutaProcesos ordena por fecha de creación cuando
// falta el `orden`, solo para que la lista se vea prolija. Usar esa
// fecha para decidir dependencias reales entre etapas es peligroso —
// un proceso creado antes que "Amasado" pero que en la vida real va
// DESPUÉS (ej: "Bolitas") haría que el sistema exija WIP de una etapa
// que en realidad no existe, bloqueando entregas que sí deberían pasar.
function procesoAnteriorDe(ruta, indice) {
  if (ruta[indice].orden == null) return null;
  for (let i = indice - 1; i >= 0; i--) {
    if (ruta[i].orden != null) return ruta[i];
  }
  return null;
}

// Mapa proceso_id -> cantidad en WIP, para un producto.
async function obtenerWIPPorProducto(productoId, usuarioId) {
  const { data, error } = await supabase
    .from('produccion_wip')
    .select('proceso_id, cantidad')
    .eq('producto_id', productoId)
    .eq('usuario_id', usuarioId);
  if (error) throw new Error(error.message);
  return new Map((data || []).map(f => [f.proceso_id, Number(f.cantidad)]));
}

// Suma (o resta, con delta negativo) cantidad al WIP de un
// producto+proceso. Nunca deja el WIP en negativo (se topa en 0).
async function ajustarWIP(productoId, procesoId, usuarioId, delta) {
  const { data: fila, error: eGet } = await supabase
    .from('produccion_wip')
    .select('id, cantidad')
    .eq('producto_id', productoId).eq('proceso_id', procesoId).eq('usuario_id', usuarioId)
    .maybeSingle();
  if (eGet) throw new Error(eGet.message);

  const actual = fila ? Number(fila.cantidad) : 0;
  const nuevo = Math.max(0, Math.round((actual + delta) * 10000) / 10000);

  if (fila) {
    const { error } = await supabase
      .from('produccion_wip')
      .update({ cantidad: nuevo, actualizado_en: new Date().toISOString() })
      .eq('id', fila.id);
    if (error) throw new Error(error.message);
  } else if (nuevo > 0) {
    const { error } = await supabase
      .from('produccion_wip')
      .insert({ usuario_id: usuarioId, producto_id: productoId, proceso_id: procesoId, cantidad: nuevo });
    if (error) throw new Error(error.message);
  }
  return nuevo;
}

// Suma de lo que ya está en cola (asignado o no) para un proceso
// puntual — para no generar trabajo duplicado si ya hay encargos
// pendientes de entregar.
async function obtenerPendienteEnCola(procesoId, usuarioId) {
  const { data, error } = await supabase
    .from('colaboradores_encargos')
    .select('cantidad_requerida, cantidad_entregada')
    .eq('proceso_id', procesoId)
    .eq('usuario_id', usuarioId);
  if (error) throw new Error(error.message);
  return (data || []).reduce((s, e) => s + Math.max(0, Number(e.cantidad_requerida) - Number(e.cantidad_entregada)), 0);
}

// `repeticiones_por_unidad` es cuántas veces se repite ESE proceso por
// cada 1 unidad del producto terminado (ej: 12 pétalos por girasol).
// Sin esto puesto, vale 1 (comportamiento de siempre).
function repeticiones(proceso) {
  return Number(proceso.repeticiones_por_unidad || 1);
}

// Cuánto WIP del proceso ANTERIOR consumen `delta` ejecuciones del
// proceso actual. Ambos números están en las unidades CRUDAS propias
// de cada proceso (ej: pétalos sueltos, girasoles armados) — se
// convierte pasando por "equivalente de producto final" en el medio:
//   equivalente = delta ÷ repeticiones(actual)
//   consumo     = equivalente × repeticiones(anterior)
// Ejemplo: 5 girasoles armados (Armado repite 1) consumen 5 × 12 = 60
// pétalos sueltos (Pétalo repite 12).
function wipAnteriorConsumidoPorDelta(delta, procesoActual, procesoAnterior) {
  const equivalenteFinal = delta / repeticiones(procesoActual);
  return equivalenteFinal * repeticiones(procesoAnterior);
}

// ---- 1) Al registrar una venta: genera la cola de lo que falta producir ----
// Devuelve { tomado_de_wip, faltante, generado: [{proceso_id, nombre, cantidad}] }
async function consumirWIPYGenerarNecesidad({ productoId, cantidadVendida, usuarioId }) {
  const ruta = await obtenerRutaProcesos(productoId, usuarioId);
  if (ruta.length === 0) {
    // Sin procesos: no hay nada que hacer aquí — este producto se
    // maneja con el flujo clásico de material directo en Ventas.
    return { tomado_de_wip: 0, faltante: 0, generado: [] };
  }

  const wip = await obtenerWIPPorProducto(productoId, usuarioId);
  const ultimoProceso = ruta[ruta.length - 1];
  const disponibleTerminado = wip.get(ultimoProceso.id) || 0;

  const tomado = Math.min(cantidadVendida, disponibleTerminado);
  if (tomado > 0) await ajustarWIP(productoId, ultimoProceso.id, usuarioId, -tomado);

  // Esta necesidad está siempre en "unidades de producto final
  // equivalentes" (girasoles, no pétalos) — se convierte a las
  // unidades crudas de cada proceso solo dentro del for, con su
  // propio `repeticiones_por_unidad`.
  let necesidadEquivalente = Math.round((cantidadVendida - tomado) * 10000) / 10000;
  const generado = [];

  if (necesidadEquivalente > 0) {
    // De atrás para adelante: cada etapa le pide a la anterior lo que
    // le falta, descontando primero lo que ya haya en cola pendiente
    // y lo que ya haya en WIP de la etapa anterior.
    for (let i = ruta.length - 1; i >= 0; i--) {
      const proceso = ruta[i];
      const rep = repeticiones(proceso);

      let necesidadEjecuciones = Math.round(necesidadEquivalente * rep * 10000) / 10000;

      const pendienteEnCola = await obtenerPendienteEnCola(proceso.id, usuarioId);
      const cubiertoPorCola = Math.min(necesidadEjecuciones, pendienteEnCola);
      necesidadEjecuciones = Math.round((necesidadEjecuciones - cubiertoPorCola) * 10000) / 10000;
      necesidadEquivalente = Math.round((necesidadEjecuciones / rep) * 10000) / 10000;
      if (necesidadEquivalente <= 0) break;

      const procesoAnterior = procesoAnteriorDe(ruta, i);
      let cubiertoConEntradaEquivalente;
      if (procesoAnterior) {
        const wipAnteriorDisponible = wip.get(procesoAnterior.id) || 0;
        const disponibleComoEquivalente = wipAnteriorDisponible / repeticiones(procesoAnterior);
        cubiertoConEntradaEquivalente = Math.min(necesidadEquivalente, disponibleComoEquivalente);
      } else {
        cubiertoConEntradaEquivalente = necesidadEquivalente; // primer proceso: no depende de nada
      }
      const cubiertoConEntradaEjecuciones = Math.round(cubiertoConEntradaEquivalente * rep * 10000) / 10000;

      if (cubiertoConEntradaEjecuciones > 0) {
        const { data: nuevoEncargo, error } = await supabase
          .from('colaboradores_encargos')
          .insert({
            usuario_id: usuarioId,
            colaborador_id: null, // sin asignar — aparece en Nóminas para asignarlo
            proceso_id: proceso.id,
            cantidad_requerida: cubiertoConEntradaEjecuciones,
            cantidad_entregada: 0,
            costo_unitario_proceso: Math.round(Number(proceso.costo_unitario)),
            costo_total_proceso: 0
          })
          .select('id').single();
        if (error) throw new Error(error.message);
        generado.push({ proceso_id: proceso.id, nombre: proceso.nombre, cantidad: cubiertoConEntradaEjecuciones, encargo_id: nuevoEncargo.id });
      }

      necesidadEquivalente = Math.round((necesidadEquivalente - cubiertoConEntradaEquivalente) * 10000) / 10000;
      if (necesidadEquivalente <= 0) break;
      // Lo que no alcanzó a cubrir el WIP de la etapa anterior sigue
      // propagándose hacia atrás en la siguiente vuelta del for.
    }
  }

  return { tomado_de_wip: tomado, faltante: Math.max(0, necesidadEquivalente), generado };
}

// ---- 2) Al registrar una entrega: descuenta material + avanza el WIP ----
// delta = cuánto AUMENTÓ cantidad_entregada respecto a lo que ya tenía
// (nunca se admite que baje — ver colaboradores.js).
async function registrarProduccionProceso({ procesoId, productoId, delta, usuarioId, encargoId, forzar }) {
  if (delta <= 0) return { faltantes: [] };

  const ruta = await obtenerRutaProcesos(productoId, usuarioId);
  const indice = ruta.findIndex(p => p.id === procesoId);
  const proceso = indice >= 0 ? ruta[indice] : null;
  if (!proceso) throw new Error('Este proceso ya no pertenece a la ruta activa de su ficha técnica');

  const faltantes = [];

  // a) Si no es el primer proceso de la ruta (y el orden está bien
  //    configurado), se descuenta del WIP del proceso anterior — la
  //    cantidad exacta depende de las repeticiones de cada uno (ver
  //    wipAnteriorConsumidoPorDelta).
  const procesoAnterior = procesoAnteriorDe(ruta, indice);
  let consumoWipAnterior = 0;
  if (procesoAnterior) {
    consumoWipAnterior = Math.round(wipAnteriorConsumidoPorDelta(delta, proceso, procesoAnterior) * 10000) / 10000;
    const wipAnteriorMapa = await obtenerWIPPorProducto(productoId, usuarioId);
    const disponible = wipAnteriorMapa.get(procesoAnterior.id) || 0;
    if (disponible < consumoWipAnterior) {
      faltantes.push({
        tipo: 'wip',
        proceso: procesoAnterior.nombre,
        disponible: Math.round(disponible * 10000) / 10000,
        requerido: consumoWipAnterior
      });
    }
  }

  // b) Materiales de ESTE proceso, multiplicados por delta.
  const requeridoPorMaterial = new Map();
  for (const fila of proceso.procesos_materiales || []) {
    const requerido = Number(fila.cantidad) * delta;
    requeridoPorMaterial.set(fila.material_id, { material: fila.materiales, requerido });
    if (Number(fila.materiales.stock_actual) < requerido) {
      faltantes.push({
        tipo: 'material',
        material: fila.materiales.nombre,
        unidad: fila.materiales.unidad,
        disponible: Number(fila.materiales.stock_actual),
        requerido: Math.round(requerido * 10000) / 10000
      });
    }
  }

  if (faltantes.length > 0 && !forzar) {
    return { faltantes };
  }

  // Todo listo (o forzado) — se aplican los movimientos.
  if (procesoAnterior) {
    await ajustarWIP(productoId, procesoAnterior.id, usuarioId, -consumoWipAnterior);
  }

  for (const [materialId, { material, requerido }] of requeridoPorMaterial) {
    const stockAnterior = Number(material.stock_actual);
    const stockNuevo = Math.max(0, Math.round((stockAnterior - requerido) * 100) / 100);
    const { error: eStock } = await supabase
      .from('materiales')
      .update({ stock_actual: stockNuevo, actualizado_en: new Date().toISOString() })
      .eq('id', materialId).eq('usuario_id', usuarioId);
    if (eStock) throw new Error(eStock.message);

    const { error: eMov } = await supabase.from('inventario_movimientos').insert({
      usuario_id: usuarioId,
      material_id: materialId,
      tipo: 'produccion',
      cantidad: -requerido,
      stock_anterior: stockAnterior,
      stock_nuevo: stockNuevo,
      referencia_id: encargoId
    });
    if (eMov) console.error('[inventario_movimientos] No se pudo registrar el movimiento de producción:', eMov.message);
  }

  await ajustarWIP(productoId, procesoId, usuarioId, delta);

  return { faltantes: forzar ? faltantes : [] };
}

// ---- 3) Al borrar un registro de entrega (corrección): revierte lo
// que esa entrega puntual había movido — devuelve el material, resta
// el WIP que este proceso había avanzado, y devuelve el WIP consumido
// de la etapa anterior. Es el inverso exacto de registrarProduccionProceso.
// Límite conocido: usa la receta ACTUAL del proceso, no la que tenía en
// el momento de esa entrega — misma convención que ya se usa en la
// reversión de stock de Ventas y Compras.
async function revertirProduccionProceso({ procesoId, productoId, delta, usuarioId, encargoId }) {
  if (delta <= 0) return;

  const ruta = await obtenerRutaProcesos(productoId, usuarioId);
  const indice = ruta.findIndex(p => p.id === procesoId);
  const proceso = indice >= 0 ? ruta[indice] : null;
  if (!proceso) return; // el proceso ya no existe en la ruta activa — no hay con qué revertir con precisión

  for (const fila of proceso.procesos_materiales || []) {
    const cantidad = Number(fila.cantidad) * delta;
    const stockAnterior = Number(fila.materiales.stock_actual);
    const stockNuevo = Math.round((stockAnterior + cantidad) * 100) / 100;
    const { error: eStock } = await supabase
      .from('materiales')
      .update({ stock_actual: stockNuevo, actualizado_en: new Date().toISOString() })
      .eq('id', fila.material_id).eq('usuario_id', usuarioId);
    if (eStock) throw new Error(eStock.message);

    const { error: eMov } = await supabase.from('inventario_movimientos').insert({
      usuario_id: usuarioId,
      material_id: fila.material_id,
      tipo: 'ajuste',
      cantidad,
      stock_anterior: stockAnterior,
      stock_nuevo: stockNuevo,
      referencia_id: encargoId
    });
    if (eMov) console.error('[inventario_movimientos] No se pudo registrar el movimiento de reversión:', eMov.message);
  }

  const procesoAnterior = procesoAnteriorDe(ruta, indice);
  if (procesoAnterior) {
    const consumoWipAnterior = Math.round(wipAnteriorConsumidoPorDelta(delta, proceso, procesoAnterior) * 10000) / 10000;
    await ajustarWIP(productoId, procesoAnterior.id, usuarioId, consumoWipAnterior);
  }
  await ajustarWIP(productoId, procesoId, usuarioId, -delta);
}

// ---- Listado para la pantalla de WIP en Inventario ----
async function obtenerWIPParaInventario(usuarioId) {
  const { data, error } = await supabase
    .from('produccion_wip')
    .select('cantidad, productos(id, nombre), procesos(id, nombre, orden)')
    .eq('usuario_id', usuarioId)
    .gt('cantidad', 0)
    .order('producto_id');
  if (error) throw new Error(error.message);
  return (data || []).map(f => ({
    producto_id: f.productos.id,
    producto: f.productos.nombre,
    proceso_id: f.procesos.id,
    proceso: f.procesos.nombre,
    orden: f.procesos.orden,
    cantidad: Number(f.cantidad)
  }));
}

module.exports = {
  obtenerRutaProcesos,
  obtenerWIPPorProducto,
  ajustarWIP,
  consumirWIPYGenerarNecesidad,
  registrarProduccionProceso,
  revertirProduccionProceso,
  obtenerWIPParaInventario
};