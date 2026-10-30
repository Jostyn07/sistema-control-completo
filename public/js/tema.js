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
// ---- Apariencia personal (Mi perfil → Apariencia) ----
// Solo afecta la interfaz de ESTA persona. Se guarda en su cuenta y se
// copia aquí (localStorage) para aplicarla antes del primer pintado.
const PREFS_UI_CLAVE = 'preferencias_ui';
const FONDOS_DEGRADADOS = {
  aurora:    'linear-gradient(135deg, #c9e4ff 0%, #e8dcff 50%, #ffe3ef 100%)',
  atardecer: 'linear-gradient(135deg, #ffd8b5 0%, #ffb8c6 55%, #d9c2ff 100%)',
  oceano:    'linear-gradient(135deg, #b8f0ec 0%, #9fd4ff 55%, #b8c4ff 100%)',
  bosque:    'linear-gradient(135deg, #d6f5c9 0%, #a8e0c4 55%, #9cc9b5 100%)',
  lavanda:   'linear-gradient(135deg, #efe4ff 0%, #d8ccff 55%, #c3d0ff 100%)',
  grafito:   'linear-gradient(135deg, #3a4253 0%, #232a37 55%, #151a24 100%)'
};

function leerPreferenciasUi() {
  try { return JSON.parse(localStorage.getItem(PREFS_UI_CLAVE) || 'null') || {}; }
  catch (_) { return {}; }
}

// Oscurece un color #rrggbb (para el "hover" del acento)
function oscurecerHex(hex, factor) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.round(v * (1 - factor))).toString(16).padStart(2, '0');
  return '#' + c(n >> 16) + c((n >> 8) & 255) + c(n & 255);
}

function aplicarApariencia(prefs) {
  prefs = prefs || leerPreferenciasUi();
  const raiz = document.documentElement;
  // Tema: lo elegido en Apariencia manda; si no, el botón viejo (tema_preferido)
  let tema = prefs.tema || (localStorage.getItem(TEMA_CLAVE) === 'oscuro' ? 'oscuro' : 'claro');
  if (tema === 'auto') tema = window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  if (tema === 'oscuro') raiz.setAttribute('data-tema', 'oscuro'); else raiz.removeAttribute('data-tema');

  if (prefs.acento && /^#[0-9a-f]{6}$/i.test(prefs.acento)) {
    raiz.style.setProperty('--t-accent', prefs.acento);
    raiz.style.setProperty('--t-accent-hover', oscurecerHex(prefs.acento, 0.15));
    raiz.style.setProperty('--t-accent-boton', oscurecerHex(prefs.acento, 0.18));
    raiz.style.setProperty('--t-accent-boton-hover', oscurecerHex(prefs.acento, 0.30));
  } else {
    raiz.style.removeProperty('--t-accent');
    raiz.style.removeProperty('--t-accent-hover');
    raiz.style.removeProperty('--t-accent-boton');
    raiz.style.removeProperty('--t-accent-boton-hover');
  }

  const f = prefs.fondo || {};
  let fondo = '';
  if (f.tipo === 'solido' && /^#[0-9a-f]{6}$/i.test(f.valor || '')) fondo = f.valor;
  else if (f.tipo === 'degradado' && FONDOS_DEGRADADOS[f.valor]) fondo = FONDOS_DEGRADADOS[f.valor];
  else if (f.tipo === 'imagen' && /^https:\/\//.test(f.valor || '')) fondo = `url("${String(f.valor).replace(/"/g, '')}")`;
  if (fondo) { raiz.style.setProperty('--fondo-usuario', fondo); raiz.classList.add('con-fondo-usuario'); }
  else { raiz.style.removeProperty('--fondo-usuario'); raiz.classList.remove('con-fondo-usuario'); }
}

function guardarPreferenciasUiLocal(prefs) {
  try { localStorage.setItem(PREFS_UI_CLAVE, JSON.stringify(prefs || {})); } catch (_) {}
}

// Se ejecuta de inmediato (no espera DOMContentLoaded) para que el
// tema quede puesto antes del primer pintado de la página.
(function aplicarTemaGuardado() {
  aplicarApariencia();
  if (window.matchMedia) {
    matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => {
      if (leerPreferenciasUi().tema === 'auto') aplicarApariencia();
    });
  }
})();

// Una vez por sesión del navegador: trae el perfil de la cuenta para
// que la apariencia, el nombre y la foto sigan a la persona en
// cualquier dispositivo.
function sincronizarPerfil() {
  try {
    if (!localStorage.getItem('token_sesion') || typeof API === 'undefined') return;
    if (sessionStorage.getItem('perfil_sincronizado')) return;
    sessionStorage.setItem('perfil_sincronizado', '1');
    API.obtener('/api/perfil').then((perfil) => {
      actualizarSesionLocalConPerfil(perfil);
      guardarPreferenciasUiLocal(perfil.apariencia || {});
      aplicarApariencia(perfil.apariencia || {});
      pintarUsuarioSuperior();
    }).catch(() => sessionStorage.removeItem('perfil_sincronizado'));
  } catch (_) { /* nunca afecta la página */ }
}

function actualizarSesionLocalConPerfil(perfil) {
  try {
    const actual = JSON.parse(localStorage.getItem('usuario_sesion') || '{}');
    localStorage.setItem('usuario_sesion', JSON.stringify({
      ...actual,
      nombre: perfil.nombre_visible || [perfil.nombre, perfil.apellido].filter(Boolean).join(' ') || actual.nombre,
      avatar_url: perfil.avatar_url || '',
      cargo: perfil.cargo || '',
      estado: perfil.estado || 'disponible'
    }));
  } catch (_) {}
}

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
  'importar-exportar.html': '<path d="M17 1l4 4-4 4"/><path d="M3 11V9a4 4 0 0 1 4-4h14"/><path d="M7 23l-4-4 4-4"/><path d="M21 13v2a4 4 0 0 1-4 4H3"/>',
  'suscripcion.html': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/>',
  'historial.html': '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l3 2"/>',
  'perfil.html': '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/>'
};

