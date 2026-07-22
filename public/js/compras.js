// ============================================================
// compras.js — pestaña Compras
// Funciones (según estructura funcional):
//   cargarPendientesCompra()
//   abrirFormularioCompra(materialId)
//   confirmarCompra(datosCompra)
//   cargarHistorialCompras(filtros)
// ============================================================

let pendientesEnMemoria = [];
let materialesParaCompra = [];

// ---- 1. Pendientes de compra (lista automática) ----
async function cargarPendientesCompra() {
  const cuerpo = document.getElementById('cuerpoPendientes');
  try {
    pendientesEnMemoria = await API.obtener('/api/compras/pendientes');

    if (pendientesEnMemoria.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">Nada pendiente: todos los materiales están por encima de su punto de reorden.</td></tr>';
      return;
    }

    cuerpo.innerHTML = pendientesEnMemoria.map(p => `
      <tr>
        <td><span class="semaforo semaforo--${p.estado}"></span></td>
        <td>${escaparHtml(p.nombre)}</td>
        <td>${p.stock_actual} ${escaparHtml(p.unidad)}</td>
        <td>${p.punto_reorden}</td>
        <td><strong>${p.cantidad_sugerida} ${escaparHtml(p.unidad)}</strong></td>
        <td>${escaparHtml(p.proveedor_sugerido)} <span class="texto-secundario">(${p.tiempo_entrega_dias} día(s))</span></td>
        <td>${formatearPesos(p.costo_estimado)}</td>
        <td><button type="button" class="boton boton--pequeno boton--primario" onclick="abrirFormularioCompra('${p.material_id}')">Comprar</button></td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="8" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

// ---- 2. Formulario de compra ----
async function abrirFormularioCompra(materialId) {
  try {
    materialesParaCompra = await API.obtener('/api/materiales');
  } catch (err) {
    mostrarAviso('No se pudo cargar la lista de materiales: ' + err.message, 'error');
    return;
  }
  if (materialesParaCompra.length === 0) {
    mostrarAviso('No hay materiales registrados. Créalos primero en la pestaña Materiales.', 'error');
    return;
  }

  const selector = document.getElementById('selectorMaterialCompra');
  selector.innerHTML = materialesParaCompra
    .map(m => `<option value="${m.id}">${escaparHtml(m.nombre)} (${escaparHtml(m.unidad)})</option>`)
    .join('');

  if (materialId) selector.value = materialId;
  precargarDatosMaterial(materialId);

  document.getElementById('campoNotasCompra').value = '';
  document.getElementById('modalCompra').hidden = false;
}

// Precarga proveedor sugerido, cantidad recomendada y último precio (todo editable)
function precargarDatosMaterial(materialId) {
  const id = materialId || document.getElementById('selectorMaterialCompra').value;
  const material = materialesParaCompra.find(m => m.id === id);
  if (!material) return;

  const pendiente = pendientesEnMemoria.find(p => p.material_id === id);
  document.getElementById('campoProveedorCompra').value = material.proveedor;
  document.getElementById('campoCantidadCompra').value = pendiente ? pendiente.cantidad_sugerida : '';
  document.getElementById('campoPrecioCompra').value = material.costo_unitario;
  calcularTotalCompra();
}

function calcularTotalCompra() {
  const cantidad = Number(document.getElementById('campoCantidadCompra').value || 0);
  const precio = Number(document.getElementById('campoPrecioCompra').value || 0);
  document.getElementById('totalCompra').textContent = formatearPesos(cantidad * precio);
}

function cerrarFormularioCompra() {
  document.getElementById('modalCompra').hidden = true;
}

async function confirmarCompra() {
  const datosCompra = {
    material_id: document.getElementById('selectorMaterialCompra').value,
    proveedor: document.getElementById('campoProveedorCompra').value,
    cantidad: document.getElementById('campoCantidadCompra').value,
    precio_unitario: document.getElementById('campoPrecioCompra').value,
    notas: document.getElementById('campoNotasCompra').value
  };

  if (!datosCompra.proveedor.trim()) { mostrarAviso('El proveedor es obligatorio', 'error'); return; }
  if (!datosCompra.cantidad || Number(datosCompra.cantidad) <= 0) { mostrarAviso('La cantidad debe ser mayor a 0', 'error'); return; }
  if (datosCompra.precio_unitario === '' || Number(datosCompra.precio_unitario) < 0) { mostrarAviso('El precio unitario no es válido', 'error'); return; }

  try {
    const resultado = await API.enviar('/api/compras', datosCompra);
    mostrarAviso(`Compra registrada. Stock actualizado a ${resultado.stock_nuevo}.`);
    if (resultado.sugerencia) {
      // Aviso aparte, un momento después, para que se alcancen a leer los dos
      setTimeout(() => mostrarAviso(resultado.sugerencia, 'error'), 1800);
    }
    cerrarFormularioCompra();
    cargarPendientesCompra();
    cargarHistorialCompras();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- 3. Historial con filtros ----
async function cargarHistorialCompras() {
  const cuerpo = document.getElementById('cuerpoHistorialCompras');
  const filtros = new URLSearchParams();
  const proveedor = document.getElementById('filtroProveedor').value;
  const desde = document.getElementById('filtroDesde').value;
  const hasta = document.getElementById('filtroHasta').value;
  if (proveedor.trim()) filtros.set('proveedor', proveedor.trim());
  if (desde) filtros.set('desde', desde);
  if (hasta) filtros.set('hasta', hasta);

  try {
    const compras = await API.obtener('/api/compras/historial' + (filtros.toString() ? '?' + filtros.toString() : ''));
    if (compras.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="tabla__vacio">No hay compras con esos filtros.</td></tr>';
      return;
    }
    cuerpo.innerHTML = compras.map(c => `
      <tr>
        <td>${formatearFecha(c.fecha)}</td>
        <td>${escaparHtml(c.materiales ? c.materiales.nombre : '—')}</td>
        <td>${escaparHtml(c.proveedor)}</td>
        <td>${c.cantidad} ${escaparHtml(c.materiales ? c.materiales.unidad : '')}</td>
        <td>${formatearPesos(c.precio_unitario)}</td>
        <td>${formatearPesos(c.total)}</td>
        <td>${escaparHtml(c.notas || '')}</td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="7" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function formatearFecha(fecha) {
  return new Date(fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  cargarPendientesCompra();
  cargarHistorialCompras();
});
