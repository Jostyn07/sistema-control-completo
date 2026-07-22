// ============================================================
// MÓDULO 7 — FACTURACIÓN ELECTRÓNICA  (/api/facturacion)
// Requiere sesión. Todo se filtra por req.usuarioId. La
// configuración fiscal ahora es una fila por usuario (antes era
// una fila única id=1), porque cada cuenta puede tener su propio
// RUT y resolución de numeración.
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const proveedor = require('../servicios/facturacion-proveedor');
const router = express.Router();

// GET /api/facturacion/configuracion
router.get('/configuracion', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('configuracion_fiscal').select('*').eq('usuario_id', req.usuarioId).maybeSingle();
    if (error) throw new Error(error.message);
    res.json(data || null);
  } catch (err) { next(err); }
});

// POST /api/facturacion/configuracion
router.post('/configuracion', async (req, res, next) => {
  try {
    const c = req.body;
    if (!c.razon_social || !c.razon_social.trim()) return res.status(400).json({ error: 'La razón social es obligatoria' });
    if (!c.nit || !c.nit.trim()) return res.status(400).json({ error: 'El NIT es obligatorio' });
    if (!c.resolucion_numero || !c.resolucion_numero.trim())
      return res.status(400).json({ error: 'El número de resolución de facturación es obligatorio' });
    if (c.resolucion_desde == null || c.resolucion_hasta == null || isNaN(c.resolucion_desde) || isNaN(c.resolucion_hasta))
      return res.status(400).json({ error: 'El rango de numeración (desde/hasta) es obligatorio' });
    if (Number(c.resolucion_desde) > Number(c.resolucion_hasta))
      return res.status(400).json({ error: 'El "desde" de la numeración no puede ser mayor que el "hasta"' });

    const fila = {
      usuario_id: req.usuarioId,
      razon_social: c.razon_social.trim(),
      nit: c.nit.trim(),
      regimen: (c.regimen || '').trim() || null,
      resolucion_numero: c.resolucion_numero.trim(),
      resolucion_prefijo: (c.resolucion_prefijo || '').trim() || null,
      resolucion_desde: Number(c.resolucion_desde),
      resolucion_hasta: Number(c.resolucion_hasta),
      resolucion_vigencia: c.resolucion_vigencia || null
    };
    const { data, error } = await supabase
      .from('configuracion_fiscal').upsert(fila).select().single();
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/facturacion/facturables
router.get('/facturables', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('ventas')
      .select('id, cliente, total, estado, fecha, ventas_items(cantidad, productos(nombre))')
      .eq('usuario_id', req.usuarioId)
      .eq('facturada', false)
      .order('fecha', { ascending: false })
      .limit(100);
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/facturacion/generar — cuerpo: { venta_id }
router.post('/generar', async (req, res, next) => {
  try {
    const { venta_id } = req.body;
    if (!venta_id) return res.status(400).json({ error: 'Falta indicar la venta' });

    const { data: config, error: eConf } = await supabase
      .from('configuracion_fiscal').select('*').eq('usuario_id', req.usuarioId).maybeSingle();
    if (eConf) throw new Error(eConf.message);
    if (!config) return res.status(400).json({
      error: 'Primero carga la configuración fiscal (datos del RUT y resolución de numeración).'
    });

    const { data: venta, error: eVenta } = await supabase
      .from('ventas').select('*').eq('id', venta_id).eq('usuario_id', req.usuarioId).single();
    if (eVenta || !venta) return res.status(404).json({ error: 'Venta no encontrada' });
    if (venta.facturada) return res.status(409).json({ error: 'Esta venta ya tiene factura generada' });

    const { count, error: eCount } = await supabase
      .from('facturas').select('id', { count: 'exact', head: true }).eq('usuario_id', req.usuarioId);
    if (eCount) throw new Error(eCount.message);

    const consecutivo = Number(config.resolucion_desde) + (count || 0);
    if (consecutivo > Number(config.resolucion_hasta)) {
      return res.status(409).json({
        error: `Se agotó el rango de numeración autorizado (${config.resolucion_desde}–${config.resolucion_hasta}). Solicita una nueva resolución a la DIAN y actualiza la configuración.`
      });
    }
    const numero = `${config.resolucion_prefijo || ''}${consecutivo}`;

    const emision = await proveedor.emitir({ venta, config, numero });

    const { data: factura, error: eFact } = await supabase
      .from('facturas')
      .insert({
        usuario_id: req.usuarioId,
        venta_id,
        numero,
        cufe: emision.cufe,
        pdf_url: emision.pdf_url,
        estado: emision.estado
      })
      .select().single();
    if (eFact) throw new Error(eFact.message);

    const { error: eMarca } = await supabase
      .from('ventas').update({ facturada: true }).eq('id', venta_id).eq('usuario_id', req.usuarioId);
    if (eMarca) throw new Error(eMarca.message);

    res.status(201).json({ ...factura, nota: emision.nota || null });
  } catch (err) { next(err); }
});

// GET /api/facturacion/historial
router.get('/historial', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('facturas')
      .select('*, ventas(cliente, total, fecha)')
      .eq('usuario_id', req.usuarioId)
      .order('fecha', { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// GET /api/facturacion/:id/detalle
router.get('/:id/detalle', async (req, res, next) => {
  try {
    const { data: factura, error: eFact } = await supabase
      .from('facturas')
      .select('*, ventas(id, cliente, total, costo_total, fecha, ventas_items(cantidad, precio_unitario, productos(nombre)))')
      .eq('id', req.params.id)
      .eq('usuario_id', req.usuarioId)
      .single();
    if (eFact || !factura) return res.status(404).json({ error: 'Factura no encontrada' });

    const { data: config, error: eConf } = await supabase
      .from('configuracion_fiscal').select('*').eq('usuario_id', req.usuarioId).maybeSingle();
    if (eConf) throw new Error(eConf.message);

    res.json({ factura, config });
  } catch (err) { next(err); }
});

module.exports = router;