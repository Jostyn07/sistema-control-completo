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
const { validarYLimpiarMetodosPago } = require('../servicios/metodosPago');
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
    if (!c.razon_social || !c.razon_social.trim()) return res.status(400).json({ error: 'El nombre es obligatorio' });

    const tieneNit = !!(c.nit && c.nit.trim());
    const tieneResolucion = !!(c.resolucion_numero && c.resolucion_numero.trim());

    if (tieneResolucion) {
      if (!tieneNit) return res.status(400).json({ error: 'Para tener resolución de facturación necesitas indicar el NIT' });
      if (c.resolucion_desde == null || c.resolucion_hasta == null || isNaN(c.resolucion_desde) || isNaN(c.resolucion_hasta))
        return res.status(400).json({ error: 'El rango de numeración (desde/hasta) es obligatorio' });
      if (Number(c.resolucion_desde) > Number(c.resolucion_hasta))
        return res.status(400).json({ error: 'El "desde" de la numeración no puede ser mayor que el "hasta"' });
    }

    // Métodos de pago para mostrar en la factura (todos opcionales):
    // hasta 5, cada uno con tipo (cuenta/llave/nequi) y su valor.
    const { error: errorMetodos, limpios: metodosPagoLimpios } = validarYLimpiarMetodosPago(c.metodos_pago);
    if (errorMetodos) return res.status(400).json({ error: errorMetodos });

    // El NIT puede existir SIN resolución (persona natural con RUT que aún
    // no tramita una resolución de numeración ante la DIAN) — en ese caso
    // se generan recibos internos igual, pero mostrando el NIT.
    const fila = {
      usuario_id: req.usuarioId,
      razon_social: c.razon_social.trim(),
      nit: tieneNit ? c.nit.trim() : null,
      regimen: tieneNit ? ((c.regimen || '').trim() || null) : null,
      resolucion_numero: tieneResolucion ? c.resolucion_numero.trim() : null,
      resolucion_prefijo: tieneResolucion ? ((c.resolucion_prefijo || '').trim() || null) : null,
      resolucion_desde: tieneResolucion ? Number(c.resolucion_desde) : null,
      resolucion_hasta: tieneResolucion ? Number(c.resolucion_hasta) : null,
      resolucion_vigencia: tieneResolucion ? (c.resolucion_vigencia || null) : null,
      nombre_persona: (c.nombre_persona || '').trim() || null,
      cedula: (c.cedula || '').trim() || null,
      metodos_pago: metodosPagoLimpios
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

// POST /api/facturacion/generar — cuerpo: { venta_id, modo }
// "modo": 'individual' (por defecto) o 'categorias' — lo decide quien
// factura, según cómo lo pida el cliente. Queda guardado en la factura.
router.post('/generar', async (req, res, next) => {
  try {
    const { venta_id, modo } = req.body;
    if (!venta_id) return res.status(400).json({ error: 'Falta indicar la venta' });
    const modoVisualizacion = modo === 'categorias' ? 'categorias' : 'individual';

    const { data: config, error: eConf } = await supabase
      .from('configuracion_fiscal').select('*').eq('usuario_id', req.usuarioId).maybeSingle();
    if (eConf) throw new Error(eConf.message);
    if (!config) return res.status(400).json({
      error: 'Primero carga la configuración del negocio (al menos el nombre; el RUT es opcional).'
    });

    const { data: venta, error: eVenta } = await supabase
      .from('ventas').select('*').eq('id', venta_id).eq('usuario_id', req.usuarioId).single();
    if (eVenta || !venta) return res.status(404).json({ error: 'Venta no encontrada' });
    if (venta.facturada) return res.status(409).json({ error: 'Esta venta ya tiene factura generada' });

    const { count, error: eCount } = await supabase
      .from('facturas').select('id', { count: 'exact', head: true }).eq('usuario_id', req.usuarioId);
    if (eCount) throw new Error(eCount.message);

    const tieneResolucion = !!config.resolucion_numero;
    let numero, emision;

    if (tieneResolucion) {
      const consecutivo = Number(config.resolucion_desde) + (count || 0);
      if (consecutivo > Number(config.resolucion_hasta)) {
        return res.status(409).json({
          error: `Se agotó el rango de numeración autorizado (${config.resolucion_desde}–${config.resolucion_hasta}). Solicita una nueva resolución a la DIAN y actualiza la configuración.`
        });
      }
      numero = `${config.resolucion_prefijo || ''}${consecutivo}`;
      emision = await proveedor.emitir({ venta, config, numero });
    } else {
      // Sin resolución (sin RUT, o con RUT como persona natural sin
      // resolución todavía) se genera un recibo interno con numeración
      // propia, sin validez fiscal ante la DIAN.
      numero = `REC-${(count || 0) + 1}`;
      emision = { cufe: null, pdf_url: null, estado: 'recibo_interno' };
    }

    const { data: factura, error: eFact } = await supabase
      .from('facturas')
      .insert({
        usuario_id: req.usuarioId,
        venta_id,
        numero,
        cufe: emision.cufe,
        pdf_url: emision.pdf_url,
        estado: emision.estado,
        modo_visualizacion: modoVisualizacion
      })
      .select().single();
    if (eFact) throw new Error(eFact.message);

    const { error: eMarca } = await supabase
      .from('ventas').update({ facturada: true }).eq('id', venta_id).eq('usuario_id', req.usuarioId);
    if (eMarca) throw new Error(eMarca.message);

    res.status(201).json({ ...factura, nota: emision.nota || null });
  } catch (err) { next(err); }
});

// POST /api/facturacion/:id/anular — cuerpo: { motivo }
// La factura NUNCA se borra (el consecutivo autorizado no se puede
// reutilizar) — solo se marca como anulada. Libera la venta
// (facturada: false) para poder editarla o generar una factura nueva
// si hace falta corregir algo. NO habilita eliminar la venta: mientras
// esta factura (anulada o no) siga existiendo, la restricción de la
// base de datos (facturas_venta_id_fkey) sigue impidiendo el borrado —
// ver el guard equivalente en DELETE /api/ventas/:id.
router.post('/:id/anular', async (req, res, next) => {
  try {
    const { motivo } = req.body;
    if (!motivo || !motivo.trim())
      return res.status(400).json({ error: 'Escribe el motivo de la anulación (para trazabilidad)' });

    const { data: factura, error: eGet } = await supabase
      .from('facturas').select('*').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !factura) return res.status(404).json({ error: 'Factura no encontrada' });
    if (factura.anulada) return res.status(400).json({ error: 'Esta factura ya está anulada' });

    const { data: actualizada, error: eUpd } = await supabase
      .from('facturas')
      .update({ anulada: true, motivo_anulacion: motivo.trim(), fecha_anulacion: new Date().toISOString() })
      .eq('id', req.params.id).eq('usuario_id', req.usuarioId)
      .select().single();
    if (eUpd) throw new Error(eUpd.message);

    const { error: eVenta } = await supabase
      .from('ventas').update({ facturada: false }).eq('id', factura.venta_id).eq('usuario_id', req.usuarioId);
    if (eVenta) throw new Error(eVenta.message);

    res.json(actualizada);
  } catch (err) { next(err); }
});

