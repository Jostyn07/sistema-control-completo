// ============================================================
// SERVIDOR PRINCIPAL — arranca Express y monta las rutas
// Correr en local:  npm run dev   (http://localhost:3000)
// ============================================================
require('dotenv').config();
const express = require('express');
const path = require('path');

const requiereAutenticacion = require('./middleware/auth');
const requiereSuscripcionActiva = require('./middleware/suscripcion');
const rutasAuth = require('./rutas/auth');
const rutasMateriales = require('./rutas/materiales');
const rutasProductos = require('./rutas/productos');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true })); // el webhook de ePayco manda los datos así, no en JSON

// Archivos estáticos (HTML, CSS, JS del navegador)
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

// ---- Suscripción va ANTES del bloqueo por vencimiento: aunque la
// cuenta esté vencida, la persona siempre debe poder pagar/renovar.
app.use('/api/suscripcion', require('./rutas/suscripcion'));

// ---- De aquí en adelante, si la suscripción está vencida más allá
// del período de gracia, se bloquea crear/editar (nunca lectura).
app.use('/api', requiereSuscripcionActiva);

// ---- Rutas de API (una por módulo; se van sumando en orden) ----
app.use('/api/materiales', rutasMateriales);
app.use('/api/productos', rutasProductos);
app.use('/api/inventario', require('./rutas/inventario'));
app.use('/api/ventas', require('./rutas/ventas'));
app.use('/api/compras', require('./rutas/compras'));
app.use('/api/finanzas', require('./rutas/finanzas'));
app.use('/api/facturacion', require('./rutas/facturacion'));
app.use('/api/configuracion', require('./rutas/configuracion'));
app.use('/api/almacenamiento', require('./rutas/almacenamiento'));

// Manejador de errores único: cualquier ruta que haga next(error) cae aquí
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Error interno' });
});

const PUERTO = process.env.PUERTO || 3000;

// En Vercel el archivo se importa como función; en local se levanta el puerto
if (require.main === module) {
  app.listen(PUERTO, () => console.log(`Servidor listo en http://localhost:${PUERTO}`));
}

module.exports = app;