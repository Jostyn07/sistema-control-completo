// ============================================================
// SERVICIO — métodos de pago (server/servicios/metodosPago.js)
// Regla compartida entre Facturación (configuracion_fiscal) y
// Colaboradores: hasta 5 métodos, cada uno con tipo (cuenta/llave/
// nequi) y un valor obligatorio. Una sola función de validación para
// no mantenerla duplicada en dos rutas distintas.
// ============================================================
const TIPOS_METODO_PAGO = ['cuenta', 'llave', 'nequi'];

// Devuelve { error } si algo no es válido, o { limpios } con la lista
// ya normalizada (valor y etiqueta recortados, etiqueta vacía -> null).
function validarYLimpiarMetodosPago(metodosPago) {
  const lista = Array.isArray(metodosPago) ? metodosPago : [];
  if (lista.length > 5) return { error: 'Puedes agregar máximo 5 métodos de pago' };

  for (const m of lista) {
    if (!TIPOS_METODO_PAGO.includes(m.tipo))
      return { error: 'Cada método de pago debe ser cuenta, llave o nequi' };
    if (!m.valor || !String(m.valor).trim())
      return { error: 'Cada método de pago necesita un valor (número de cuenta, llave o Nequi)' };
  }

  const limpios = lista.map(m => ({
    tipo: m.tipo,
    valor: String(m.valor).trim(),
    etiqueta: (m.etiqueta || '').trim() || null
  }));
  return { limpios };
}

module.exports = { TIPOS_METODO_PAGO, validarYLimpiarMetodosPago };