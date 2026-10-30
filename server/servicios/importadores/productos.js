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
//   - Tipo FABRICADO / REVENTA. Reventa: costo = "Costo compra" y las
//     "Existencias" de un producto nuevo entran como compra por el núcleo.
//     El tipo de un producto existente no se cambia desde el Excel.
// ============================================================
const supabase = require('../../supabase/cliente');
const { supabaseAdminBase } = require('../../supabase/cliente');
const libro = require('../inventario/libro');
const { normalizarModelo } = require('../modelo-negocio');
const { usuarioActual } = require('../../contexto');
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

// '' (no indicado), 'fabricado', 'reventa' o undefined (no válido)
function aTipo(valor) {
  const t = aTextoLimpio(valor).toLowerCase();
  if (t === '') return '';
  if (['fabricado', 'fabricados', 'fabrico'].includes(t)) return 'fabricado';
  if (['reventa', 'revendo', 'comprado'].includes(t)) return 'reventa';
  return undefined;
}

async function tipoPorDefecto(empresaId) {
  const { data } = await supabase.from('empresas').select('configuracion').eq('id', empresaId).maybeSingle();
  const m = normalizarModelo(data && data.configuracion);
  return m.reventa && !m.fabricacion ? 'reventa' : 'fabricado';
}

function validarFila(datos) {
  const errores = [
    requerido(datos.nombre, 'Producto'),
    numeroValido(datos.precio_venta, 'Precio venta', { minimo: 0 }),
    aTipo(datos.tipo) === undefined ? 'Tipo debe ser FABRICADO o REVENTA' : null,
    numeroValido(datos.costo_compra, 'Costo compra', { minimo: 0, opcional: true }),
    numeroValido(datos.existencias, 'Existencias', { minimo: 0, opcional: true }),
    numeroValido(datos.minutos_fabricacion, 'Minutos fabricación', { minimo: 0, opcional: true }),
    siNoValido(datos.activo, 'Activo', { opcional: true })
  ].filter(Boolean);
  return errores;
}

async function obtenerCategoriasExistentes(empresaId) {
  const { data, error } = await supabase.from('categorias_productos').select('id, nombre').eq('empresa_id', empresaId);
  if (error) throw new Error(error.message);
  return new Map((data || []).map((c) => [c.nombre.toLowerCase(), c]));
}

