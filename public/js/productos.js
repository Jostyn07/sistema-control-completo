let productosEnMemoria = [];
let materialesDisponibles = [];   // precios actuales, pedidos una sola vez al abrir la ficha
let filasFichaEnEdicion = [];     // [{ material_id, nombre, unidad, costo_unitario, cantidad }]
let costoMinutoGlobal = 0;        // se calcula a partir del precio de hora global
let categoriasDisponibles = [];   // categorías de producto del usuario (ej: "Flores", "Panadería")
let fichaEnEdicionUsaCosteoPorProcesos = false; // si true, "Materiales" es de solo lectura (viene de Procesos)
let fichaEnEdicionTieneProcesos = false; // si true, "Minutos de fabricación" es de solo lectura (se derivan de Procesos)
let minutosDerivadosActual = 0; // valor numérico de minutos cuando vienen derivados de procesos

// ---- Categorías de producto ----
async function cargarCategorias() {
  try {
    categoriasDisponibles = await API.obtener('/api/categorias');
  } catch (err) {
    categoriasDisponibles = [];
  }
  pintarSelectorCategoria();
}

function pintarSelectorCategoria(categoriaSeleccionadaId) {
  const selector = document.getElementById('selectorCategoriaProducto');
  if (!selector) return;
  const actual = categoriaSeleccionadaId !== undefined ? categoriaSeleccionadaId : selector.value;
  selector.innerHTML =
    '<option value="">Sin categoría</option>' +
    categoriasDisponibles.map(c => `<option value="${c.id}">${escaparHtml(c.nombre)}</option>`).join('') +
    '<option value="__nueva__">+ Crear categoría nueva…</option>';
  selector.value = actual || '';
}

// Se dispara al elegir "+ Crear categoría nueva…" en el selector.
async function manejarCambioCategoria() {
  const selector = document.getElementById('selectorCategoriaProducto');
  if (selector.value !== '__nueva__') return;

  const nombre = prompt('Nombre de la nueva categoría (ej: Flores, Panadería):');
  if (!nombre || !nombre.trim()) { selector.value = ''; return; }

  try {
    const nueva = await API.enviar('/api/categorias', { nombre: nombre.trim() });
    if (!categoriasDisponibles.some(c => c.id === nueva.id)) categoriasDisponibles.push(nueva);
    categoriasDisponibles.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
    pintarSelectorCategoria(nueva.id);
  } catch (err) {
    mostrarAviso('No se pudo crear la categoría: ' + err.message, 'error');
    selector.value = '';
  }
}

// ---- Precio de hora global (un solo lugar, afecta todos los productos) ----
async function cargarPrecioHora() {
  try {
    const config = await API.obtener('/api/configuracion/produccion');
    const costoHora = Number(config.costo_hora_mano_obra || 0);
    costoMinutoGlobal = costoHora / 60;
    document.getElementById('textoPrecioHoraBanner').textContent = formatearPesos(costoHora) + ' / hora';
    const textoFicha = document.getElementById('textoPrecioHoraActual');
    if (textoFicha) textoFicha.textContent = `Precio de hora vigente: ${formatearPesos(costoHora)} (se cambia desde el botón "Cambiar" arriba)`;
  } catch (err) {
    document.getElementById('textoPrecioHoraBanner').textContent = 'No se pudo cargar';
  }
}

function abrirPrecioHora() {
  document.getElementById('campoPrecioHora').value = Math.round(costoMinutoGlobal * 60);
  document.getElementById('modalPrecioHora').hidden = false;
}

function cerrarPrecioHora() {
  document.getElementById('modalPrecioHora').hidden = true;
}

