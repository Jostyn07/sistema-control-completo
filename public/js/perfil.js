// ============================================================
// perfil.js — Mi perfil: datos personales, apariencia y seguridad.
// Todo es personal: se guarda en la cuenta del usuario (no en la
// empresa) vía /api/perfil. La apariencia se aplica con las funciones
// de tema.js (aplicarApariencia, FONDOS_DEGRADADOS…).
// ============================================================

const ESTADOS_PERFIL = {
  disponible: { texto: 'Disponible', color: '#22B07D' },
  ocupado: { texto: 'Ocupado', color: '#E8A33D' },
  ausente: { texto: 'Ausente', color: '#8C96A8' },
  no_disponible: { texto: 'No disponible', color: '#D6455F' }
};
const COLORES_SOLIDOS = ['#F4F7FB', '#FDF6EC', '#EEF7F1', '#F3EEFB', '#E8F1FB', '#FBEFF3', '#1B2433', '#0F1A2E'];
const NOMBRES_DEGRADADOS = { aurora: 'Aurora', atardecer: 'Atardecer', oceano: 'Océano', bosque: 'Bosque', lavanda: 'Lavanda', grafito: 'Grafito' };

let perfilActual = null;
let estadoElegido = 'disponible';
let aparienciaGuardada = {};   // lo que está guardado en la cuenta
let aparienciaBorrador = {};   // lo que se está probando en pantalla
let fondosSubidos = [];        // imágenes de fondo subidas en esta visita

const $ = (id) => document.getElementById(id);
const esc = (t) => { const d = document.createElement('div'); d.textContent = t ?? ''; return d.innerHTML; };

function iniciales(texto) {
  return (texto || '?').trim().split(/\s+/).slice(0, 2).map(p => p[0]).join('').toUpperCase() || '?';
}
function nombreMostrado() {
  const visible = $('cVisible').value.trim();
  return visible || [$('cNombre').value.trim(), $('cApellido').value.trim()].filter(Boolean).join(' ') || 'Tu nombre';
}
function htmlFotoOIniciales(url, nombre) {
  return url ? `<img src="${esc(url)}" alt="">` : esc(iniciales(nombre));
}

// ---------------- Arranque ----------------
async function iniciarPerfil() {
  prepararPestanas();
  prepararFormularioPerfil();
  prepararApariencia();
  prepararSeguridad();
  document.querySelectorAll('input[type=file][data-subir]').forEach(inp =>
    inp.addEventListener('change', () => subirImagen(inp.dataset.subir, inp)));
  $('quitarPortada').addEventListener('click', () => guardarImagenPerfil('portada', ''));

  try {
    perfilActual = await API.obtener('/api/perfil');
    llenarPerfil(perfilActual);
    aparienciaGuardada = { ...(perfilActual.apariencia || {}) };
    aparienciaBorrador = { ...aparienciaGuardada };
    if (aparienciaGuardada.fondo?.tipo === 'imagen') fondosSubidos.push(aparienciaGuardada.fondo.valor);
    pintarApariencia();
  } catch (err) {
    mostrarAviso('No se pudo cargar tu perfil: ' + err.message, 'error');
  }
  const inicial = (location.hash || '').replace('#', '');
  if (['perfil', 'apariencia', 'seguridad'].includes(inicial)) cambiarPestana(inicial);
}

function prepararPestanas() {
  document.querySelectorAll('.pf-pestana').forEach(b =>
    b.addEventListener('click', () => { cambiarPestana(b.dataset.pestana); history.replaceState(null, '', '#' + b.dataset.pestana); }));
}
function cambiarPestana(nombre) {
  document.querySelectorAll('.pf-pestana').forEach(b => b.classList.toggle('pf-pestana--activa', b.dataset.pestana === nombre));
  document.querySelectorAll('.pf-panel').forEach(p => { p.hidden = p.dataset.panel !== nombre; });
}

