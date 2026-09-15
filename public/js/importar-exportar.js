// ============================================================
// importar-exportar.js — página /importar-exportar.html
// Arma las tarjetas de los 9 módulos a partir de una sola lista de
// configuración (MODULOS_EXCEL) y maneja el flujo común a todos:
// subir el archivo → /analizar (previsualizar, sin guardar nada) →
// el usuario confirma → /importar (ahí sí se guarda).
//
// Cada módulo devuelve su reporte con una forma distinta (ver los
// importadores en server/servicios/importadores/) — `forma` decide
// qué función de renderizado usar para el bloque de previsualización.
// ============================================================

const MODULOS_EXCEL = [
  { clave: 'materiales', nombre: 'Materiales', archivo: '01_Materiales.xlsx',
    descripcion: 'Materiales, proveedores, costos e inventario.', forma: 'simple', tieneModo: true },
  { clave: 'productos', nombre: 'Productos', archivo: '02_Productos.xlsx',
    descripcion: 'Catálogo de productos, precios y categorías.', forma: 'simple', tieneModo: true },
  { clave: 'procesos', nombre: 'Procesos', archivo: '03_Procesos.xlsx',
    descripcion: 'Etapas de fabricación y los materiales que usa cada una.', forma: 'procesos', tieneModo: true },
  { clave: 'inventario', nombre: 'Inventario', archivo: '04_Inventario.xlsx',
    descripcion: 'Entradas, salidas y ajustes de stock.', forma: 'simple' },
  { clave: 'compras', nombre: 'Compras', archivo: '05_Compras.xlsx',
    descripcion: 'Pedidos a proveedores, pendientes o ya recibidos.', forma: 'simple', tieneAfectarInventario: true },
  { clave: 'ventas', nombre: 'Ventas', archivo: '06_Ventas.xlsx',
    descripcion: 'Pedidos de clientes y los productos que incluyen.', forma: 'ventas' },
  { clave: 'finanzas', nombre: 'Finanzas', archivo: '07_Finanzas.xlsx',
    descripcion: 'Costos fijos, capital invertido y configuración general.', forma: 'finanzas' },
  { clave: 'facturacion', nombre: 'Facturación', archivo: '08_Facturacion.xlsx',
    descripcion: 'Configuración fiscal e historial de facturas (no emite facturas nuevas).', forma: 'facturacion' },
  { clave: 'nominas', nombre: 'Nóminas', archivo: '09_Nominas.xlsx',
    descripcion: 'Colaboradores y su historial de encargos.', forma: 'nominas' }
];

let moduloActualExcel = null;
let reporteActualExcel = null;

// -------------------- Arranque de la página --------------------
function inicializarPaginaExcel() {
  const lista = document.getElementById('listaModulosExcel');
  lista.innerHTML = MODULOS_EXCEL.map((m) => `
    <article class="modulo-excel">
      <h3>${m.nombre}</h3>
      <p>${m.descripcion}</p>
      <div class="modulo-excel__acciones">
        <button type="button" class="boton boton--pequeno" onclick="descargarPlantillaModulo('${m.clave}', '${m.archivo}')">Descargar Excel</button>
        <button type="button" class="boton boton--pequeno" onclick="descargarActualModulo('${m.clave}', '${m.archivo}')">Descargar información actual</button>
        <button type="button" class="boton boton--pequeno boton--primario" onclick="abrirModalExcel('${m.clave}')">Subir Excel</button>
      </div>
    </article>
  `).join('');
}

