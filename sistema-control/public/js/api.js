// ============================================================
// api.js — funciones compartidas para hablar con el backend.
// Todas las pestañas usan estas 4 funciones; nunca fetch directo.
// ============================================================
const API = {
  async _procesar(respuesta) {
    const datos = await respuesta.json().catch(() => ({}));
    if (!respuesta.ok) throw new Error(datos.error || `Error ${respuesta.status}`);
    return datos;
  },
  async obtener(ruta) {
    return this._procesar(await fetch(ruta));
  },
  async enviar(ruta, cuerpo) {
    return this._procesar(await fetch(ruta, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    }));
  },
  async actualizar(ruta, cuerpo) {
    return this._procesar(await fetch(ruta, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo)
    }));
  },
  async eliminar(ruta) {
    return this._procesar(await fetch(ruta, { method: 'DELETE' }));
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
