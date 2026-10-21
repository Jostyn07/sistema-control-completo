// ============================================================
// Inventario · Historial unificado — public/js/inventario-historial.js
// Materiales y productos terminados en una sola lista, con detalle de
// cada operación, enlace al origen y reversión.
// ============================================================
let historialInventario = { pagina: 1, total: 0, por_pagina: 50, movimientos: [] };
let operacionActual = null;

const NOMBRES_ORIGEN = {
  venta: 'Venta', venta_edicion: 'Venta editada', venta_eliminacion: 'Venta eliminada', compra: 'Compra',
  compra_reventa: 'Compra reventa', ajuste: 'Ajuste', produccion: 'Producción', fabricacion: 'Fabricación',
  ingreso_producto: 'Ingreso', salida_producto: 'Salida', entrega_proceso: 'Entrega de proceso',
  importacion: 'Importación', reversion: 'Reversión'
};

function filtrosHistorial(pagina) {
  const f = new URLSearchParams();
  const valor = (id) => document.getElementById(id).value.trim();
  if (valor('filtroHistArticulo')) f.set('articulo', valor('filtroHistArticulo'));
  if (valor('filtroHistOrigen')) f.set('origen', valor('filtroHistOrigen'));
  if (valor('filtroHistDesde')) f.set('desde', valor('filtroHistDesde'));
  if (valor('filtroHistHasta')) f.set('hasta', valor('filtroHistHasta'));
  if (valor('filtroHistTexto')) f.set('q', valor('filtroHistTexto'));
  f.set('pagina', String(pagina));
  return f;
}

async function cargarHistorialInventario(pagina = 1) {
  const cuerpo = document.getElementById('cuerpoHistorialInventario');
  try {
    historialInventario = await API.obtener(`/api/inventario/movimientos?${filtrosHistorial(pagina)}`);
    pintarHistorialInventario();
  } catch (err) {
    cuerpo.innerHTML = `<tr><td colspan="8" class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</td></tr>`;
  }
}

const fechaCorta = (f) => new Date(f).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' });
const numero = (n) => Number(n).toLocaleString('es-CO', { maximumFractionDigits: 4 });

function pintarHistorialInventario() {
  const cuerpo = document.getElementById('cuerpoHistorialInventario');
  const { movimientos, pagina, total, por_pagina } = historialInventario;
  if (!movimientos.length) {
    cuerpo.innerHTML = '<tr><td colspan="8" class="tabla__vacio">No hay movimientos con estos filtros</td></tr>';
  } else {
    cuerpo.innerHTML = movimientos.map(m => `
      <tr>
        <td style="white-space:nowrap;">${fechaCorta(m.fecha)}</td>
        <td>${escaparHtml(m.nombre || '—')} <span class="texto-secundario">· ${m.articulo === 'producto' ? 'Producto' : 'Material'}</span></td>
        <td>${escaparHtml(NOMBRES_ORIGEN[m.origen] || m.origen)}</td>
        <td><strong style="color:${m.cantidad < 0 ? 'var(--t-peligro)' : 'var(--t-exito)'}">${m.cantidad > 0 ? '+' : ''}${numero(m.cantidad)}</strong>${m.unidad ? ` <span class="texto-secundario">${escaparHtml(m.unidad)}</span>` : ''}</td>
        <td style="white-space:nowrap;">${numero(m.stock_anterior)} → ${numero(m.stock_nuevo)}</td>
        <td>${escaparHtml(m.motivo || '')}</td>
        <td>${escaparHtml(m.usuario)}</td>
        <td>${m.operacion_id ? `<button type="button" class="boton boton--pequeno" onclick="verOperacion('${m.operacion_id}')">Detalle</button>` : ''}</td>
      </tr>`).join('');
  }

  const paginas = Math.max(1, Math.ceil(total / por_pagina));
  document.getElementById('paginacionHistorialInventario').innerHTML = paginas <= 1 ? '' : `
    <button type="button" class="boton boton--pequeno" ${pagina <= 1 ? 'disabled' : ''} onclick="cargarHistorialInventario(${pagina - 1})">←</button>
    <span class="texto-secundario">Página ${pagina} de ${paginas} · ${total} movimientos</span>
    <button type="button" class="boton boton--pequeno" ${pagina >= paginas ? 'disabled' : ''} onclick="cargarHistorialInventario(${pagina + 1})">→</button>`;
}

