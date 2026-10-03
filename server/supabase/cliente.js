// ============================================================
// CONEXIÓN A SUPABASE — server/supabase/cliente.js
// Solo el backend usa este archivo; ninguna llave llega al navegador.
//
// Exporta un cliente "inteligente": todas las rutas siguen haciendo
//   const supabase = require('../supabase/cliente');
//   supabase.from('materiales')...
// pero cada llamada se resuelve, en el momento, contra:
//   - el cliente del USUARIO (anon key + su JWT → RLS aplica), si la
//     petición pasó por middleware/tenant.js y SUPABASE_RLS_ACTIVO=true;
//   - el cliente ADMIN (service_role → salta RLS) en cualquier otro
//     caso: webhooks, registro, panel de plataforma, scripts.
//
// Mientras SUPABASE_RLS_ACTIVO no sea "true", TODO usa service_role
// (igual que hoy). Se activa SOLO después de aplicar 004_rls_tenant.sql;
// si se activa antes, las tablas sin políticas devolverán vacío.
//
// Para tareas que DEBEN saltar RLS dentro de una petición (crear
// membresías, leer auth.users) usa explícitamente:
//   const { supabaseAdmin } = require('../supabase/cliente');
// ============================================================
const { createClient } = require('@supabase/supabase-js');
const { contextoActual } = require('../contexto');

const url = process.env.SUPABASE_URL;
const llaveServicio = process.env.SUPABASE_SERVICE_ROLE_KEY;
const llaveAnonima = process.env.SUPABASE_ANON_KEY;

const RLS_ACTIVO = process.env.SUPABASE_RLS_ACTIVO === 'true';

const OPCIONES_SERVIDOR = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };

let supabaseAdmin;

if (url && llaveServicio) {
  supabaseAdmin = createClient(url, llaveServicio, OPCIONES_SERVIDOR);
} else {
  console.warn('[AVISO] Faltan SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en el .env — las rutas de API fallarán hasta configurarlas.');
  const mensaje = 'Supabase no está configurado: crea el archivo .env a partir de .env.ejemplo';
  supabaseAdmin = new Proxy({}, {
    get() { return () => { throw new Error(mensaje); }; }
  });
}

if (RLS_ACTIVO && !llaveAnonima) {
  // Fallar en el arranque es mejor que operar creyendo que hay RLS
  throw new Error('SUPABASE_RLS_ACTIVO=true requiere SUPABASE_ANON_KEY');
}

// Cliente que actúa COMO el usuario: PostgreSQL ve su JWT, auth.uid()
// funciona y las políticas RLS se aplican.
function crearClienteUsuario(tokenAcceso) {
  return createClient(url, llaveAnonima, {
    ...OPCIONES_SERVIDOR,
    global: { headers: { Authorization: `Bearer ${tokenAcceso}` } }
  });
}

function clienteDeLaPeticion() {
  const ctx = contextoActual();
  return (ctx && ctx.supabase) || supabaseAdmin;
}

const EXTRAS = { supabaseAdmin, crearClienteUsuario, RLS_ACTIVO };

const supabase = new Proxy({}, {
  get(_, propiedad) {
    if (Object.prototype.hasOwnProperty.call(EXTRAS, propiedad)) return EXTRAS[propiedad];
    const cliente = clienteDeLaPeticion();
    const valor = cliente[propiedad];
    return typeof valor === 'function' ? valor.bind(cliente) : valor;
  }
});

module.exports = supabase;
