// ============================================================
// api.js — funciones compartidas para hablar con el backend.
// Todas las pestañas usan estas 4 funciones; nunca fetch directo.
// Ahora agrega el token de sesión a cada llamada, y si el backend
// responde 401 (sesión inválida o expirada), manda a login.html.
// ============================================================
const API = {
  _encabezados() {
    const token = localStorage.getItem('token_sesion');
    const encabezados = { 'Content-Type': 'application/json' };
    if (token) encabezados['Authorization'] = `Bearer ${token}`;
    return encabezados;
  },
  async _procesar(respuesta) {
    if (respuesta.status === 401) {
      localStorage.removeItem('token_sesion');
      localStorage.removeItem('usuario_sesion');
      window.location.href = '/login.html';
      throw new Error('Sesión expirada');
    }
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`);
    return datos;
  },
  async obtener(ruta) {
    return this._procesar(await fetch(ruta, { headers: this._encabezados() }));
  },
  async enviar(ruta, cuerpo) {
    return this._procesar(await fetch(ruta, {
      method: 'POST',
      headers: this._encabezados(),
      body: JSON.stringify(cuerpo)
    }));
  },
  async actualizar(ruta, cuerpo) {
    return this._procesar(await fetch(ruta, {
      method: 'PUT',
      headers: this._encabezados(),
      body: JSON.stringify(cuerpo)
    }));
  },
  async eliminar(ruta) {
    return this._procesar(await fetch(ruta, { method: 'DELETE', headers: this._encabezados() }));
  }
};

// Utilidad compartida: formatear pesos colombianos
function formatearPesos(valor) {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency', currency: 'COP', maximumFractionDigits: 0
  }).format(valor);
}

// Utilidad compartida: aviso simple no bloqueante
function mostrarAviso(mensaje, tipo = 'ok') {
  const aviso = document.createElement('div');
  aviso.className = `aviso aviso--${tipo}`;
  aviso.textContent = mensaje;
  document.body.appendChild(aviso);
  setTimeout(() => aviso.remove(), 3500);
}

// Exige sesión iniciada; se llama al cargar cada página protegida.
// Si no hay token, manda directo a login sin siquiera intentar la API.
function exigirSesion() {
  const token = localStorage.getItem('token_sesion');
  if (!token) {
    window.location.href = '/login.html';
    return false;
  }
  return true;
}