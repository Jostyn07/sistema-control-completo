// ============================================================
// PRECIOS DE SUSCRIPCIÓN — server/servicios/precios.js
// Una sola fuente de verdad para lo que se cobra:
//  - Mensual: precio de lista; 50 % de descuento SOLO en el primer pago
//    real de la empresa.
//  - Anual: 12 meses con 30 % de descuento. No se acumula con el 50 %
//    del primer mes.
// El navegador nunca decide el monto: lo calcula el servidor al abrir
// el pago y lo vuelve a comprobar al confirmarlo.
// ============================================================
const PERIODOS = ['mensual', 'anual'];
const DESCUENTO_ANUAL = 0.30;
const DIAS_POR_PERIODO = { mensual: 30, anual: 365 };

function normalizarPeriodo(periodo) {
  return PERIODOS.includes(periodo) ? periodo : 'mensual';
}

function precioAnual(precioMensual) {
  return Math.round(Number(precioMensual) * 12 * (1 - DESCUENTO_ANUAL));
}

// Monto a cobrar (COP, sin centavos)
function calcularMonto(precioMensual, periodo, yaPagoAntes) {
  const p = Number(precioMensual);
  if (normalizarPeriodo(periodo) === 'anual') return precioAnual(p);
  return yaPagoAntes ? p : Math.round(p / 2);
}

// Lo mínimo que se acepta como pago válido de ese periodo (por si el
// descuento del primer mes se aplicó al abrir el pago).
function montoMinimoAceptable(precioMensual, periodo) {
  return normalizarPeriodo(periodo) === 'anual'
    ? precioAnual(precioMensual)
    : Math.round(Number(precioMensual) / 2);
}

// Referencia Wompi: SUB_<empresa>_<plan>_<periodo>_<marca de tiempo>
// (las referencias viejas, sin periodo, se leen como mensual)
function armarReferencia(empresaId, planId, periodo) {
  return `SUB_${empresaId}_${planId}_${normalizarPeriodo(periodo)}_${Date.now()}`;
}
function leerReferencia(referencia) {
  const [prefijo, empresaId, planId, cuarto] = String(referencia || '').split('_');
  return { prefijo, empresaId, planId, periodo: cuarto === 'anual' ? 'anual' : 'mensual' };
}

// Nuevo vencimiento: si aún le quedan días pagados, se suman encima
// (comprar el año antes de que venza el mes no hace perder días).
function calcularVencimiento(vencimientoActual, estadoActual, periodo, ahora = new Date()) {
  let base = ahora;
  if (vencimientoActual && ['activa', 'cancelada'].includes(estadoActual)) {
    const actual = new Date(vencimientoActual);
    if (actual > ahora) base = actual;
  }
  const nuevo = new Date(base);
  nuevo.setDate(nuevo.getDate() + DIAS_POR_PERIODO[normalizarPeriodo(periodo)]);
  return nuevo;
}

module.exports = {
  PERIODOS, DESCUENTO_ANUAL, DIAS_POR_PERIODO,
  normalizarPeriodo, precioAnual, calcularMonto, montoMinimoAceptable,
  armarReferencia, leerReferencia, calcularVencimiento
};
