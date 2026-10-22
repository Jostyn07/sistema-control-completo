// ============================================================
// admin-uso.js — Panel "Uso del producto" (solo administrador de Fincil)
// Qué se usa, activación, retención, fricción y encuestas. Todo viene
// agregado de /api/admin/uso (telemetría seudónima).
// ============================================================
let diasUso = 30;

const NOMBRES_PANTALLA = {
  index: 'Inicio', materiales: 'Materiales', productos: 'Productos', procesos: 'Procesos', inventario: 'Inventario',
  compras: 'Compras', ventas: 'Ventas', finanzas: 'Finanzas', facturacion: 'Facturación', nomina: 'Nóminas',
  'importar-exportar': 'Importar/Exportar', suscripcion: 'Suscripción', historial: 'Historial', perfil: 'Mi perfil'
};
const NOMBRES_ACCION = {
  'venta.creada': 'Venta registrada', 'venta.estado_cambiado': 'Estado de venta cambiado', 'venta.entrega_registrada': 'Entrega de venta',
  'compra.registrada': 'Compra registrada', 'compra.recibida': 'Compra recibida', 'producto.creado': 'Producto creado',
  'material.creado': 'Material creado', 'proceso.creado': 'Proceso creado', 'inventario.ajustado': 'Ajuste de inventario',
  'factura.generada': 'Factura generada', 'factura.anulada': 'Factura anulada', 'colaborador.creado': 'Colaborador creado',
  'encargo.asignado': 'Encargo asignado', 'excel.analizado': 'Excel analizado', 'excel.importado': 'Excel importado',
  'excel.exportado': 'Excel exportado', 'foto.subida': 'Foto subida', 'equipo.miembro_agregado': 'Miembro agregado',
  'suscripcion.pago_iniciado': 'Pago iniciado', 'suscripcion.pagada': 'Pago aprobado', 'suscripcion.cancelada': 'Suscripción cancelada'
};
const NOMBRES_MOTIVO = {
  no_entendi: 'No entendí qué llenar', me_falta_dato: 'Le faltaba un dato', error_al_guardar: 'Le salió un error',
  solo_mirando: 'Solo estaba mirando', otro: 'Otro', muy_caro: 'Muy caro', dificil_de_usar: 'Difícil de usar',
  falta_funcion: 'Le falta una función', no_lo_uso: 'No lo usa', otro_sistema: 'Otro sistema', cierre_negocio: 'Cerró el negocio'
};

const nombreFormulario = (id) => (id || '').replace(/^modal/, '').replace(/([a-z])([A-Z])/g, '$1 $2') || id;
const pct = (a, b) => b > 0 ? Math.round((a / b) * 100) : 0;
const num = (n) => Number(n || 0).toLocaleString('es-CO');

function barras(filas, { etiqueta, valor, extra }) {
  if (!filas.length) return '<p class="tabla__vacio">Sin datos todavía</p>';
  const max = Math.max(...filas.map(valor), 1);
  return `<div class="uso-barras">${filas.map(f => `
    <div class="uso-barra">
      <span class="uso-barra__etiqueta">${escaparHtml(etiqueta(f))}</span>
      <span class="uso-barra__pista"><span class="uso-barra__relleno" style="width:${Math.max(2, (valor(f) / max) * 100)}%"></span></span>
      <span class="uso-barra__valor">${num(valor(f))}${extra ? ` <span class="texto-secundario">${extra(f)}</span>` : ''}</span>
    </div>`).join('')}</div>`;
}

