// ============================================================
// agregar-metodo-pago.js
// La tarjeta se captura y se tokeniza DIRECTO en el navegador,
// hablando con los servidores de ePayco — nuestro backend nunca
// recibe el número de tarjeta, solo el token que resulta de esto.
// ============================================================

document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('formTarjeta');
  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    const boton = document.getElementById('botonGuardarTarjeta');
    boton.disabled = true;
    boton.textContent = 'Guardando…';

    try {
      const { public_key: llavePublica } = await API.obtener('/api/suscripcion/llave-publica-epayco');
      ePayco.setPublicKey(llavePublica);

      const token = await new Promise((resolve, reject) => {
        ePayco.token.create($('#formTarjeta'), (error, respuesta) => {
          if (error) {
            reject(new Error((respuesta && respuesta.data && respuesta.data.description) || 'La tarjeta no pudo validarse'));
          } else {
            resolve(respuesta);
          }
        });
      });

      await API.enviar('/api/suscripcion/agregar-metodo-pago', {
        token: token,
        nombre: document.getElementById('campoNombreTitular').value,
        apellido: document.getElementById('campoApellidoTitular').value,
        telefono: document.getElementById('campoTelefonoTitular').value
      });

      mostrarAviso('Método de pago guardado');
      window.location.href = '/';
    } catch (err) {
      mostrarAviso(err.message, 'error');
      boton.disabled = false;
      boton.textContent = 'Guardar método de pago';
    }
  });
});