// ============================================================
// MODELO DE NEGOCIO — server/servicios/modelo-negocio.js
// empresas.configuracion.modelo_negocio = { fabricacion, reventa }
// Sin elegir todavía: se trata como fabricante (lo que el sistema era
// antes) y `definido: false` para que la interfaz pregunte.
// ============================================================

function normalizarModelo(configuracion) {
  const m = configuracion && typeof configuracion === 'object' ? configuracion.modelo_negocio : null;
  if (!m || typeof m !== 'object' || (!m.fabricacion && !m.reventa)) {
    return { fabricacion: true, reventa: false, definido: false };
  }
  return { fabricacion: !!m.fabricacion, reventa: !!m.reventa, definido: true };
}

// Valida lo que llega del cliente; devuelve { modelo } o { error }
function validarModelo(cuerpo) {
  const b = cuerpo || {};
  if (typeof b.fabricacion !== 'boolean' || typeof b.reventa !== 'boolean') {
    return { error: 'Indica si fabricas, revendes o ambas' };
  }
  if (!b.fabricacion && !b.reventa) return { error: 'Elige al menos una opción' };
  return { modelo: { fabricacion: b.fabricacion, reventa: b.reventa } };
}

module.exports = { normalizarModelo, validarModelo };
