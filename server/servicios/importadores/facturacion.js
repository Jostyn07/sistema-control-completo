// ============================================================
// IMPORTADOR — Facturación (server/servicios/importadores/facturacion.js)
// A propósito NO llama al proveedor de facturación electrónica ni
// genera un consecutivo nuevo — ver definiciones/facturacion.js para
// la razón. Solo:
//   - CONFIGURACION_FISCAL → guarda la config (mismas reglas que
//     valida POST /api/facturacion/configuracion).
//   - FACTURAS             → inserta un registro histórico y marca la
//     venta como facturada, sin tocar ningún consecutivo de la DIAN.
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerHoja } = require('../excel/lector');
const {
  HOJA_CONFIGURACION_FISCAL, HOJA_FACTURAS, COLUMNAS_CONFIGURACION_FISCAL, COLUMNAS_FACTURAS
} = require('../excel/definiciones/facturacion');
const { aTextoLimpio, aNumero, aFechaISO, requerido, numeroValido, fechaValida } = require('../excel/validador');

const CLAVE_CONFIG = new Map(COLUMNAS_CONFIGURACION_FISCAL.map((c) => [c.encabezado, c.clave]));
const CLAVE_FACTURAS = new Map(COLUMNAS_FACTURAS.map((c) => [c.encabezado, c.clave]));

function extraer(filaExcel, mapaClaves) {
  const datos = {};
  for (const [encabezado, clave] of mapaClaves) datos[clave] = filaExcel[encabezado];
  return datos;
}

// -------------------- 1. ANALIZAR --------------------
async function analizarFacturacion(buffer, usuarioId) {
  // ---- CONFIGURACION_FISCAL (a lo más una fila con datos) ----
  const filasConfigExcel = leerHoja(buffer, HOJA_CONFIGURACION_FISCAL, { opcional: true })
    .filter((f) => Object.values(f).some((v) => aTextoLimpio(v) !== '')); // ignora filas de ejemplo vacías
  const filasConfig = filasConfigExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_CONFIG);
    const tieneNit = aTextoLimpio(datos.nit) !== '';
    const tieneResolucion = aTextoLimpio(datos.resolucion_numero) !== '';

    const errores = [requerido(datos.razon_social, 'Razón social')].filter(Boolean);
    if (tieneResolucion) {
      if (!tieneNit) errores.push('Para tener Resolución número necesitas indicar el NIT');
      const eDesde = numeroValido(datos.resolucion_desde, 'Resolución desde', {});
      const eHasta = numeroValido(datos.resolucion_hasta, 'Resolución hasta', {});
      if (eDesde) errores.push(eDesde); else if (eHasta) errores.push(eHasta);
      else if (Number(aNumero(datos.resolucion_desde)) > Number(aNumero(datos.resolucion_hasta))) {
        errores.push('El "Resolución desde" no puede ser mayor que el "Resolución hasta"');
      }
      const eVig = fechaValida(datos.resolucion_vigencia, 'Resolución vigencia', { opcional: true });
      if (eVig) errores.push(eVig);
    }

    return { numero_fila: numeroFila, datos, tiene_nit: tieneNit, tiene_resolucion: tieneResolucion, errores };
  });
  if (filasConfig.length > 1) {
    for (const f of filasConfig) f.errores.push('Solo puede haber una fila de configuración fiscal en este archivo');
  }

  // ---- FACTURAS ----
  const filasFacturasExcel = leerHoja(buffer, HOJA_FACTURAS, { opcional: true });
  const { data: ventasExistentes, error: eVentas } = await supabase
    .from('ventas').select('id, codigo, facturada').eq('usuario_id', usuarioId).not('codigo', 'is', null);
  if (eVentas) throw new Error(eVentas.message);
  const ventasPorCodigo = new Map((ventasExistentes || []).map((v) => [v.codigo.toLowerCase(), v]));

  const { data: facturasExistentes, error: eFact } = await supabase
    .from('facturas').select('numero').eq('usuario_id', usuarioId);
  if (eFact) throw new Error(eFact.message);
  const numerosExistentes = new Set((facturasExistentes || []).map((f) => (f.numero || '').toLowerCase()).filter(Boolean));

  const numerosVistosEnArchivo = new Set();
  const codigosVentaVistos = new Set();
  const resumenFacturas = { validas: 0, errores: 0 };

  const filasFacturas = filasFacturasExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraer(filaExcel, CLAVE_FACTURAS);
    const numero = aTextoLimpio(datos.numero);
    const codigoVenta = aTextoLimpio(datos.codigo_venta);

    const errores = [
      requerido(datos.numero, 'Número factura'),
      requerido(datos.codigo_venta, 'Código venta'),
      fechaValida(datos.fecha, 'Fecha', { opcional: true })
    ].filter(Boolean);

    if (numero) {
      const clave = numero.toLowerCase();
      if (numerosExistentes.has(clave)) errores.push(`Ya existe una factura con el número "${numero}"`);
      else if (numerosVistosEnArchivo.has(clave)) errores.push(`El número "${numero}" está repetido dentro de este archivo`);
      numerosVistosEnArchivo.add(clave);
    }

    const venta = codigoVenta ? ventasPorCodigo.get(codigoVenta.toLowerCase()) : null;
    if (codigoVenta && !venta) errores.push(`La venta con código "${codigoVenta}" no existe`);
    else if (venta && venta.facturada) errores.push(`La venta "${codigoVenta}" ya tiene una factura generada`);
    else if (venta) {
      const clave = codigoVenta.toLowerCase();
      if (codigosVentaVistos.has(clave)) errores.push(`La venta "${codigoVenta}" aparece más de una vez en este archivo`);
      codigosVentaVistos.add(clave);
    }

    if (errores.length) resumenFacturas.errores++; else resumenFacturas.validas++;
    return { numero_fila: numeroFila, numero: numero || null, venta_id: venta ? venta.id : null, datos, errores };
  });

  return {
    modulo: 'facturacion',
    filas_configuracion_fiscal: filasConfig,
    resumen_facturas: resumenFacturas,
    filas_facturas: filasFacturas
  };
}

