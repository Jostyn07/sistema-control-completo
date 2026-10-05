// ============================================================
// historial.js — pantalla Historial (auditoría, Fase 7)
// Lee GET /api/auditoria (solo propietario y administrador) y lo
// muestra en lenguaje claro: "Precio de venta: $35.000 → $36.000".
// ============================================================

const NOMBRES_MODULO = {
  productos: 'Productos', materiales: 'Materiales', inventario: 'Inventario', compras: 'Compras',
  ventas: 'Ventas', facturacion: 'Facturación', finanzas: 'Finanzas', colaboradores: 'Nóminas',
  configuracion: 'Configuración', equipo: 'Equipo', tienda: 'Tienda', suscripcion: 'Suscripción'
};

const NOMBRES_ACCION = { crear: 'Creó', editar: 'Editó', eliminar: 'Eliminó', denegado: 'Intento bloqueado' };

const NOMBRES_ENTIDAD = {
  productos: 'producto', materiales: 'material', inventario_ajustes: 'ajuste de inventario',
  compras: 'compra', ventas: 'venta', facturas: 'factura', configuracion_fiscal: 'configuración fiscal',
  configuracion_produccion: 'configuración de producción', costos_fijos: 'costo fijo',
  capital_invertido: 'capital invertido', colaboradores_encargos: 'encargo', tiendas: 'tienda',
  suscripciones: 'suscripción', empresas: 'empresa', empresa_usuarios: 'miembro del equipo', permiso: 'permiso'
};

const NOMBRES_CAMPO = {
  precio_venta: 'Precio de venta', costo_unitario: 'Costo unitario', stock_seguridad: 'Stock de seguridad',
  stock_anterior: 'Stock anterior', stock_nuevo: 'Stock nuevo', activo: 'Activo', estado: 'Estado',
  total: 'Total', pagado: 'Pagado', facturada: 'Facturada', anulada: 'Anulada', numero: 'Número',
  cantidad: 'Cantidad', precio_unitario: 'Precio unitario', costo_hora_mano_obra: 'Costo de la hora de trabajo',
  meta_ventas_mensual: 'Meta de ventas mensual', valor_mensual: 'Valor mensual', valor: 'Valor',
  costo_total_proceso: 'Costo del proceso', rol: 'Rol', nombre: 'Nombre', slug: 'Dirección de la tienda',
  dominio_personalizado: 'Dominio', plan_id: 'Plan', nit: 'NIT', razon_social: 'Razón social',
  regimen: 'Régimen', cedula: 'Cédula', nombre_persona: 'Nombre', metodos_pago: 'Métodos de pago',
  resolucion_numero: 'Resolución DIAN', resolucion_prefijo: 'Prefijo', resolucion_desde: 'Rango desde',
  resolucion_hasta: 'Rango hasta', resolucion_vigencia: 'Vigencia de la resolución'
};

const CAMPOS_EN_PESOS = new Set(['precio_venta', 'costo_unitario', 'total', 'precio_unitario', 'costo_hora_mano_obra',
  'meta_ventas_mensual', 'valor_mensual', 'valor', 'costo_total_proceso']);

function escaparHtmlHistorial(texto) {
  return String(texto ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function nombreCampo(campo) {
  return NOMBRES_CAMPO[campo] || campo.replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
}

function formatearValor(campo, valor) {
  if (valor === null || valor === undefined || valor === '') return '—';
  if (typeof valor === 'boolean') return valor ? 'Sí' : 'No';
  if (CAMPOS_EN_PESOS.has(campo) && !isNaN(valor)) {
    return typeof formatearPesos === 'function' ? formatearPesos(Number(valor)) : '$' + Number(valor).toLocaleString('es-CO');
  }
  return String(valor);
}

// "Precio de venta: $35.000 → $36.000 · Stock de seguridad"
function describirCambios(fila) {
  const c = fila.cambios || {};
  if (fila.accion === 'denegado') return `Sin permiso para <strong>${escaparHtmlHistorial(c.permiso || '')}</strong>`;

  const valores = c.valores || {};
  const partes = [];

  if (fila.accion === 'editar') {
    for (const campo of (c.campos || [])) {
      const v = valores[campo];
      partes.push(v
        ? `${escaparHtmlHistorial(nombreCampo(campo))}: ${escaparHtmlHistorial(formatearValor(campo, v.antes))} → <strong>${escaparHtmlHistorial(formatearValor(campo, v.despues))}</strong>`
        : escaparHtmlHistorial(nombreCampo(campo)));
    }
  } else {
    for (const [campo, valor] of Object.entries(valores)) {
      partes.push(`${escaparHtmlHistorial(nombreCampo(campo))}: ${escaparHtmlHistorial(formatearValor(campo, valor))}`);
    }
  }
  return partes.length ? partes.join(' · ') : '<span class="texto-secundario">—</span>';
}

function formatearFecha(iso) {
  const d = new Date(iso);
  return d.toLocaleString('es-CO', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function cargarHistorial() {
  const cuerpo = document.getElementById('cuerpoHistorial');
  cuerpo.innerHTML = '<tr><td colspan="5" class="tabla__vacio">Cargando…</td></tr>';

  const parametros = new URLSearchParams();
  const modulo = document.getElementById('filtroModulo').value;
  const desde = document.getElementById('filtroDesde').value;
  const hasta = document.getElementById('filtroHasta').value;
  parametros.set('limite', document.getElementById('filtroLimite').value);
  if (modulo) parametros.set('modulo', modulo);
  if (desde) parametros.set('desde', desde);
  if (hasta) parametros.set('hasta', hasta + 'T23:59:59');

  try {
    const filas = await API.obtener('/api/auditoria?' + parametros.toString());
    if (!filas.length) {
      cuerpo.innerHTML = '<tr><td colspan="5" class="tabla__vacio">No hay cambios registrados con estos filtros.</td></tr>';
      return;
    }
    cuerpo.innerHTML = filas.map(f => `
      <tr>
        <td style="white-space:nowrap">${escaparHtmlHistorial(formatearFecha(f.creado_en))}</td>
        <td>${escaparHtmlHistorial(f.actor || 'Sistema')}</td>
        <td>${escaparHtmlHistorial(NOMBRES_ACCION[f.accion] || f.accion)}${f.accion === 'denegado' ? '' : ' ' + escaparHtmlHistorial(NOMBRES_ENTIDAD[f.entidad] || f.entidad)}</td>
        <td>${escaparHtmlHistorial(NOMBRES_MODULO[f.modulo] || f.modulo)}</td>
        <td>${describirCambios(f)}</td>
      </tr>`).join('');
  } catch (err) {
    const sinPermiso = /permiso/i.test(err.message);
    cuerpo.innerHTML = `<tr><td colspan="5" class="tabla__vacio">${sinPermiso
      ? 'Solo el propietario y los administradores pueden ver el historial.'
      : 'No se pudo cargar el historial: ' + escaparHtmlHistorial(err.message)}</td></tr>`;
  }
}