// ---------------- Mi perfil ----------------
function llenarPerfil(p) {
  $('cNombre').value = p.nombre || '';
  $('cApellido').value = p.apellido || '';
  $('cVisible').value = p.nombre_visible || '';
  $('cCargo').value = p.cargo || '';
  $('cTelefono').value = p.telefono || '';
  $('cCorreo').value = p.correo || '';
  $('cDescripcion').value = p.descripcion || '';
  estadoElegido = p.estado || 'disponible';
  $('heroCorreo').textContent = p.correo || '';
  if (p.creado_en) {
    const f = new Date(p.creado_en).toLocaleDateString('es-CO', { month: 'short', year: 'numeric' });
    $('heroDesde').textContent = 'En Fincil desde ' + f;
  }
  $('ultimoIngreso').textContent = p.ultimo_ingreso
    ? new Date(p.ultimo_ingreso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
  $('formaIngreso').textContent = [p.tiene_contrasena && 'Correo y contraseña', p.acceso_google && 'Google'].filter(Boolean).join(' · ') || '—';
  if (!p.tiene_contrasena) {
    $('campoActual').hidden = true;
    $('tituloContrasena').textContent = 'Crear contraseña';
    $('ayudaContrasena').textContent = 'Entraste con Google. Si creas una contraseña, también podrás ingresar con tu correo.';
    $('guardarContrasena').textContent = 'Crear contraseña';
  }
  pintarIdentidad();
}

function pintarIdentidad() {
  const p = perfilActual || {};
  const nombre = nombreMostrado();
  const cargo = $('cCargo').value.trim();
  const estado = ESTADOS_PERFIL[estadoElegido];
  const chipEstado = `<i style="background:${estado.color}"></i>${estado.texto}`;

  $('heroNombre').textContent = nombre;
  $('heroCargo').textContent = cargo;
  $('heroEstado').innerHTML = chipEstado;
  $('avatarImg').innerHTML = htmlFotoOIniciales(p.avatar_url, nombre);
  $('avatarEstado').style.background = estado.color;

  const portada = $('portada');
  portada.style.backgroundImage = p.portada_url ? `url("${p.portada_url.replace(/"/g, '')}")` : '';
  portada.classList.toggle('con-imagen', !!p.portada_url);
  $('quitarPortada').hidden = !p.portada_url;

  // Tarjeta de presentación
  $('tpPortada').style.background = p.portada_url
    ? `center / cover url("${p.portada_url.replace(/"/g, '')}")`
    : 'linear-gradient(120deg, var(--t-accent), color-mix(in srgb, var(--t-accent) 55%, #7C5CDB))';
  $('tpAvatar').innerHTML = htmlFotoOIniciales(p.avatar_url, nombre);
  $('tpNombre').textContent = nombre;
  $('tpCargo').textContent = cargo;
  $('tpEstado').innerHTML = chipEstado;
  $('tpDesc').textContent = $('cDescripcion').value.trim();
  const tel = $('cTelefono').value.trim().replace(/[^\d+]/g, '');
  const correo = p.correo || '';
  $('tpContacto').innerHTML = [
    tel ? `<a href="tel:${esc(tel)}" title="Llamar"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2Z"/></svg></a>` : '',
    tel ? `<a href="https://wa.me/${esc(tel.replace('+', ''))}" target="_blank" rel="noopener" title="WhatsApp"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg></a>` : '',
    correo ? `<a href="mailto:${esc(correo)}" title="Correo"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/></svg></a>` : ''
  ].join('');

  document.querySelectorAll('#selectorEstado button').forEach(b => b.classList.toggle('activo', b.dataset.estado === estadoElegido));
  $('contadorDesc').textContent = `${$('cDescripcion').value.length}/200`;
  const prev = $('previaAvatar');
  if (prev) prev.innerHTML = htmlFotoOIniciales(p.avatar_url, nombre);
  $('previaSaludo').textContent = `Hola, ${nombre.split(' ')[0]} 👋`;
}

function prepararFormularioPerfil() {
  ['cNombre', 'cApellido', 'cVisible', 'cCargo', 'cTelefono', 'cDescripcion'].forEach(id => $(id).addEventListener('input', pintarIdentidad));
  document.querySelectorAll('#selectorEstado button').forEach(b =>
    b.addEventListener('click', () => { estadoElegido = b.dataset.estado; pintarIdentidad(); }));

  $('formPerfil').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!$('cNombre').value.trim()) { mostrarAviso('El nombre es obligatorio', 'error'); return; }
    const boton = $('guardarPerfil'); boton.disabled = true;
    try {
      perfilActual = await API.actualizar('/api/perfil', {
        nombre: $('cNombre').value, apellido: $('cApellido').value, nombre_visible: $('cVisible').value,
        cargo: $('cCargo').value, telefono: $('cTelefono').value, descripcion: $('cDescripcion').value,
        estado: estadoElegido
      });
      refrescarSesionLocal();
      pintarIdentidad();
      mostrarAviso('Perfil guardado');
    } catch (err) { mostrarAviso(err.message, 'error'); }
    finally { boton.disabled = false; }
  });
}

