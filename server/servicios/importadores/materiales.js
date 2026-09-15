// ============================================================
// IMPORTADOR — Materiales (server/servicios/importadores/materiales.js)
// Dos pasos, igual que en el resto de la plataforma:
//
//   1. analizarMateriales(buffer, usuarioId)
//      Lee el Excel y VALIDA cada fila, pero no toca la base de
//      datos. Devuelve un reporte fila por fila (para previsualizar)
//      con un resumen (nuevos / actualizados / sin cambios /
//      advertencias / errores).
//
//   2. importarMateriales(usuarioId, filas, modo)
//      Recibe las filas que ya devolvió analizarMateriales() (el
//      usuario las vio y confirmó) y ahí sí crea/actualiza en la
//      base de datos. Las filas con error NUNCA se importan.
//
// El "Código" (MAT001, MAT002...) es lo que decide si una fila crea
// un material nuevo o actualiza uno existente. Si no viene código,
// se intenta encontrar el material por nombre (mismo criterio que
// usaría una persona llenando el Excel a mano); si tampoco hay
// coincidencia, se crea uno nuevo y se le asigna un código.
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerFilas } = require('../excel/lector');
const { COLUMNAS } = require('../excel/definiciones/materiales');
const { aTextoLimpio, aNumero, aBooleanoSiNo, requerido, numeroValido, siNoValido } = require('../excel/validador');
const { recalcularProductosQueUsanMaterial } = require('../costos');

// Mapa encabezado de Excel -> clave interna (usa la misma definición
// que el exportador, así ambos quedan sincronizados automáticamente).
const CLAVE_POR_ENCABEZADO = new Map(COLUMNAS.map((c) => [c.encabezado, c.clave]));

function extraerDatos(filaExcel) {
  const datos = {};
  for (const [encabezado, clave] of CLAVE_POR_ENCABEZADO) {
    datos[clave] = filaExcel[encabezado];
  }
  return datos;
}

function validarFila(datos) {
  const errores = [];
  const posible = [
    requerido(datos.nombre, 'Nombre'),
    requerido(datos.unidad, 'Unidad'),
    numeroValido(datos.costo_unitario, 'Costo unitario', { minimo: 0 }),
    requerido(datos.proveedor, 'Proveedor'),
    numeroValido(datos.tiempo_entrega_dias, 'Tiempo entrega (días)', { minimo: 0, opcional: true }),
    numeroValido(datos.stock_actual, 'Stock actual', { minimo: 0, opcional: true }),
    numeroValido(datos.stock_seguridad, 'Stock de seguridad', { minimo: 0, opcional: true }),
    siNoValido(datos.activo, 'Activo', { opcional: true })
  ];
  for (const error of posible) if (error) errores.push(error);
  return errores;
}

async function obtenerMaterialesExistentes(usuarioId) {
  const { data, error } = await supabase
    .from('materiales')
    .select('id, codigo, nombre, costo_unitario, stock_actual')
    .eq('usuario_id', usuarioId);
  if (error) throw new Error(error.message);

  const porCodigo = new Map();
  const porNombre = new Map();
  for (const material of data || []) {
    if (material.codigo) porCodigo.set(material.codigo.toLowerCase(), material);
    porNombre.set(material.nombre.toLowerCase(), material);
  }
  return { porCodigo, porNombre };
}

async function siguienteCodigoDisponible(usuarioId) {
  const { data, error } = await supabase
    .from('materiales')
    .select('codigo')
    .eq('usuario_id', usuarioId)
    .not('codigo', 'is', null)
    .like('codigo', 'MAT%');
  if (error) throw new Error(error.message);

  let maximo = 0;
  for (const fila of data || []) {
    const numero = parseInt(String(fila.codigo).replace(/^MAT/i, ''), 10);
    if (!isNaN(numero) && numero > maximo) maximo = numero;
  }
  return maximo + 1;
}

