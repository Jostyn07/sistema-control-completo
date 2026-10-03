// ============================================================
// OCULTAR COSTOS POR ROL — server/middleware/ocultarCostos.js
// FASE 6. Si el rol de la petición no tiene "costos.ver" (hoy: el
// operador), se eliminan de la respuesta JSON todos los campos de
// costo, margen, utilidad, ganancia y rentabilidad, a cualquier
// profundidad. Así el operador puede vender y ver productos sin
// conocer cuánto le cuesta a la empresa ni cuánto gana.
// Va después de middleware/tenant.js.
// ============================================================
const { tienePermiso } = require('../seguridad/permisos');
const { esCampoDeCosto } = require('../seguridad/pii');

function quitarCostos(valor, profundidad = 0) {
  if (valor == null || profundidad > 10) return valor;
  if (Array.isArray(valor)) return valor.map(v => quitarCostos(v, profundidad + 1));
  if (typeof valor === 'object' && !(valor instanceof Date)) {
    const limpio = {};
    for (const [clave, v] of Object.entries(valor)) {
      if (!esCampoDeCosto(clave)) limpio[clave] = quitarCostos(v, profundidad + 1);
    }
    return limpio;
  }
  return valor;
}

function ocultarCostos(req, res, next) {
  if (!req.empresa || tienePermiso(req.empresa.rol, 'costos', 'ver')) return next();
  const jsonOriginal = res.json.bind(res);
  res.json = (cuerpo) => jsonOriginal(quitarCostos(cuerpo));
  next();
}

module.exports = ocultarCostos;
module.exports.quitarCostos = quitarCostos;
