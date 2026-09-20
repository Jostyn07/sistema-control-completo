// FINCIL — Acordeón de preguntas frecuentes (Fase 5, sección 5.1)
// Un solo ítem abierto a la vez; el primero viene abierto por defecto en el HTML.

(function () {
  function alternar(item, abrir) {
    var boton = item.querySelector('.acordeon__pregunta');
    var panel = item.querySelector('.acordeon__respuesta');
    item.classList.toggle('acordeon__item--abierto', abrir);
    boton.setAttribute('aria-expanded', abrir ? 'true' : 'false');
    panel.style.display = abrir ? 'block' : 'none';
  }

  document.addEventListener('DOMContentLoaded', function () {
    var items = document.querySelectorAll('.acordeon__item');
    items.forEach(function (item) {
      var boton = item.querySelector('.acordeon__pregunta');
      if (!boton) return;
      boton.addEventListener('click', function () {
        var yaAbierto = item.classList.contains('acordeon__item--abierto');
        items.forEach(function (otro) { alternar(otro, false); });
        alternar(item, !yaAbierto);
      });
    });
  });
})();