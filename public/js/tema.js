// ============================================================
// tema.js — motor del layout único de Fincil (sidebar + topbar)
// y del selector de tema (claro / oscuro). Se incluye en TODAS
// las páginas, junto a api.js y auth.js.
//
// Responsabilidades:
// 1) Aplicar el tema guardado (claro/oscuro) ANTES de que se vea
//    nada (evita el parpadeo de "carga claro, salta a oscuro").
// 2) Construir la sidebar y la barra superior reales leyendo los
//    enlaces que YA existen en <nav class="navegacion"> de cada
//    página — no se inventan rutas nuevas ni se toca el HTML de
//    ninguna página para esto. El layout es el mismo siempre;
//    solo cambian los colores según el tema.
// ============================================================

const TEMA_CLAVE = 'tema_preferido';

// Se ejecuta de inmediato (no espera DOMContentLoaded) para que el
// atributo quede puesto antes del primer pintado de la página.
(function aplicarTemaGuardado() {
  if (localStorage.getItem(TEMA_CLAVE) === 'oscuro') {
    document.documentElement.setAttribute('data-tema', 'oscuro');
  }
})();

// Un ícono lineal por página — mismo criterio de "sin dependencias
// nuevas" del resto del proyecto: SVG a mano, no una librería de íconos.
const ICONOS_NAV = {
  'index.html': '<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M9 21v-6h6v6"/>',
  'materiales.html': '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/>',
  'productos.html': '<path d="M6 2 3 6v14a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
  'procesos.html': '<circle cx="12" cy="6" r="2.2"/><circle cx="5" cy="18" r="2.2"/><circle cx="19" cy="18" r="2.2"/><path d="M12 8.2v3.3M12 11.5 6.6 16M12 11.5 17.4 16"/>',
  'inventario.html': '<rect x="3" y="7" width="18" height="14" rx="1"/><path d="M8 7V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3"/>',
  'compras.html': '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 11.6a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L21 8H6"/>',
  'ventas.html': '<path d="M4 4h13l3 6-3 10H4l3-10Z"/><path d="M9 10h6"/>',
  'finanzas.html': '<path d="M4 20V10"/><path d="M11 20V4"/><path d="M18 20v-7"/>',
  'facturacion.html': '<path d="M6 2h9l4 4v16H6Z"/><path d="M15 2v4h4"/><path d="M9 12h6M9 16h6"/>',
  'nomina.html': '<circle cx="9" cy="7" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><path d="M16 4.2a3.2 3.2 0 0 1 0 6M22 20c0-2.8-2-5.1-4.7-5.8"/>',
  'suscripcion.html': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>'
};

