// ============================================================
// auth.js — página de login/registro, y funciones de sesión que
// otras páginas también usan (mostrarUsuarioActual, cerrarSesion).
// ============================================================

let modoRegistro = false;
let clienteSupabasePublico = null;

// Crea (una sola vez) el cliente de Supabase del navegador, usando SOLO la
// llave pública. Se usa exclusivamente para el redireccionamiento a Google;
// todo lo demás del sistema sigue pasando por nuestro backend.
async function obtenerClienteSupabasePublico() {
  if (clienteSupabasePublico) return clienteSupabasePublico;
  const config = await fetch('/api/auth/configuracion-publica').then(r => r.json());
  if (config.error) throw new Error(config.error);
  clienteSupabasePublico = window.supabase.createClient(config.url, config.anonKey);
  return clienteSupabasePublico;
}

// Botón "Continuar con Google": redirige a Google y vuelve a auth-callback.html
async function iniciarSesionConGoogle() {
  try {
    const cliente = await obtenerClienteSupabasePublico();
    const { error } = await cliente.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + '/auth-callback.html' }
    });
    if (error) throw error;
  } catch (err) {
    mostrarAviso('No se pudo iniciar sesión con Google: ' + err.message, 'error');
  }
}

// Se llama desde auth-callback.html cuando Google ya redirigió de vuelta.
// Toma la sesión que Supabase dejó en la URL y la guarda igual que el
// login normal, para que el resto del sistema no note la diferencia.
async function completarLoginGoogle() {
  try {
    // Google/Supabase dejan la sesión en el "hash" de la URL (después del #).
    // La leemos directamente en vez de depender de la librería del navegador
    // para "adivinarla" — así evitamos cualquier incompatibilidad de versión
    // entre esa librería y el formato nuevo de llaves de Supabase.
    const parametros = new URLSearchParams(window.location.hash.slice(1));
    const token = parametros.get('access_token');
    if (!token) throw new Error('No se recibió la sesión de Google en la URL');

    // Validamos el token contra nuestro propio backend (el mismo mecanismo
    // que usa el resto del sistema, ya probado y funcionando).
    const respuesta = await fetch('/api/auth/yo', {
      headers: { Authorization: `Bearer ${token}` }
    });
    const usuario = await respuesta.json();
    if (!respuesta.ok) throw new Error(usuario.error || 'No se pudo validar la sesión');

    localStorage.setItem('token_sesion', token);
    localStorage.setItem('usuario_sesion', JSON.stringify({
      id: usuario.id,
      correo: usuario.correo,
      nombre: usuario.nombre || usuario.correo
    }));
    window.location.href = '/';
  } catch (err) {
    mostrarAviso(err.message, 'error');
    setTimeout(() => { window.location.href = '/login.html'; }, 1500);
  }
}

function alternarModo(evento) {
  if (evento) evento.preventDefault();
  modoRegistro = !modoRegistro;
  document.getElementById('camposRegistro').hidden = !modoRegistro;
  document.getElementById('tituloFormulario').textContent = modoRegistro ? 'Crear cuenta' : 'Iniciar sesión';
  document.getElementById('botonPrincipal').textContent = modoRegistro ? 'Crear cuenta' : 'Entrar';
  document.getElementById('textoAlternar').textContent = modoRegistro ? '¿Ya tienes cuenta?' : '¿No tienes cuenta?';
  document.getElementById('enlaceAlternar').textContent = modoRegistro ? 'Inicia sesión' : 'Crear una';
}

async function enviarFormulario() {
  const correo = document.getElementById('campoCorreo').value.trim();
  const contrasena = document.getElementById('campoContrasena').value;

  if (!correo || !contrasena) {
    mostrarAviso('Completa correo y contraseña', 'error');
    return;
  }

  try {
    if (modoRegistro) {
      const nombre = document.getElementById('campoNombre').value.trim();
      if (!nombre) { mostrarAviso('Escribe tu nombre', 'error'); return; }
      await API.enviar('/api/auth/registro', { nombre, correo, contrasena });
      mostrarAviso('Cuenta creada, ahora inicia sesión');
      alternarModo();
    } else {
      const resultado = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ correo, contrasena })
      });
      const datos = await resultado.json();
      if (!resultado.ok) throw new Error(datos.error || 'No se pudo iniciar sesión');

      localStorage.setItem('token_sesion', datos.token);
      localStorage.setItem('usuario_sesion', JSON.stringify(datos.usuario));
      window.location.href = '/';
    }
  } catch (err) {
    mostrarAviso(err.message, 'error');
  }
}

// ---- Funciones compartidas por el resto de páginas ----

// Muestra el nombre del usuario y un botón de cerrar sesión en la navegación.
// Se llama desde cada página protegida después de exigirSesion().
function mostrarUsuarioActual() {
  const datos = localStorage.getItem('usuario_sesion');
  if (!datos) return;
  const usuario = JSON.parse(datos);
  const nav = document.querySelector('.navegacion');
  if (!nav) return;

  const contenedor = document.createElement('span');
  contenedor.className = 'navegacion__usuario';
  contenedor.innerHTML = `
    <span class="texto-secundario">${escaparHtmlAuth(usuario.nombre || usuario.correo)}</span>
    <button type="button" class="boton boton--pequeno" onclick="cerrarSesion()">Cerrar sesión</button>
  `;
  nav.appendChild(contenedor);
}

function cerrarSesion() {
  localStorage.removeItem('token_sesion');
  localStorage.removeItem('usuario_sesion');
  window.location.href = '/login.html';
}

function escaparHtmlAuth(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}