async function obtenerProductosExistentes(empresaId) {
  const { data, error } = await supabase
    .from('productos')
    .select('id, codigo, nombre, tipo, precio_venta, costo_calculado, minutos_fabricacion, foto_url, activo, categoria_id, usa_costeo_por_procesos, categorias_productos(nombre)')
    .eq('empresa_id', empresaId);
  if (error) throw new Error(error.message);

  const { data: procesos, error: eProc } = await supabase
    .from('procesos').select('producto_id').eq('empresa_id', empresaId).eq('activo', true);
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

async function siguienteCodigoDisponible(empresaId) {
  const { data, error } = await supabase
    .from('productos').select('codigo').eq('empresa_id', empresaId).not('codigo', 'is', null).like('codigo', 'PROD%');
  if (error) throw new Error(error.message);
  let maximo = 0;
  for (const fila of data || []) {
    const numero = parseInt(String(fila.codigo).replace(/^PROD/i, ''), 10);
    if (!isNaN(numero) && numero > maximo) maximo = numero;
  }
  return maximo + 1;
}

// -------------------- 1. ANALIZAR --------------------
async function analizarProductos(buffer, empresaId) {
  const filasExcel = leerFilas(buffer);
  const [{ porCodigo, porNombre }, categorias, tipoNuevo] = await Promise.all([
    obtenerProductosExistentes(empresaId),
    obtenerCategoriasExistentes(empresaId),
    tipoPorDefecto(empresaId)
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

    const tipoIndicado = aTipo(datos.tipo);
    const tipo = existente ? (existente.tipo || 'fabricado') : (tipoIndicado || tipoNuevo);
    if (existente && tipoIndicado && tipoIndicado !== tipo) {
      errores.push(`Este producto es ${tipo === 'reventa' ? 'de REVENTA' : 'FABRICADO'}; el tipo se cambia desde la plataforma`);
    }
    if (tipo === 'reventa' && !existente && aTextoLimpio(datos.costo_compra) === '') errores.push('Costo compra es obligatorio para productos de REVENTA');
    if (tipo === 'reventa' && !categoriaTexto && !(existente && existente.categoria_id)) errores.push('Categoría es obligatoria para productos de REVENTA');
    if (tipo === 'fabricado' && (aTextoLimpio(datos.costo_compra) !== '' || aTextoLimpio(datos.existencias) !== '')) {
      advertencias.push('Costo compra y Existencias solo aplican a productos de REVENTA: se ignorarán.');
    }
    if (tipo === 'reventa' && existente && aTextoLimpio(datos.existencias) !== '') {
      advertencias.push('Existencias solo se usa al crear: para sumar unidades registra una compra.');
    }

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
        (tipo !== 'reventa' || aTextoLimpio(datos.costo_compra) === '' || Number(aNumero(datos.costo_compra)) === Number(existente.costo_calculado)) &&
        (tipo === 'reventa' || existente.tiene_procesos || aTextoLimpio(datos.minutos_fabricacion) === '' ||
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
      tipo,
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
async function obtenerOCrearCategoriaId(empresaId, nombreCategoria, cache) {
  if (!nombreCategoria) return null;
  const clave = nombreCategoria.toLowerCase();
  if (cache.has(clave)) return cache.get(clave).id;

  const { data: existente, error: eGet } = await supabase
    .from('categorias_productos').select('id, nombre').eq('empresa_id', empresaId).ilike('nombre', nombreCategoria).maybeSingle();
  if (eGet) throw new Error(eGet.message);
  if (existente) { cache.set(clave, existente); return existente.id; }

  const { data: creada, error: eIns } = await supabase
    .from('categorias_productos').insert({ empresa_id: empresaId, usuario_id: usuarioActual(), nombre: nombreCategoria }).select('id, nombre').single();
  if (eIns) throw new Error(eIns.message);
  cache.set(clave, creada);
  return creada.id;
}

// Producto de reventa nuevo: costo de compra y existencias por el núcleo
async function crearReventaDesdeExcel({ empresaId, fila, codigo, categoriaId }) {
  const datos = fila.datos;
  const costo = aNumero(datos.costo_compra) ?? 0;
  const { data: producto, error } = await supabase.from('productos').insert({
    empresa_id: empresaId, usuario_id: usuarioActual(), tipo: 'reventa',
    codigo,
    nombre: aTextoLimpio(datos.nombre),
    categoria_id: categoriaId,
    precio_venta: aNumero(datos.precio_venta),
    minutos_fabricacion: 0,
    foto_url: aTextoLimpio(datos.foto_url) || null,
    costo_calculado: costo,
    activo: aBooleanoSiNo(datos.activo) ?? true
  }).select('id').single();
  if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);

  const { error: eInv } = await supabaseAdminBase.from('inventario_productos').upsert({
    producto_id: producto.id, empresa_id: empresaId, controla_stock: true,
    actualizado_en: new Date().toISOString(), actualizado_por: usuarioActual()
  }, { onConflict: 'producto_id' });
  if (eInv) throw new Error(`Fila ${fila.numero_fila}: ${eInv.message}`);

  const existencias = aNumero(datos.existencias) ?? 0;
  if (existencias > 0) {
    const operacion = await libro.aplicarOperacion({
      empresaId, usuarioId: usuarioActual(), tipo: 'compra_reventa',
      origenTabla: 'productos', origenId: producto.id,
      motivo: 'Existencias iniciales (Excel)', clave: `stock-inicial:${producto.id}`,
      movimientos: [{ producto_id: producto.id, cantidad: existencias, costo_unitario: costo }]
    });
    if (!operacion.ok) throw new Error(`Fila ${fila.numero_fila}: no se pudieron registrar las existencias`);
  }
}

// -------------------- 2. IMPORTAR --------------------
async function importarProductos(empresaId, filas, modo = 'crear_y_actualizar') {
  let siguienteConsecutivo = null;
  const cacheCategorias = new Map();
  const resultado = { creados: 0, actualizados: 0, sin_cambios: 0, omitidos: 0, categorias_creadas: 0 };
  let tipoNuevo = null;

  for (const fila of filas) {
    if (fila.errores && fila.errores.length) { resultado.omitidos++; continue; }
    if (fila.accion === 'sin_cambios') { resultado.sin_cambios++; continue; }
    if (fila.accion === 'crear' && modo === 'actualizar_solamente') { resultado.omitidos++; continue; }
    if (fila.accion === 'actualizar' && modo === 'crear_solamente') { resultado.omitidos++; continue; }

    const datos = fila.datos;
    const categoriaTexto = aTextoLimpio(datos.categoria);
    const categoriasAntes = cacheCategorias.size;
    const categoriaId = categoriaTexto ? await obtenerOCrearCategoriaId(empresaId, categoriaTexto, cacheCategorias) : null;
    if (cacheCategorias.size > categoriasAntes) resultado.categorias_creadas++;

    if (fila.accion === 'crear') {
      let codigo = fila.codigo;
      if (!codigo) {
        if (siguienteConsecutivo == null) siguienteConsecutivo = await siguienteCodigoDisponible(empresaId);
        codigo = `PROD${String(siguienteConsecutivo).padStart(3, '0')}`;
        siguienteConsecutivo++;
      }
      // El tipo se vuelve a decidir aquí: no se confía en lo que trae la fila
      if (tipoNuevo == null) tipoNuevo = await tipoPorDefecto(empresaId);
      const tipo = aTipo(datos.tipo) || tipoNuevo;
      if (tipo === 'reventa') {
        await crearReventaDesdeExcel({ empresaId, fila, codigo, categoriaId });
        resultado.creados++;
        continue;
      }
      const minutosFabricacion = aNumero(datos.minutos_fabricacion) ?? 0;
      const costoCalculado = await calcularCostoProducto({ materiales: [], minutosFabricacion, empresaId });

      const { error } = await supabase.from('productos').insert({
        empresa_id: empresaId, usuario_id: usuarioActual(),
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
        .from('productos').select('tipo, costo_calculado, minutos_fabricacion, categoria_id, foto_url, activo, usa_costeo_por_procesos')
        .eq('id', fila.producto_id).eq('empresa_id', empresaId).single();
      if (eActual || !actual) throw new Error(`Fila ${fila.numero_fila}: el producto ya no existe`);

      if (actual.tipo === 'reventa') {
        const costo = aNumero(datos.costo_compra);
        const { error } = await supabase.from('productos').update({
          nombre: aTextoLimpio(datos.nombre),
          categoria_id: categoriaTexto ? categoriaId : actual.categoria_id,
          precio_venta: aNumero(datos.precio_venta),
          costo_calculado: costo == null ? actual.costo_calculado : costo,
          foto_url: aTextoLimpio(datos.foto_url) || actual.foto_url,
          activo: aBooleanoSiNo(datos.activo) ?? actual.activo,
          actualizado_en: new Date().toISOString()
        }).eq('id', fila.producto_id).eq('empresa_id', empresaId);
        if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);
        resultado.actualizados++;
        continue;
      }

      const { count: countProcesos, error: eCount } = await supabase
        .from('procesos').select('id', { count: 'exact', head: true })
        .eq('producto_id', fila.producto_id).eq('empresa_id', empresaId).eq('activo', true);
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
          empresaId
        });
      }

      const { error } = await supabase.from('productos').update(cambios).eq('id', fila.producto_id).eq('empresa_id', empresaId);
      if (error) throw new Error(`Fila ${fila.numero_fila}: ${error.message}`);

      if (tieneProcesos) await recalcularProductoDesdeSusProcesos(fila.producto_id, empresaId);
      resultado.actualizados++;
    }
  }

  return resultado;
}

module.exports = { analizarProductos, importarProductos, _interno: { aTipo, validarFila } };