// -------------------- 2. IMPORTAR --------------------
async function importarFacturacion(usuarioId, reporte) {
  const resultado = { configuracion_guardada: false, facturas_registradas: 0, facturas_omitidas: 0 };

  const filaConfig = (reporte.filas_configuracion_fiscal || []).find((f) => !f.errores || f.errores.length === 0);
  if (filaConfig) {
    const datos = filaConfig.datos;
    const fila = {
      usuario_id: usuarioId,
      razon_social: aTextoLimpio(datos.razon_social),
      nit: filaConfig.tiene_nit ? aTextoLimpio(datos.nit) : null,
      regimen: filaConfig.tiene_nit ? (aTextoLimpio(datos.regimen) || null) : null,
      resolucion_numero: filaConfig.tiene_resolucion ? aTextoLimpio(datos.resolucion_numero) : null,
      resolucion_prefijo: filaConfig.tiene_resolucion ? (aTextoLimpio(datos.resolucion_prefijo) || null) : null,
      resolucion_desde: filaConfig.tiene_resolucion ? aNumero(datos.resolucion_desde) : null,
      resolucion_hasta: filaConfig.tiene_resolucion ? aNumero(datos.resolucion_hasta) : null,
      resolucion_vigencia: filaConfig.tiene_resolucion ? (aFechaISO(datos.resolucion_vigencia) || null) : null
    };
    const { error } = await supabase.from('configuracion_fiscal').upsert(fila);
    if (error) throw new Error(`Configuración fiscal: ${error.message}`);
    resultado.configuracion_guardada = true;
  }

  for (const fila of reporte.filas_facturas || []) {
    if (fila.errores && fila.errores.length) { resultado.facturas_omitidas++; continue; }
    const datos = fila.datos;
    const fecha = aFechaISO(datos.fecha) || new Date().toISOString().slice(0, 10);

    const { error: eFact } = await supabase.from('facturas').insert({
      usuario_id: usuarioId,
      venta_id: fila.venta_id,
      numero: fila.numero,
      cufe: aTextoLimpio(datos.cufe) || null,
      estado: aTextoLimpio(datos.estado) || 'historica',
      modo_visualizacion: 'individual',
      fecha
    });
    if (eFact) throw new Error(`Fila ${fila.numero_fila}: ${eFact.message}`);

    const { error: eVenta } = await supabase.from('ventas').update({ facturada: true }).eq('id', fila.venta_id).eq('usuario_id', usuarioId);
    if (eVenta) throw new Error(`Fila ${fila.numero_fila}: ${eVenta.message}`);

    resultado.facturas_registradas++;
  }

  return resultado;
}

module.exports = { analizarFacturacion, importarFacturacion };