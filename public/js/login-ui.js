// login-ui.js — comportamiento puramente visual de la pantalla de login
// (mostrar/ocultar contraseña). No toca la lógica de sesión, que sigue
// viviendo en auth.js.

document.addEventListener('DOMContentLoaded', function () {
  var boton = document.getElementById('botonMostrarContrasena');
  var campo = document.getElementById('campoContrasena');
  if (!boton || !campo) return;

  var iconoOjo = boton.querySelector('.login__icono-ojo');
  var iconoOjoTachado = boton.querySelector('.login__icono-ojo-tachado');

  boton.addEventListener('click', function () {
    var visible = campo.type === 'text';
    campo.type = visible ? 'password' : 'text';
    iconoOjo.hidden = !visible ? true : false;
    iconoOjoTachado.hidden = visible ? true : false;
    boton.setAttribute('aria-label', visible ? 'Mostrar contraseña' : 'Ocultar contraseña');
  });
});