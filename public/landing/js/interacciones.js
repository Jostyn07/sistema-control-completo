// FINCIL — Interacciones base de la landing (Fase 0)
// Revela elementos con la clase "entra-en-vista" al hacer scroll y anima
// los números con la clase "kpi__numero[data-hasta]" cuando entran en pantalla.

(function () {
  var prefiereMenosMovimiento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function activarRevelado() {
    var elementos = document.querySelectorAll('.entra-en-vista');
    if (!elementos.length) return;

    if (prefiereMenosMovimiento || !('IntersectionObserver' in window)) {
      elementos.forEach(function (el) { el.classList.add('en-vista'); });
      return;
    }

    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          entrada.target.classList.add('en-vista');
          observador.unobserve(entrada.target);
        }
      });
    }, { threshold: 0.15 });

    elementos.forEach(function (el) { observador.observe(el); });
  }

  function animarContador(el) {
    var hasta = parseFloat(el.dataset.hasta || '0');
    var prefijo = el.dataset.prefijo || '';
    var sufijo = el.dataset.sufijo || '';
    if (prefiereMenosMovimiento) {
      el.textContent = prefijo + hasta.toLocaleString('es-CO') + sufijo;
      return;
    }
    var duracion = 900;
    var inicio = null;
    function paso(marca) {
      if (inicio === null) inicio = marca;
      var progreso = Math.min((marca - inicio) / duracion, 1);
      var valor = Math.round(hasta * progreso);
      el.textContent = prefijo + valor.toLocaleString('es-CO') + sufijo;
      if (progreso < 1) requestAnimationFrame(paso);
    }
    requestAnimationFrame(paso);
  }

  function activarContadores() {
    var contadores = document.querySelectorAll('.kpi__numero[data-hasta]');
    if (!contadores.length) return;

    if (!('IntersectionObserver' in window)) {
      contadores.forEach(animarContador);
      return;
    }
    var observador = new IntersectionObserver(function (entradas) {
      entradas.forEach(function (entrada) {
        if (entrada.isIntersecting) {
          animarContador(entrada.target);
          observador.unobserve(entrada.target);
        }
      });
    }, { threshold: 0.4 });
    contadores.forEach(function (el) { observador.observe(el); });
  }

  document.addEventListener('DOMContentLoaded', function () {
    activarRevelado();
    activarContadores();
  });
})();