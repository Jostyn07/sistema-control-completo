// ============================================================
// CATÁLOGO DE TELEMETRÍA — server/servicios/telemetria/catalogo.js
// FASE 8. Única lista de eventos que Fincil puede medir y de las
// propiedades que cada uno puede llevar. Lo que no está aquí, no sale.
// Regla: solo nombres de módulo/pantalla, códigos, conteos y tiempos.
// Nunca nombres de productos o clientes, precios, costos ni montos.
// ============================================================

// Valores permitidos (enums cerrados) para propiedades de texto
const PANTALLAS = ['index', 'materiales', 'productos', 'procesos', 'inventario', 'compras', 'ventas',
  'finanzas', 'facturacion', 'nomina', 'importar-exportar', 'suscripcion', 'historial', 'perfil'];
const MODULOS_EXCEL = ['materiales', 'productos', 'procesos', 'inventario', 'compras', 'ventas',
  'finanzas', 'facturacion', 'nominas'];

// nombre → { props: { propiedad: 'numero' | 'booleano' | [enum] } }
const EVENTOS = {
  // Automáticos del servidor (middleware/telemetria.js)
  'api.solicitud':          { props: { metodo: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'], estado: 'numero', ruta: 'ruta' } },
  'venta.creada':           { props: {} },
  'venta.estado_cambiado':  { props: {} },
  'venta.entrega_registrada': { props: {} },
  'compra.registrada':      { props: {} },
  'compra.recibida':        { props: {} },
  'producto.creado':        { props: {} },
  'material.creado':        { props: {} },
  'proceso.creado':         { props: {} },
  'inventario.ajustado':    { props: {} },
  'factura.generada':       { props: {} },
  'factura.anulada':        { props: {} },
  'colaborador.creado':     { props: {} },
  'encargo.asignado':       { props: {} },
  'excel.analizado':        { props: { modulo: MODULOS_EXCEL } },
  'excel.importado':        { props: { modulo: MODULOS_EXCEL } },
  'excel.exportado':        { props: { modulo: MODULOS_EXCEL } },
  'foto.subida':            { props: {} },
  'equipo.miembro_agregado': { props: {} },
  'suscripcion.pago_iniciado': { props: {} },
  'suscripcion.cancelada':  { props: {} },

  // Desde el navegador (POST /api/telemetria/eventos)
  'pantalla.abierta':       { props: { pantalla: PANTALLAS }, navegador: true },
  'recorrido.completado':   { props: { pantalla: PANTALLAS }, navegador: true },
  'recorrido.omitido':      { props: { pantalla: PANTALLAS }, navegador: true },
  'busqueda.usada':         { props: { resultados: 'numero' }, navegador: true },
  'error.pantalla':         { props: { pantalla: PANTALLAS }, navegador: true }
};

// Ruta del API (patrón, nunca con IDs) + método + éxito → evento de negocio
const EVENTOS_DE_RUTA = {
  'POST /api/ventas/': 'venta.creada',
  'PUT /api/ventas/:id/estado': 'venta.estado_cambiado',
  'POST /api/ventas/:id/entregas': 'venta.entrega_registrada',
  'POST /api/compras/': 'compra.registrada',
  'POST /api/compras/:id/recibir': 'compra.recibida',
  'POST /api/productos/': 'producto.creado',
  'POST /api/materiales/': 'material.creado',
  'POST /api/procesos/': 'proceso.creado',
  'POST /api/inventario/ajuste': 'inventario.ajustado',
  'POST /api/facturacion/generar': 'factura.generada',
  'POST /api/facturacion/:id/anular': 'factura.anulada',
  'POST /api/colaboradores/': 'colaborador.creado',
  'POST /api/colaboradores/:id/encargos': 'encargo.asignado',
  'POST /api/excel/:modulo/analizar': 'excel.analizado',
  'POST /api/excel/:modulo/importar': 'excel.importado',
  'GET /api/excel/:modulo/exportar': 'excel.exportado',
  'POST /api/almacenamiento/foto-producto': 'foto.subida',
  'POST /api/empresas/miembros': 'equipo.miembro_agregado',
  'POST /api/suscripcion/iniciar-pago': 'suscripcion.pago_iniciado',
  'POST /api/suscripcion/cancelar': 'suscripcion.cancelada'
};

const RUTA_PATRON = /^\/api\/[a-z-]+(\/(:[a-zA-Z]+|[a-z-]+))*\/?$/;

// Deja solo propiedades del catálogo con valores válidos; lo demás se descarta
function filtrarPropiedades(nombre, propiedades) {
  const def = EVENTOS[nombre];
  const limpio = {};
  if (!def || !propiedades || typeof propiedades !== 'object') return limpio;
  for (const [clave, tipo] of Object.entries(def.props)) {
    const v = propiedades[clave];
    if (v === undefined || v === null) continue;
    if (tipo === 'numero' && Number.isFinite(Number(v))) limpio[clave] = Math.max(0, Math.min(Math.round(Number(v)), 1e6));
    else if (tipo === 'booleano' && typeof v === 'boolean') limpio[clave] = v;
    else if (tipo === 'ruta' && typeof v === 'string' && RUTA_PATRON.test(v) && v.length <= 80) limpio[clave] = v;
    else if (Array.isArray(tipo) && tipo.includes(v)) limpio[clave] = v;
  }
  return limpio;
}

module.exports = { EVENTOS, EVENTOS_DE_RUTA, PANTALLAS, filtrarPropiedades };