// ---- Detalle y reversión ----
async function verOperacion(id) {
  const modal = document.getElementById('modalOperacion');
  document.getElementById('cuerpoOperacion').innerHTML = '<tr><td colspan="3" class="tabla__vacio">Cargando…</td></tr>';
  document.getElementById('bloqueRevertir').hidden = true;
  document.getElementById('botonRevertir').hidden = true;
  document.getElementById('enlaceOrigenOperacion').hidden = true;
  modal.hidden = false;
  try {
    const op = await API.obtener(`/api/inventario/operaciones/${id}`);
    operacionActual = op;
    document.getElementById('tituloOperacion').textContent =
      `${NOMBRES_ORIGEN[op.tipo] || op.tipo}${op.estado === 'revertida' ? ' · revertida' : ''}${op.forzada ? ' · forzada' : ''}`;
    document.getElementById('textoOperacion').textContent =
      [fechaCorta(op.creado_en), op.usuario, op.motivo].filter(Boolean).join(' · ');
    document.getElementById('cuerpoOperacion').innerHTML = op.movimientos.map(m => `
      <tr>
        <td>${escaparHtml(m.nombre || '—')} <span class="texto-secundario">· ${m.articulo === 'producto' ? 'Producto' : 'Material'}</span></td>
        <td><strong>${m.cantidad > 0 ? '+' : ''}${numero(m.cantidad)}</strong>${m.unidad ? ` ${escaparHtml(m.unidad)}` : ''}</td>
        <td>${numero(m.stock_anterior)} → ${numero(m.stock_nuevo)}</td>
      </tr>`).join('');
    const enlace = document.getElementById('enlaceOrigenOperacion');
    if (op.enlace_origen) { enlace.href = op.enlace_origen; enlace.hidden = false; }
    if (op.reversible) {
      document.getElementById('campoMotivoRevertir').value = '';
      document.getElementById('bloqueRevertir').hidden = false;
      document.getElementById('botonRevertir').hidden = false;
    } else if (op.motivo_no_reversible) {
      document.getElementById('textoOperacion').textContent += ` · ${op.motivo_no_reversible}`;
    }
  } catch (err) {
    document.getElementById('cuerpoOperacion').innerHTML = `<tr><td colspan="3" class="tabla__vacio">${escaparHtml(err.message)}</td></tr>`;
  }
}

async function revertirOperacionActual(forzar = false) {
  if (!operacionActual) return;
  const motivo = document.getElementById('campoMotivoRevertir').value.trim();
  if (!motivo) { mostrarAviso('El motivo es obligatorio', 'error'); return; }
  try {
    await API.enviar(`/api/inventario/operaciones/${operacionActual.id}/revertir`, { motivo, forzar });
    mostrarAviso('Operación revertida');
    document.getElementById('modalOperacion').hidden = true;
    cargarHistorialInventario(historialInventario.pagina);
    if (typeof cargarProductosStock === 'function') cargarProductosStock();
  } catch (err) {
    if (!forzar && err.message.includes('negativo')) {
      if (confirm(`${err.message}.\n\n¿Revertir de todas formas?`)) revertirOperacionActual(true);
      return;
    }
    mostrarAviso(err.message, 'error');
  }
}

// ---- Exportar (todas las páginas con los filtros actuales) ----
async function exportarHistorialCsv() {
  try {
    const filas = [];
    for (let pagina = 1; pagina <= 40; pagina++) {
      const r = await API.obtener(`/api/inventario/movimientos?${filtrosHistorial(pagina)}`);
      filas.push(...r.movimientos);
      if (pagina * r.por_pagina >= r.total) break;
    }
    const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [
      ['Fecha', 'Tipo de artículo', 'Artículo', 'Origen', 'Cantidad', 'Unidad', 'Stock anterior', 'Stock nuevo', 'Motivo', 'Usuario'].map(celda).join(';'),
      ...filas.map(m => [new Date(m.fecha).toLocaleString('es-CO'), m.articulo === 'producto' ? 'Producto' : 'Material', m.nombre,
        NOMBRES_ORIGEN[m.origen] || m.origen, String(m.cantidad).replace('.', ','), m.unidad,
        String(m.stock_anterior).replace('.', ','), String(m.stock_nuevo).replace('.', ','), m.motivo, m.usuario].map(celda).join(';'))
    ].join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `historial-inventario-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}
