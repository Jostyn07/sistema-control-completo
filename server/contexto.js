// ============================================================
// CONTEXTO DE PETICIÓN — server/contexto.js
// Guarda, durante toda una petición HTTP, quién es el usuario, en
// qué empresa está trabajando y con qué cliente de Supabase deben
// hacerse las consultas. Usa AsyncLocalStorage: cualquier servicio
// llamado desde la ruta (aunque no reciba `req`) puede leerlo.
// Fuera de una petición (webhooks, scripts) no hay contexto y todo
// devuelve null.
// ============================================================
const { AsyncLocalStorage } = require('node:async_hooks');

const almacen = new AsyncLocalStorage();

function ejecutarConContexto(contexto, fn) {
  return almacen.run(Object.freeze({ ...contexto }), fn);
}

function contextoActual() {
  return almacen.getStore() || null;
}

// Autor de la acción (va en usuario_id de las filas nuevas)
function usuarioActual() {
  const c = contextoActual();
  return c ? c.usuarioId : null;
}

// Dueño de los datos (empresa activa de la petición)
function empresaActual() {
  const c = contextoActual();
  return c ? c.empresaId : null;
}

module.exports = { ejecutarConContexto, contextoActual, usuarioActual, empresaActual };