// Páginas que aparecen en la sidebar aunque la página actual no las
// tenga en su <nav> (así no hay que editar el HTML de cada página).
const PAGINAS_SIEMPRE = { 'perfil.html': 'Mi perfil' };

// Agrupación de la sidebar — módulos reales del sistema.
const SECCIONES_NAV = [
  { titulo: null, paginas: ['index.html', 'ventas.html', 'inventario.html', 'compras.html'] },
  { titulo: 'Productos', paginas: ['materiales.html', 'productos.html', 'procesos.html'] },
  { titulo: 'Finanzas', paginas: ['finanzas.html', 'facturacion.html'] },
  { titulo: 'Equipo', paginas: ['nomina.html'] },
  { titulo: 'Herramientas', paginas: ['importar-exportar.html'] },
  { titulo: 'Cuenta', paginas: ['perfil.html', 'suscripcion.html', 'historial.html'] }
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
      if (!original && !PAGINAS_SIEMPRE[pagina]) continue;
      const enEstaPagina = location.pathname.endsWith('/' + pagina);
      const activo = original ? original.classList.contains('navegacion__enlace--activo') : enEstaPagina;
      const item = document.createElement('a');
      item.href = original ? original.getAttribute('href') : './' + pagina;
      item.className = 'barra-lateral__enlace' + (activo ? ' barra-lateral__enlace--activo' : '');
      item.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONOS_NAV[pagina] || ''}</svg><span>${original ? original.textContent : PAGINAS_SIEMPRE[pagina]}</span>`;
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
      <a href="./perfil.html" class="barra-superior__usuario" id="botonUsuarioSuperior" title="Mi perfil">
        ${htmlAvatar(usuario, 32)}
        <span class="barra-superior__usuario-texto">
          <span class="barra-superior__usuario-nombre">${escaparHtmlTema(nombre.split(' ')[0] || 'Cuenta')}</span>
          <span class="barra-superior__usuario-empresa">${escaparHtmlTema((usuario && usuario.cargo) || 'Mi perfil')}</span>
        </span>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONO_CHEVRON}</svg>
      </a>
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

  // Cada página puede conectar este buscador al suyo propio definiendo
  // window.buscarDesdeTopbar(texto) — si no existe, el campo sigue
  // sirviendo como atajo (Ctrl+K) sin filtrar nada por su cuenta.
  buscador.addEventListener('input', () => {
    if (typeof window.buscarDesdeTopbar === 'function') window.buscarDesdeTopbar(buscador.value);
  });
}

// Avatar: foto si la hay; si no, iniciales. Con el puntito de estado.
const COLORES_ESTADO = { disponible: '#22B07D', ocupado: '#E8A33D', ausente: '#8C96A8', no_disponible: '#D6455F' };
function htmlAvatar(usuario, tamano) {
  const nombre = usuario ? (usuario.nombre || usuario.correo || '') : '';
  const foto = usuario && /^https:\/\//.test(usuario.avatar_url || '') ? usuario.avatar_url : '';
  const estado = COLORES_ESTADO[(usuario && usuario.estado) || 'disponible'];
  const interior = foto
    ? `<img src="${escaparHtmlTema(foto)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%">`
    : obtenerIniciales(nombre);
  return `<span class="barra-lateral__avatar avatar-con-estado" style="width:${tamano}px;height:${tamano}px;font-size:${Math.round(tamano * 0.38)}px;">${interior}<i style="background:${estado}"></i></span>`;
}

// Repinta el bloque de usuario de la topbar (tras sincronizar o guardar el perfil)
function pintarUsuarioSuperior() {
  const boton = document.getElementById('botonUsuarioSuperior');
  if (!boton) return;
  const usuario = JSON.parse(localStorage.getItem('usuario_sesion') || 'null');
  const nombre = usuario ? (usuario.nombre || usuario.correo) : '';
  const avatar = boton.querySelector('.barra-lateral__avatar');
  if (avatar) avatar.outerHTML = htmlAvatar(usuario, 32);
  const n = boton.querySelector('.barra-superior__usuario-nombre');
  if (n) n.textContent = nombre.split(' ')[0] || 'Cuenta';
  const c = boton.querySelector('.barra-superior__usuario-empresa');
  if (c) c.textContent = (usuario && usuario.cargo) || 'Mi perfil';
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
  // Mantiene en sintonía la preferencia de "Apariencia" y la guarda en la cuenta
  const prefs = { ...leerPreferenciasUi(), tema: activarOscuro ? 'oscuro' : 'claro' };
  guardarPreferenciasUiLocal(prefs);
  const recargar = () => window.location.reload();
  try {
    if (typeof API === 'undefined') return recargar();
    Promise.race([API.actualizar('/api/perfil/apariencia', { tema: prefs.tema }), new Promise(r => setTimeout(r, 1500))])
      .catch(() => {}).finally(recargar);
  } catch (_) { recargar(); }
}

document.addEventListener('DOMContentLoaded', () => { iniciarLayout(); sincronizarPerfil(); });

// ============================================================
// Telemetría del navegador (Fase 8): solo "qué pantalla se abrió".
// Sin contenido de la página, sin búsquedas escritas, sin datos del
// negocio. El servidor descarta cualquier cosa fuera del catálogo.
// ============================================================
const Telemetria = {
  enviar(nombre, propiedades) {
    try {
      const token = localStorage.getItem('token_sesion');
      if (!token || typeof API === 'undefined') return;
      fetch('/api/telemetria/eventos', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...API.encabezadoEmpresa() },
        body: JSON.stringify({ eventos: [{ nombre, propiedades: propiedades || {} }] })
      }).catch(() => {});
    } catch (_) { /* nunca afecta la página */ }
  },
  pantallaActual() {
    const archivo = (location.pathname.split('/').pop() || 'index.html').replace('.html', '');
    return archivo || 'index';
  }
};

document.addEventListener('DOMContentLoaded', () => {
  // El panel de administrador no se mide (no es uso de clientes)
  if (document.querySelector('.navegacion') && Telemetria.pantallaActual() !== 'admin') {
    Telemetria.enviar('pantalla.abierta', { pantalla: Telemetria.pantallaActual() });
  }
});

// ============================================================
// Medición de uso (facilidad de uso): ventanas que se abren y se
// cierran con o sin guardar, búsquedas y ayuda. Solo identificadores
// del código (id de la ventana), conteos y tiempos: nunca lo escrito.
// ============================================================
(function medirUso() {
  if (!document.querySelector('.navegacion')) return;
  const pantalla = () => Telemetria.pantallaActual();
  const abiertas = new Map(); // id → momento de apertura
  const CLAVE_CANCELADOS = 'uso_formularios_cancelados';

  function cancelacionesDe(id) {
    try { return (JSON.parse(sessionStorage.getItem(CLAVE_CANCELADOS) || '{}')[id]) || 0; } catch (_) { return 0; }
  }
  function sumarCancelacion(id) {
    try {
      const mapa = JSON.parse(sessionStorage.getItem(CLAVE_CANCELADOS) || '{}');
      mapa[id] = (mapa[id] || 0) + 1;
      sessionStorage.setItem(CLAVE_CANCELADOS, JSON.stringify(mapa));
      return mapa[id];
    } catch (_) { return 0; }
  }

  function revisar(modal) {
    const id = modal.id;
    if (!id || modal.dataset.sinMedicion !== undefined) return;
    const visible = !modal.hidden;
    if (visible && !abiertas.has(id)) {
      abiertas.set(id, Date.now());
      Telemetria.enviar('formulario.abierto', { pantalla: pantalla(), formulario: id });
    } else if (!visible && abiertas.has(id)) {
      const inicio = abiertas.get(id);
      abiertas.delete(id);
      const guardado = (typeof API !== 'undefined' && API.ultimaEscrituraOk >= inicio);
      Telemetria.enviar('formulario.cerrado', {
        pantalla: pantalla(), formulario: id, guardado, segundos: Math.round((Date.now() - inicio) / 1000)
      });
      if (!guardado && sumarCancelacion(id) === 3) Encuestas.preguntarPorFormulario(id);
    }
  }

  const observador = new MutationObserver((cambios) => {
    for (const c of cambios) {
      if (c.type === 'attributes' && c.target.classList && c.target.classList.contains('modal')) revisar(c.target);
    }
  });
  document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.modal[id]').forEach(revisar);
    observador.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
  });

  // Búsquedas: cuántos resultados quedaron (no lo que se escribió)
  let reloj = null;
  document.addEventListener('input', (ev) => {
    const campo = ev.target;
    if (!campo.closest || !campo.closest('.barra-herramientas-tabla__buscador')) return;
    clearTimeout(reloj);
    reloj = setTimeout(() => {
      if ((campo.value || '').trim().length < 2) return;
      const seccion = campo.closest('section, .tarjeta, main') || document;
      const filas = [...seccion.querySelectorAll('tbody tr')].filter(f => !f.querySelector('.tabla__vacio') && f.offsetParent !== null).length;
      const tarjetas = filas ? 0 : seccion.querySelectorAll('.tarjeta-producto, .tarjetas-productos > *').length;
      Telemetria.enviar('busqueda.usada', { pantalla: pantalla(), resultados: filas || tarjetas });
    }, 1500);
  });

  // "¿Cómo funciona?"
  document.addEventListener('DOMContentLoaded', () => {
    if (typeof window.abrirAyudaContextual === 'function') {
      const original = window.abrirAyudaContextual;
      window.abrirAyudaContextual = function (...args) {
        Telemetria.enviar('ayuda.abierta', { pantalla: pantalla() });
        return original.apply(this, args);
      };
    }
  });
})();

// ============================================================
// Encuestas cortas en el momento justo. Una tarjeta pequeña abajo a
// la derecha, que se puede cerrar. El servidor decide si toca
// (facilidad: a partir de 7 días de uso, una sola vez).
// ============================================================
const Encuestas = {
  _abierta: false,

  _tarjeta(contenido) {
    if (this._abierta) return null;
    this._abierta = true;
    const t = document.createElement('div');
    t.className = 'encuesta-flotante';
    t.setAttribute('role', 'dialog');
    t.innerHTML = `<button type="button" class="encuesta-flotante__cerrar" aria-label="Cerrar">×</button>${contenido}`;
    document.body.appendChild(t);
    requestAnimationFrame(() => t.classList.add('encuesta-flotante--visible'));
    return t;
  },

  _cerrar(t) {
    t.classList.remove('encuesta-flotante--visible');
    setTimeout(() => t.remove(), 250);
    this._abierta = false;
  },

  _guardar(cuerpo) {
    return API.enviar('/api/encuestas', cuerpo).catch(() => {});
  },

  async revisarPendiente() {
    try {
      const hoy = new Date().toISOString().slice(0, 10);
      if (localStorage.getItem('encuesta_revisada') === hoy) return;
      localStorage.setItem('encuesta_revisada', hoy);
      const r = await API.obtener('/api/encuestas/pendiente');
      if (!r || r.encuesta !== 'facilidad') return;
      // No interrumpe: espera a que no haya ventanas ni recorridos abiertos
      const ocupado = () => document.querySelector('.modal:not([hidden]), .recorrido-tarjeta, .recorrido-capa');
      let intentos = 0;
      const intentar = () => {
        if (!ocupado()) return this.preguntarFacilidad();
        if (++intentos < 20) setTimeout(intentar, 15000);
      };
      intentar();
    } catch (_) { /* nunca molesta si falla */ }
  },

  preguntarFacilidad() {
    const t = this._tarjeta(`
      <p class="encuesta-flotante__pregunta">¿Qué tan fácil es usar Fincil?</p>
      <div class="encuesta-flotante__escala">
        ${[1, 2, 3, 4, 5].map(n => `<button type="button" data-puntaje="${n}">${n}</button>`).join('')}
      </div>
      <div class="encuesta-flotante__extremos"><span>Muy difícil</span><span>Muy fácil</span></div>
      <div class="encuesta-flotante__detalle" hidden>
        <textarea maxlength="500" rows="3" placeholder="¿Qué mejorarías?"></textarea>
        <button type="button" class="boton boton--primario boton--pequeno" data-enviar>Enviar</button>
      </div>`);
    if (!t) return;
    Telemetria.enviar('encuesta.mostrada', { pantalla: Telemetria.pantallaActual(), encuesta: 'facilidad' });
    let puntaje = null;
    t.querySelector('.encuesta-flotante__cerrar').onclick = () => {
      this._guardar({ encuesta: 'facilidad', estado: puntaje ? 'respondida' : 'omitida', puntaje, contexto: Telemetria.pantallaActual() });
      this._cerrar(t);
    };
    t.querySelectorAll('[data-puntaje]').forEach(b => b.onclick = () => {
      puntaje = Number(b.dataset.puntaje);
      t.querySelectorAll('[data-puntaje]').forEach(x => x.classList.toggle('activo', x === b));
      t.querySelector('.encuesta-flotante__detalle').hidden = false;
    });
    t.querySelector('[data-enviar]').onclick = () => {
      this._guardar({ encuesta: 'facilidad', estado: 'respondida', puntaje, contexto: Telemetria.pantallaActual(),
        comentario: t.querySelector('textarea').value });
      t.innerHTML = '<p class="encuesta-flotante__pregunta">¡Gracias!</p>';
      setTimeout(() => this._cerrar(t), 1500);
    };
  },

  preguntarPorFormulario(formulario) {
    try { if (localStorage.getItem('encuesta_formulario_' + formulario)) return; localStorage.setItem('encuesta_formulario_' + formulario, '1'); } catch (_) {}
    const motivos = [
      ['no_entendi', 'No entendí qué llenar'],
      ['me_falta_dato', 'Me faltaba un dato'],
      ['error_al_guardar', 'Me salió un error'],
      ['solo_mirando', 'Solo estaba mirando'],
      ['otro', 'Otro']
    ];
    const t = this._tarjeta(`
      <p class="encuesta-flotante__pregunta">¿Algo no quedó claro?</p>
      <div class="encuesta-flotante__opciones">
        ${motivos.map(([v, txt]) => `<button type="button" data-motivo="${v}">${txt}</button>`).join('')}
      </div>
      <div class="encuesta-flotante__detalle" hidden>
        <textarea maxlength="500" rows="3" placeholder="Cuéntanos (opcional)"></textarea>
        <button type="button" class="boton boton--primario boton--pequeno" data-enviar>Enviar</button>
      </div>`);
    if (!t) return;
    Telemetria.enviar('encuesta.mostrada', { pantalla: Telemetria.pantallaActual(), encuesta: 'formulario' });
    let motivo = null;
    const contexto = `${Telemetria.pantallaActual()}:${formulario}`;
    t.querySelector('.encuesta-flotante__cerrar').onclick = () => {
      this._guardar({ encuesta: 'formulario', estado: motivo ? 'respondida' : 'omitida', motivo, contexto });
      this._cerrar(t);
    };
    t.querySelectorAll('[data-motivo]').forEach(b => b.onclick = () => {
      motivo = b.dataset.motivo;
      t.querySelectorAll('[data-motivo]').forEach(x => x.classList.toggle('activo', x === b));
      t.querySelector('.encuesta-flotante__detalle').hidden = false;
    });
    t.querySelector('[data-enviar]').onclick = () => {
      this._guardar({ encuesta: 'formulario', estado: 'respondida', motivo, contexto, comentario: t.querySelector('textarea').value });
      t.innerHTML = '<p class="encuesta-flotante__pregunta">¡Gracias! Lo vamos a revisar.</p>';
      setTimeout(() => this._cerrar(t), 1800);
    };
  }
};

document.addEventListener('DOMContentLoaded', () => {
  if (document.querySelector('.navegacion') && localStorage.getItem('token_sesion')) {
    setTimeout(() => Encuestas.revisarPendiente(), 20000);
  }
});


// ============================================================
// Errores del navegador (Fase 9): se reportan al servidor, que los
// limpia y los manda a Sentry. Solo el mensaje del error y la
// pantalla; nunca contenido de la página ni datos escritos.
// Máximo 5 por página para no inundar.
// ============================================================
(function vigilarErrores() {
  let enviados = 0;
  const vistos = new Set();
  function reportar(mensaje, tipo) {
    try {
      const texto = String(mensaje || '').slice(0, 300);
      if (!texto || vistos.has(texto) || enviados >= 5) return;
      const token = localStorage.getItem('token_sesion');
      if (!token || typeof API === 'undefined') return;
      vistos.add(texto); enviados++;
      fetch('/api/errores-navegador', {
        method: 'POST',
        keepalive: true,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...API.encabezadoEmpresa() },
        body: JSON.stringify({ mensaje: texto, pantalla: Telemetria.pantallaActual(), tipo })
      }).catch(() => {});
    } catch (_) { /* nunca afecta la página */ }
  }
  window.addEventListener('error', (e) => reportar(e && e.message, 'error'));
  window.addEventListener('unhandledrejection', (e) => {
    const r = e && e.reason;
    // "Sesión expirada" y errores de validación del API no son fallas del código
    if (r && /Sesión expirada/.test(r.message || '')) return;
    reportar(r && (r.message || r), 'promesa');
  });
})();

// ============================================================
// Tipo de negocio: fabricante, comerciante o ambos.
// Se guarda en la empresa. Lo último conocido queda en el navegador
// para ocultar Materiales/Procesos antes del primer pintado; luego se
// confirma con el servidor. Sin elegir, la persona con permiso de
// configuración ve el selector una vez.
// ============================================================
const Negocio = (() => {
  const CLAVE = 'modelo_negocio';
  const PREDETERMINADO = { fabricacion: true, reventa: false, definido: false };
  let permisos = [];
  let avisarListo;
  const listo = new Promise(r => { avisarListo = r; }); // se resuelve tras consultar al servidor

  function leer() {
    try { return { ...PREDETERMINADO, ...(JSON.parse(localStorage.getItem(CLAVE) || 'null') || {}) }; }
    catch (_) { return { ...PREDETERMINADO }; }
  }

  function aplicarClases(m) {
    const raiz = document.documentElement;
    raiz.classList.toggle('negocio-sin-fabricacion', !m.fabricacion);
    raiz.classList.toggle('negocio-sin-reventa', !m.reventa);
  }

  function guardarLocal(m) {
    try { localStorage.setItem(CLAVE, JSON.stringify(m)); } catch (_) {}
    aplicarClases(m);
    document.dispatchEvent(new CustomEvent('negocio:cambio', { detail: m }));
  }

  aplicarClases(leer());

  const OPCIONES = [
    { id: 'fabricacion', titulo: 'Fabrico mis productos', texto: 'Materiales, recetas, procesos y producción.',
      icono: '<path d="M2 20h20"/><path d="M4 20V9l5 3V9l5 3V5h6v15"/>' },
    { id: 'reventa', titulo: 'Compro y revendo', texto: 'Compras, precios y existencias.',
      icono: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2l2.4 11.6a1 1 0 0 0 1 .8h8.8a1 1 0 0 0 1-.8L21 8H6"/>' },
    { id: 'ambos', titulo: 'Las dos cosas', texto: 'Fabrico algunos productos y compro otros para revender.',
      icono: '<path d="M21 8 12 3 3 8l9 5 9-5Z"/><path d="M3 8v8l9 5 9-5V8"/>' }
  ];

  function seleccionActual(m) {
    if (!m.definido) return null;
    return m.fabricacion && m.reventa ? 'ambos' : (m.reventa ? 'reventa' : 'fabricacion');
  }

  function abrirSelector(permitirCerrar) {
    if (document.getElementById('modalTipoNegocio')) return;
    const actual = seleccionActual(leer());
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.id = 'modalTipoNegocio';
    modal.innerHTML = `
      <div class="modal__contenido tarjeta tn" role="dialog" aria-modal="true" aria-labelledby="tituloTipoNegocio">
        <h2 id="tituloTipoNegocio">¿Cómo funciona tu negocio?</h2>
        <div class="tn__opciones" role="radiogroup">
          ${OPCIONES.map(o => `
            <button type="button" class="tn__opcion${o.id === actual ? ' tn__opcion--activa' : ''}" data-opcion="${o.id}" role="radio" aria-checked="${o.id === actual}">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${o.icono}</svg>
              <strong>${o.titulo}</strong>
              <span>${o.texto}</span>
            </button>`).join('')}
        </div>
        <div class="modal__acciones">
          ${permitirCerrar ? '<button type="button" class="boton" data-accion="cerrar">Cancelar</button>' : ''}
          <button type="button" class="boton boton--primario" data-accion="guardar" ${actual ? '' : 'disabled'}>Continuar</button>
        </div>
      </div>`;
    document.body.appendChild(modal);

    let elegida = actual;
    const botonGuardar = modal.querySelector('[data-accion="guardar"]');
    modal.querySelectorAll('[data-opcion]').forEach(b => b.addEventListener('click', () => {
      elegida = b.dataset.opcion;
      modal.querySelectorAll('[data-opcion]').forEach(x => {
        const activa = x === b;
        x.classList.toggle('tn__opcion--activa', activa);
        x.setAttribute('aria-checked', activa);
      });
      botonGuardar.disabled = false;
    }));
    const cerrar = modal.querySelector('[data-accion="cerrar"]');
    if (cerrar) cerrar.addEventListener('click', () => modal.remove());

    botonGuardar.addEventListener('click', async () => {
      const cuerpo = { fabricacion: elegida !== 'reventa', reventa: elegida !== 'fabricacion' };
      botonGuardar.disabled = true;
      try {
        const m = await API.actualizar('/api/empresas/modelo-negocio', cuerpo);
        guardarLocal({ ...cuerpo, definido: true, ...m });
        modal.remove();
        // La pantalla actual puede dejar de aplicar (p. ej. Materiales para un comerciante)
        const pagina = location.pathname.split('/').pop();
        if (!cuerpo.fabricacion && ['materiales.html', 'procesos.html'].includes(pagina)) location.href = '/productos.html';
        else location.reload();
      } catch (err) {
        botonGuardar.disabled = false;
        mostrarAviso(err.message, 'error');
      }
    });
  }

  function puedeElegir() { return permisos.includes('configuracion.editar'); }

  function pintarTarjetaPerfil(m) {
    const tarjeta = document.getElementById('tarjetaTipoNegocio');
    if (!tarjeta) return;
    tarjeta.hidden = !puedeElegir();
    const o = OPCIONES.find(x => x.id === seleccionActual(m));
    document.getElementById('textoTipoNegocio').textContent = o ? o.titulo : 'Sin elegir';
  }

  async function sincronizar() {
    if (!localStorage.getItem('token_sesion') || typeof API === 'undefined') return;
    try {
      const r = await API.obtener('/api/empresas');
      permisos = (r.activa && r.activa.permisos) || [];
      const m = { ...PREDETERMINADO, ...((r.activa && r.activa.modelo_negocio) || {}) };
      const antes = JSON.stringify(leer());
      if (antes !== JSON.stringify(m)) guardarLocal(m);
      pintarTarjetaPerfil(m);
      if (!m.definido && puedeElegir()) abrirSelector(false);
    } catch (_) { /* sin conexión: se queda con lo último conocido */ }
    finally { avisarListo(); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    if (document.querySelector('.navegacion')) sincronizar(); else avisarListo();
  });

  return {
    modelo: leer,
    fabrica: () => leer().fabricacion,
    revende: () => leer().reventa,
    abrirSelector,
    listo,
    eligiendo: () => !!document.getElementById('modalTipoNegocio')
  };
})();