// -------------------- 1. ANALIZAR (solo lectura) --------------------
async function analizarMateriales(buffer, usuarioId) {
  const filasExcel = leerFilas(buffer);
  const { porCodigo, porNombre } = await obtenerMaterialesExistentes(usuarioId);
  const codigosVistosEnArchivo = new Set();

  const resumen = { nuevos: 0, actualizados: 0, sin_cambios: 0, advertencias: 0, errores: 0 };

  const filas = filasExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2; // fila 1 = encabezados; Excel cuenta desde 1
    const datos = extraerDatos(filaExcel);
    const codigo = aTextoLimpio(datos.codigo) || null;

    const errores = validarFila(datos);
    const advertencias = [];

    if (codigo) {
      const codigoNorm = codigo.toLowerCase();
      if (codigosVistosEnArchivo.has(codigoNorm)) {
        errores.push(`El código "${codigo}" está repetido dentro de este archivo`);
      }
      codigosVistosEnArchivo.add(codigoNorm);
    }

    const existente = (codigo && porCodigo.get(codigo.toLowerCase()))
      || (datos.nombre && porNombre.get(aTextoLimpio(datos.nombre).toLowerCase()))
      || null;

    let accion = existente ? 'actualizar' : 'crear';

    const stockActualNuevo = aNumero(datos.stock_actual);
    if (existente && stockActualNuevo != null && Number(stockActualNuevo) !== Number(existente.stock_actual)) {
      advertencias.push(
        'El Stock actual no se actualiza desde aquí (usa Inventario para registrar entradas, salidas o ajustes); se ignorará ese valor.'
      );
    }

    if (existente && errores.length === 0) {
      const sinCambios =
        aTextoLimpio(datos.nombre).toLowerCase() === existente.nombre.toLowerCase() &&
        Number(aNumero(datos.costo_unitario)) === Number(existente.costo_unitario);
      if (sinCambios) accion = 'sin_cambios';
    }

    if (errores.length) resumen.errores++;
    else if (advertencias.length) resumen.advertencias++;
    if (accion === 'crear') resumen.nuevos++;
    else if (accion === 'actualizar') resumen.actualizados++;
    else resumen.sin_cambios++;

    return {
      numero_fila: numeroFila,
      codigo,
      datos,
      accion, // 'crear' | 'actualizar' | 'sin_cambios'
      material_id: existente ? existente.id : null,
      costo_anterior: existente ? existente.costo_unitario : null,
      errores,
      advertencias
    };
  });

  return { modulo: 'materiales', total_filas: filas.length, resumen, filas };
}

// -------------------- 2. IMPORTAR (escribe en la base) --------------------
// modo: 'crear_solamente' | 'actualizar_solamente' | 'crear_y_actualizar'
async function importarMateriales(usuarioId, filas, modo = 'crear_y_actualizar') {
  let siguienteConsecutivo = null;
  const resultado = { creados: 0, actualizados: 0, sin_cambios: 0, omitidos: 0 };

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }
    if (fila.accion === 'sin_cambios') { resultado.sin_cambios++; continue; }
    if (fila.accion === 'crear' && modo === 'actualizar_solamente') { resultado.omitidos++; continue; }
    if (fila.accion === 'actualizar' && modo === 'crear_solamente') { resultado.omitidos++; continue; }

    const datos = fila.datos;

    if (fila.accion === 'crear') {
      let codigo = fila.codigo;
      if (!codigo) {
        if (siguienteConsecutivo == null) siguienteConsecutivo = await siguienteCodigoDisponible(usuarioId);
        codigo = `MAT${String(siguienteConsecutivo).padStart(3, '0')}`;
        siguienteConsecutivo++;
      }
      const nuevo = {
        usuario_id: usuarioId,
        codigo,
        nombre: aTextoLimpio(datos.nombre),
        unidad: aTextoLimpio(datos.unidad),
        costo_unitario: aNumero(datos.costo_unitario),
        proveedor: aTextoLimpio(datos.proveedor),
        tiempo_entrega_dias: aNumero(datos.tiempo_entrega_dias) ?? 1,
        stock_actual: aNumero(datos.stock_actual) ?? 0,
        stock_seguridad: aNumero(datos.stock_seguridad) ?? 0,
        activo: aBooleanoSiNo(datos.activo) ?? true
      };
      const { error } = await supabase.from('materiales').insert(nuevo);
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
      resultado.creados++;
    } else if (fila.accion === 'actualizar') {
      const costoNuevo = aNumero(datos.costo_unitario);
      const costoCambio = Number(fila.costo_anterior) !== Number(costoNuevo);

      const cambios = {
        nombre: aTextoLimpio(datos.nombre),
        unidad: aTextoLimpio(datos.unidad),
        costo_unitario: costoNuevo,
        proveedor: aTextoLimpio(datos.proveedor),
        tiempo_entrega_dias: aNumero(datos.tiempo_entrega_dias) ?? 1,
        stock_seguridad: aNumero(datos.stock_seguridad) ?? 0,
        activo: aBooleanoSiNo(datos.activo) ?? true,
        actualizado_en: new Date().toISOString()
        // stock_actual NUNCA se toca desde aquí — ver advertencia del importador.
      };
      const { error } = await supabase
        .from('materiales').update(cambios).eq('id', fila.material_id).eq('usuario_id', usuarioId);
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);

      if (costoCambio) {
        const { error: eHist } = await supabase.from('materiales_historial_precio').insert({
          usuario_id: usuarioId,
          material_id: fila.material_id,
          costo_anterior: fila.costo_anterior,
          costo_nuevo: costoNuevo,
          origen: 'importacion_excel'
        });
        if (eHist) throw new Error(eHist.message);
        await recalcularProductosQueUsanMaterial(fila.material_id, usuarioId);
      }
      resultado.actualizados++;
    }
  }

  return resultado;
}

module.exports = { analizarMateriales, importarMateriales };