// DELETE /api/facturacion/:id — borra la factura DE VERDAD (no la
// marca, la quita). Solo se permite si ya estaba anulada — nunca se
// puede saltar directo de "generada" a "borrada" sin pasar por anular
// primero. Deja un hueco en la numeración del consecutivo: aceptable
// mientras estés en "Modo interno" (sin CUFE real ante la DIAN), pero
// en cuanto conectes el proveedor tecnológico esto deja de ser
// recomendable — un hueco en un consecutivo YA validado ante la DIAN
// es un problema real, no solo estético.
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: factura, error: eGet } = await supabase
      .from('facturas').select('id, anulada').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !factura) return res.status(404).json({ error: 'Factura no encontrada' });
    if (!factura.anulada)
      return res.status(400).json({ error: 'Primero tienes que anularla — no se puede borrar una factura activa directamente.' });

    const { error: eDel } = await supabase
      .from('facturas').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (eDel) throw new Error(eDel.message);

    res.json({ eliminada: true });
  } catch (err) { next(err); }
});

// PUT /api/facturacion/:id/modo — cuerpo: { modo: 'individual' | 'categorias' }
// Cambia cómo se ve/imprime la factura sin tocar números, CUFE ni
// numeración — es solo el formato de presentación de las líneas.
router.put('/:id/modo', async (req, res, next) => {
  try {
    const modo = req.body.modo === 'categorias' ? 'categorias' : 'individual';
    const { data, error } = await supabase
      .from('facturas')
      .update({ modo_visualizacion: modo })
      .eq('id', req.params.id).eq('usuario_id', req.usuarioId)
      .select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Factura no encontrada' });
    res.json(data);
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
      .select('*, ventas(id, cliente, total, costo_total, fecha, ventas_items(cantidad, precio_unitario, categoria, productos(nombre)))')
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