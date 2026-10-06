// ============================================================
// INSTRUMENTACIÓN — server/instrument.js
// FASE 9. Debe cargarse ANTES que express (primera línea de index.js)
// para que Sentry pueda medir el rendimiento de las peticiones.
// Sin SENTRY_DSN no hace nada.
// ============================================================
require('dotenv').config();
require('./servicios/sentry').iniciar();
