// ============================================================
// IMPORTADOR — Productos (server/servicios/importadores/productos.js)
// Mismo patrón de dos pasos que Materiales (ver ese archivo para más
// detalle general). Particularidades de Productos:
//
//   - La "Categoría" se busca por nombre (sin importar mayúsculas) y
//     se CREA automáticamente si no existe — igual que ya hace
//     POST /api/categorias cuando alguien la escribe desde el formulario.
//   - Si el producto ya tiene Procesos configurados, sus minutos de
//     fabricación y su costo se derivan solos de ahí (igual que en
//     rutas/productos.js): el Excel nunca los pisa, solo actualiza los
//     datos básicos (nombre, categoría, precio, foto, activo).
//   - Este importador NO toca la ficha técnica (productos_materiales):
//     al actualizar un producto sin procesos, se preserva la ficha
//     técnica que ya tenía para no perderla ni recalcular mal el costo.
// ============================================================
const supabase = require('../../supabase/cliente');
const { leerFilas } = require('../excel/lector');
const { COLUMNAS } = require('../excel/definiciones/productos');
const { aTextoLimpio, aNumero, aBooleanoSiNo, requerido, numeroValido, siNoValido } = require('../excel/validador');
const { calcularCostoProducto, recalcularProductoDesdeSusProcesos } = require('../costos');

const CLAVE_POR_ENCABEZADO = new Map(COLUMNAS.map((c) => [c.encabezado, c.clave]));

function extraerDatos(filaExcel) {
  const datos = {};
  for (const [encabezado, clave] of CLAVE_POR_ENCABEZADO) datos[clave] = filaExcel[encabezado];
  return datos;
}

function validarFila(datos) {
  const errores = [
    requerido(datos.nombre, 'Producto'),
    numeroValido(datos.precio_venta, 'Precio venta', { minimo: 0 }),
    numeroValido(datos.minutos_fabricacion, 'Minutos fabricación', { minimo: 0, opcional: true }),
    siNoValido(datos.activo, 'Activo', { opcional: true })
  ].filter(Boolean);
  return errores;
}

async function obtenerCategoriasExistentes(usuarioId) {
  const { data, error } = await supabase.from('categorias_productos').select('id, nombre').eq('usuario_id', usuarioId);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((c) => [c.nombre.toLowerCase(), c]));
}

async function obtenerProductosExistentes(usuarioId) {
  const { data, error } = await supabase
    .from('productos')
    .select('id, codigo, nombre, precio_venta, minutos_fabricacion, foto_url, activo, categoria_id, usa_costeo_por_procesos, categorias_productos(nombre)')
    .eq('usuario_id', usuarioId);
  if (error) throw new Error(error.message);

  const { data: procesos, error: eProc } = await supabase
    .from('procesos').select('producto_id').eq('usuario_id', usuarioId).eq('activo', true);
  if (eProc) throw new Error(eProc.message);
  const idsConProcesos = new Set((procesos || []).map((p) => p.producto_id));

  const porCodigo = new Map();
  const porNombre = new Map();
  for (const producto of data || []) {
    const conTieneProcesos = { ...producto, tiene_procesos: idsConProcesos.has(producto.id) };
    if (producto.codigo) porCodigo.set(producto.codigo.toLowerCase(), conTieneProcesos);
    porNombre.set(producto.nombre.toLowerCase(), conTieneProcesos);
  }
  return { porCodigo, porNombre };
}

async function siguienteCodigoDisponible(usuarioId) {
  const { data, error } = await supabase
    .from('productos').select('codigo').eq('usuario_id', usuarioId).not('codigo', 'is', null).like('codigo', 'PROD%');
  if (error) throw new Error(error.message);
  let maximo = 0;
  for (const fila of data || []) {
    const numero = parseInt(String(fila.codigo).replace(/^PROD/i, ''), 10);
    if (!isNaN(numero) && numero > maximo) maximo = numero;
  }
  return maximo + 1;
}