function refrescarSesionLocal() {
  if (typeof actualizarSesionLocalConPerfil === 'function') actualizarSesionLocalConPerfil(perfilActual);
  if (typeof pintarUsuarioSuperior === 'function') pintarUsuarioSuperior();
  // Pie de la sidebar (lo arma auth.js): se rehace con los datos nuevos
  const pie = document.querySelector('.barra-lateral__pie');
  const viejo = pie && pie.querySelector('.navegacion__usuario');
  if (viejo && typeof mostrarUsuarioActual === 'function') {
    viejo.remove();
    mostrarUsuarioActual();
    const nuevo = document.querySelector('.navegacion .navegacion__usuario');
    if (nuevo) pie.appendChild(nuevo);
  }
}

// ---------------- Imágenes ----------------
async function subirImagen(tipo, input) {
  const archivo = input.files && input.files[0];
  input.value = '';
  if (!archivo) return;
  if (archivo.size > 5 * 1024 * 1024) { mostrarAviso('La imagen no puede pesar más de 5 MB', 'error'); return; }
  const datos = new FormData();
  datos.append('imagen', archivo);
  mostrarAviso('Subiendo imagen…');
  try {
    const subir = (token) => fetch(`/api/perfil/imagen?tipo=${tipo}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, ...API.encabezadoEmpresa() },
      body: datos
    });
    let r = await subir(localStorage.getItem('token_sesion'));
    if (r.status === 401 && await API._renovarSesion()) r = await subir(localStorage.getItem('token_sesion'));
    const resultado = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(resultado.error || 'No se pudo subir la imagen');

    if (tipo === 'fondo') {
      fondosSubidos.unshift(resultado.url);
      aparienciaBorrador.fondo = { tipo: 'imagen', valor: resultado.url };
      pintarApariencia();
      mostrarAviso('Imagen lista. Guarda la apariencia para aplicarla.');
    } else {
      await guardarImagenPerfil(tipo, resultado.url);
    }
  } catch (err) { mostrarAviso(err.message, 'error'); }
}

async function guardarImagenPerfil(tipo, url) {
  try {
    perfilActual = await API.actualizar('/api/perfil', tipo === 'avatar' ? { avatar_url: url } : { portada_url: url });
    refrescarSesionLocal();
    pintarIdentidad();
    mostrarAviso(url ? (tipo === 'avatar' ? 'Foto actualizada' : 'Portada actualizada') : 'Portada quitada');
  } catch (err) { mostrarAviso(err.message, 'error'); }
}

// ---------------- Apariencia ----------------
function prepararApariencia() {
  document.querySelectorAll('[data-tema-opcion]').forEach(b => b.addEventListener('click', () => {
    aparienciaBorrador.tema = b.dataset.temaOpcion; pintarApariencia();
  }));
  document.querySelectorAll('[data-acento]').forEach(b => b.addEventListener('click', () => {
    aparienciaBorrador.acento = b.dataset.acento || null; pintarApariencia();
  }));
  $('acentoPropio').addEventListener('input', (e) => { aparienciaBorrador.acento = e.target.value; pintarApariencia(); });
  document.querySelectorAll('[data-fondo-tipo]').forEach(b => b.addEventListener('click', () => {
    const tipo = b.dataset.fondoTipo;
    const actual = aparienciaBorrador.fondo || {};
    if (tipo === 'ninguno') aparienciaBorrador.fondo = { tipo: 'ninguno' };
    else if (actual.tipo !== tipo) {
      aparienciaBorrador.fondo = tipo === 'solido' ? { tipo, valor: COLORES_SOLIDOS[0] }
        : tipo === 'degradado' ? { tipo, valor: 'aurora' }
        : fondosSubidos[0] ? { tipo, valor: fondosSubidos[0] } : { tipo: 'imagen', valor: '' };
    }
    pintarApariencia();
  }));
  $('guardarApariencia').addEventListener('click', guardarApariencia);
  $('restablecerApariencia').addEventListener('click', () => {
    aparienciaBorrador = { tema: 'claro', acento: null, fondo: { tipo: 'ninguno' } };
    pintarApariencia();
  });
  window.addEventListener('beforeunload', () => aplicarApariencia(aparienciaGuardada));
}

function temaEfectivo(tema) {
  if (tema === 'auto') return matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  return tema || (document.documentElement.getAttribute('data-tema') === 'oscuro' ? 'oscuro' : 'claro');
}

function cssFondo(f) {
  if (!f || !f.tipo || f.tipo === 'ninguno') return '';
  if (f.tipo === 'solido') return f.valor;
  if (f.tipo === 'degradado') return FONDOS_DEGRADADOS[f.valor] || '';
  if (f.tipo === 'imagen' && f.valor) return `url("${f.valor.replace(/"/g, '')}")`;
  return '';
}

function pintarApariencia() {
  const a = aparienciaBorrador;
  const tema = a.tema || (document.documentElement.getAttribute('data-tema') === 'oscuro' ? 'oscuro' : 'claro');
  const acento = a.acento || '';
  const fondo = a.fondo || { tipo: 'ninguno' };

  document.querySelectorAll('[data-tema-opcion]').forEach(b => b.classList.toggle('activo', b.dataset.temaOpcion === tema));
  const presets = [...document.querySelectorAll('[data-acento]')];
  presets.forEach(b => b.classList.toggle('activo', (b.dataset.acento || '').toLowerCase() === acento.toLowerCase()));
  const esPropio = !!acento && !presets.some(b => (b.dataset.acento || '').toLowerCase() === acento.toLowerCase());
  document.querySelector('.pf-color-propio').classList.toggle('activo', esPropio);
  if (esPropio) $('acentoPropio').value = acento;
  document.querySelectorAll('[data-fondo-tipo]').forEach(b => b.classList.toggle('activo', b.dataset.fondoTipo === fondo.tipo));

  // Opciones según el tipo de fondo
  const cont = $('opcionesFondo');
  if (fondo.tipo === 'solido') {
    cont.innerHTML = COLORES_SOLIDOS.map(c =>
      `<button type="button" class="pf-fondo ${c === fondo.valor ? 'activo' : ''}" style="--f:${c}" data-valor="${c}" title="${c}"></button>`).join('');
  } else if (fondo.tipo === 'degradado') {
    cont.innerHTML = Object.keys(FONDOS_DEGRADADOS).map(k =>
      `<button type="button" class="pf-fondo ${k === fondo.valor ? 'activo' : ''}" style="--f:${FONDOS_DEGRADADOS[k]}" data-valor="${k}"><span class="pf-fondo__nombre">${NOMBRES_DEGRADADOS[k]}</span></button>`).join('');
  } else if (fondo.tipo === 'imagen') {
    cont.innerHTML = `<label class="pf-subir-fondo">＋ Subir imagen<br><small>JPG, PNG o WEBP · máx. 5 MB</small>
        <input type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden id="subirFondo"></label>` +
      fondosSubidos.map(u => `<button type="button" class="pf-fondo ${u === fondo.valor ? 'activo' : ''}" style="--f:url('${esc(u)}')" data-valor="${esc(u)}"></button>`).join('');
    $('subirFondo').addEventListener('change', (e) => subirImagen('fondo', e.target));
  } else cont.innerHTML = '';
  cont.querySelectorAll('.pf-fondo').forEach(b => b.addEventListener('click', () => {
    aparienciaBorrador.fondo = { tipo: fondo.tipo, valor: b.dataset.valor }; pintarApariencia();
  }));

  // Vista previa + aplicar en vivo a esta misma página
  const previa = $('previa');
  previa.classList.toggle('oscuro', temaEfectivo(tema) === 'oscuro');
  previa.style.setProperty('--pv-acento', acento || '#168FF0');
  const contenido = previa.querySelector('.pf-previa__contenido');
  const css = cssFondo(fondo);
  contenido.classList.toggle('con-fondo', !!css);
  if (css) contenido.style.setProperty('--pv-fondo', css); else contenido.style.removeProperty('--pv-fondo');

  aplicarApariencia(normalizarParaGuardar());
}

function normalizarParaGuardar() {
  const a = aparienciaBorrador;
  const f = a.fondo && a.fondo.tipo !== 'ninguno' && a.fondo.valor ? a.fondo : { tipo: 'ninguno' };
  return { tema: a.tema || temaEfectivo(), acento: a.acento || null, fondo: f };
}

async function guardarApariencia() {
  const boton = $('guardarApariencia'); boton.disabled = true;
  try {
    const datos = normalizarParaGuardar();
    aparienciaGuardada = await API.actualizar('/api/perfil/apariencia', datos);
    aparienciaBorrador = { ...aparienciaGuardada };
    guardarPreferenciasUiLocal(aparienciaGuardada);
    if (aparienciaGuardada.tema === 'oscuro') localStorage.setItem(TEMA_CLAVE, 'oscuro');
    else localStorage.removeItem(TEMA_CLAVE);
    aplicarApariencia(aparienciaGuardada);
    pintarApariencia();
    mostrarAviso('Apariencia guardada');
  } catch (err) { mostrarAviso(err.message, 'error'); }
  finally { boton.disabled = false; }
}

// ---------------- Seguridad ----------------
function fuerzaContrasena(c) {
  let puntos = 0;
  if (c.length >= 8) puntos++;
  if (c.length >= 12) puntos++;
  if (/[a-z]/.test(c) && /[A-Z]/.test(c)) puntos++;
  if (/\d/.test(c)) puntos++;
  if (/[^A-Za-z0-9]/.test(c)) puntos++;
  return puntos;
}

function prepararSeguridad() {
  $('cNueva').addEventListener('input', () => {
    const p = fuerzaContrasena($('cNueva').value);
    const barra = $('barraFuerza');
    barra.style.width = `${(p / 5) * 100}%`;
    barra.style.background = p <= 2 ? '#D6455F' : p === 3 ? '#E8A33D' : '#22B07D';
  });

  $('formContrasena').addEventListener('submit', async (e) => {
    e.preventDefault();
    const nueva = $('cNueva').value;
    if (nueva.length < 8) return mostrarAviso('La contraseña nueva debe tener al menos 8 caracteres', 'error');
    if (nueva !== $('cRepetir').value) return mostrarAviso('Las contraseñas nuevas no coinciden', 'error');
    const boton = $('guardarContrasena'); boton.disabled = true;
    try {
      await API.actualizar('/api/perfil/contrasena', { actual: $('cActual').value, nueva });
      ['cActual', 'cNueva', 'cRepetir'].forEach(id => { $(id).value = ''; });
      $('barraFuerza').style.width = '0';
      mostrarAviso('Contraseña actualizada');
      if (perfilActual && !perfilActual.tiene_contrasena) {
        perfilActual.tiene_contrasena = true;
        $('campoActual').hidden = false;
        $('tituloContrasena').textContent = 'Cambiar contraseña';
        $('guardarContrasena').textContent = 'Actualizar contraseña';
      }
    } catch (err) { mostrarAviso(err.message, 'error'); }
    finally { boton.disabled = false; }
  });

  $('cerrarOtras').addEventListener('click', async () => {
    if (!confirm('¿Cerrar tu sesión en todos los demás dispositivos? Este seguirá conectado.')) return;
    const boton = $('cerrarOtras'); boton.disabled = true;
    try {
      await API.enviar('/api/perfil/cerrar-otras-sesiones', {});
      mostrarAviso('Listo: se cerró la sesión en los demás dispositivos');
    } catch (err) { mostrarAviso(err.message, 'error'); }
    finally { boton.disabled = false; }
  });
}
