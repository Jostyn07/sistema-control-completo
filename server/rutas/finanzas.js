// ============================================================
// MÓDULO 6 — FINANZAS Y PUNTO DE EQUILIBRIO  (/api/finanzas)
// Requiere sesión. Todo se filtra por req.usuarioId.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const { calcularRango } = require('../servicios/periodo');
const router = express.Router();

function inicioDeMes(fecha) {
  return new Date(fecha.getFullYear(), fecha.getMonth(), 1);
}
function claveMes(fecha) {
  const f = new Date(fecha);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, '0')}`;
}

async function obtenerCostosFijosMensuales(usuarioId) {
  const { data, error } = await supabase
    .from('costos_fijos').select('*').eq('usuario_id', usuarioId).eq('activo', true).order('nombre');
  if (error) throw new Error(error.message);
  const total = (data || []).reduce((s, c) => s + Number(c.valor_mensual), 0);
  return { lista: data || [], total: Math.round(total * 100) / 100 };
}

// GET /api/finanzas/resumen
router.get('/resumen', async (req, res, next) => {
  try {
    const ahora = new Date();
    const desdeMes = inicioDeMes(ahora).toISOString();

    const { data: ventasMes, error: eMes } = await supabase
      .from('ventas').select('total, costo_total').eq('usuario_id', req.usuarioId).gte('fecha', desdeMes);
    if (eMes) throw new Error(eMes.message);

    const ingresosMes = (ventasMes || []).reduce((s, v) => s + Number(v.total), 0);

    // Nómina pagada a colaboradores — lo que se confirma como "pagado" en
    // Nóminas es dinero real que sale del negocio, así que cuenta como
    // gasto variable en Finanzas (se suma al costo de lo vendido). Se usa
    // fecha_pago (cuándo se pagó), no fecha_entrega ni creado_en.
    const { data: nominaPagadaMes, error: eNominaMes } = await supabase
      .from('colaboradores_encargos')
      .select('costo_total_proceso')
      .eq('usuario_id', req.usuarioId)
      .eq('pagado', true)
      .gte('fecha_pago', desdeMes);
    if (eNominaMes) throw new Error(eNominaMes.message);
    const costosNominaMes = (nominaPagadaMes || []).reduce((s, e) => s + Number(e.costo_total_proceso), 0);

    // Meta de ventas y avance del mes en curso
    const { data: configProd, error: eConfigProd } = await supabase
      .from('configuracion_produccion').select('meta_ventas_mensual, fecha_inicio_operacion').eq('usuario_id', req.usuarioId).maybeSingle();
    if (eConfigProd) throw new Error(eConfigProd.message);
    const metaVentas = configProd && configProd.meta_ventas_mensual != null ? Number(configProd.meta_ventas_mensual) : null;
    const fechaInicioOperacion = configProd && configProd.fecha_inicio_operacion ? configProd.fecha_inicio_operacion : null;

    const diaActual = ahora.getDate();
    const diasEnMes = new Date(ahora.getFullYear(), ahora.getMonth() + 1, 0).getDate();
    const diasRestantesMes = diasEnMes - diaActual;
    const promedioDiario = diaActual > 0 ? ingresosMes / diaActual : 0;
    const proyeccionCierreMes = Math.round(promedioDiario * diasEnMes * 100) / 100;

    let avanceMetaPct = null, faltanteMeta = null, ritmoNecesarioDiario = null;
    if (metaVentas != null && metaVentas > 0) {
      avanceMetaPct = Math.round((ingresosMes / metaVentas) * 1000) / 10;
      faltanteMeta = Math.max(0, Math.round((metaVentas - ingresosMes) * 100) / 100);
      ritmoNecesarioDiario = diasRestantesMes > 0
        ? Math.round((faltanteMeta / diasRestantesMes) * 100) / 100
        : (faltanteMeta > 0 ? null : 0); // null = ya no quedan días y no se alcanzó
    }
    const costoVentasMes = (ventasMes || []).reduce((s, v) => s + Number(v.costo_total), 0);
    // "Costo de ventas" (ficha técnica) + nómina pagada = costos variables
    // totales del mes. Se mantienen separados como campos (costo_ventas_mes
    // vs costos_nomina_mes) para que el panel pueda mostrar cada uno, pero
    // toda la contabilidad de utilidad/equilibrio usa la suma de ambos.
    const costosVariablesMes = costoVentasMes + costosNominaMes;

    const costosFijos = await obtenerCostosFijosMensuales(req.usuarioId);
    const utilidadMes = ingresosMes - costosVariablesMes - costosFijos.total;

    // Estado de resultados en cascada: utilidad bruta (antes de fijos)
    // vs. utilidad operativa (después de fijos) — son problemas distintos:
    // si la bruta ya es mala, el problema está en precios/costo de producción;
    // si la bruta está bien pero la operativa no, el problema son los fijos.
    const utilidadBrutaMes = ingresosMes - costosVariablesMes;
    const margenBrutoPct = ingresosMes > 0 ? Math.round((utilidadBrutaMes / ingresosMes) * 1000) / 10 : null;
    const utilidadOperativaMes = utilidadBrutaMes - costosFijos.total;

    // Valor del inventario: cuánto dinero tienes inmovilizado en materiales
    // sin vender todavía (stock actual × costo unitario de cada uno).
    const { data: materialesInv, error: eInv } = await supabase
      .from('materiales').select('stock_actual, costo_unitario').eq('usuario_id', req.usuarioId).eq('activo', true);
    if (eInv) throw new Error(eInv.message);
    const valorInventario = (materialesInv || []).reduce(
      (s, m) => s + Number(m.stock_actual) * Number(m.costo_unitario), 0);

    // Compras del mes: dinero REAL gastado comprando materiales (por fecha
    // del pedido, sin importar si ya llegó). Es un número distinto al
    // "costo de lo vendido" de arriba: ese es lo que costó fabricar lo que
    // se VENDIÓ; esto es lo que salió del bolsillo comprando materiales,
    // se hayan usado ya o no. Ambos importan para entender el negocio.
    const { data: comprasMes, error: eComprasMes } = await supabase
      .from('compras').select('total').eq('usuario_id', req.usuarioId).gte('fecha', desdeMes);
    if (eComprasMes) throw new Error(eComprasMes.message);
    const comprasMesTotal = (comprasMes || []).reduce((s, c) => s + Number(c.total), 0);
    const flujoCajaMes = ingresosMes - comprasMesTotal - costosFijos.total - costosNominaMes;

    let puntoEquilibrio = null;
    let margenContribucion = null;
    let notaEquilibrio = null;
    if (ingresosMes > 0) {
      margenContribucion = (ingresosMes - costosVariablesMes) / ingresosMes;
      if (margenContribucion > 0) {
        puntoEquilibrio = Math.round((costosFijos.total / margenContribucion) * 100) / 100;
      } else {
        notaEquilibrio = 'El mix vendido este mes no deja margen de contribución positivo: se vende por debajo del costo variable.';
      }
    } else {
      notaEquilibrio = 'Aún no hay ventas este mes; el punto de equilibrio se calcula con el mix real de lo vendido.';
    }

    const { data: todasVentas, error: eTodas } = await supabase
      .from('ventas').select('total, costo_total, fecha').eq('usuario_id', req.usuarioId).order('fecha', { ascending: true });
    if (eTodas) throw new Error(eTodas.message);

    // Nómina pagada en TODA la historia (no solo este mes) — también sale
    // de la utilidad acumulada que alimenta el ROI, por la misma razón:
    // es dinero real que salió del negocio.
    const { data: nominaPagadaTotal, error: eNominaTotal } = await supabase
      .from('colaboradores_encargos')
      .select('costo_total_proceso')
      .eq('usuario_id', req.usuarioId)
      .eq('pagado', true);
    if (eNominaTotal) throw new Error(eNominaTotal.message);
    const costosNominaTotal = (nominaPagadaTotal || []).reduce((s, e) => s + Number(e.costo_total_proceso), 0);

    const margenAcumulado = (todasVentas || []).reduce((s, v) => s + (Number(v.total) - Number(v.costo_total)), 0)
      - costosNominaTotal;

    // Los meses para restar costos fijos se cuentan SIEMPRE desde la fecha
    // de inicio de operación que se configura en Finanzas — no desde la
    // primera venta (que puede no coincidir con cuándo arrancó el negocio)
    // ni desde el mes en curso. Así el ROI es un número total acumulado,
    // no algo que cambie según el mes en el que se consulte.
    let mesesTranscurridos = 0;
    let notaMesesRoi = null;
    if (fechaInicioOperacion) {
      const inicio = inicioDeMes(new Date(fechaInicioOperacion + 'T00:00:00'));
      const actual = inicioDeMes(ahora);
      mesesTranscurridos = Math.max(0, (actual.getFullYear() - inicio.getFullYear()) * 12
                                      + (actual.getMonth() - inicio.getMonth()) + 1);
    } else if (todasVentas && todasVentas.length > 0) {
      // Sin fecha configurada todavía: se usa la primera venta como antes,
      // para no dejar el ROI en cero de un momento a otro.
      const primera = inicioDeMes(new Date(todasVentas[0].fecha));
      const actual = inicioDeMes(ahora);
      mesesTranscurridos = (actual.getFullYear() - primera.getFullYear()) * 12
                          + (actual.getMonth() - primera.getMonth()) + 1;
      notaMesesRoi = 'Configura la fecha de inicio de operación en Finanzas para un ROI más exacto (por ahora se usa la fecha de tu primera venta).';
    }
    const utilidadAcumulada = margenAcumulado - costosFijos.total * mesesTranscurridos;

    const { data: capital, error: eCap } = await supabase
      .from('capital_invertido').select('valor').eq('usuario_id', req.usuarioId);
    if (eCap) throw new Error(eCap.message);
    const capitalTotal = (capital || []).reduce((s, c) => s + Number(c.valor), 0);

    let roiAcumulado = null;
    let notaRoi = null;
    if (capitalTotal > 0) {
      roiAcumulado = Math.round((utilidadAcumulada / capitalTotal) * 1000) / 10;
      notaRoi = notaMesesRoi;
    } else {
      notaRoi = 'Registra el capital invertido para calcular el ROI.';
    }

    res.json({
      mes: claveMes(ahora),
      ingresos_mes: Math.round(ingresosMes * 100) / 100,
      costos_variables_mes: Math.round(costosVariablesMes * 100) / 100,
      costos_fijos_mes: costosFijos.total,
      utilidad_mes: Math.round(utilidadMes * 100) / 100,
      costo_ventas_mes: Math.round(costoVentasMes * 100) / 100,
      costos_nomina_mes: Math.round(costosNominaMes * 100) / 100,
      utilidad_bruta_mes: Math.round(utilidadBrutaMes * 100) / 100,
      margen_bruto_pct: margenBrutoPct,
      utilidad_operativa_mes: Math.round(utilidadOperativaMes * 100) / 100,
      valor_inventario: Math.round(valorInventario * 100) / 100,
      meta_ventas_mensual: metaVentas,
      avance_meta_pct: avanceMetaPct,
      faltante_meta: faltanteMeta,
      dias_restantes_mes: diasRestantesMes,
      ritmo_necesario_diario: ritmoNecesarioDiario,
      proyeccion_cierre_mes: proyeccionCierreMes,
      compras_mes: Math.round(comprasMesTotal * 100) / 100,
      flujo_caja_mes: Math.round(flujoCajaMes * 100) / 100,
      margen_contribucion_ponderado: margenContribucion != null ? Math.round(margenContribucion * 1000) / 10 : null,
      punto_equilibrio: puntoEquilibrio,
      falta_para_equilibrio: puntoEquilibrio != null ? Math.max(0, Math.round((puntoEquilibrio - ingresosMes) * 100) / 100) : null,
      nota_equilibrio: notaEquilibrio,
      utilidad_acumulada: Math.round(utilidadAcumulada * 100) / 100,
      meses_operando: mesesTranscurridos,
      fecha_inicio_operacion: fechaInicioOperacion,
      capital_invertido: Math.round(capitalTotal * 100) / 100,
      roi_acumulado: roiAcumulado,
      nota_roi: notaRoi,
      ventas_del_mes: (ventasMes || []).length
    });
  } catch (err) { next(err); }
});

// GET /api/finanzas/costos-fijos
router.get('/costos-fijos', async (req, res, next) => {
  try {
    const costos = await obtenerCostosFijosMensuales(req.usuarioId);
    res.json(costos);
  } catch (err) { next(err); }
});

// POST /api/finanzas/costos-fijos — cuerpo: { id?, nombre, valor_mensual }
router.post('/costos-fijos', async (req, res, next) => {
  try {
    const { id, nombre, valor_mensual } = req.body;
    if (!nombre || !nombre.trim()) return res.status(400).json({ error: 'El nombre del costo es obligatorio' });
    if (valor_mensual == null || isNaN(valor_mensual) || Number(valor_mensual) < 0)
      return res.status(400).json({ error: 'El valor mensual debe ser un número mayor o igual a 0' });

    let resultado;
    if (id) {
      resultado = await supabase
        .from('costos_fijos')
        .update({ nombre: nombre.trim(), valor_mensual: Number(valor_mensual) })
        .eq('id', id)
        .eq('usuario_id', req.usuarioId)
        .select().single();
    } else {
      resultado = await supabase
        .from('costos_fijos')
        .insert({ usuario_id: req.usuarioId, nombre: nombre.trim(), valor_mensual: Number(valor_mensual) })
        .select().single();
    }
    if (resultado.error) throw new Error(resultado.error.message);
    res.status(id ? 200 : 201).json(resultado.data);
  } catch (err) { next(err); }
});

// DELETE /api/finanzas/costos-fijos/:id
router.delete('/costos-fijos/:id', async (req, res, next) => {
  try {
    const { error } = await supabase
      .from('costos_fijos').update({ activo: false }).eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);
    res.json({ desactivado: true });
  } catch (err) { next(err); }
});

// GET /api/finanzas/capital
router.get('/capital', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('capital_invertido').select('*').eq('usuario_id', req.usuarioId).order('fecha', { ascending: false });
    if (error) throw new Error(error.message);
    const total = (data || []).reduce((s, c) => s + Number(c.valor), 0);
    res.json({ lista: data || [], total: Math.round(total * 100) / 100 });
  } catch (err) { next(err); }
});

// POST /api/finanzas/capital
router.post('/capital', async (req, res, next) => {
  try {
    const { concepto, valor } = req.body;
    if (!concepto || !concepto.trim()) return res.status(400).json({ error: 'El concepto es obligatorio' });
    if (valor == null || isNaN(valor) || Number(valor) === 0)
      return res.status(400).json({ error: 'El valor debe ser un número distinto de 0' });

    const { data, error } = await supabase
      .from('capital_invertido')
      .insert({ usuario_id: req.usuarioId, concepto: concepto.trim(), valor: Number(valor) })
      .select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// GET /api/finanzas/historico-mensual?meses=N
router.get('/historico-mensual', async (req, res, next) => {
  try {
    const meses = Math.min(24, Math.max(1, Number(req.query.meses || 6)));
    const ahora = new Date();
    const desde = new Date(ahora.getFullYear(), ahora.getMonth() - (meses - 1), 1);

    const { data: ventas, error } = await supabase
      .from('ventas')
      .select('total, costo_total, fecha')
      .eq('usuario_id', req.usuarioId)
      .gte('fecha', desde.toISOString());
    if (error) throw new Error(error.message);

    const { data: compras, error: eCompras } = await supabase
      .from('compras')
      .select('total, fecha')
      .eq('usuario_id', req.usuarioId)
      .gte('fecha', desde.toISOString());
    if (eCompras) throw new Error(eCompras.message);

    // Nómina pagada por mes — misma razón que en /resumen: es un gasto
    // variable real, así que entra en costos totales, utilidad y flujo.
    const { data: nomina, error: eNomina } = await supabase
      .from('colaboradores_encargos')
      .select('costo_total_proceso, fecha_pago')
      .eq('usuario_id', req.usuarioId)
      .eq('pagado', true)
      .gte('fecha_pago', desde.toISOString());
    if (eNomina) throw new Error(eNomina.message);

    const costosFijos = await obtenerCostosFijosMensuales(req.usuarioId);

    const historico = [];
    for (let i = meses - 1; i >= 0; i--) {
      const mesFecha = new Date(ahora.getFullYear(), ahora.getMonth() - i, 1);
      const clave = claveMes(mesFecha);
      const ventasDelMes = (ventas || []).filter(v => claveMes(v.fecha) === clave);
      const comprasDelMes = (compras || []).filter(c => claveMes(c.fecha) === clave);
      const nominaDelMes = (nomina || []).filter(n => claveMes(n.fecha_pago) === clave);
      const ingresos = ventasDelMes.reduce((s, v) => s + Number(v.total), 0);
      const costoVentas = ventasDelMes.reduce((s, v) => s + Number(v.costo_total), 0);
      const nominaTotal = nominaDelMes.reduce((s, n) => s + Number(n.costo_total_proceso), 0);
      const variables = costoVentas + nominaTotal;
      const comprasTotal = comprasDelMes.reduce((s, c) => s + Number(c.total), 0);
      historico.push({
        mes: clave,
        ingresos: Math.round(ingresos * 100) / 100,
        costos_variables: Math.round(variables * 100) / 100,
        costos_nomina: Math.round(nominaTotal * 100) / 100,
        costos_fijos: costosFijos.total,
        costos_totales: Math.round((variables + costosFijos.total) * 100) / 100,
        utilidad: Math.round((ingresos - variables - costosFijos.total) * 100) / 100,
        compras: Math.round(comprasTotal * 100) / 100,
        flujo_caja: Math.round((ingresos - comprasTotal - costosFijos.total - nominaTotal) * 100) / 100
      });
    }

    res.json(historico);
  } catch (err) { next(err); }
});

// GET /api/finanzas/rentabilidad-productos — margen de cada producto,
// con lo REALMENTE vendido (no el margen teórico de la ficha técnica).
//
// Parámetros opcionales (los usa el dashboard de Inicio; Finanzas sigue
// llamando esta ruta SIN ningún parámetro, así que su comportamiento
// no cambió ni un poco):
//   ?periodo=7d|30d|mes|3m|6m|1y  (o &desde=&hasta=) — si no se manda
//     ninguno, se mantiene el comportamiento original exacto: mes en
//     curso hasta ahora, sin límite superior de fecha.
//   ?orden=margen|unidades|ingresos — default: margen (como siempre)
//   ?limite=N — Top N productos. Sin este parámetro, devuelve todos
//     (igual que siempre le ha devuelto a Finanzas).
router.get('/rentabilidad-productos', async (req, res, next) => {
  try {
    let desde, hasta;
    if (req.query.periodo || req.query.desde) {
      const rango = calcularRango(req.query);
      desde = rango.desde.toISOString();
      hasta = rango.hasta.toISOString();
    } else {
      desde = inicioDeMes(new Date()).toISOString();
      hasta = null;
    }

    let consulta = supabase
      .from('ventas_items')
      .select('cantidad, precio_unitario, costo_unitario, producto_id, productos(nombre), ventas!inner(fecha, usuario_id)')
      .eq('ventas.usuario_id', req.usuarioId)
      .gte('ventas.fecha', desde);
    if (hasta) consulta = consulta.lte('ventas.fecha', hasta);

    const { data: items, error } = await consulta;
    if (error) throw new Error(error.message);

    const porProducto = new Map();
    for (const item of items || []) {
      const id = item.producto_id;
      const previo = porProducto.get(id) || {
        producto_id: id,
        nombre: item.productos ? item.productos.nombre : 'Producto eliminado',
        unidades: 0, ingresos: 0, costo: 0
      };
      previo.unidades += Number(item.cantidad);
      previo.ingresos += Number(item.precio_unitario) * Number(item.cantidad);
      previo.costo += Number(item.costo_unitario) * Number(item.cantidad);
      porProducto.set(id, previo);
    }

    const margenTotal = [...porProducto.values()].reduce((s, p) => s + (p.ingresos - p.costo), 0);

    let lista = [...porProducto.values()].map(p => {
      const margen = Math.round((p.ingresos - p.costo) * 100) / 100;
      return {
        producto_id: p.producto_id,
        nombre: p.nombre,
        unidades: p.unidades,
        ingresos: Math.round(p.ingresos * 100) / 100,
        costo: Math.round(p.costo * 100) / 100,
        margen,
        margen_pct: p.ingresos > 0 ? Math.round((margen / p.ingresos) * 1000) / 10 : 0,
        porcentaje_del_margen_total: margenTotal > 0 ? Math.round((margen / margenTotal) * 1000) / 10 : 0
      };
    });

    const CAMPOS_ORDEN = { margen: 'margen', unidades: 'unidades', ingresos: 'ingresos' };
    const campoOrden = CAMPOS_ORDEN[req.query.orden] || 'margen';
    lista.sort((a, b) => b[campoOrden] - a[campoOrden]);

    const limite = Number(req.query.limite);
    if (limite > 0) lista = lista.slice(0, limite);

    res.json(lista);
  } catch (err) { next(err); }
});

// GET /api/finanzas/clientes — quién compra más, con qué frecuencia, y el
// ticket promedio. Es histórico completo (no solo del mes), porque para
// identificar clientes recurrentes hace falta ver todo el tiempo que llevas
// vendiendo, no solo lo último.
router.get('/clientes', async (req, res, next) => {
  try {
    const { data: ventas, error } = await supabase
      .from('ventas')
      .select('cliente, total, fecha')
      .eq('usuario_id', req.usuarioId)
      .order('fecha', { ascending: true });
    if (error) throw new Error(error.message);

    const porCliente = new Map();
    for (const v of ventas || []) {
      const nombre = (v.cliente && v.cliente.trim()) || 'Sin nombre registrado';
      const previo = porCliente.get(nombre) || { nombre, compras: 0, total: 0, primera: v.fecha, ultima: v.fecha };
      previo.compras += 1;
      previo.total += Number(v.total);
      if (v.fecha < previo.primera) previo.primera = v.fecha;
      if (v.fecha > previo.ultima) previo.ultima = v.fecha;
      porCliente.set(nombre, previo);
    }

    const lista = [...porCliente.values()].map(c => ({
      nombre: c.nombre,
      compras: c.compras,
      total_gastado: Math.round(c.total * 100) / 100,
      ticket_promedio: Math.round((c.total / c.compras) * 100) / 100,
      primera_compra: c.primera,
      ultima_compra: c.ultima,
      recurrente: c.compras > 1
    })).sort((a, b) => b.total_gastado - a.total_gastado);

    const totalClientes = lista.length;
    const recurrentes = lista.filter(c => c.recurrente).length;
    const totalGeneral = lista.reduce((s, c) => s + c.total_gastado, 0);
    const totalCompras = lista.reduce((s, c) => s + c.compras, 0);

    res.json({
      clientes: lista,
      resumen: {
        total_clientes: totalClientes,
        clientes_recurrentes: recurrentes,
        pct_recurrentes: totalClientes > 0 ? Math.round((recurrentes / totalClientes) * 1000) / 10 : 0,
        ticket_promedio_general: totalCompras > 0 ? Math.round((totalGeneral / totalCompras) * 100) / 100 : 0
      }
    });
  } catch (err) { next(err); }
});

module.exports = router;