function tablaSimple(encabezados, filas) {
  if (!filas.length) return '<p class="tabla__vacio">Sin datos todavía</p>';
  return `<div style="overflow-x:auto"><table class="tabla"><thead><tr>${encabezados.map(e => `<th>${e}</th>`).join('')}</tr></thead>
    <tbody>${filas.map(f => `<tr>${f.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}

function pintarUso(d) {
  const t = d.totales || {};
  const e = d.embudo || {};
  const pasos = [
    ['Empresas nuevas', e.nuevas], ['Crearon un material', e.con_material], ['Crearon un producto', e.con_producto],
    ['Registraron una venta', e.con_venta], ['Pagaron', e.pagaron]
  ];
  const fac = (d.encuestas && d.encuestas.facilidad) || {};
  const dist = fac.distribucion || {};
  const motivos = (d.encuestas && d.encuestas.motivos) || [];
  const busq = d.busquedas || {};

  document.getElementById('panelUso').innerHTML = `
    <div class="kpi-grid">
      ${[['Empresas activas', t.empresas_activas], ['Personas activas', t.usuarios_activos], ['Pantallas vistas', t.pantallas_vistas], ['Acciones', t.acciones]]
        .map(([k, v]) => `<div class="kpi-tarjeta"><span class="kpi-tarjeta__etiqueta">${k}</span><span class="kpi-tarjeta__valor">${num(v)}</span></div>`).join('')}
    </div>

    <h3>Activación de empresas nuevas</h3>
    <div class="uso-embudo">
      ${pasos.map(([k, v], i) => `
        <div class="uso-embudo__paso">
          <span class="uso-embudo__valor">${num(v)}</span>
          <span class="uso-embudo__etiqueta">${k}</span>
          ${i > 0 ? `<span class="uso-embudo__pct">${pct(v, e.nuevas)} %</span>` : ''}
        </div>`).join('')}
    </div>
    <p class="texto-secundario">Tiempo mediano hasta la primera venta: <strong>${e.horas_a_primera_venta_mediana != null ? `${num(e.horas_a_primera_venta_mediana)} h` : '—'}</strong></p>

    <h3>Retención (empresas que vuelven)</h3>
    ${tablaSimple(['Semana de llegada', 'Empresas', '1 semana después', '2 semanas', '4 semanas'],
      (d.retencion || []).map(r => [r.semana, num(r.empresas), `${pct(r.s1, r.empresas)} %`, `${pct(r.s2, r.empresas)} %`, `${pct(r.s4, r.empresas)} %`]))}

    <div class="uso-columnas">
      <div>
        <h3>Pantallas más usadas</h3>
        ${barras(d.pantallas || [], { etiqueta: f => NOMBRES_PANTALLA[f.pantalla] || f.pantalla, valor: f => f.vistas, extra: f => `${num(f.empresas)} emp.` })}
      </div>
      <div>
        <h3>Acciones más hechas</h3>
        ${barras(d.acciones || [], { etiqueta: f => NOMBRES_ACCION[f.accion] || f.accion, valor: f => f.veces, extra: f => `${num(f.empresas)} emp.` })}
      </div>
    </div>

    <h3>Ventanas que se cierran sin guardar</h3>
    ${tablaSimple(['Pantalla', 'Ventana', 'Abiertas', 'Sin guardar', '% abandono', 'Segundos antes de cerrar'],
      (d.formularios || []).map(f => [escaparHtml(NOMBRES_PANTALLA[f.pantalla] || f.pantalla), escaparHtml(nombreFormulario(f.formulario)),
        num(f.cerrados), num(f.cerrados_sin_guardar), `<strong>${pct(f.cerrados_sin_guardar, f.cerrados)} %</strong>`,
        f.segundos_mediana_sin_guardar != null ? num(Math.round(f.segundos_mediana_sin_guardar)) : '—']))}

    <div class="uso-columnas">
      <div>
        <h3>Errores que ve la gente</h3>
        ${tablaSimple(['Dónde', 'Código', 'Veces'], (d.errores_usuario || []).map(f => [escaparHtml(`${f.metodo} ${f.ruta}`), f.estado, num(f.veces)]))}
      </div>
      <div>
        <h3>Fallas del sistema</h3>
        ${tablaSimple(['Dónde', 'Veces'], (d.errores_sistema || []).map(f => [escaparHtml(f.lugar), num(f.veces)]))}
      </div>
    </div>

    <div class="uso-columnas">
      <div>
        <h3>Ayuda y recorridos</h3>
        ${tablaSimple(['Pantalla', '¿Cómo funciona?', 'Recorridos completos', 'Omitidos', 'Paso al omitir'],
          (d.ayuda || []).map(f => [escaparHtml(NOMBRES_PANTALLA[f.pantalla] || f.pantalla), num(f.ayuda), num(f.recorridos_completados),
            num(f.recorridos_omitidos), f.paso_mediano_al_omitir != null ? num(f.paso_mediano_al_omitir) : '—']))}
      </div>
      <div>
        <h3>Búsquedas</h3>
        <p>${num(busq.total)} búsquedas · <strong>${pct(busq.sin_resultados, busq.total)} %</strong> sin resultados</p>
      </div>
    </div>

    <h3>Encuestas</h3>
    <div class="uso-columnas">
      <div>
        <p>Facilidad de uso: <strong>${fac.promedio != null ? fac.promedio : '—'} / 5</strong>
          <span class="texto-secundario">· ${num(fac.respuestas)} respuestas, ${num(fac.omitidas)} cerradas sin responder</span></p>
        ${barras([5, 4, 3, 2, 1].map(n => ({ n, v: dist[n] || 0 })), { etiqueta: f => `${f.n}`, valor: f => f.v })}
      </div>
      <div>
        <p><strong>Por qué cancelan</strong></p>
        ${barras(motivos.filter(m => m.encuesta === 'cancelacion'), { etiqueta: f => NOMBRES_MOTIVO[f.motivo] || f.motivo, valor: f => f.veces })}
        <p style="margin-top:16px"><strong>Por qué no terminan una ventana</strong></p>
        ${barras(motivos.filter(m => m.encuesta === 'formulario'), { etiqueta: f => NOMBRES_MOTIVO[f.motivo] || f.motivo, valor: f => f.veces })}
      </div>
    </div>

    <h3>Comentarios recientes</h3>
    ${((d.encuestas && d.encuestas.comentarios) || []).length === 0 ? '<p class="tabla__vacio">Sin comentarios todavía</p>' :
      `<div class="uso-comentarios">${d.encuestas.comentarios.map(c => `
        <div class="uso-comentario">
          <span class="texto-secundario">${formatearFecha(c.fecha)} · ${escaparHtml(c.encuesta === 'facilidad' ? `Facilidad ${c.puntaje || ''}/5` : c.encuesta === 'cancelacion' ? 'Cancelación' : 'Ventana sin terminar')}${c.contexto ? ` · ${escaparHtml(c.contexto)}` : ''}${c.motivo ? ` · ${escaparHtml(NOMBRES_MOTIVO[c.motivo] || c.motivo)}` : ''}</span>
          <p>${escaparHtml(c.comentario)}</p>
        </div>`).join('')}</div>`}
  `;
}

async function cargarUso() {
  const panel = document.getElementById('panelUso');
  try {
    pintarUso(await API.obtener(`/api/admin/uso?dias=${diasUso}`));
  } catch (err) {
    panel.innerHTML = `<p class="tabla__vacio">No se pudo cargar: ${escaparHtml(err.message)}</p>`;
  }
}

function iniciarPanelUso() {
  const selector = document.getElementById('selectorDiasUso');
  if (!selector) return;
  selector.addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-dias]');
    if (!b) return;
    diasUso = Number(b.dataset.dias);
    selector.querySelectorAll('button').forEach(x => x.classList.toggle('boton--activo', x === b));
    cargarUso();
  });
  cargarUso();
}
