// ============================================================
// tema.js — motor del selector de tema (claro / panel oscuro)
// Se incluye en TODAS las páginas, junto a api.js y auth.js.
//
// Dos responsabilidades:
// 1) Aplicar el tema guardado ANTES de que se vea nada (evita el
//    parpadeo de "carga claro, salta a oscuro").
// 2) Cuando el tema activo es "panel-oscuro", construir la barra
//    lateral real leyendo los enlaces que YA existen en
//    <nav class="navegacion"> de cada página — no se inventan
//    rutas nuevas ni se toca el HTML de ninguna página para esto.
// ============================================================

const TEMA_CLAVE = 'tema_preferido';

// Se ejecuta de inmediato (no espera DOMContentLoaded) para que el
// atributo quede puesto antes del primer pintado de la página.
(function aplicarTemaGuardado() {
  if (localStorage.getItem(TEMA_CLAVE) === 'panel-oscuro') {
    document.documentElement.setAttribute('data-tema', 'panel-oscuro');
  }
})();

// Un ícono lineal por página — mismo criterio de "sin dependencias
// nuevas" del resto del proyecto: SVG a mano, no una librería de íconos.
const ICONOS_NAV = {
  'index.html': '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  'materiales.html': '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  'productos.html': '<path d="M6 2 3 6v14a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  'inventario.html': '<rect x="3" y="7" width="18" height="14" rx="1"/><path d="M8 7V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3"/>',
  'compras.html': '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 11.6a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L21 8H6"/>',
  'ventas.html': '<path d="M4 4h13l3 6-3 10H4l3-10Z"/><path d="M9 10h6"/>',
  'finanzas.html': '<path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/>',
  'facturacion.html': '<path d="M6 2h9l4 4v16H6Z"/><path d="M15 2v4h4"/><path d="M9 12h6M9 16h6"/>',
  'suscripcion.html': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'
};

// Agrupación de la sidebar — módulos reales del sistema, no los
// nombres genéricos del mockup original.
const SECCIONES_NAV = [
  { titulo: null, paginas: ['index.html', 'ventas.html', 'inventario.html', 'compras.html'] },
  { titulo: 'Productos', paginas: ['materiales.html', 'productos.html'] },
  { titulo: 'Finanzas', paginas: ['finanzas.html', 'facturacion.html'] },
  { titulo: 'Cuenta', paginas: ['suscripcion.html'] }
];

function construirBarraLateral() {
  const nav = document.querySelector('.navegacion');
  if (!nav) return false;

  const enlaces = [...nav.querySelectorAll('.navegacion__enlace')];
  if (enlaces.length === 0) return false;
  const porPagina = new Map(enlaces.map(a => [a.getAttribute('href').replace('./', ''), a]));

  const aside = document.createElement('aside');
  aside.className = 'barra-lateral';

  aside.innerHTML += `
    <div class="barra-lateral__marca">
      <span class="barra-lateral__logo" aria-hidden="true"></span>
      <span>Control<br><small>Completo</small></span>
    </div>`;

  for (const seccion of SECCIONES_NAV) {
    if (seccion.titulo) {
      const etiqueta = document.createElement('div');
      etiqueta.className = 'barra-lateral__seccion';
      etiqueta.textContent = seccion.titulo;
      aside.appendChild(etiqueta);
    }
    for (const pagina of seccion.paginas) {
      const original = porPagina.get(pagina);
      if (!original) continue;
      const activo = original.classList.contains('navegacion__enlace--activo');
      const item = document.createElement('a');
      item.href = original.getAttribute('href');
      item.className = 'barra-lateral__enlace' + (activo ? ' barra-lateral__enlace--activo' : '');
      item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS_NAV[pagina] || ''}</svg><span>${original.textContent}</span>`;
      aside.appendChild(item);
    }
  }

  const pie = document.createElement('div');
  pie.className = 'barra-lateral__pie';
  aside.appendChild(pie);

  document.body.insertBefore(aside, document.body.firstChild);
  document.body.classList.add('con-barra-lateral');
  return true;
}

// El bloque de usuario (nombre + botón de tema + cerrar sesión) lo
// agrega auth.js con mostrarUsuarioActual(), DESPUÉS de que este
// script ya corrió — por eso se espera con un MutationObserver a
// que aparezca, en vez de perderlo si llega un instante tarde.
function iniciarSidebarSiAplica() {
  if (document.documentElement.getAttribute('data-tema') !== 'panel-oscuro') return;
  const nav = document.querySelector('.navegacion');
  if (!nav) return;
  if (!construirBarraLateral()) return;

  const moverUsuario = () => {
    const usuario = nav.querySelector('.navegacion__usuario');
    const pie = document.querySelector('.barra-lateral__pie');
    if (usuario && pie) { pie.appendChild(usuario); return true; }
    return false;
  };
  if (!moverUsuario()) {
    const observador = new MutationObserver(() => { if (moverUsuario()) observador.disconnect(); });
    observador.observe(nav, { childList: true });
  }
}

// Cambia de tema y recarga — más simple y confiable que reconstruir
// todo el layout en caliente sin recargar.
function alternarTema() {
  const activarOscuro = document.documentElement.getAttribute('data-tema') !== 'panel-oscuro';
  if (activarOscuro) localStorage.setItem(TEMA_CLAVE, 'panel-oscuro');
  else localStorage.removeItem(TEMA_CLAVE);
  window.location.reload();
}

document.addEventListener('DOMContentLoaded', iniciarSidebarSiAplica);