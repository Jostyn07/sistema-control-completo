// ============================================================
// SERVIDOR PRINCIPAL — arranca Express y monta las rutas
// Correr en local:  npm run dev   (http://localhost:3000)
// ============================================================
require('dotenv').config();
const express = require('express');
const path = require('path');

const rutasMateriales = require('./rutas/materiales');
const rutasProductos = require('./rutas/productos');

const app = express();
app.use(express.json());

// Archivos estáticos (HTML, CSS, JS del navegador)
app.use(express.static(path.join(__dirname, '..', 'public')));

// ---- Rutas de API (una por módulo; se van sumando en orden) ----
app.use('/api/materiales', rutasMateriales);
app.use('/api/productos', rutasProductos);
app.use('/api/inventario', require('./rutas/inventario'));
app.use('/api/ventas', require('./rutas/ventas'));
app.use('/api/compras', require('./rutas/compras'));
app.use('/api/finanzas', require('./rutas/finanzas'));
app.use('/api/facturacion', require('./rutas/facturacion'));
// app.use('/api/inventario',  require('./rutas/inventario'));  // módulo 3
// app.use('/api/ventas',      require('./rutas/ventas'));      // módulo 4
// app.use('/api/compras',     require('./rutas/compras'));     // módulo 5
// app.use('/api/finanzas',    require('./rutas/finanzas'));    // módulo 6
// app.use('/api/facturacion', require('./rutas/facturacion')); // módulo 7

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
