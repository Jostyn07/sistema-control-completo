// ============================================================
// agregar-metodo-pago.js
// La tarjeta se captura con los "Secure Fields" de Mercado Pago:
// número, vencimiento y CVC viven en iframes que Mercado Pago monta
// directo dentro de #campoNumeroTarjeta / #campoVencimientoTarjeta /
// #campoCVCTarjeta — nuestro JS nunca ve esos valores, solo recibe
// el token final. Nombre y documento sí son campos normales (no son
// datos de tarjeta, no necesitan iframe).
// ============================================================

document.addEventListener('DOMContentLoaded', async () => {
  const form = document.getElementById('formTarjeta');
  const boton = document.getElementById('botonGuardarTarjeta');

  let mp;
  try {
    const { public_key: llavePublica } = await API.obtener('/api/suscripcion/llave-publica-mercadopago');
    mp = new MercadoPago(llavePublica, { locale: 'es-CO' });
  } catch (err) {
    mostrarAviso('No se pudo iniciar el formulario de pago: ' + err.message, 'error');
    boton.disabled = true;
    return;
  }

  const estiloCampo = { style: { fontSize: '16px', fontFamily: 'Georgia, serif' } };
  const campoNumero = mp.fields.create('cardNumber', estiloCampo).mount('campoNumeroTarjeta');
  const campoVencimiento = mp.fields.create('expirationDate', { ...estiloCampo, placeholder: 'MM/AA' }).mount('campoVencimientoTarjeta');
  const campoCVC = mp.fields.create('securityCode', estiloCampo).mount('campoCVCTarjeta');

  // Resaltar el contenedor cuando el iframe interno tiene foco, para
  // que se vea igual que el resto de campos del formulario.
  for (const [campo, idContenedor] of [[campoNumero, 'campoNumeroTarjeta'], [campoVencimiento, 'campoVencimientoTarjeta'], [campoCVC, 'campoCVCTarjeta']]) {
    campo.on('focus', () => document.getElementById(idContenedor).classList.add('campo__tarjeta-segura--activo'));
    campo.on('blur', () => document.getElementById(idContenedor).classList.remove('campo__tarjeta-segura--activo'));
  }

  form.addEventListener('submit', async (evento) => {
    evento.preventDefault();
    boton.disabled = true;
    boton.textContent = 'Guardando…';

    try {
      const { id: token } = await mp.fields.createCardToken({
        cardholderName: document.getElementById('campoNombreTitular').value,
        identificationType: document.getElementById('campoTipoDocumento').value,
        identificationNumber: document.getElementById('campoNumeroDocumento').value
      });

      await API.enviar('/api/suscripcion/agregar-metodo-pago', { token });

      mostrarAviso('Método de pago guardado');
      window.location.href = '/';
    } catch (err) {
      mostrarAviso(err.message || 'La tarjeta no pudo validarse', 'error');
      boton.disabled = false;
      boton.textContent = 'Guardar método de pago';
    }
  });
});