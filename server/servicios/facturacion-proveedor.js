// ============================================================
// ADAPTADOR DE PROVEEDOR DE FACTURACIÓN — server/servicios/facturacion-proveedor.js
//
// La decisión de CÓMO validar ante la DIAN sigue abierta (servicio
// gratuito manual, proveedor tecnológico con API, o desarrollo propio).
// Para que esa decisión no frene el resto del módulo, TODO lo que
// depende de ella vive en este único archivo.
//
// Modo actual: 'interno' — el sistema genera la factura con su
// numeración según la resolución, la guarda y produce una versión
// imprimible; el CUFE queda pendiente porque solo lo emite la DIAN
// o un proveedor autorizado.
//
// Cuando se elija proveedor (ej. Factus, Siigo, Alegra):
// 1. Implementar emitirAnteProveedor() con su API
// 2. Cambiar MODO a 'proveedor'
// Nada más del módulo se toca.
// ============================================================

const MODO = 'interno'; // 'interno' | 'proveedor'

// Emite la factura ante el proveedor tecnológico y devuelve
// { cufe, pdf_url, estado }. Por implementar cuando se decida proveedor.
async function emitirAnteProveedor(datosFactura) {
  throw new Error('Aún no hay proveedor de facturación configurado. La factura quedó guardada en modo interno.');
}

// Punto de entrada único que usa el módulo de facturación
async function emitir(datosFactura) {
  if (MODO === 'proveedor') {
    return emitirAnteProveedor(datosFactura);
  }
  // Modo interno: sin validación DIAN todavía
  return {
    cufe: null,
    pdf_url: null,
    estado: 'generada_interna',
    nota: 'Factura generada internamente. La validación ante la DIAN (CUFE) requiere el proveedor tecnológico, aún por decidir.'
  };
}

module.exports = { emitir, MODO };