async function guardarPrecioHora() {
  const valor = document.getElementById('campoPrecioHora').value;
  if (valor === '' || Number(valor) < 0) {
    mostrarAviso('El precio por hora no es válido', 'error');
    return;
  }
  try {
    const resultado = await API.actualizar('/api/configuracion/produccion', { costo_hora_mano_obra: valor });
    mostrarAviso(`Precio de hora actualizado. Se recalcularon ${resultado.productos_recalculados} producto(s).`);
    cerrarPrecioHora();
    await cargarPrecioHora();
    cargarListaProductos();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 1. Lista de productos (tarjetas o lista) ----
// El "stock" de un producto no es un número guardado: es cuántas
// unidades más se pueden fabricar HOY con el material que hay
// disponible (mínimo de "stock del material / cantidad que usa la
// receta", material por material). Ese cálculo ya existe en el
// servidor (/api/inventario/capacidad, el mismo que usa Inventario);
// acá solo se combina con /api/productos por id.
let capacidadPorProducto = new Map();
let vistaProductosActual = localStorage.getItem('vista_productos') || 'tarjetas';
let paginaProductos = 1;
let filasPorPaginaProductos = 12;

async function cargarListaProductos() {
  const contenedor = document.getElementById('listaProductos');
  try {
    const [productos, capacidad] = await Promise.all([
      API.obtener('/api/productos'),
      API.obtener('/api/inventario/capacidad')
    ]);
    capacidadPorProducto = new Map(capacidad.map(c => [c.id, c]));
    productosEnMemoria = productos.map(p => {
      const cap = capacidadPorProducto.get(p.id);
      return { ...p, unidades_fabricables: cap ? cap.unidades_fabricables : 0, material_limitante: cap ? cap.material_limitante : null };
    });

    poblarFiltroCategoriasProducto();
    pintarKpisProductos();
    cambiarVistaProductos(vistaProductosActual, true);
    buscarProductos();
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar la lista: ${escaparHtml(err.message)}</p>`;
  }
}

function poblarFiltroCategoriasProducto() {
  const selector = document.getElementById('filtroCategoriaProducto');
  const actual = selector.value;
  const categorias = [...new Set(productosEnMemoria
    .map(p => p.categorias_productos ? p.categorias_productos.nombre : null)
    .filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es'));
  selector.innerHTML = '<option value="">Todas</option>' +
    categorias.map(c => `<option value="${escaparHtml(c)}">${escaparHtml(c)}</option>`).join('');
  if (categorias.includes(actual)) selector.value = actual;
}

// Umbral de "stock bajo": no hay un mínimo configurado por producto
// (eso solo existe para materiales), así que se usa un corte fijo de
// unidades fabricables — 0 es "Sin stock", 1 a 9 es "Stock bajo".
const UMBRAL_STOCK_BAJO_PRODUCTO = 10;

function estadoStockProducto(p) {
  const u = Number(p.unidades_fabricables || 0);
  if (u <= 0) return 'sin';
  if (u < UMBRAL_STOCK_BAJO_PRODUCTO) return 'bajo';
  return 'ok';
}

function pintarKpisProductos() {
  const contenedor = document.getElementById('kpisProductos');
  if (!contenedor) return;

  const total = productosEnMemoria.length;
  const sinStock = productosEnMemoria.filter(p => estadoStockProducto(p) === 'sin').length;
  const stockBajo = productosEnMemoria.filter(p => estadoStockProducto(p) === 'bajo').length;
  const valorFabricable = productosEnMemoria.reduce((s, p) => s + Number(p.unidades_fabricables || 0) * Number(p.costo_calculado || 0), 0);

  const ICONOS = {
    caja: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>',
    alerta: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    pausa: '<circle cx="12" cy="12" r="10"/><line x1="10" y1="9" x2="10" y2="15"/><line x1="14" y1="9" x2="14" y2="15"/>',
    capas: '<path d="m12 2 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5"/><path d="m3 17 9 5 9-5"/>'
  };

  const tarjetas = [
    { icono: 'caja', color: 'azul', etiqueta: 'Total de productos', valor: String(total) },
    { icono: 'alerta', color: 'naranja', etiqueta: 'Productos con stock bajo', valor: String(stockBajo) },
    { icono: 'pausa', color: 'rosa', etiqueta: 'Productos sin stock', valor: String(sinStock) },
    { icono: 'capas', color: 'morado', etiqueta: 'Valor fabricable hoy', valor: formatearPesos(valorFabricable) }
  ];

  contenedor.innerHTML = tarjetas.map(t => `
    <div class="kpi-tarjeta">
      <span class="kpi-tarjeta__icono indicador__icono--${t.color}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS[t.icono]}</svg></span>
      <span class="kpi-tarjeta__etiqueta">${t.etiqueta}</span>
      <span class="kpi-tarjeta__valor">${t.valor}</span>
    </div>`).join('');
}

function cambiarVistaProductos(vista, silencioso) {
  vistaProductosActual = vista;
  localStorage.setItem('vista_productos', vista);
  document.getElementById('botonVistaTarjetas').classList.toggle('boton--activo', vista === 'tarjetas');
  document.getElementById('botonVistaLista').classList.toggle('boton--activo', vista === 'lista');
  document.getElementById('listaProductos').hidden = vista !== 'tarjetas';
  document.getElementById('tablaProductosLista').hidden = vista !== 'lista';
  if (!silencioso) pintarListaProductosFiltrada();
}

function buscarProductos() {
  paginaProductos = 1;
  pintarListaProductosFiltrada();
}

// Conecta el buscador de la barra superior (tema.js) con el de esta página.
window.buscarDesdeTopbar = function (texto) {
  document.getElementById('buscadorProductos').value = texto;
  buscarProductos();
};

function pintarListaProductosFiltrada() {
  const texto = normalizarTextoProducto(document.getElementById('buscadorProductos').value);
  const categoria = document.getElementById('filtroCategoriaProducto').value;
  const estado = document.getElementById('filtroEstadoProducto').value;
  const orden = document.getElementById('ordenProductos').value;

  let lista = productosEnMemoria;
  if (texto) {
    lista = lista.filter(p =>
      normalizarTextoProducto(p.nombre).includes(texto) ||
      normalizarTextoProducto(p.categorias_productos ? p.categorias_productos.nombre : '').includes(texto));
  }
  if (categoria) lista = lista.filter(p => p.categorias_productos && p.categorias_productos.nombre === categoria);
  if (estado) lista = lista.filter(p => estadoStockProducto(p) === estado);

  lista = [...lista];
  if (orden === 'nombre') lista.sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
  else if (orden === 'precio_desc') lista.sort((a, b) => Number(b.precio_venta) - Number(a.precio_venta));
  else if (orden === 'margen_desc') lista.sort((a, b) => Number(b.margen_valor) - Number(a.margen_valor));
  else if (orden === 'stock_asc') lista.sort((a, b) => Number(a.unidades_fabricables) - Number(b.unidades_fabricables));
  else lista.sort((a, b) => new Date(b.actualizado_en || 0) - new Date(a.actualizado_en || 0));

  renderizarVistaActual(lista);
}

function renderizarVistaActual(lista) {
  if (productosEnMemoria.length === 0) {
    document.getElementById('listaProductos').innerHTML = '<p class="tabla__vacio">Aún no hay productos. Crea la primera ficha técnica con el botón de arriba.</p>';
    document.getElementById('cuerpoTablaProductosLista').innerHTML = '<tr><td colspan="9" class="tabla__vacio">Aún no hay productos.</td></tr>';
    document.getElementById('paginacionProductos').innerHTML = '';
    return;
  }
  if (lista.length === 0) {
    document.getElementById('listaProductos').innerHTML = '<p class="tabla__vacio">Ningún producto coincide con la búsqueda o los filtros.</p>';
    document.getElementById('cuerpoTablaProductosLista').innerHTML = '<tr><td colspan="9" class="tabla__vacio">Ningún producto coincide con la búsqueda o los filtros.</td></tr>';
    document.getElementById('paginacionProductos').innerHTML = '';
    return;
  }

  const totalPaginas = Math.max(1, Math.ceil(lista.length / filasPorPaginaProductos));
  if (paginaProductos > totalPaginas) paginaProductos = totalPaginas;
  const inicio = (paginaProductos - 1) * filasPorPaginaProductos;
  const paginaActual = lista.slice(inicio, inicio + filasPorPaginaProductos);

  if (vistaProductosActual === 'tarjetas') pintarTarjetasProductos(paginaActual);
  else pintarListaTablaProductos(paginaActual);

  pintarPaginacionProductos(lista.length, totalPaginas);
}

function etiquetaEstadoProducto(p) {
  const e = estadoStockProducto(p);
  return e === 'ok' ? 'En stock' : (e === 'bajo' ? 'Stock bajo' : 'Sin stock');
}

function claseEstadoProducto(p) {
  const e = estadoStockProducto(p);
  return e === 'ok' ? 'listo' : (e === 'bajo' ? 'pendiente' : 'critico');
}

function pintarTarjetasProductos(lista) {
  const contenedor = document.getElementById('listaProductos');
  contenedor.innerHTML = lista.map(p => `
    <article class="tarjeta-producto">
      <div style="position:relative;">
        ${p.foto_url
          ? `<img class="tarjeta-producto__foto" src="${escaparHtml(p.foto_url)}" alt="${escaparHtml(p.nombre)}">`
          : `<div class="tarjeta-producto__foto tarjeta-producto__foto--vacia">Sin foto</div>`}
        <span class="etiqueta-estado etiqueta-estado--${claseEstadoProducto(p)}" style="position:absolute; top:8px; left:8px;">${etiquetaEstadoProducto(p)}</span>
        <span class="texto-secundario" style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.55); color:#fff; padding:2px 8px; border-radius:999px; font-size:0.75rem;">Stock: ${Number(p.unidades_fabricables)}</span>
      </div>
      <div class="tarjeta-producto__cuerpo">
        <h3>${escaparHtml(p.nombre)}</h3>
        ${p.categorias_productos ? `<p class="texto-secundario" style="margin:-2px 0 6px">${escaparHtml(p.categorias_productos.nombre)}</p>` : ''}
        <p class="tarjeta-producto__precio">${formatearPesos(p.precio_venta)}</p>
        <p class="tarjeta-producto__margen ${p.margen_valor < 0 ? 'tarjeta-producto__margen--negativo' : ''}">
          Margen: ${formatearPesos(p.margen_valor)} (${p.margen_porcentaje}%)
        </p>
        <div class="tabla__acciones">
          <button type="button" class="boton boton--pequeno" onclick="verDesglose('${p.id}')">Ver</button>
          <button type="button" class="boton boton--pequeno" onclick="abrirFichaProducto('${p.id}')">Editar</button>
          <button type="button" class="boton boton--pequeno boton--peligro" onclick="eliminarProducto('${p.id}')">Eliminar</button>
        </div>
      </div>
    </article>`).join('');
}

function pintarListaTablaProductos(lista) {
  const cuerpo = document.getElementById('cuerpoTablaProductosLista');
  cuerpo.innerHTML = lista.map(p => `
    <tr>
      <td>
        <span class="celda-cliente">
          ${p.foto_url ? `<img src="${escaparHtml(p.foto_url)}" class="miniatura" alt="">` : `<span class="miniatura miniatura--vacia"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/></svg></span>`}
          <strong>${escaparHtml(p.nombre)}</strong>
        </span>
      </td>
      <td>${p.categorias_productos ? escaparHtml(p.categorias_productos.nombre) : '—'}</td>
      <td>${formatearPesos(p.precio_venta)}</td>
      <td>${formatearPesos(p.costo_calculado)}</td>
      <td>${celdaStockProducto(p)}</td>
      <td>${p.material_limitante ? escaparHtml(p.material_limitante.nombre) : '—'}</td>
      <td>${p.actualizado_en ? new Date(p.actualizado_en).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}</td>
      <td><span class="etiqueta-estado etiqueta-estado--${claseEstadoProducto(p)}">${etiquetaEstadoProducto(p)}</span></td>
      <td>${accionesProductoLista(p)}</td>
    </tr>`).join('');
}

function celdaStockProducto(p) {
  const stock = Number(p.unidades_fabricables || 0);
  const objetivo = Math.max(UMBRAL_STOCK_BAJO_PRODUCTO * 2, 1);
  const porcentaje = Math.max(0, Math.min(100, Math.round((stock / objetivo) * 100)));
  const estado = estadoStockProducto(p);
  const color = estado === 'ok' ? 'var(--t-exito)' : (estado === 'bajo' ? 'var(--t-advertencia)' : 'var(--t-peligro)');
  return `
    <div>${stock.toLocaleString('es-CO')}</div>
    <div class="barra-progreso" style="height:5px;margin-top:4px;">
      <div class="barra-progreso__relleno" style="width:${porcentaje}%;background:${color};"></div>
    </div>`;
}

const ICONO_OJO_PRODUCTO = '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>';
const ICONO_LAPIZ_PRODUCTO = '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>';
const ICONO_BASURA_PRODUCTO = '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>';

function accionesProductoLista(p) {
  return `<span class="acciones-fila">
    <button type="button" onclick="verDesglose('${p.id}')" title="Ver desglose"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_OJO_PRODUCTO}</svg></button>
    <button type="button" onclick="abrirFichaProducto('${p.id}')" title="Editar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_LAPIZ_PRODUCTO}</svg></button>
    <button type="button" class="acciones-fila__peligro" onclick="eliminarProducto('${p.id}')" title="Eliminar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_BASURA_PRODUCTO}</svg></button>
  </span>`;
}

function pintarPaginacionProductos(totalFilas, totalPaginas) {
  const contenedor = document.getElementById('paginacionProductos');
  const inicio = totalFilas === 0 ? 0 : (paginaProductos - 1) * filasPorPaginaProductos + 1;
  const fin = Math.min(paginaProductos * filasPorPaginaProductos, totalFilas);

  const botones = [];
  for (let p = 1; p <= totalPaginas; p++) {
    botones.push(`<button type="button" class="${p === paginaProductos ? 'paginacion__botones--activa' : ''}" onclick="irAPaginaProductos(${p})">${p}</button>`);
  }

  contenedor.innerHTML = `
    <span>Mostrando ${inicio} a ${fin} de ${totalFilas} productos</span>
    <span class="paginacion__selector">
      Filas por página
      <select onchange="cambiarFilasPorPaginaProductos(this.value)">
        ${[12, 24, 48, 96].map(n => `<option value="${n}" ${n === filasPorPaginaProductos ? 'selected' : ''}>${n}</option>`).join('')}
      </select>
    </span>
    <span class="paginacion__botones">
      <button type="button" onclick="irAPaginaProductos(${paginaProductos - 1})" ${paginaProductos <= 1 ? 'disabled' : ''}>‹</button>
      ${botones.join('')}
      <button type="button" onclick="irAPaginaProductos(${paginaProductos + 1})" ${paginaProductos >= totalPaginas ? 'disabled' : ''}>›</button>
    </span>`;
}

function irAPaginaProductos(pagina) {
  paginaProductos = pagina;
  pintarListaProductosFiltrada();
}

function cambiarFilasPorPaginaProductos(valor) {
  filasPorPaginaProductos = Number(valor);
  paginaProductos = 1;
  pintarListaProductosFiltrada();
}

function normalizarTextoProducto(texto) {
  return (texto ?? '').toString().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

// ---- 2. Abrir formulario de ficha técnica ----
// Sube la foto elegida al bucket de Supabase (vía el backend, nunca
// directo desde el navegador) y guarda la URL resultante en el campo
// oculto que sí se manda al guardar la ficha técnica.
async function subirFotoProducto() {
  const input = document.getElementById('campoFotoArchivo');
  const archivo = input.files[0];
  if (!archivo) return;

  const previsualizacion = document.getElementById('previsualizacionFoto');
  previsualizacion.innerHTML = '<p class="texto-secundario">Subiendo imagen…</p>';

  try {
    const formData = new FormData();
    formData.append('foto', archivo);
    const token = localStorage.getItem('token_sesion');

    const respuesta = await fetch('/api/almacenamiento/foto-producto', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }, // sin Content-Type: el navegador arma el multipart solo
      body: formData
    });
    const datos = await respuesta.json();
    if (!respuesta.ok) throw new Error(datos.error || 'No se pudo subir la imagen');

    document.getElementById('campoFoto').value = datos.url;
    previsualizacion.innerHTML = `<img src="${datos.url}" class="previsualizacion-foto__imagen" alt="Vista previa">`;
  } catch (err) {
    previsualizacion.innerHTML = '';
    mostrarAviso(err.message, 'error');
  }
}

async function abrirFichaProducto(id) {
  const modal = document.getElementById('modalProducto');
  const titulo = document.getElementById('tituloFicha');

  // Pide los precios actuales de materiales UNA sola vez (para calcular en vivo sin más llamadas)
  try {
    materialesDisponibles = await API.obtener('/api/materiales');
  } catch (err) {
    mostrarAviso('No se pudo cargar la lista de materiales: ' + err.message, 'error');
    return;
  }
  const selector = document.getElementById('selectorMaterial');
  selector.innerHTML = materialesDisponibles
    .map(m => `<option value="${m.id}">${escaparHtml(m.nombre)} (${escaparHtml(m.unidad)}) — ${formatearPesos(m.costo_unitario)}</option>`)
    .join('');

  await cargarCategorias();

  if (id) {
    const p = productosEnMemoria.find(x => x.id === id);
    if (!p) return;
    titulo.textContent = 'Editar ficha técnica';
    document.getElementById('campoProductoId').value = p.id;
    document.getElementById('campoNombreProducto').value = p.nombre;
    document.getElementById('campoFoto').value = p.foto_url || '';
    document.getElementById('previsualizacionFoto').innerHTML = p.foto_url
      ? `<img src="${escaparHtml(p.foto_url)}" class="previsualizacion-foto__imagen" alt="Foto actual">`
      : '';
    document.getElementById('campoPrecioVenta').value = p.precio_venta;
    document.getElementById('campoMinutosSoloLectura').value = `${p.minutos_fabricacion} min`;
    document.getElementById('campoMinutosEditable').value = p.minutos_fabricacion;
    minutosDerivadosActual = Number(p.minutos_fabricacion) || 0;
    pintarSelectorCategoria(p.categoria_id || '');
    fichaEnEdicionUsaCosteoPorProcesos = !!p.usa_costeo_por_procesos;
    fichaEnEdicionTieneProcesos = !!p.tiene_procesos;

    // Trae el desglose para precargar las filas de materiales de la ficha
    // (en modo "por procesos" ya viene agregado desde ahí, de solo lectura)
    try {
      const desglose = await API.obtener(`/api/productos/${id}/costo`);
      filasFichaEnEdicion = desglose.materiales.map(m => ({
        material_id: m.material_id, nombre: m.nombre, unidad: m.unidad,
        costo_unitario: m.costo_unitario, cantidad: m.cantidad
      }));
    } catch (err) {
      filasFichaEnEdicion = [];
      mostrarAviso('No se pudo cargar la ficha técnica: ' + err.message, 'error');
    }
  } else {
    titulo.textContent = 'Nueva ficha técnica';
    document.getElementById('campoProductoId').value = '';
    document.getElementById('campoNombreProducto').value = '';
    document.getElementById('campoFoto').value = '';
    document.getElementById('previsualizacionFoto').innerHTML = '';
    document.getElementById('campoFotoArchivo').value = '';
    document.getElementById('campoPrecioVenta').value = '';
    document.getElementById('campoMinutosSoloLectura').value = '0 min';
    document.getElementById('campoMinutosEditable').value = 0;
    minutosDerivadosActual = 0;
    pintarSelectorCategoria('');
    filasFichaEnEdicion = [];
    fichaEnEdicionUsaCosteoPorProcesos = false;
    fichaEnEdicionTieneProcesos = false;
  }

  document.getElementById('bloqueMaterialesEditable').hidden = fichaEnEdicionUsaCosteoPorProcesos;
  document.getElementById('avisoMaterialesSoloLectura').hidden = !fichaEnEdicionUsaCosteoPorProcesos;
  document.getElementById('tablaMaterialesSoloLectura').hidden = !fichaEnEdicionUsaCosteoPorProcesos;

  // Minutos: editables a mano SOLO si el producto todavía no tiene
  // procesos — en cuanto le asignas el primero, pasan a derivarse solos.
  document.getElementById('campoMinutosEditable').hidden = fichaEnEdicionTieneProcesos;
  document.getElementById('campoMinutosSoloLectura').hidden = !fichaEnEdicionTieneProcesos;
  document.getElementById('textoMinutosOrigen').hidden = !fichaEnEdicionTieneProcesos;

  pintarFilasFicha();
  calcularCostoEnVivo();
  modal.hidden = false;
}

function cerrarFichaProducto() {
  document.getElementById('modalProducto').hidden = true;
}

// ---- Agregar material a la ficha en construcción (antes de guardar) ----
function agregarMaterialAFicha(materialId, cantidad) {
  const idMaterial = materialId || document.getElementById('selectorMaterial').value;
  const cantidadNumero = Number(cantidad ?? document.getElementById('cantidadMaterial').value);

  if (!idMaterial) { mostrarAviso('Elige un material', 'error'); return; }
  if (!cantidadNumero || cantidadNumero <= 0) { mostrarAviso('La cantidad debe ser mayor a 0', 'error'); return; }

  const material = materialesDisponibles.find(m => m.id === idMaterial);
  if (!material) return;

  const filaExistente = filasFichaEnEdicion.find(f => f.material_id === idMaterial);
  if (filaExistente) {
    filaExistente.cantidad = cantidadNumero; // reemplaza la cantidad si ya estaba agregado
  } else {
    filasFichaEnEdicion.push({
      material_id: idMaterial, nombre: material.nombre, unidad: material.unidad,
      costo_unitario: Number(material.costo_unitario), cantidad: cantidadNumero
    });
  }

  document.getElementById('cantidadMaterial').value = '';
  pintarFilasFicha();
  calcularCostoEnVivo();
}

function quitarMaterialDeFicha(materialId) {
  filasFichaEnEdicion = filasFichaEnEdicion.filter(f => f.material_id !== materialId);
  pintarFilasFicha();
  calcularCostoEnVivo();
}

function pintarFilasFicha() {
  const cuerpo = document.getElementById('cuerpoTablaFicha');
  if (filasFichaEnEdicion.length === 0) {
    cuerpo.innerHTML = '<tr><td colspan="5" class="tabla__vacio">Aún no has agregado materiales</td></tr>';
  } else {
    cuerpo.innerHTML = filasFichaEnEdicion.map(f => `
      <tr>
        <td>${escaparHtml(f.nombre)}</td>
        <td>${f.cantidad} ${escaparHtml(f.unidad)}</td>
        <td>${formatearPesos(f.costo_unitario)}</td>
        <td>${formatearPesos(f.costo_unitario * f.cantidad)}</td>
        <td><button type="button" class="boton boton--pequeno boton--peligro" onclick="quitarMaterialDeFicha('${f.material_id}')">Quitar</button></td>
      </tr>`).join('');
  }

  const cuerpoSoloLectura = document.getElementById('cuerpoTablaFichaSoloLectura');
  cuerpoSoloLectura.innerHTML = filasFichaEnEdicion.length === 0
    ? '<tr><td colspan="4" class="tabla__vacio">Sin materiales en los procesos todavía</td></tr>'
    : filasFichaEnEdicion.map(f => `
      <tr>
        <td>${escaparHtml(f.nombre)}</td>
        <td>${f.cantidad} ${escaparHtml(f.unidad)}</td>
        <td>${formatearPesos(f.costo_unitario)}</td>
        <td>${formatearPesos(f.costo_unitario * f.cantidad)}</td>
      </tr>`).join('');
}

// ---- 3. Simulador de margen: recalcula costo y margen sin guardar ----
function calcularCostoEnVivo() {
  const minutos = fichaEnEdicionTieneProcesos
    ? minutosDerivadosActual
    : Number(document.getElementById('campoMinutosEditable').value || 0);
  const precioVenta = Number(document.getElementById('campoPrecioVenta').value || 0);

  const costoMateriales = filasFichaEnEdicion.reduce((s, f) => s + f.costo_unitario * f.cantidad, 0);
  const costoManoObra = minutos * costoMinutoGlobal;
  const costoTotal = costoMateriales + costoManoObra;
  const margenValor = precioVenta - costoTotal;
  const margenPorcentaje = precioVenta > 0 ? (margenValor / precioVenta) * 100 : 0;

  document.getElementById('resumenCostoMateriales').textContent = formatearPesos(costoMateriales);
  document.getElementById('resumenCostoManoObra').textContent = formatearPesos(costoManoObra);
  document.getElementById('resumenCostoTotal').textContent = formatearPesos(costoTotal);
  const elementoMargen = document.getElementById('resumenMargen');
  elementoMargen.textContent = `${formatearPesos(margenValor)} (${margenPorcentaje.toFixed(1)}%)`;
  elementoMargen.style.color = margenValor < 0 ? '#b91c1c' : '';

  return { costoMateriales, costoManoObra, costoTotal, margenValor, margenPorcentaje };
}

// Simula un precio distinto sin guardar (usado, por ejemplo, desde un campo aparte de "qué pasaría si...")
function simularCambioPrecio(nuevoPrecio) {
  const campoPrecio = document.getElementById('campoPrecioVenta');
  const precioOriginal = campoPrecio.value;
  campoPrecio.value = nuevoPrecio;
  const resultado = calcularCostoEnVivo();
  campoPrecio.value = precioOriginal; // no deja el cambio puesto; es solo una simulación visual
  calcularCostoEnVivo();
  return resultado;
}

// ---- Guardar (crear o editar) ----
async function guardarProducto() {
  const id = document.getElementById('campoProductoId').value;
  const nombre = document.getElementById('campoNombreProducto').value;
  const precioVenta = document.getElementById('campoPrecioVenta').value;

  if (!nombre.trim()) { mostrarAviso('El nombre del producto es obligatorio', 'error'); return; }
  if (precioVenta === '' || Number(precioVenta) < 0) { mostrarAviso('El precio de venta no es válido', 'error'); return; }
  // Los materiales ya no son obligatorios aquí: un producto puede crearse
  // vacío y llenarse luego agregándole procesos en la pestaña Procesos.

  const datosFicha = {
    nombre,
    foto_url: document.getElementById('campoFoto').value,
    categoria_id: document.getElementById('selectorCategoriaProducto').value || null,
    precio_venta: precioVenta
  };
  if (!fichaEnEdicionTieneProcesos) {
    datosFicha.minutos_fabricacion = document.getElementById('campoMinutosEditable').value || 0;
  }
  // En modo "por procesos" no se manda `materiales`: esta ficha es de
  // solo lectura aquí, se edita desde Procesos.
  if (!fichaEnEdicionUsaCosteoPorProcesos) {
    datosFicha.materiales = filasFichaEnEdicion.map(f => ({ material_id: f.material_id, cantidad: f.cantidad }));
  }

  try {
    if (id) {
      await API.actualizar(`/api/productos/${id}`, datosFicha);
      mostrarAviso('Ficha técnica actualizada');
    } else {
      await API.enviar('/api/productos', datosFicha);
      mostrarAviso('Producto creado');
    }
    cerrarFichaProducto();
    cargarListaProductos();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Eliminar (o desactivar si tiene ventas) ----
async function eliminarProducto(id) {
  const p = productosEnMemoria.find(x => x.id === id);
  if (!p) return;
  const confirmado = confirm(`¿Eliminar "${p.nombre}"? Si ya tiene ventas registradas, se desactivará en vez de borrarse.`);
  if (!confirmado) return;

  try {
    const resultado = await API.eliminar(`/api/productos/${id}`);
    mostrarAviso(resultado.desactivado ? resultado.mensaje : 'Producto eliminado');
    cargarListaProductos();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Ver desglose de costo puntual ----
async function verDesglose(id) {
  const modal = document.getElementById('modalDesglose');
  const contenido = document.getElementById('contenidoDesglose');
  contenido.innerHTML = '<p>Cargando…</p>';
  modal.hidden = false;

  try {
    const d = await API.obtener(`/api/productos/${id}/costo`);
    document.getElementById('tituloDesglose').textContent = `Desglose de costo — ${d.nombre}`;
    contenido.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Material</th><th>Cantidad</th><th>Costo unitario</th><th>Subtotal</th></tr></thead>
        <tbody>
          ${d.materiales.map(m => `
            <tr><td>${escaparHtml(m.nombre)}</td><td>${m.cantidad} ${escaparHtml(m.unidad)}</td>
                <td>${formatearPesos(m.costo_unitario)}</td><td>${formatearPesos(m.subtotal)}</td></tr>`).join('')}
        </tbody>
      </table>
      <section class="tarjeta tarjeta--resumen">
        <div><span class="campo__etiqueta">Costo materiales</span><strong>${formatearPesos(d.costo_materiales)}</strong></div>
        <div><span class="campo__etiqueta">Costo mano de obra</span><strong>${formatearPesos(d.costo_mano_obra)}</strong></div>
        <div><span class="campo__etiqueta">Costo total</span><strong>${formatearPesos(d.costo_total)}</strong></div>
        <div><span class="campo__etiqueta">Precio de venta</span><strong>${formatearPesos(d.precio_venta)}</strong></div>
      </section>`;
  } catch (err) {
    contenido.innerHTML = `<p class="tabla__vacio">Error: ${escaparHtml(err.message)}</p>`;
  }
}

