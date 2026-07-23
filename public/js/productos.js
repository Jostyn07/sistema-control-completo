// ============================================================
// productos.js — pestaña Productos (Fichas Técnicas)
// Funciones (según estructura funcional):
//   cargarListaProductos()
//   abrirFichaProducto(id)
//   agregarMaterialAFicha(materialId, cantidad)
//   calcularCostoEnVivo()
//   guardarProducto(datosFicha)
//   simularCambioPrecio(nuevoPrecio)
// ============================================================

let productosEnMemoria = [];
let materialesDisponibles = [];   // precios actuales, pedidos una sola vez al abrir la ficha
let filasFichaEnEdicion = [];     // [{ material_id, nombre, unidad, costo_unitario, cantidad }]
let costoMinutoGlobal = 0;        // se calcula a partir del precio de hora global

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

// ---- 1. Lista de productos (tarjetas) ----
async function cargarListaProductos() {
  const contenedor = document.getElementById('listaProductos');
  try {
    productosEnMemoria = await API.obtener('/api/productos');

    if (productosEnMemoria.length === 0) {
      contenedor.innerHTML = '<p class="tabla__vacio">Aún no hay productos. Crea la primera ficha técnica con el botón de arriba.</p>';
      return;
    }

    contenedor.innerHTML = productosEnMemoria.map(p => `
      <article class="tarjeta-producto">
        ${p.foto_url
          ? `<img class="tarjeta-producto__foto" src="${escaparHtml(p.foto_url)}" alt="${escaparHtml(p.nombre)}">`
          : `<div class="tarjeta-producto__foto tarjeta-producto__foto--vacia">Sin foto</div>`}
        <div class="tarjeta-producto__cuerpo">
          <h3>${escaparHtml(p.nombre)}</h3>
          <p class="tarjeta-producto__precio">${formatearPesos(p.precio_venta)}</p>
          <p class="tarjeta-producto__margen ${p.margen_valor < 0 ? 'tarjeta-producto__margen--negativo' : ''}">
            Margen: ${formatearPesos(p.margen_valor)} (${p.margen_porcentaje}%)
          </p>
          <div class="tabla__acciones">
            <button type="button" class="boton boton--pequeno" onclick="verDesglose('${p.id}')">Ver desglose</button>
            <button type="button" class="boton boton--pequeno" onclick="abrirFichaProducto('${p.id}')">Editar</button>
            <button type="button" class="boton boton--pequeno boton--peligro" onclick="eliminarProducto('${p.id}')">Eliminar</button>
          </div>
        </div>
      </article>`).join('');
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar la lista: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- 2. Abrir formulario de ficha técnica ----
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

  if (id) {
    const p = productosEnMemoria.find(x => x.id === id);
    if (!p) return;
    titulo.textContent = 'Editar ficha técnica';
    document.getElementById('campoProductoId').value = p.id;
    document.getElementById('campoNombreProducto').value = p.nombre;
    document.getElementById('campoFoto').value = p.foto_url || '';
    document.getElementById('campoPrecioVenta').value = p.precio_venta;
    document.getElementById('campoMinutos').value = p.minutos_fabricacion;

    // Trae el desglose para precargar las filas de materiales de la ficha
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
    document.getElementById('campoPrecioVenta').value = '';
    document.getElementById('campoMinutos').value = 0;
    filasFichaEnEdicion = [];
  }

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
    return;
  }
  cuerpo.innerHTML = filasFichaEnEdicion.map(f => `
    <tr>
      <td>${escaparHtml(f.nombre)}</td>
      <td>${f.cantidad} ${escaparHtml(f.unidad)}</td>
      <td>${formatearPesos(f.costo_unitario)}</td>
      <td>${formatearPesos(f.costo_unitario * f.cantidad)}</td>
      <td><button type="button" class="boton boton--pequeno boton--peligro" onclick="quitarMaterialDeFicha('${f.material_id}')">Quitar</button></td>
    </tr>`).join('');
}

// ---- 3. Simulador de margen: recalcula costo y margen sin guardar ----
function calcularCostoEnVivo() {
  const minutos = Number(document.getElementById('campoMinutos').value || 0);
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
  if (filasFichaEnEdicion.length === 0) { mostrarAviso('Agrega al menos un material a la ficha', 'error'); return; }

  const datosFicha = {
    nombre,
    foto_url: document.getElementById('campoFoto').value,
    precio_venta: precioVenta,
    minutos_fabricacion: document.getElementById('campoMinutos').value,
    materiales: filasFichaEnEdicion.map(f => ({ material_id: f.material_id, cantidad: f.cantidad }))
  };

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

document.addEventListener('DOMContentLoaded', () => {
  cargarPrecioHora();
  cargarListaProductos();
});