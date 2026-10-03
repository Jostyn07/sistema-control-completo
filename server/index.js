// ============================================================
// SERVIDOR PRINCIPAL — arranca Express y monta las rutas
// Correr en local:  npm run dev   (http://localhost:3000)
// ============================================================
require('dotenv').config();
const express = require('express');
const path = require('path');

const requiereAutenticacion = require('./middleware/auth');
const requiereSuscripcionActiva = require('./middleware/suscripcion');
const exigirAdmin = require('./middleware/admin');
const resolverEmpresa = require('./middleware/tenant');
const requierePermiso = require('./middleware/permissions');
const ocultarCostos = require('./middleware/ocultarCostos');
const log = require('./seguridad/log');
const { esErrorInterno, sanitizarTexto } = require('./seguridad/sanitize');
const { randomUUID } = require('node:crypto');
const rutasAuth = require('./rutas/auth');
const rutasMateriales = require('./rutas/materiales');
const rutasProductos = require('./rutas/productos');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // por si algún formulario manda datos así, no en JSON

// Archivos estáticos (HTML, CSS, JS del navegador)
// La raíz sirve la landing pública, no el dashboard — debe ir antes de
// express.static para que este no resuelva '/' contra public/index.html.
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'landing', 'index.html'));
});
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Rutas públicas de autenticación (sin token todavía) ----
app.use('/api/auth', rutasAuth);

// ---- Webhooks de terceros: PÚBLICOS también, nunca llevan nuestro
// token de sesión (los llaman los servidores del proveedor, no el
// navegador del usuario) — su seguridad depende de validar la firma
// dentro de cada ruta, no de este middleware.
app.use('/api/webhooks', require('./rutas/webhooks'));

// ---- A partir de aquí, toda ruta de /api/* exige sesión válida ----
app.use('/api', requiereAutenticacion);

// ---- Admin de PLATAFORMA (platform_owner): mira métricas de toda la
// plataforma, no una empresa. Va antes del contexto de empresa.
app.use('/api/admin', exigirAdmin, require('./rutas/admin'));

// ---- Desde aquí toda petición trabaja dentro de UNA empresa:
// tenant.js valida la membresía y deja req.empresa = { id, rol, permisos }.
app.use('/api', resolverEmpresa);

// ---- Si el rol no puede ver costos (operador), se quitan de toda respuesta.
app.use('/api', ocultarCostos);

// ---- Empresas y equipo (permisos se validan ruta por ruta adentro).
app.use('/api/empresas', require('./rutas/empresas'));

// ---- Suscripción va ANTES del bloqueo por vencimiento: aunque la
// cuenta esté vencida, la persona siempre debe poder pagar/renovar.
app.use('/api/suscripcion', requierePermiso('suscripcion'), require('./rutas/suscripcion'));

// ---- De aquí en adelante, si la suscripción está vencida más allá
// del período de gracia, se bloquea crear/editar (nunca lectura).
app.use('/api', requiereSuscripcionActiva);

// ---- Rutas de negocio: cada una exige el permiso de su módulo.
// La acción sale del método: GET=ver, POST=crear, PUT/PATCH=editar, DELETE=eliminar.
app.use('/api/materiales', requierePermiso('materiales'), rutasMateriales);
app.use('/api/productos', requierePermiso('productos'), rutasProductos);
app.use('/api/categorias', requierePermiso('categorias'), require('./rutas/categorias'));
app.use('/api/procesos', requierePermiso('procesos'), require('./rutas/procesos'));
app.use('/api/colaboradores', requierePermiso('colaboradores'), require('./rutas/colaboradores'));
app.use('/api/inventario', requierePermiso('inventario'), require('./rutas/inventario'));
app.use('/api/ventas', requierePermiso('ventas'), require('./rutas/ventas'));
app.use('/api/compras', requierePermiso('compras'), require('./rutas/compras'));
app.use('/api/finanzas', requierePermiso('finanzas'), require('./rutas/finanzas'));
app.use('/api/dashboard', requierePermiso('dashboard'), require('./rutas/dashboard'));
app.use('/api/facturacion', requierePermiso('facturacion'), require('./rutas/facturacion'));
// /onboarding (¿ya vio el recorrido?) lo usa cualquier rol al entrar;
// el resto de configuración (costo de mano de obra, metas) exige permiso.
const permisoConfiguracion = requierePermiso('configuracion');
app.use('/api/configuracion',
  (req, res, next) => (req.path.startsWith('/onboarding') ? next() : permisoConfiguracion(req, res, next)),
  require('./rutas/configuracion'));
app.use('/api/almacenamiento', requierePermiso('almacenamiento'), require('./rutas/almacenamiento'));
app.use('/api/excel', requierePermiso('excel'), require('./rutas/excel'));

// Manejador de errores único: cualquier ruta que haga next(error) cae aquí.
// FASE 6:
// - El log nunca lleva body, query ni headers; el mensaje va sanitizado.
// - Errores 4xx: el mensaje se devuelve (son validaciones para el usuario).
// - Errores 5xx con detalle interno de la base (constraints, columnas,
//   valores): el cliente recibe un mensaje genérico + una referencia
//   que permite encontrar el detalle en los logs de Vercel.
app.use((err, req, res, next) => {
  const estado = err.status || 500;
  const referencia = randomUUID().slice(0, 8);
  log.error('[API]', err, {
    ref: referencia,
    metodo: req.method,
    ruta: (req.baseUrl || '') + (req.route ? req.route.path : ''),
    estado,
    rol: req.empresa ? req.empresa.rol : undefined
  });

  if (estado < 500) return res.status(estado).json({ error: sanitizarTexto(err.message) || 'Solicitud inválida' });
  if (esErrorInterno(err.message)) {
    return res.status(estado).json({ error: `Ocurrió un error inesperado. Si se repite, comparte esta referencia: ${referencia}`, referencia });
  }
  res.status(estado).json({ error: sanitizarTexto(err.message) || 'Error interno', referencia });
});

const PUERTO = process.env.PUERTO || 3000;

// En Vercel el archivo se importa como función; en local se levanta el puerto
if (require.main === module) {
  app.listen(PUERTO, () => console.log(`Servidor listo en http://localhost:${PUERTO}`));
}

module.exports = app;