// Agrupación de la sidebar — módulos reales del sistema.
const SECCIONES_NAV = [
  { titulo: null, paginas: ['index.html', 'ventas.html', 'inventario.html', 'compras.html'] },
  { titulo: 'Productos', paginas: ['materiales.html', 'productos.html', 'procesos.html'] },
  { titulo: 'Finanzas', paginas: ['finanzas.html', 'facturacion.html'] },
  { titulo: 'Equipo', paginas: ['nomina.html'] },
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
    <a href="/landing/index.html" class="barra-lateral__marca">
      <img src="/landing/img/logo-toolkap.png" alt="" class="barra-lateral__logo">
      <span>Fincil<br><small>Tu negocio en orden</small></span>
    </a>`;

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

  const fondo = document.createElement('div');
  fondo.className = 'barra-lateral__fondo';
  fondo.addEventListener('click', () => document.body.classList.remove('con-sidebar-abierta'));

  document.body.insertBefore(fondo, document.body.firstChild);
  document.body.insertBefore(aside, document.body.firstChild);
  document.body.classList.add('con-barra-lateral');
  return true;
}

// Iconos de la barra superior (sin librería, igual que el resto).
const ICONO_BUSCAR = '<path d="m21 21-4.3-4.3"/><circle cx="11" cy="11" r="7"/>';
const ICONO_CAMPANA = '<path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>';
const ICONO_AYUDA = '<circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 2-3 4"/><line x1="12" y1="17" x2="12.01" y2="17"/>';
const ICONO_CHEVRON = '<path d="m6 9 6 6 6-6"/>';

function construirBarraSuperior(enlaceAyuda) {
  const superior = document.createElement('header');
  superior.className = 'barra-superior';

  const usuario = JSON.parse(localStorage.getItem('usuario_sesion') || 'null');
  const nombre = usuario ? (usuario.nombre || usuario.correo) : '';
  const iniciales = obtenerIniciales(nombre);

  superior.innerHTML = `
    <button type="button" class="barra-superior__menu" id="botonAbrirSidebar" aria-label="Abrir menú">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
    </button>
    <label class="barra-superior__buscador">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_BUSCAR}</svg>
      <input type="text" id="buscadorGlobal" placeholder="Buscar productos, materiales, ventas...">
      <span class="barra-superior__atajo">Ctrl+K</span>
    </label>
    <div class="barra-superior__acciones">
      <button type="button" class="barra-superior__icono" aria-label="Notificaciones">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_CAMPANA}</svg>
      </button>
      <a class="barra-superior__icono" aria-label="¿Cómo funciona?" href="${enlaceAyuda || '#'}">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_AYUDA}</svg>
      </a>
      <button type="button" class="barra-superior__usuario" id="botonUsuarioSuperior">
        <span class="barra-lateral__avatar" style="width:32px;height:32px;font-size:12px;">${iniciales}</span>
        <span class="barra-superior__usuario-texto">
          <span class="barra-superior__usuario-nombre">${escaparHtmlTema(nombre.split(' ')[0] || 'Cuenta')}</span>
          <span class="barra-superior__usuario-empresa">Mi Empresa</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_CHEVRON}</svg>
      </button>
    </div>
  `;

  document.body.insertBefore(superior, document.body.firstChild);

  const botonMenu = superior.querySelector('#botonAbrirSidebar');
  botonMenu.addEventListener('click', () => document.body.classList.toggle('con-sidebar-abierta'));

  const buscador = superior.querySelector('#buscadorGlobal');
  document.addEventListener('keydown', (evento) => {
    if ((evento.ctrlKey || evento.metaKey) && evento.key.toLowerCase() === 'k') {
      evento.preventDefault();
      buscador.focus();
    }
  });
}

function obtenerIniciales(nombre) {
  if (!nombre) return '?';
  const partes = nombre.trim().split(/\s+/).slice(0, 2);
  return partes.map(p => p[0]).join('').toUpperCase();
}

function escaparHtmlTema(texto) {
  const div = document.createElement('div');
  div.textContent = texto ?? '';
  return div.innerHTML;
}

// El bloque de usuario (nombre + botón de tema + cerrar sesión) lo
// agrega auth.js con mostrarUsuarioActual(), DESPUÉS de que este
// script ya corrió — por eso se espera con un MutationObserver a
// que aparezca, en vez de perderlo si llega un instante tarde.
function iniciarLayout() {
  const nav = document.querySelector('.navegacion');
  if (!nav) return; // páginas sin sidebar (ej. login)

  const enlaceAyuda = [...nav.querySelectorAll('.navegacion__enlace')]
    .find(a => /ayuda/i.test(a.textContent));

  if (!construirBarraLateral()) return;
  construirBarraSuperior(enlaceAyuda ? enlaceAyuda.getAttribute('href') : '#');

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
  const activarOscuro = document.documentElement.getAttribute('data-tema') !== 'oscuro';
  if (activarOscuro) localStorage.setItem(TEMA_CLAVE, 'oscuro');
  else localStorage.removeItem(TEMA_CLAVE);
  window.location.reload();
}

document.addEventListener('DOMContentLoaded', iniciarLayout);