// -------------------- 1. ANALIZAR --------------------
async function analizarProductos(buffer, usuarioId) {
  const filasExcel = leerFilas(buffer);
  const [{ porCodigo, porNombre }, categorias] = await Promise.all([
    obtenerProductosExistentes(usuarioId),
    obtenerCategoriasExistentes(usuarioId)
  ]);
  const codigosVistosEnArchivo = new Set();
  const resumen = { nuevos: 0, actualizados: 0, sin_cambios: 0, advertencias: 0, errores: 0 };

  const filas = filasExcel.map((filaExcel, indice) => {
    const numeroFila = indice + 2;
    const datos = extraerDatos(filaExcel);
    const codigo = aTextoLimpio(datos.codigo) || null;
    const categoriaTexto = aTextoLimpio(datos.categoria);

    const errores = validarFila(datos);
    const advertencias = [];

    if (codigo) {
      const codigoNorm = codigo.toLowerCase();
      if (codigosVistosEnArchivo.has(codigoNorm)) errores.push(`El código "${codigo}" está repetido dentro de este archivo`);
      codigosVistosEnArchivo.add(codigoNorm);
    }

    if (categoriaTexto && !categorias.has(categoriaTexto.toLowerCase())) {
      advertencias.push(`La categoría "${categoriaTexto}" no existe: se creará automáticamente al importar.`);
    }

    const existente = (codigo && porCodigo.get(codigo.toLowerCase()))
      || (datos.nombre && porNombre.get(aTextoLimpio(datos.nombre).toLowerCase()))
      || null;

    let accion = existente ? 'actualizar' : 'crear';

    if (existente && existente.tiene_procesos && aTextoLimpio(datos.minutos_fabricacion) !== '') {
      advertencias.push('Este producto ya tiene Procesos configurados: los minutos de fabricación se calculan solos y este valor se ignorará.');
    }

    if (existente && errores.length === 0) {
      const categoriaActual = existente.categorias_productos ? existente.categorias_productos.nombre.toLowerCase() : '';
      const categoriaNueva = categoriaTexto ? categoriaTexto.toLowerCase() : categoriaActual; // vacío = no cambiar
      const sinCambios =
        aTextoLimpio(datos.nombre).toLowerCase() === existente.nombre.toLowerCase() &&
        Number(aNumero(datos.precio_venta)) === Number(existente.precio_venta) &&
        categoriaNueva === categoriaActual &&
        (existente.tiene_procesos || aTextoLimpio(datos.minutos_fabricacion) === '' ||
          Number(aNumero(datos.minutos_fabricacion)) === Number(existente.minutos_fabricacion));
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
      accion,
      producto_id: existente ? existente.id : null,
      errores,
      advertencias
    };
  });

  return { modulo: 'productos', total_filas: filas.length, resumen, filas };
}

// Devuelve el id de la categoría (existente o recién creada), usando
// `cache` para no crear la misma categoría dos veces en una sola importación.
async function obtenerOCrearCategoriaId(usuarioId, nombreCategoria, cache) {
  if (!nombreCategoria) return null;
  const clave = nombreCategoria.toLowerCase();
  if (cache.has(clave)) return cache.get(clave).id;

  const { data: existente, error: eGet } = await supabase
    .from('categorias_productos').select('id, nombre').eq('usuario_id', usuarioId).ilike('nombre', nombreCategoria).maybeSingle();
  if (eGet) throw new Error(eGet.message);
  if (existente) { cache.set(clave, existente); return existente.id; }

  const { data: creada, error: eIns } = await supabase
    .from('categorias_productos').insert({ usuario_id: usuarioId, nombre: nombreCategoria }).select('id, nombre').single();
  if (eIns) throw new Error(eIns.message);
  cache.set(clave, creada);
  return creada.id;
}

