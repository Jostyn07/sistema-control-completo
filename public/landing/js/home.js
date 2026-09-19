// FINCIL — Home (Fase 1)
// Menú móvil del header y trazado de las curvas del diagrama "todo conectado".

(function () {
  function iniciarMenuMovil() {
    var boton = document.querySelector('.nav__boton-menu');
    var menu = document.querySelector('.nav__menu-movil');
    if (!boton || !menu) return;
    boton.addEventListener('click', function () {
      var abierto = menu.classList.toggle('abierto');
      boton.setAttribute('aria-expanded', abierto ? 'true' : 'false');
    });
    menu.querySelectorAll('a').forEach(function (enlace) {
      enlace.addEventListener('click', function () { menu.classList.remove('abierto'); });
    });
  }

  // Nodos del ciclo, en porcentaje sobre un contenedor cuadrado (0-100).
  // El orden sigue el flujo del documento: Producto → Materiales → Inventario
  // → Compras → Ventas → Facturación → Finanzas → (vuelve a Producto).
  var NODOS_CICLO = [
    { x: 50, y: 8 },
    { x: 82.6, y: 23.6 },
    { x: 90.9, y: 59.4 },
    { x: 68.4, y: 87.8 },
    { x: 31.6, y: 87.8 },
    { x: 9.1, y: 59.4 },
    { x: 17.4, y: 23.6 },
  ];
  var CONTROL_CICLO = [
    { x: 69.8, y: 8.5 },
    { x: 94.8, y: 39.65 },
    { x: 85.98, y: 78.66 },
    { x: 50, y: 96 },
    { x: 14.02, y: 78.66 },
    { x: 5.2, y: 39.65 },
    { x: 30.2, y: 8.5 },
  ];

  function dibujarCiclo() {
    var svg = document.querySelector('.ciclo__flechas');
    if (!svg) return;
    var ns = 'http://www.w3.org/2000/svg';

    var defs = document.createElementNS(ns, 'defs');
    defs.innerHTML =
      '<marker id="flecha-ciclo" markerWidth="8" markerHeight="8" refX="5" refY="3" orient="auto">' +
      '<path d="M0,0 L6,3 L0,6 Z" fill="var(--azul-fincil)" /></marker>';
    svg.appendChild(defs);

    for (var i = 0; i < NODOS_CICLO.length; i++) {
      var actual = NODOS_CICLO[i];
      var siguiente = NODOS_CICLO[(i + 1) % NODOS_CICLO.length];
      var control = CONTROL_CICLO[i];
      var d = 'M ' + actual.x + ' ' + actual.y +
        ' Q ' + control.x + ' ' + control.y + ' ' + siguiente.x + ' ' + siguiente.y;
      var path = document.createElementNS(ns, 'path');
      path.setAttribute('d', d);
      path.setAttribute('fill', 'none');
      path.setAttribute('stroke', 'var(--azul-fincil)');
      path.setAttribute('stroke-width', '0.6');
      path.setAttribute('stroke-dasharray', '2 2');
      path.setAttribute('marker-end', 'url(#flecha-ciclo)');
      path.setAttribute('opacity', '0.55');
      svg.appendChild(path);
    }
  }

  // Diagrama radial de la sección "¿Qué es Fincil?": líneas rectas simples
  // desde cada nodo hacia el centro (50,50), sin flecha, más discretas.
  function dibujarRadial() {
    var svg = document.querySelector('.radial__lineas');
    if (!svg) return;
    var nodos = document.querySelectorAll('.radial__nodo');
    var ns = 'http://www.w3.org/2000/svg';
    nodos.forEach(function (nodo) {
      var x = parseFloat(nodo.dataset.x);
      var y = parseFloat(nodo.dataset.y);
      var linea = document.createElementNS(ns, 'line');
      linea.setAttribute('x1', x);
      linea.setAttribute('y1', y);
      linea.setAttribute('x2', 50);
      linea.setAttribute('y2', 50);
      linea.setAttribute('stroke', 'var(--azul-fincil)');
      linea.setAttribute('stroke-width', '0.4');
      linea.setAttribute('stroke-dasharray', '1.5 1.5');
      linea.setAttribute('opacity', '0.5');
      svg.appendChild(linea);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    iniciarMenuMovil();
    dibujarCiclo();
    dibujarRadial();
  });
})();