// -------------------- Descargas (requieren el token, pero no son JSON) --------------------
async function descargarConAuth(ruta, nombreArchivo) {
  const token = localStorage.getItem('token_sesion');
  const respuesta = await fetch(ruta, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  if (!respuesta.ok) {
    const datos = await respuesta.json().catch(() => ({}));
    throw new Error(datos.error || `Error ${respuesta.status}`);
  }
  const blob = await respuesta.blob();
  const url = URL.createObjectURL(blob);
  const enlace = document.createElement('a');
  enlace.href = url;
  enlace.download = nombreArchivo;
  document.body.appendChild(enlace);
  enlace.click();
  enlace.remove();
  URL.revokeObjectURL(url);
}

async function descargarPlantillaModulo(clave, archivo) {
  try { await descargarConAuth(`/api/excel/${clave}/plantilla`, archivo); }
  catch (err) { mostrarAviso(err.message, 'error'); }
}

async function descargarActualModulo(clave, archivo) {
  try { await descargarConAuth(`/api/excel/${clave}/exportar`, archivo); }
  catch (err) { mostrarAviso(err.message, 'error'); }
}

async function descargarTodo(tipo) {
  const nombre = tipo === 'plantillas' ? 'Sistema_Control_Plantillas.zip' : `Mi_Negocio_Exportacion_${new Date().toISOString().slice(0, 10)}.zip`;
  try { await descargarConAuth(`/api/excel/todo/${tipo}`, nombre); }
  catch (err) { mostrarAviso(err.message, 'error'); }
}

// -------------------- Modal: subir → analizar --------------------
function abrirModalExcel(clave) {
  moduloActualExcel = MODULOS_EXCEL.find((m) => m.clave === clave);
  reporteActualExcel = null;
  document.getElementById('tituloModalExcel').textContent = `Subir Excel — ${moduloActualExcel.nombre}`;
  document.getElementById('campoArchivoExcel').value = '';
  document.getElementById('pasoSeleccionArchivo').hidden = false;
  document.getElementById('lineaCargandoExcel').hidden = true;
  document.getElementById('contenidoReporteExcel').innerHTML = '';
  document.getElementById('botonConfirmarImportacion').hidden = true;
  document.getElementById('modalExcel').hidden = false;
}

function cerrarModalExcel() {
  document.getElementById('modalExcel').hidden = true;
  moduloActualExcel = null;
  reporteActualExcel = null;
}

async function alSeleccionarArchivo(evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;

  document.getElementById('pasoSeleccionArchivo').hidden = true;
  document.getElementById('lineaCargandoExcel').hidden = false;
  document.getElementById('contenidoReporteExcel').innerHTML = '';
  document.getElementById('botonConfirmarImportacion').hidden = true;

  try {
    const token = localStorage.getItem('token_sesion');
    const formData = new FormData();
    formData.append('archivo', archivo);
    const respuesta = await fetch(`/api/excel/${moduloActualExcel.clave}/analizar`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      body: formData
    });
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`);

    reporteActualExcel = datos;
    renderizarReporteExcel();
    document.getElementById('botonConfirmarImportacion').hidden = false;
  } catch (err) {
    mostrarAviso(err.message, 'error');
    document.getElementById('pasoSeleccionArchivo').hidden = false;
  } finally {
    document.getElementById('lineaCargandoExcel').hidden = true;
  }
}

// -------------------- Previsualización del reporte --------------------
const ETIQUETAS_RESUMEN = {
  nuevos: 'Nuevos', actualizados: 'Actualizados', sin_cambios: 'Sin cambios', errores: 'Errores',
  validas: 'Válidas', aplicables: 'Con valor', sin_valor: 'Sin valor', aplicados: 'Aplicados'
};

function chipsResumen(resumen) {
  return Object.entries(resumen || {}).map(([clave, valor]) => {
    const tipo = clave === 'errores' ? 'chip--error' : (clave === 'nuevos' || clave === 'validas' || clave === 'aplicables' ? 'chip--ok' : '');
    return `<span class="chip ${tipo}">${ETIQUETAS_RESUMEN[clave] || clave}: ${valor}</span>`;
  }).join('');
}

const MAXIMO_FILAS_VISIBLES = 50;

// columnas: [{ titulo, obtener(fila) }]
function tablaFilas(filas, columnas) {
  if (!filas || filas.length === 0) return '<p class="texto-secundario">No hay filas.</p>';
  const visibles = filas.slice(0, MAXIMO_FILAS_VISIBLES);
  const encabezados = columnas.map((c) => `<th>${c.titulo}</th>`).join('') + '<th>Mensajes</th>';
  const filasHtml = visibles.map((fila) => {
    const tieneErrores = fila.errores && fila.errores.length > 0;
    const tieneAdvertencias = fila.advertencias && fila.advertencias.length > 0;
    const claseFila = tieneErrores ? 'reporte-tabla__fila--error' : (tieneAdvertencias ? 'reporte-tabla__fila--advertencia' : '');
    const celdas = columnas.map((c) => `<td>${escaparHtml(c.obtener(fila) ?? '')}</td>`).join('');
    const mensajes = [
      ...(fila.errores || []).map((m) => `<div class="reporte-tabla__mensaje">${escaparHtml(m)}</div>`),
      ...(fila.advertencias || []).map((m) => `<div class="reporte-tabla__mensaje--advertencia">${escaparHtml(m)}</div>`)
    ].join('');
    return `<tr class="${claseFila}"><td>${fila.numero_fila}</td>${celdas}<td>${mensajes}</td></tr>`;
  }).join('');
  const nota = filas.length > MAXIMO_FILAS_VISIBLES
    ? `<p class="reporte-mas-filas">Mostrando ${MAXIMO_FILAS_VISIBLES} de ${filas.length} filas.</p>` : '';
  return `<table class="reporte-tabla"><thead><tr><th>Fila</th>${encabezados}</tr></thead><tbody>${filasHtml}</tbody></table>${nota}`;
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = String(texto);
  return div.innerHTML;
}

function opcionesModoHtml() {
  return `
    <div class="opciones-importacion">
      <strong>¿Qué importar?</strong>
      <label><input type="radio" name="modoImportacion" value="crear_y_actualizar" checked> Crear y actualizar</label>
      <label><input type="radio" name="modoImportacion" value="crear_solamente"> Solo crear</label>
      <label><input type="radio" name="modoImportacion" value="actualizar_solamente"> Solo actualizar</label>
    </div>`;
}

function opcionAfectarInventarioHtml() {
  return `
    <div class="opciones-importacion">
      <label><input type="checkbox" id="campoAfectarInventario" checked> Las compras marcadas "RECIBIDA" deben sumar el stock automáticamente</label>
    </div>`;
}

function renderizarReporteExcel() {
  const contenedor = document.getElementById('contenidoReporteExcel');
  const reporte = reporteActualExcel;
  let html = '';

  if (moduloActualExcel.tieneModo) html += opcionesModoHtml();
  if (moduloActualExcel.tieneAfectarInventario) html += opcionAfectarInventarioHtml();

  switch (moduloActualExcel.forma) {
    case 'procesos':
      html += bloqueSimple('Procesos', reporte.resumen, reporte.filas, [
        { titulo: 'Código', obtener: (f) => f.codigo || '' },
        { titulo: 'Producto', obtener: (f) => f.codigo_producto || '' },
        { titulo: 'Acción', obtener: (f) => f.accion || '' },
        { titulo: 'Materiales', obtener: (f) => (f.materiales || []).length }
      ]);
      break;
    case 'ventas':
      html += bloqueSimple('Ventas', reporte.resumen, reporte.filas, [
        { titulo: 'Código', obtener: (f) => f.codigo || '' },
        { titulo: 'Total', obtener: (f) => formatearPesos(f.total || 0) },
        { titulo: 'Productos', obtener: (f) => (f.items || []).length }
      ]);
      if (reporte.resumen_items) html += `<div class="reporte-bloque"><h4>Líneas de VENTAS_ITEMS</h4>${chipsResumen(reporte.resumen_items)}</div>`;
      break;
    case 'finanzas':
      html += bloqueSimple('Costos fijos', reporte.resumen_costos_fijos, reporte.filas_costos_fijos, [
        { titulo: 'Nombre', obtener: (f) => f.nombre || '' },
        { titulo: 'Acción', obtener: (f) => f.accion || '' }
      ]);
      html += bloqueSimple('Capital', reporte.resumen_capital, reporte.filas_capital, [
        { titulo: 'Concepto', obtener: (f) => f.datos.concepto || '' },
        { titulo: 'Valor', obtener: (f) => f.datos.valor || '' }
      ]);
      html += bloqueSimple('Configuración', reporte.resumen_configuracion, reporte.filas_configuracion, [
        { titulo: 'Parámetro', obtener: (f) => f.parametro || '' },
        { titulo: 'Valor', obtener: (f) => f.datos.valor || '(sin cambio)' }
      ]);
      break;
    case 'facturacion':
      html += bloqueSimple('Configuración fiscal', null, reporte.filas_configuracion_fiscal, [
        { titulo: 'Razón social', obtener: (f) => f.datos.razon_social || '' }
      ]);
      html += bloqueSimple('Facturas', reporte.resumen_facturas, reporte.filas_facturas, [
        { titulo: 'Número', obtener: (f) => f.numero || '' },
        { titulo: 'Venta', obtener: (f) => f.datos.codigo_venta || '' }
      ]);
      break;
    case 'nominas':
      html += bloqueSimple('Colaboradores', reporte.resumen_colaboradores, reporte.filas_colaboradores, [
        { titulo: 'Código', obtener: (f) => f.codigo || '' },
        { titulo: 'Nombre', obtener: (f) => f.datos.nombre || '' },
        { titulo: 'Acción', obtener: (f) => f.accion || '' }
      ]);
      html += bloqueSimple('Encargos', reporte.resumen_encargos, reporte.filas_encargos, [
        { titulo: 'Colaborador', obtener: (f) => f.codigo_colaborador || '' },
        { titulo: 'Proceso', obtener: (f) => f.codigo_proceso || '' },
        { titulo: 'Cantidad', obtener: (f) => f.datos.cantidad || '' }
      ]);
      break;
    default: // 'simple': materiales, productos, inventario, compras
      html += bloqueSimple(moduloActualExcel.nombre, reporte.resumen, reporte.filas, columnasSimple(moduloActualExcel.clave));
  }

  contenedor.innerHTML = html;
}

function columnasSimple(clave) {
  if (clave === 'materiales' || clave === 'productos') {
    return [
      { titulo: 'Código', obtener: (f) => f.codigo || '' },
      { titulo: 'Nombre', obtener: (f) => (f.datos.nombre || '') },
      { titulo: 'Acción', obtener: (f) => f.accion || '' }
    ];
  }
  if (clave === 'inventario') {
    return [
      { titulo: 'Material', obtener: (f) => f.codigo_material || '' },
      { titulo: 'Tipo', obtener: (f) => f.tipo || '' },
      { titulo: 'Stock resultante', obtener: (f) => f.stock_nuevo_proyectado ?? '' }
    ];
  }
  if (clave === 'compras') {
    return [
      { titulo: 'Material', obtener: (f) => f.codigo_material || '' },
      { titulo: 'Estado', obtener: (f) => f.estado || '' },
      { titulo: 'Proveedor', obtener: (f) => f.datos.proveedor || '' }
    ];
  }
  return [{ titulo: 'Datos', obtener: (f) => JSON.stringify(f.datos) }];
}

function bloqueSimple(titulo, resumen, filas, columnas) {
  return `
    <div class="reporte-bloque">
      <h4>${titulo}</h4>
      ${resumen ? chipsResumen(resumen) : ''}
      ${tablaFilas(filas || [], columnas)}
    </div>`;
}

// -------------------- Confirmar importación --------------------
function opcionesSeleccionadas() {
  const opciones = {};
  if (moduloActualExcel.tieneModo) {
    const radio = document.querySelector('input[name="modoImportacion"]:checked');
    opciones.modo = radio ? radio.value : 'crear_y_actualizar';
  }
  if (moduloActualExcel.tieneAfectarInventario) {
    const casilla = document.getElementById('campoAfectarInventario');
    opciones.afectar_inventario = casilla ? casilla.checked : true;
  }
  return opciones;
}

// La mayoría de módulos manda su `filas` (arreglo plano); Finanzas,
// Facturación y Nóminas mandan el reporte completo (varias listas) —
// el backend ya sabe distinguirlos, aquí solo se decide QUÉ mandar.
function filasParaImportar() {
  const forma = moduloActualExcel.forma;
  if (forma === 'finanzas' || forma === 'facturacion' || forma === 'nominas') return reporteActualExcel;
  return reporteActualExcel.filas;
}

async function confirmarImportacion() {
  const boton = document.getElementById('botonConfirmarImportacion');
  boton.disabled = true;
  try {
    const cuerpo = { filas: filasParaImportar(), ...opcionesSeleccionadas() };
    const resultado = await API.enviar(`/api/excel/${moduloActualExcel.clave}/importar`, cuerpo);
    mostrarAviso('Importación completada.', 'ok');
    console.log('Resultado de la importación:', resultado);
    cerrarModalExcel();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  } finally {
    boton.disabled = false;
  }
}