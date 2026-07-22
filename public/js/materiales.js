// ============================================================
// materiales.js — pestaña Materiales
// Funciones (según estructura funcional):
//   cargarListaMateriales()
//   abrirFormularioMaterial(id)
//   guardarMaterial()
//   eliminarMaterial(id)
//   verHistorialPrecio(id)
// ============================================================

let materialesEnMemoria = []; // copia local para precargar el formulario sin otro fetch

// ---- 1. Lista ----
async function cargarListaMateriales() {
  const cuerpo = document.getElementById('cuerpoTablaMateriales');
  try {
    materialesEnMemoria = await API.obtener('/api/materiales');

    if (materialesEnMemoria.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="tabla__vacio">Aún no hay materiales. Agrega el primero con el botón de arriba.</td></tr>';
      return;
    }

    cuerpo.innerHTML = materialesEnMemoria.map(m => `
      <tr>
        <td>${escaparHtml(m.nombre)}</td>
        <td>${escaparHtml(m.unidad)}</td>
        <td>${formatearPesos(m.costo_unitario)}</td>
        <td>${escaparHtml(m.proveedor)}</td>
        <td>${m.tiempo_entrega_dias}</td>
        <td>${Number(m.stock_actual)}</td>
        <td class="tabla__acciones">
          <button type="button" class="boton boton--pequeno" onclick="verHistorialPrecio('${m.id}')">Historial</button>
          <button type="button" class="boton boton--pequeno" onclick="abrirFormularioMaterial('${m.id}')">Editar</button>
          <button type="button" class="boton boton--pequeno boton--peligro" onclick="eliminarMaterial('${m.id}')">Eliminar</button>
        </td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="7" class="tabla__vacio">No se pudo cargar la lista: ${escaparHtml(err.message)}</td></tr>`;
  }
}

// ---- 2. Formulario nuevo / editar ----
function abrirFormularioMaterial(id) {
  const modal = document.getElementById('modalMaterial');
  const titulo = document.getElementById('tituloFormulario');
  const grupoStockInicial = document.getElementById('grupoStockInicial');

  if (id) {
    const m = materialesEnMemoria.find(x => x.id === id);
    if (!m) return;
    titulo.textContent = 'Editar material';
    document.getElementById('campoId').value = m.id;
    document.getElementById('campoNombre').value = m.nombre;
    document.getElementById('campoUnidad').value = m.unidad;
    document.getElementById('campoCosto').value = m.costo_unitario;
    document.getElementById('campoProveedor').value = m.proveedor;
    document.getElementById('campoEntrega').value = m.tiempo_entrega_dias;
    document.getElementById('campoStockSeguridad').value = m.stock_seguridad;
    grupoStockInicial.hidden = true; // el stock se ajusta desde Inventario, no aquí
  } else {
    titulo.textContent = 'Nuevo material';
    document.getElementById('campoId').value = '';
    ['campoNombre','campoUnidad','campoCosto','campoProveedor'].forEach(c => document.getElementById(c).value = '');
    document.getElementById('campoEntrega').value = 1;
    document.getElementById('campoStockSeguridad').value = 0;
    document.getElementById('campoStockInicial').value = 0;
    grupoStockInicial.hidden = false;
  }
  modal.hidden = false;
}

function cerrarFormularioMaterial() {
  document.getElementById('modalMaterial').hidden = true;
}

async function guardarMaterial() {
  const id = document.getElementById('campoId').value;
  const datos = {
    nombre: document.getElementById('campoNombre').value,
    unidad: document.getElementById('campoUnidad').value,
    costo_unitario: document.getElementById('campoCosto').value,
    proveedor: document.getElementById('campoProveedor').value,
    tiempo_entrega_dias: document.getElementById('campoEntrega').value,
    stock_seguridad: document.getElementById('campoStockSeguridad').value
  };

  // Validación en el navegador (el backend valida de nuevo)
  if (!datos.nombre.trim() || !datos.unidad.trim() || datos.costo_unitario === '' || !datos.proveedor.trim()) {
    mostrarAviso('Completa los campos obligatorios: nombre, unidad, costo y proveedor', 'error');
    return;
  }

  try {
    if (id) {
      const resultado = await API.actualizar(`/api/materiales/${id}`, datos);
      if (resultado.productos_recalculados > 0) {
        mostrarAviso(`Material actualizado. Se recalculó el costo de ${resultado.productos_recalculados} producto(s).`);
      } else {
        mostrarAviso('Material actualizado');
      }
    } else {
      datos.stock_actual = document.getElementById('campoStockInicial').value;
      await API.enviar('/api/materiales', datos);
      mostrarAviso('Material creado');
    }
    cerrarFormularioMaterial();
    cargarListaMateriales();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Eliminar ----
async function eliminarMaterial(id) {
  const m = materialesEnMemoria.find(x => x.id === id);
  if (!m) return;
  const confirmado = confirm(`¿Eliminar "${m.nombre}"? Esta acción no se puede deshacer.`);
  if (!confirmado) return;

  try {
    await API.eliminar(`/api/materiales/${id}`);
    mostrarAviso('Material eliminado');
    cargarListaMateriales();
  } catch (err) {
    // El backend responde 409 si está usado en una ficha técnica
    mostrarAviso(err.message, 'error');
  }
}

// ---- 3. Historial de precios ----
async function verHistorialPrecio(id) {
  const m = materialesEnMemoria.find(x => x.id === id);
  const modal = document.getElementById('modalHistorial');
  const contenido = document.getElementById('contenidoHistorial');
  document.getElementById('tituloHistorial').textContent = `Historial de precios — ${m ? m.nombre : ''}`;
  contenido.innerHTML = '<p>Cargando…</p>';
  modal.hidden = false;

  try {
    const historial = await API.obtener(`/api/materiales/${id}/historial-precio`);
    if (historial.length === 0) {
      contenido.innerHTML = '<p class="tabla__vacio">Este material no ha tenido cambios de precio todavía.</p>';
      return;
    }
    contenido.innerHTML = `
      <table class="tabla">
        <thead><tr><th>Fecha</th><th>Precio anterior</th><th>Precio nuevo</th><th>Origen</th></tr></thead>
        <tbody>
          ${historial.map(h => `
            <tr>
              <td>${new Date(h.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}</td>
              <td>${formatearPesos(h.costo_anterior)}</td>
              <td>${formatearPesos(h.costo_nuevo)}</td>
              <td>${h.origen === 'compra' ? 'Compra registrada' : 'Edición manual'}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  } catch (err) {
    contenido.innerHTML = `<p class="tabla__vacio">Error: ${escaparHtml(err.message)}</p>`;
  }
}

function cerrarHistorial() {
  document.getElementById('modalHistorial').hidden = true;
}

// ---- Utilidad de seguridad para pintar texto ----
function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// Arranque
document.addEventListener('DOMContentLoaded', cargarListaMateriales);
