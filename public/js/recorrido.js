// ============================================================
// recorrido.js — motor genérico del recorrido guiado (onboarding).
// No sabe nada de "Materiales" ni "Ventas": solo sabe resaltar un
// elemento del DOM (o mostrar una tarjeta centrada, si no hay
// elemento) y pasar de un paso al siguiente. El contenido de cada
// recorrido (qué pasos, qué texto) vive en otro archivo — ver
// recorrido-inicial.js para el recorrido de bienvenida.
//
// Uso:
//   iniciarRecorrido([
//     { selector: null, titulo: '...', texto: '...' },              // tarjeta centrada
//     { selector: 'a[href="./materiales.html"]', titulo: '...', texto: '...' }, // resalta ese elemento
//     { selector: '...', titulo: '...', texto: '...', diagrama: '<html opcional>' }
//   ], { alTerminar: () => {...} });
// ============================================================
function iniciarRecorrido(pasos, opciones = {}) {
  if (!pasos || pasos.length === 0) return;

  let indice = 0;
  const elementos = crearElementosRecorrido();

  function crearElementosRecorrido() {
    const fondo = document.createElement('div');
    fondo.className = 'recorrido-fondo';
    fondo.hidden = true; // el fondo oscuro completo solo se usa en pasos sin elemento que resaltar

    const resaltado = document.createElement('div');
    resaltado.className = 'recorrido-resaltado';
    resaltado.hidden = true;

    const tarjeta = document.createElement('div');
    tarjeta.className = 'recorrido-tarjeta';

    document.body.appendChild(fondo);
    document.body.appendChild(resaltado);
    document.body.appendChild(tarjeta);
    return { fondo, resaltado, tarjeta };
  }

  function destruirElementosRecorrido() {
    elementos.fondo.remove();
    elementos.resaltado.remove();
    elementos.tarjeta.remove();
  }

  function posicionarSobreElemento(elemento) {
    const rect = elemento.getBoundingClientRect();
    const margen = 6;
    elementos.resaltado.style.top = `${rect.top - margen}px`;
    elementos.resaltado.style.left = `${rect.left - margen}px`;
    elementos.resaltado.style.width = `${rect.width + margen * 2}px`;
    elementos.resaltado.style.height = `${rect.height + margen * 2}px`;
    elementos.resaltado.hidden = false;
    elementos.fondo.hidden = true; // el propio resaltado ya oscurece el resto (box-shadow enorme)

    // Tarjeta debajo del elemento si hay espacio; si no, arriba.
    const espacioAbajo = window.innerHeight - rect.bottom;
    const arriba = espacioAbajo < 220 && rect.top > 220;
    elementos.tarjeta.classList.remove('recorrido-tarjeta--centrada');
    elementos.tarjeta.style.top = arriba ? `${rect.top - 12}px` : `${rect.bottom + 12}px`;
    elementos.tarjeta.style.left = `${Math.max(12, Math.min(rect.left, window.innerWidth - 360))}px`;
    elementos.tarjeta.style.transform = arriba ? 'translateY(-100%)' : 'none';
  }

  function posicionarCentrada() {
    elementos.resaltado.hidden = true;
    elementos.fondo.hidden = false;
    elementos.tarjeta.classList.add('recorrido-tarjeta--centrada');
    elementos.tarjeta.style.transform = 'translate(-50%, -50%)';
  }

  function mostrarPaso() {
    const paso = pasos[indice];
    const elemento = paso.selector ? document.querySelector(paso.selector) : null;

    if (elemento) {
      elemento.scrollIntoView({ block: 'center', behavior: 'instant' in window ? 'instant' : 'auto' });
      posicionarSobreElemento(elemento);
    } else {
      posicionarCentrada();
    }

    const esUltimo = indice === pasos.length - 1;
    const esPrimero = indice === 0;
    elementos.tarjeta.innerHTML = `
      ${pasos.length > 1 ? `<div class="recorrido-tarjeta__contador">Paso ${indice + 1} de ${pasos.length}</div>` : ''}
      <h3>${paso.titulo}</h3>
      ${paso.diagrama ? `<div class="recorrido-tarjeta__diagrama">${paso.diagrama}</div>` : ''}
      <p>${paso.texto}</p>
      <div class="recorrido-tarjeta__acciones">
        <button type="button" class="boton boton--pequeno" data-accion="saltar">Saltar recorrido</button>
        <div>
          ${!esPrimero ? '<button type="button" class="boton boton--pequeno" data-accion="atras">Atrás</button>' : ''}
          <button type="button" class="boton boton--pequeno boton--primario" data-accion="${esUltimo ? 'terminar' : 'siguiente'}">
            ${esUltimo ? (paso.textoBotonFinal || 'Comenzar a trabajar →') : (paso.textoBotonSiguiente || 'Siguiente →')}
          </button>
        </div>
      </div>`;

    elementos.tarjeta.querySelector('[data-accion="siguiente"]')?.addEventListener('click', siguiente);
    elementos.tarjeta.querySelector('[data-accion="atras"]')?.addEventListener('click', atras);
    elementos.tarjeta.querySelector('[data-accion="saltar"]')?.addEventListener('click', () => terminar(true));
    elementos.tarjeta.querySelector('[data-accion="terminar"]')?.addEventListener('click', () => terminar(false));
  }

  function siguiente() { indice = Math.min(indice + 1, pasos.length - 1); mostrarPaso(); }
  function atras() { indice = Math.max(indice - 1, 0); mostrarPaso(); }

  function terminar(saltado) {
    destruirElementosRecorrido();
    window.removeEventListener('resize', mostrarPaso);
    if (opciones.alTerminar) opciones.alTerminar({ saltado });
  }

  window.addEventListener('resize', mostrarPaso);
  mostrarPaso();
}