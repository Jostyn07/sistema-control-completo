// ============================================================
// api.js — funciones compartidas para hablar con el backend.
// Todas las pestañas usan estas 4 funciones; nunca fetch directo.
// Agrega el token de sesión a cada llamada. Los tokens de Supabase
// expiran cada hora por diseño: si el backend responde 401, primero
// se intenta renovar la sesión sola (con el refresh_token) y
// reintentar la petición una sola vez — solo si eso también falla
// se manda al login. Así nadie ve su sesión "cerrarse sola".
// ============================================================
const API = {
  _encabezados() {
    const token = localStorage.getItem('token_sesion');
    const encabezados = { 'Content-Type': 'application/json' };
    if (token) encabezados['Authorization'] = `Bearer ${token}`;
    return encabezados;
  },

  async _renovarSesion() {
    const refreshToken = localStorage.getItem('refresh_token_sesion');
    if (!refreshToken) return false;
    try {
      const respuesta = await fetch('/api/auth/refrescar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh_token: refreshToken })
      });
      if (!respuesta.ok) return false;
      const datos = await respuesta.json();
      localStorage.setItem('token_sesion', datos.token);
      localStorage.setItem('refresh_token_sesion', datos.refresh_token);
      return true;
    } catch {
      return false;
    }
  },

  _cerrarSesionYRedirigir() {
    localStorage.removeItem('token_sesion');
    localStorage.removeItem('refresh_token_sesion');
    localStorage.removeItem('usuario_sesion');
    window.location.href = '/login.html';
  },

  async _peticion(ruta, opciones, reintentado) {
    const respuesta = await fetch(ruta, opciones);

    if (respuesta.status === 401) {
      if (!reintentado && await this._renovarSesion()) {
        const opcionesRenovadas = { ...opciones, headers: this._encabezados() };
        return this._peticion(ruta, opcionesRenovadas, true); // un solo reintento, nunca más
      }
      this._cerrarSesionYRedirigir();
      throw new Error('Sesión expirada');
    }

    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`);
    return datos;
  },

  async obtener(ruta) {
    return this._peticion(ruta, { headers: this._encabezados() });
  },
  async enviar(ruta, cuerpo) {
    return this._peticion(ruta, {
      method: 'POST',
      headers: this._encabezados(),
      body: JSON.stringify(cuerpo)
    });
  },
  async actualizar(ruta, cuerpo) {
    return this._peticion(ruta, {
      method: 'PUT',
      headers: this._encabezados(),
      body: JSON.stringify(cuerpo)
    });
  },
  async eliminar(ruta, cuerpo) {
    const opciones = { method: 'DELETE', headers: this._encabezados() };
    if (cuerpo !== undefined) opciones.body = JSON.stringify(cuerpo);
    return this._peticion(ruta, opciones);
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