// -------------------- 2. IMPORTAR --------------------
async function importarProductos(usuarioId, filas, modo = 'crear_y_actualizar') {
  let siguienteConsecutivo = null;
  const cacheCategorias = new Map();
  const resultado = { creados: 0, actualizados: 0, sin_cambios: 0, omitidos: 0, categorias_creadas: 0 };

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }
    if (fila.accion === 'sin_cambios') { resultado.sin_cambios++; continue; }
    if (fila.accion === 'crear' && modo === 'actualizar_solamente') { resultado.omitidos++; continue; }
    if (fila.accion === 'actualizar' && modo === 'crear_solamente') { resultado.omitidos++; continue; }

    const datos = fila.datos;
    const categoriaTexto = aTextoLimpio(datos.categoria);
    const categoriasAntes = cacheCategorias.size;
    const categoriaId = categoriaTexto ? await obtenerOCrearCategoriaId(usuarioId, categoriaTexto, cacheCategorias) : null;
    if (cacheCategorias.size > categoriasAntes) resultado.categorias_creadas++;

    if (fila.accion === 'crear') {
      let codigo = fila.codigo;
      if (!codigo) {
        if (siguienteConsecutivo == null) siguienteConsecutivo = await siguienteCodigoDisponible(usuarioId);
        codigo = `PROD${String(siguienteConsecutivo).padStart(3, '0')}`;
        siguienteConsecutivo++;
      }
      const minutosFabricacion = aNumero(datos.minutos_fabricacion) ?? 0;
      const costoCalculado = await calcularCostoProducto({ materiales: [], minutosFabricacion, usuarioId });

      const { error } = await supabase.from('productos').insert({
        usuario_id: usuarioId,
        codigo,
        nombre: aTextoLimpio(datos.nombre),
        categoria_id: categoriaId,
        precio_venta: aNumero(datos.precio_venta),
        minutos_fabricacion: minutosFabricacion,
        foto_url: aTextoLimpio(datos.foto_url) || null,
        costo_calculado: costoCalculado,
        activo: aBooleanoSiNo(datos.activo) ?? true
      });
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
      resultado.creados++;
    } else if (fila.accion === 'actualizar') {
      const { data: actual, error: eActual } = await supabase
        .from('productos').select('minutos_fabricacion, categoria_id, foto_url, activo, usa_costeo_por_procesos')
        .eq('id', fila.producto_id).eq('usuario_id', usuarioId).single();
      if (eActual || !actual) throw new Error(`Fila ${fila.numero_fila}: el producto ya no existe`);

      const { count: countProcesos, error: eCount } = await supabase
        .from('procesos').select('id', { count: 'exact', head: true })
        .eq('producto_id', fila.producto_id).eq('usuario_id', usuarioId).eq('activo', true);
      if (eCount) throw new Error(eCount.message);
      const tieneProcesos = countProcesos > 0;

      const minutosFabricacion = tieneProcesos
        ? Number(actual.minutos_fabricacion)
        : (aNumero(datos.minutos_fabricacion) ?? Number(actual.minutos_fabricacion));

      const cambios = {
        nombre: aTextoLimpio(datos.nombre),
        categoria_id: categoriaTexto ? categoriaId : actual.categoria_id,
        precio_venta: aNumero(datos.precio_venta),
        minutos_fabricacion: minutosFabricacion,
        foto_url: aTextoLimpio(datos.foto_url) || actual.foto_url,
        activo: aBooleanoSiNo(datos.activo) ?? actual.activo,
        actualizado_en: new Date().toISOString()
      };

      if (!tieneProcesos) {
        // Preserva la ficha técnica actual: solo cambia precio/minutos/etc,
        // nunca los materiales que ya tenía asignados.
        const { data: filasMateriales, error: eMat } = await supabase
          .from('productos_materiales').select('material_id, cantidad').eq('producto_id', fila.producto_id);
        if (eMat) throw new Error(eMat.message);
        cambios.costo_calculado = await calcularCostoProducto({
          materiales: (filasMateriales || []).map((f) => ({ material_id: f.material_id, cantidad: f.cantidad })),
          minutosFabricacion,
          usuarioId
        });
      }

      const { error } = await supabase.from('productos').update(cambios).eq('id', fila.producto_id).eq('usuario_id', usuarioId);
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);

      if (tieneProcesos) await recalcularProductoDesdeSusProcesos(fila.producto_id, usuarioId);
      resultado.actualizados++;
    }
  }

  return resultado;
}

module.exports = { analizarProductos, importarProductos };