// ============================================================
// CLASIFICACIÓN DE DATOS — server/seguridad/pii.js
// FASE 6. Qué es cada dato y a dónde NO puede salir.
//
//   publico       se puede mostrar a cualquiera (vitrina de la tienda)
//   interno       datos de operación de la empresa
//   confidencial  costos, márgenes, utilidades, pagos a colaboradores
//   pii           datos personales de clientes y colaboradores
//   fiscal        NIT, resolución DIAN, CUFE, facturas
//   secreto       llaves, tokens, contraseñas (nunca salen del servidor)
//
// Reglas de salida (lo usan sanitize.js, el ocultamiento por rol y,
// más adelante, Sentry, telemetría e IA):
//   logs / Sentry   → nunca pii, fiscal, confidencial ni secreto
//   telemetría      → solo eventos y conteos, ningún valor de negocio
//   rol operador    → nunca confidencial (costos y márgenes)
// ============================================================

// Patrones de NOMBRE de campo → categoría. Se evalúan en orden.
const PATRONES = [
  { categoria: 'secreto',      patron: /(password|contrasena|clave|token|secret|api_?key|refresh|authorization|cookie|llave|firma|signature|checksum)/i },
  { categoria: 'fiscal',       patron: /(^nit$|cufe|resolucion|razon_social|regimen|^cedula$|documento|identificacion|rut$)/i },
  { categoria: 'pii',          patron: /(correo|email|telefono|celular|whatsapp|direccion|cliente_nombre|nombre_cliente|nombre_persona|cedula|tarjeta|datos_crudos|metodos_pago|ip$|user_agent)/i },
  { categoria: 'confidencial', patron: /^(costo|costos|margen|ganancia|utilidad|rentabilidad|valor_inventario|capital|salario|pago|monto|valor_mensual|valor$)(_|$)/i }
];

function clasificarCampo(nombre) {
  const n = String(nombre || '');
  for (const { categoria, patron } of PATRONES) {
    if (patron.test(n)) return categoria;
  }
  return 'interno';
}

// Campos que un rol sin permiso "costos.ver" nunca recibe en una respuesta
const CAMPO_DE_COSTO = /^(costo|costos|margen|ganancia|utilidad|rentabilidad|valor_inventario)(_|$)/i;

function esCampoDeCosto(nombre) {
  return CAMPO_DE_COSTO.test(String(nombre || ''));
}

// Categorías que nunca deben llegar a logs, Sentry ni telemetría
const PROHIBIDO_EN_EXTERNOS = new Set(['secreto', 'fiscal', 'pii', 'confidencial']);

function puedeSalirAExternos(nombre) {
  return !PROHIBIDO_EN_EXTERNOS.has(clasificarCampo(nombre));
}

module.exports = { clasificarCampo, esCampoDeCosto, puedeSalirAExternos, PROHIBIDO_EN_EXTERNOS };
