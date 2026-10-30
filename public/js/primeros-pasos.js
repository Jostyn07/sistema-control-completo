// ============================================================
// PRIMEROS PASOS — public/js/primeros-pasos.js
// Hitos en Inicio. Fabricante: primer material, primer producto con
// receta y primera venta. Comerciante: primer producto y primera venta. Se marcan solos con los datos reales (los de
// ejemplo no cuentan) y la tarjeta desaparece al completar los 3.
// "Cargar ejemplo" crea datos reales marcados con " (ejemplo)" por
// la API normal (stock e historial cuadran); "Borrar ejemplo" los quita.
// ============================================================
const PrimerosPasos = (() => {
  const MARCA = ' (ejemplo)';
  const esEjemplo = (t) => typeof t === 'string' && t.endsWith(MARCA);

  const EJEMPLO = {
    categoria: 'Repostería' + MARCA,
    proveedor: 'Proveedor' + MARCA,
    materiales: [
      { clave: 'harina', nombre: 'Harina de trigo' + MARCA, unidad: 'kg', costo_unitario: 4500, stock_actual: 10, stock_seguridad: 2 },
      { clave: 'huevos', nombre: 'Huevos' + MARCA, unidad: 'unidad', costo_unitario: 600, stock_actual: 60, stock_seguridad: 12 },
      { clave: 'chocolate', nombre: 'Chocolate' + MARCA, unidad: 'kg', costo_unitario: 18000, stock_actual: 3, stock_seguridad: 1 }
    ],
    producto: {
      nombre: 'Torta de chocolate' + MARCA, precio_venta: 45000,
      receta: { harina: 0.5, huevos: 4, chocolate: 0.2 }
    },
    venta: { cliente: 'Cliente' + MARCA, cantidad: 2 },
    reventa: {
      nombre: 'Audífonos inalámbricos' + MARCA, categoria: 'Tecnología' + MARCA,
      costo_compra: 35000, precio_venta: 59900, stock_inicial: 20, stock_minimo: 5, venta: 2
    }
  };

  let ocupado = false;

  async function leerDatos() {
    const [materiales, productos, ventas] = await Promise.all([
      Negocio.fabrica() ? API.obtener('/api/materiales').catch(() => []) : [],
      API.obtener('/api/productos').catch(() => []),
      API.obtener('/api/ventas').catch(() => [])
    ]);
    const lista = (x) => (Array.isArray(x) ? x : (x && x.datos) || []);
    return { materiales: lista(materiales), productos: lista(productos), ventas: lista(ventas) };
  }

  function estadoDe(d) {
    const reales = {
      materiales: d.materiales.filter(m => !esEjemplo(m.nombre)),
      productos: d.productos.filter(p => !esEjemplo(p.nombre)),
      ventas: d.ventas.filter(v => !esEjemplo(v.cliente))
    };
    const venta = { id: 'venta', titulo: 'Registra tu primera venta', hecho: reales.ventas.length > 0, enlace: 'ventas.html' };
    const hitos = Negocio.fabrica()
      ? [
          { id: 'material', titulo: 'Crea tu primer material', hecho: reales.materiales.length > 0, enlace: 'materiales.html' },
          { id: 'producto', titulo: 'Arma tu primer producto con su receta', hecho: reales.productos.length > 0, enlace: 'productos.html' },
          venta
        ]
      : [
          { id: 'producto', titulo: 'Agrega tu primer producto', hecho: reales.productos.length > 0, enlace: 'productos.html' },
          venta
        ];
    return {
      hitos,
      hayEjemplo: d.materiales.some(m => esEjemplo(m.nombre)) || d.productos.some(p => esEjemplo(p.nombre)) ||
        d.ventas.some(v => esEjemplo(v.cliente))
    };
  }

  async function pintar() {
    const caja = document.getElementById('seccionPrimerosPasos');
    if (!caja) return;
    const e = estadoDe(await leerDatos());
    const hechos = e.hitos.filter(h => h.hecho).length;
    if (hechos === e.hitos.length && !e.hayEjemplo) { caja.innerHTML = ''; return; }

    const botonEjemplo = e.hayEjemplo
      ? '<button type="button" class="boton boton--pequeno" data-accion="borrar">Borrar ejemplo</button>'
      : '<button type="button" class="boton boton--pequeno" data-accion="cargar">Cargar ejemplo</button>';

    caja.innerHTML = `
      <div class="tarjeta pp">
        <div class="pp__cabeza">
          <h2 class="pp__titulo">Primeros pasos</h2>
          <span class="pp__avance">${hechos} de ${e.hitos.length}</span>
          ${botonEjemplo}
        </div>
        <div class="pp__barra"><span style="width:${Math.round(hechos / e.hitos.length * 100)}%"></span></div>
        <ol class="pp__lista">
          ${e.hitos.map(h => `
            <li class="pp__hito ${h.hecho ? 'pp__hito--hecho' : ''}">
              <span class="pp__marca" aria-hidden="true">${h.hecho ? '✓' : ''}</span>
              ${h.hecho ? `<span>${h.titulo}</span>` : `<a href="${h.enlace}">${h.titulo}</a>`}
            </li>`).join('')}
        </ol>
      </div>`;

    caja.querySelector('[data-accion]').addEventListener('click', (ev) => {
      if (ev.currentTarget.dataset.accion === 'cargar') cargarEjemplo(ev.currentTarget);
      else borrarEjemplo(ev.currentTarget);
    });
  }

  function medir(nombre) {
    try { Telemetria.enviar(nombre, { pantalla: 'index' }); } catch (_) { /* nunca afecta */ }
  }

  async function conBoton(boton, texto, tarea) {
    if (ocupado) return;
    ocupado = true;
    const original = boton.textContent;
    boton.disabled = true;
    boton.textContent = texto;
    try { await tarea(); }
    catch (err) { mostrarAviso(err.message || 'No se pudo completar', 'error'); }
    finally {
      ocupado = false;
      boton.disabled = false;
      boton.textContent = original;
    }
  }

  // Comerciante: un producto comprado con existencias y una venta
  async function crearEjemploReventa() {
    const r = EJEMPLO.reventa;
    const categoria = await API.enviar('/api/categorias', { nombre: r.categoria });
    const producto = await API.enviar('/api/productos', {
      tipo: 'reventa', nombre: r.nombre, categoria_id: categoria.id, proveedor: EJEMPLO.proveedor,
      costo_compra: r.costo_compra, precio_venta: r.precio_venta,
      stock_inicial: r.stock_inicial, stock_minimo: r.stock_minimo
    });
    await API.enviar('/api/ventas', {
      cliente: EJEMPLO.venta.cliente,
      items: [{ producto_id: producto.id, cantidad: r.venta }]
    });
  }

  function cargarEjemplo(boton) {
    return conBoton(boton, 'Cargando…', async () => {
      if (Negocio.revende()) await crearEjemploReventa();
      if (!Negocio.fabrica()) {
        medir('ejemplo.cargado');
        mostrarAviso('Ejemplo cargado: revisa Productos, Inventario y Ventas');
        setTimeout(() => location.reload(), 900);
        return;
      }
      const categoria = await API.enviar('/api/categorias', { nombre: EJEMPLO.categoria });
      const ids = {};
      for (const m of EJEMPLO.materiales) {
        const { clave, ...datos } = m;
        const creado = await API.enviar('/api/materiales', { ...datos, proveedor: EJEMPLO.proveedor, tiempo_entrega_dias: 2 });
        ids[clave] = creado.id;
      }
      const producto = await API.enviar('/api/productos', {
        nombre: EJEMPLO.producto.nombre,
        precio_venta: EJEMPLO.producto.precio_venta,
        categoria_id: categoria.id,
        materiales: Object.entries(EJEMPLO.producto.receta).map(([clave, cantidad]) => ({ material_id: ids[clave], cantidad }))
      });
      const manana = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
      await API.enviar('/api/ventas', {
        cliente: EJEMPLO.venta.cliente,
        fecha_entrega: manana,
        items: [{ producto_id: producto.id, cantidad: EJEMPLO.venta.cantidad }]
      });
      medir('ejemplo.cargado');
      mostrarAviso('Ejemplo cargado: revisa Materiales, Productos y Ventas');
      setTimeout(() => location.reload(), 900);
    });
  }

  function borrarEjemplo(boton) {
    return conBoton(boton, 'Borrando…', async () => {
      const d = await leerDatos();
      const fallos = [];
      const intentar = async (fn, nombre) => { try { await fn(); } catch (_) { fallos.push(nombre); } };

      for (const v of d.ventas.filter(v => esEjemplo(v.cliente)))
        await intentar(() => API.eliminar(`/api/ventas/${v.id}`, { motivo: 'Datos de ejemplo', forzar: true }), v.cliente);
      for (const p of d.productos.filter(p => esEjemplo(p.nombre)))
        await intentar(() => API.eliminar(`/api/productos/${p.id}`), p.nombre);
      for (const m of d.materiales.filter(m => esEjemplo(m.nombre)))
        await intentar(() => API.eliminar(`/api/materiales/${m.id}`), m.nombre);
      const categorias = await API.obtener('/api/categorias').catch(() => []);
      for (const c of (Array.isArray(categorias) ? categorias : []).filter(c => esEjemplo(c.nombre)))
        await intentar(() => API.eliminar(`/api/categorias/${c.id}`), c.nombre);

      medir('ejemplo.borrado');
      if (fallos.length) mostrarAviso(`No se pudo borrar: ${fallos.join(', ')}. Bórralo a mano.`, 'error');
      else mostrarAviso('Ejemplo borrado');
      setTimeout(() => location.reload(), 900);
    });
  }

  return { pintar };
})();

document.addEventListener('DOMContentLoaded', () => { PrimerosPasos.pintar().catch(() => {}); });
document.addEventListener('negocio:cambio', () => { PrimerosPasos.pintar().catch(() => {}); });
