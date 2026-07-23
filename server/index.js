// ============================================================
// SERVIDOR PRINCIPAL — arranca Express y monta las rutas
// Correr en local:  npm run dev   (http://localhost:3000)
// ============================================================
require('dotenv').config();
const express = require('express');
const path = require('path');

const requiereAutenticacion = require('./middleware/auth');
const rutasAuth = require('./rutas/auth');
const rutasMateriales = require('./rutas/materiales');
const rutasProductos = require('./rutas/productos');

const app = express();
app.use(express.json());

// Archivos estáticos (HTML, CSS, JS del navegador)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Rutas públicas de autenticación (sin token todavía) ----
app.use('/api/auth', rutasAuth);

// ---- A partir de aquí, toda ruta de /api/* exige sesión válida ----
app.use('/api', requiereAutenticacion);

// ---- Rutas de API (una por módulo; se van sumando en orden) ----
app.use('/api/materiales', rutasMateriales);
app.use('/api/productos', rutasProductos);
app.use('/api/inventario', require('./rutas/inventario'));
app.use('/api/ventas', require('./rutas/ventas'));
app.use('/api/compras', require('./rutas/compras'));
app.use('/api/finanzas', require('./rutas/finanzas'));
app.use('/api/facturacion', require('./rutas/facturacion'));
app.use('/api/configuracion', require('./rutas/configuracion'));

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