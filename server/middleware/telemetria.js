// ============================================================
// MIDDLEWARE DE TELEMETRÍA — server/middleware/telemetria.js
// FASE 8. Al terminar cada petición de /api registra:
//   1. api.solicitud: módulo, método, patrón de ruta (sin IDs),
//      código de estado y duración → uso, rendimiento y errores.
//   2. El evento de negocio si la ruta está en el catálogo y salió
//      bien (ej. POST /api/ventas → venta.creada). Sin contenido:
//      solo que ocurrió.
// Nunca lee req.body ni la respuesta. Va después de tenant.js.
// ============================================================
const { construirEvento, enviar } = require('../servicios/telemetria');
const { EVENTOS_DE_RUTA } = require('../servicios/telemetria/catalogo');

function resultadoDe(estado) {
  if (estado >= 500) return 'error_servidor';
  if (estado >= 400) return 'error_cliente';
  return 'ok';
}

function telemetria(req, res, next) {
  const inicio = process.hrtime.bigint();

  res.on('finish', () => {
    try {
      if (!req.empresa) return;
      // Express puede limpiar req.baseUrl al salir del router (p. ej. en
      // errores), así que el módulo se toma de la URL original: es solo
      // el segmento /api/<modulo>, nunca un ID.
      const segmentos = (req.originalUrl || '').split('?')[0].split('/');
      const modulo = segmentos[2] || null;                               // /api/ventas/123 → ventas
      const patron = req.route ? `/api/${modulo}${req.route.path}` : null; // /api/ventas/:id
      const base = {
        empresaId: req.empresa.id,
        usuarioId: req.usuarioId,
        rol: req.empresa.rol,
        modulo,
        resultado: resultadoDe(res.statusCode),
        duracionMs: Number(process.hrtime.bigint() - inicio) / 1e6
      };

      const eventos = [construirEvento('api.solicitud', {
        ...base,
        propiedades: { metodo: req.method, estado: res.statusCode, ruta: patron || undefined }
      })];

      const negocio = req.route && res.statusCode < 400 ? EVENTOS_DE_RUTA[`${req.method} ${patron}`] : null;
      if (negocio) {
        // excel.*: el módulo (materiales, ventas…) es el 4.º segmento; el catálogo lo valida
        eventos.push(construirEvento(negocio, { ...base, propiedades: { modulo: segmentos[3] } }));
      }
      enviar(eventos);
    } catch (_) { /* la telemetría nunca afecta la petición */ }
  });

  next();
}

module.exports = telemetria;