function cerrarDesglose() {
  document.getElementById('modalDesglose').hidden = true;
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// ---- Conflictos de materiales (producto con procesos cuya lista de
// materiales no coincide con la ficha técnica manual) ----
async function cargarConflictosMateriales() {
  const seccion = document.getElementById('seccionConflictosMateriales');
  try {
    const conflictos = await API.obtener('/api/productos/conflictos-materiales');
    if (!conflictos || conflictos.length === 0) { seccion.hidden = true; return; }

    seccion.hidden = false;
    document.getElementById('listaConflictosMateriales').innerHTML = conflictos.map(c => `
      <div class="tarjeta" style="margin-bottom:12px">
        <h3 style="margin-top:0">${escaparHtml(c.nombre)}</h3>
        <div class="fila-campos">
          <div>
            <p class="texto-secundario"><strong>Ficha técnica (manual)</strong></p>
            <ul>${c.materiales_ficha_tecnica.map(m => `<li>${m.cantidad} ${escaparHtml(m.unidad)} de ${escaparHtml(m.nombre)} — ${formatearPesos(m.subtotal)}</li>`).join('')}</ul>
          </div>
          <div>
            <p class="texto-secundario"><strong>Suma de sus procesos</strong></p>
            <ul>${c.materiales_desde_procesos.map(m => `<li>${m.cantidad} ${escaparHtml(m.unidad)} de ${escaparHtml(m.nombre)} — ${formatearPesos(m.subtotal)}</li>`).join('')}</ul>
          </div>
        </div>
        <div class="modal__acciones">
          <button type="button" class="boton" onclick="resolverConflictoMaterial('${c.producto_id}', false)">Usar ficha técnica</button>
          <button type="button" class="boton boton--primario" onclick="resolverConflictoMaterial('${c.producto_id}', true)">Usar procesos</button>
        </div>
      </div>`).join('');
  } catch (err) {
    seccion.hidden = true;
  }
}

async function resolverConflictoMaterial(productoId, usarProcesos) {
  try {
    await API.actualizar(`/api/productos/${productoId}/costeo-materiales`, { usar_procesos: usarProcesos });
    mostrarAviso('Listo, se actualizó el costo de ese producto');
    cargarConflictosMateriales();
    cargarListaProductos();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  cargarPrecioHora();
  cargarListaProductos();
  cargarConflictosMateriales();
});