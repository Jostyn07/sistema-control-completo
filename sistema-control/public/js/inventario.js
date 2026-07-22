// ============================================================
// inventario.js — pestaña Inventario en Tiempo Real
// Funciones (según estructura funcional):
//   cargarInventarioPorMaterial()
//   cargarCapacidadPorProducto()
//   registrarAjusteManual(materialId, cantidadNueva, motivo)
//   refrescarInventario()
//
// Nota sobre "tiempo real": como el navegador nunca habla con
// Supabase directamente (regla de arquitectura del proyecto), la
// vista se refresca sola cada 15 segundos y también al volver a
// la pestaña del navegador. Si más adelante se quiere el push
// instantáneo de Supabase Realtime, habría que exponer una anon
// key con política de solo-lectura — decisión aparte de seguridad.
// ============================================================

const SEGUNDOS_REFRESCO = 15;
let inventarioEnMemoria = [];
let temporizadorRefresco = null;

// ---- 1. Vista por material (semáforo) ----
async function cargarInventarioPorMaterial() {
  const cuerpo = document.getElementById('cuerpoInventarioMateriales');
  try {
    inventarioEnMemoria = await API.obtener('/api/inventario/materiales');

    if (inventarioEnMemoria.length === 0) {
      cuerpo.innerHTML = '<tr><td colspan="7" class="tabla__vacio">No hay materiales registrados todavía. Créalos en la pestaña Materiales.</td></tr>';
      return;
    }

    // Rojo primero, luego amarillo, luego verde (lo urgente arriba)
    const orden = { rojo: 0, amarillo: 1, verde: 2 };
    const ordenados = [...inventarioEnMemoria].sort((a, b) => orden[a.estado] - orden[b.estado]);

    cuerpo.innerHTML = ordenados.map(m => `
      <tr>
        <td><span class="semaforo semaforo--${m.estado}" title="${textoEstado(m.estado)}"></span></td>
        <td>${escaparHtml(m.nombre)}</td>
        <td>${m.stock_actual} ${escaparHtml(m.unidad)}</td>
        <td>${m.punto_reorden}</td>
        <td>${m.consumo_diario_promedio > 0 ? m.consumo_diario_promedio + '/día' : 'Sin ventas aún'}</td>
        <td>${escaparHtml(m.proveedor)}</td>
        <td><button type="button" class="boton boton--pequeno" onclick="abrirAjuste('${m.id}')">Ajustar</button></td>
      </tr>`).join('');
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="7" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

function textoEstado(estado) {
  if (estado === 'rojo') return 'Comprar ya: el stock está en o por debajo del punto de reorden';
  if (estado === 'amarillo') return 'Atención: el stock se acerca al punto de reorden';
  return 'Stock suficiente';
}

// ---- 2. Vista por producto (capacidad) ----
async function cargarCapacidadPorProducto() {
  const contenedor = document.getElementById('listaCapacidad');
  try {
    const capacidad = await API.obtener('/api/inventario/capacidad');

    if (capacidad.length === 0) {
      contenedor.innerHTML = '<p class="tabla__vacio">No hay productos registrados todavía. Crea las fichas técnicas en la pestaña Productos.</p>';
      return;
    }

    contenedor.innerHTML = capacidad.map(p => `
      <article class="tarjeta-producto">
        <div class="tarjeta-producto__cuerpo">
          <h3>${escaparHtml(p.nombre)}</h3>
          <p class="capacidad__numero ${p.unidades_fabricables === 0 ? 'capacidad__numero--cero' : ''}">
            ${p.unidades_fabricables} <span class="texto-secundario">unidades fabricables</span>
          </p>
          ${p.material_limitante ? `
            <p class="texto-secundario">
              Limita: <strong>${escaparHtml(p.material_limitante.nombre)}</strong>
              (quedan ${p.material_limitante.stock_actual} ${escaparHtml(p.material_limitante.unidad)},
              usa ${p.material_limitante.cantidad_por_unidad} por unidad)
            </p>` : `<p class="texto-secundario">${escaparHtml(p.detalle || '')}</p>`}
        </div>
      </article>`).join('');
  } catch (err) {
    contenedor.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

// ---- 3. Ajuste manual ----
function abrirAjuste(materialId) {
  const m = inventarioEnMemoria.find(x => x.id === materialId);
  if (!m) return;
  document.getElementById('tituloAjuste').textContent = `Ajustar inventario — ${m.nombre}`;
  document.getElementById('campoAjusteMaterialId').value = m.id;
  document.getElementById('textoStockActual').textContent =
    `El sistema registra ${m.stock_actual} ${m.unidad}. Escribe la cantidad real que contaste.`;
  document.getElementById('campoCantidadNueva').value = m.stock_actual;
  document.getElementById('campoMotivo').value = '';
  document.getElementById('modalAjuste').hidden = false;
}

function cerrarAjuste() {
  document.getElementById('modalAjuste').hidden = true;
}

async function confirmarAjuste() {
  const materialId = document.getElementById('campoAjusteMaterialId').value;
  const cantidadNueva = document.getElementById('campoCantidadNueva').value;
  const motivo = document.getElementById('campoMotivo').value;
  await registrarAjusteManual(materialId, cantidadNueva, motivo);
}

async function registrarAjusteManual(materialId, cantidadNueva, motivo) {
  if (cantidadNueva === '' || Number(cantidadNueva) < 0) {
    mostrarAviso('La cantidad debe ser un número mayor o igual a 0', 'error');
    return;
  }
  if (!motivo || !motivo.trim()) {
    mostrarAviso('El motivo es obligatorio: es lo que deja rastro de por qué cambió el stock', 'error');
    return;
  }

  try {
    const resultado = await API.enviar('/api/inventario/ajuste', {
      material_id: materialId,
      cantidad_nueva: cantidadNueva,
      motivo
    });
    mostrarAviso(`Ajuste registrado: de ${resultado.stock_anterior} a ${resultado.stock_nuevo}`);
    cerrarAjuste();
    refrescarInventario();
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Refresco automático ----
async function refrescarInventario() {
  await Promise.all([cargarInventarioPorMaterial(), cargarCapacidadPorProducto()]);
  const ahora = new Date().toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  document.getElementById('indicadorActualizacion').textContent = `Actualizado ${ahora} · se refresca solo cada ${SEGUNDOS_REFRESCO}s`;
}

function iniciarRefrescoAutomatico() {
  if (temporizadorRefresco) clearInterval(temporizadorRefresco);
  temporizadorRefresco = setInterval(refrescarInventario, SEGUNDOS_REFRESCO * 1000);

  // Refresca también al volver a la pestaña del navegador
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) refrescarInventario();
  });
}

function escaparHtml(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

document.addEventListener('DOMContentLoaded', () => {
  refrescarInventario();
  iniciarRefrescoAutomatico();
});
