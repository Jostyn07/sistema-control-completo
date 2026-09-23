// meta-pixel.js — Carga el Pixel de Meta (Facebook) y registra PageView.
// Se incluye en el <head> de las páginas públicas (landing, login, gracias).
// Cambia PIXEL_ID por el ID de tu pixel (Administrador de eventos de Meta).
(function () {
  var PIXEL_ID = '1096538993342486';

  !function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
  n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;
  n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;
  t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,
  document,'script','https://connect.facebook.net/en_US/fbevents.js');

  fbq('init', PIXEL_ID);
  fbq('track', 'PageView');
})();

// Helper seguro: no rompe nada si un bloqueador de anuncios impide cargar el pixel.
// opciones.eventID sirve para no contar doble si luego agregas la API de Conversiones.
window.rastrearMeta = function (evento, datos, opciones) {
  try { if (window.fbq) fbq('track', evento, datos || {}, opciones || {}); } catch (e) {}
};