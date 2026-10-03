// ============================================================
// MIDDLEWARE DE PERMISOS — server/middleware/permissions.js
// FASE 3. Se monta por módulo en index.js:
//   app.use('/api/ventas', requierePermiso('ventas'), rutasVentas)
// La acción sale del método HTTP (GET=ver, POST=crear, PUT/PATCH=
// editar, DELETE=eliminar). Para una ruta puntual que necesite otra
// acción, úsalo dentro del router:
//   router.post('/anular', requierePermiso('facturacion', 'administrar'), ...)
// Requiere que middleware/tenant.js ya haya puesto req.empresa.
// ============================================================
const { tienePermiso, accionDeMetodo } = require('../seguridad/permisos');

function requierePermiso(modulo, accionFija) {
  return function verificarPermiso(req, res, next) {
    if (!req.empresa) {
      return res.status(500).json({ error: 'Falta el contexto de empresa' });
    }
    const accion = accionFija || accionDeMetodo(req.method);
    if (!tienePermiso(req.empresa.rol, modulo, accion)) {
      return res.status(403).json({
        error: 'Tu rol no tiene permiso para esta acción',
        permiso_requerido: `${modulo}.${accion}`
      });
    }
    next();
  };
}

module.exports = requierePermiso;
