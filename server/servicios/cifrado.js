// ============================================================
// CIFRADO DE CAMPOS SENSIBLES — server/servicios/cifrado.js
// Encripta/desencripta datos personales (teléfono, cédula) antes
// de guardarlos. La llave vive SOLO en la variable de entorno
// ENCRYPTION_KEY — nunca en la base de datos ni en el código.
// Aunque alguien vea la tabla directo en Supabase, estos campos
// se ven como texto cifrado ilegible; solo el backend, con la
// llave correcta, puede leerlos.
// ============================================================
const crypto = require('crypto');

function obtenerLlave() {
  const llave = process.env.ENCRYPTION_KEY;
  if (!llave) throw new Error('Falta configurar ENCRYPTION_KEY en el servidor');
  const buffer = Buffer.from(llave, 'hex');
  if (buffer.length !== 32) {
    throw new Error('ENCRYPTION_KEY debe ser una cadena hexadecimal de 64 caracteres (32 bytes)');
  }
  return buffer;
}

// Cifra un texto. Devuelve null si la entrada es null/vacía (campo opcional).
function cifrar(texto) {
  if (texto == null || texto === '') return null;
  const llave = obtenerLlave();
  const iv = crypto.randomBytes(12); // tamaño recomendado de IV para GCM
  const cifrador = crypto.createCipheriv('aes-256-gcm', llave, iv);
  const cifrado = Buffer.concat([cifrador.update(String(texto), 'utf8'), cifrador.final()]);
  const tag = cifrador.getAuthTag();
  // Empaqueta iv + tag + texto cifrado en un solo valor guardable
  return Buffer.concat([iv, tag, cifrado]).toString('base64');
}

// Descifra un valor previamente cifrado con cifrar(). Devuelve null si
// la entrada es null, o si falla el descifrado (dato corrupto/llave distinta).
function descifrar(valorCifrado) {
  if (!valorCifrado) return null;
  try {
    const llave = obtenerLlave();
    const datos = Buffer.from(valorCifrado, 'base64');
    const iv = datos.subarray(0, 12);
    const tag = datos.subarray(12, 28);
    const cifrado = datos.subarray(28);
    const descifrador = crypto.createDecipheriv('aes-256-gcm', llave, iv);
    descifrador.setAuthTag(tag);
    const original = Buffer.concat([descifrador.update(cifrado), descifrador.final()]);
    return original.toString('utf8');
  } catch {
    return null; // no tumba la respuesta completa si un dato puntual falla
  }
}

module.exports = { cifrar, descifrar };