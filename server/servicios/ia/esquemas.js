// ============================================================
// ESQUEMAS DESTINO — server/servicios/ia/esquemas.js
// Para cada módulo: qué hojas y columnas espera la plantilla de
// Fincil. Se arma desde las MISMAS definiciones que usan las
// plantillas y los importadores, así la IA siempre apunta a lo que
// el importador de verdad sabe leer.
// ============================================================
const { HOJA_DATOS } = require('../excel/generador');
const def = (m) => require(`../excel/definiciones/${m}`);

function columnas(lista) {
  return lista.map(c => ({
    clave: c.clave, encabezado: c.encabezado, obligatorio: !!c.obligatorio,
    descripcion: c.descripcion, ejemplo: c.ejemplo
  }));
}

function esquemaDe(modulo) {
  const d = def(modulo);
  switch (modulo) {
    case 'procesos':
      return [{ hoja: d.HOJA_PROCESOS, columnas: columnas(d.COLUMNAS_PROCESOS) },
              { hoja: d.HOJA_MATERIALES_PROCESO, columnas: columnas(d.COLUMNAS_MATERIALES_PROCESO) }];
    case 'ventas':
      return [{ hoja: d.HOJA_VENTAS, columnas: columnas(d.COLUMNAS_VENTAS) },
              { hoja: d.HOJA_VENTAS_ITEMS, columnas: columnas(d.COLUMNAS_VENTAS_ITEMS) }];
    case 'finanzas':
      return [{ hoja: d.HOJA_COSTOS_FIJOS, columnas: columnas(d.COLUMNAS_COSTOS_FIJOS) },
              { hoja: d.HOJA_CAPITAL, columnas: columnas(d.COLUMNAS_CAPITAL) },
              { hoja: d.HOJA_CONFIGURACION, columnas: columnas(d.COLUMNAS_CONFIGURACION) }];
    case 'facturacion':
      return [{ hoja: d.HOJA_CONFIGURACION_FISCAL, columnas: columnas(d.COLUMNAS_CONFIGURACION_FISCAL) },
              { hoja: d.HOJA_FACTURAS, columnas: columnas(d.COLUMNAS_FACTURAS) }];
    case 'nominas':
      return [{ hoja: d.HOJA_COLABORADORES, columnas: columnas(d.COLUMNAS_COLABORADORES) },
              { hoja: d.HOJA_ENCARGOS, columnas: columnas(d.COLUMNAS_ENCARGOS) }];
    default: // materiales, productos, inventario, compras: una hoja "Datos"
      return [{ hoja: HOJA_DATOS, columnas: columnas(d.COLUMNAS) }];
  }
}

const MODULOS_IA = ['materiales', 'productos', 'procesos', 'inventario', 'compras', 'ventas', 'finanzas', 'facturacion', 'nominas'];

function descripcionModulos() {
  return MODULOS_IA.map(m => {
    const d = def(m);
    return `- ${m}: ${d.TITULO}. ${d.PARA_QUE_SIRVE}`;
  }).join('\n');
}

module.exports = { esquemaDe, MODULOS_IA, descripcionModulos };
