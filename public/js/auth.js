// ============================================================
// auth.js — página de login/registro, y funciones de sesión que
// otras páginas también usan (mostrarUsuarioActual, cerrarSesion).
// ============================================================

let modoRegistro = false;

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