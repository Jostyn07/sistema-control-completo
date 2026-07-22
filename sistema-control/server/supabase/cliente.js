// ============================================================
// CONEXIÓN A SUPABASE — solo el backend usa este archivo.
// Usa la service_role key: nunca debe llegar al navegador.
// Si falta el .env, el servidor arranca igual y cada llamada
// a la API responde con un error claro en vez de tumbar todo.
// ============================================================
const { createClient } = require('@supabase/supabase-js');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

let supabase;

if (url && key) {
  supabase = createClient(url, key, { auth: { persistSession: false } });
} else {
  console.warn('[AVISO] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env — las rutas de API fallarán hasta configurarlas.');
  const mensaje = 'Supabase no está configurado: crea el archivo .env a partir de .env.ejemplo';
  supabase = new Proxy({}, {
    get() { return () => { throw new Error(mensaje); }; }
  });
}

module.exports = supabase;
