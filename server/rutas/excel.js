// ============================================================
// IMPORTAR / EXPORTAR POR EXCEL  (/api/excel)
// Cada pestaña puede: descargar su plantilla vacía, exportar su
// información actual, subir un Excel para revisarlo (sin guardar
// nada todavía) y, si el usuario confirma, importarlo de verdad.
//
// - GET  /:modulo/plantilla     → descarga la plantilla vacía (.xlsx)
// - GET  /:modulo/exportar      → descarga la información actual (.xlsx)
// - POST /:modulo/analizar      → sube un .xlsx, devuelve el reporte de
//                                 validación fila por fila (NO guarda nada)
// - POST /:modulo/importar      → guarda en la base las filas ya
//                                 analizadas (body: { filas, modo })
// - GET  /todo/plantillas       → ZIP con la plantilla de cada módulo
// - GET  /todo/exportar         → ZIP con la información actual de cada módulo
//
// Por ahora solo "materiales" tiene importador/exportador. Los demás
// módulos (productos, procesos, inventario, compras, ventas, finanzas,
// facturación, nóminas) se agregan sumando una entrada más al objeto
// MODULOS de abajo, con el mismo patrón — igual que ya se hizo con
// materiales, no debería requerir tocar el resto de este archivo.
// ============================================================
const express = require('express');
const multer = require('multer');
const router = express.Router();

const { crearZip } = require('../servicios/excel/zip');
const materialesImportador = require('../servicios/importadores/materiales');
const materialesExportador = require('../servicios/exportadores/materiales');
const productosImportador = require('../servicios/importadores/productos');
const productosExportador = require('../servicios/exportadores/productos');
const procesosImportador = require('../servicios/importadores/procesos');
const procesosExportador = require('../servicios/exportadores/procesos');
const inventarioImportador = require('../servicios/importadores/inventario');
const inventarioExportador = require('../servicios/exportadores/inventario');
const comprasImportador = require('../servicios/importadores/compras');
const comprasExportador = require('../servicios/exportadores/compras');
const ventasImportador = require('../servicios/importadores/ventas');
const ventasExportador = require('../servicios/exportadores/ventas');
const finanzasImportador = require('../servicios/importadores/finanzas');
const finanzasExportador = require('../servicios/exportadores/finanzas');
const facturacionImportador = require('../servicios/importadores/facturacion');
const facturacionExportador = require('../servicios/exportadores/facturacion');
const nominasImportador = require('../servicios/importadores/nominas');
const nominasExportador = require('../servicios/exportadores/nominas');

const MODULOS = {
  materiales: {
    archivo: '01_Materiales.xlsx',
    plantilla: () => materialesExportador.generarPlantilla(),
    exportarActual: (usuarioId) => materialesExportador.exportarMateriales(usuarioId),
    analizar: (buffer, usuarioId) => materialesImportador.analizarMateriales(buffer, usuarioId),
    importar: (usuarioId, filas, opciones) => materialesImportador.importarMateriales(usuarioId, filas, opciones.modo || 'crear_y_actualizar')
  },
  productos: {
    archivo: '02_Productos.xlsx',
    plantilla: () => productosExportador.generarPlantilla(),
    exportarActual: (usuarioId) => productosExportador.exportarProductos(usuarioId),
    analizar: (buffer, usuarioId) => productosImportador.analizarProductos(buffer, usuarioId),
    importar: (usuarioId, filas, opciones) => productosImportador.importarProductos(usuarioId, filas, opciones.modo || 'crear_y_actualizar')
  },
  procesos: {
    archivo: '03_Procesos.xlsx',
    plantilla: () => procesosExportador.generarPlantilla(),
    exportarActual: (usuarioId) => procesosExportador.exportarProcesos(usuarioId),
    analizar: (buffer, usuarioId) => procesosImportador.analizarProcesos(buffer, usuarioId),
    importar: (usuarioId, filas, opciones) => procesosImportador.importarProcesos(usuarioId, filas, opciones.modo || 'crear_y_actualizar')
  },
  inventario: {
    archivo: '04_Inventario.xlsx',
    plantilla: () => inventarioExportador.generarPlantilla(),
    exportarActual: (usuarioId) => inventarioExportador.exportarInventario(usuarioId),
    analizar: (buffer, usuarioId) => inventarioImportador.analizarInventario(buffer, usuarioId),
    // Inventario no tiene "modo" (crear/actualizar) — cada fila válida
    // siempre se aplica como un movimiento nuevo; no necesita opciones.
    importar: (usuarioId, filas) => inventarioImportador.importarInventario(usuarioId, filas)
  },
  compras: {
    archivo: '05_Compras.xlsx',
    plantilla: () => comprasExportador.generarPlantilla(),
    exportarActual: (usuarioId) => comprasExportador.exportarCompras(usuarioId),
    analizar: (buffer, usuarioId) => comprasImportador.analizarCompras(buffer, usuarioId),
    // `afectar_inventario` (true por defecto): si es false, las compras
    // marcadas "RECIBIDA" quedan en el historial pero NO suman stock —
    // útil cuando el stock ya se cargó aparte, por Materiales o Inventario.
    importar: (usuarioId, filas, opciones) =>
      comprasImportador.importarCompras(usuarioId, filas, { afectarInventario: opciones.afectar_inventario !== false })
  },
  ventas: {
    archivo: '06_Ventas.xlsx',
    plantilla: () => ventasExportador.generarPlantilla(),
    exportarActual: (usuarioId) => ventasExportador.exportarVentas(usuarioId),
    analizar: (buffer, usuarioId) => ventasImportador.analizarVentas(buffer, usuarioId),
    // Cada venta siempre se crea nueva (como Inventario/Compras) — no necesita opciones.
    importar: (usuarioId, filas) => ventasImportador.importarVentas(usuarioId, filas)
  },
  finanzas: {
    archivo: '07_Finanzas.xlsx',
    plantilla: () => finanzasExportador.generarPlantilla(),
    exportarActual: (usuarioId) => finanzasExportador.exportarFinanzas(usuarioId),
    analizar: (buffer, usuarioId) => finanzasImportador.analizarFinanzas(buffer, usuarioId),
    // Este módulo no recibe un arreglo plano de `filas`, sino el reporte
    // completo (tres listas: costos fijos, capital y configuración) que
    // devolvió /analizar — no necesita opciones aparte.
    importar: (usuarioId, filas) => finanzasImportador.importarFinanzas(usuarioId, filas)
  },
  facturacion: {
    archivo: '08_Facturacion.xlsx',
    plantilla: () => facturacionExportador.generarPlantilla(),
    exportarActual: (usuarioId) => facturacionExportador.exportarFacturacion(usuarioId),
    analizar: (buffer, usuarioId) => facturacionImportador.analizarFacturacion(buffer, usuarioId),
    // No genera facturas electrónicas reales ni usa opciones — ver
    // definiciones/facturacion.js para el porqué de esta limitación.
    importar: (usuarioId, filas) => facturacionImportador.importarFacturacion(usuarioId, filas)
  },
  nominas: {
    archivo: '09_Nominas.xlsx',
    plantilla: () => nominasExportador.generarPlantilla(),
    exportarActual: (usuarioId) => nominasExportador.exportarNominas(usuarioId),
    analizar: (buffer, usuarioId) => nominasImportador.analizarNominas(buffer, usuarioId),
    // Igual que Finanzas: recibe el reporte completo (colaboradores +
    // encargos), no un arreglo plano — no necesita opciones.
    importar: (usuarioId, filas) => nominasImportador.importarNominas(usuarioId, filas)
  }
};

const TAMANO_MAXIMO = 10 * 1024 * 1024; // 10 MB
const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter: (req, file, cb) => {
    if (!/\.xlsx$/i.test(file.originalname)) return cb(new Error('El archivo debe ser un Excel (.xlsx)'));
    cb(null, true);
  }
});

// Devuelve la definición del módulo, o responde 404 y `null` si no existe.
function obtenerModulo(req, res) {
  const modulo = MODULOS[req.params.modulo];
  if (!modulo) {
    res.status(404).json({ error: `El módulo "${req.params.modulo}" todavía no tiene importación/exportación por Excel` });
    return null;
  }
  return modulo;
}

function enviarXlsx(res, nombreArchivo, buffer) {
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
  res.send(buffer);
}

// GET /api/excel/:modulo/plantilla
router.get('/:modulo/plantilla', async (req, res, next) => {
  try {
    const modulo = obtenerModulo(req, res);
    if (!modulo) return;
    enviarXlsx(res, modulo.archivo, await modulo.plantilla());
  } catch (err) { next(err); }
});

// GET /api/excel/:modulo/exportar
router.get('/:modulo/exportar', async (req, res, next) => {
  try {
    const modulo = obtenerModulo(req, res);
    if (!modulo) return;
    enviarXlsx(res, modulo.archivo, await modulo.exportarActual(req.usuarioId));
  } catch (err) { next(err); }
});

// POST /api/excel/:modulo/analizar — campo de formulario: "archivo"
router.post('/:modulo/analizar', (req, res, next) => {
  subida.single('archivo')(req, res, async (errSubida) => {
    if (errSubida) {
      const mensaje = errSubida.code === 'LIMIT_FILE_SIZE' ? 'El archivo no puede pesar más de 10 MB' : errSubida.message;
      return res.status(400).json({ error: mensaje });
    }
    try {
      const modulo = obtenerModulo(req, res);
      if (!modulo) return;
      if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

      const reporte = await modulo.analizar(req.file.buffer, req.usuarioId);
      res.json(reporte);
    } catch (err) { next(err); }
  });
});

// POST /api/excel/:modulo/importar — body JSON: { filas, ...opciones }
// `filas` es exactamente lo que devolvió /analizar (el usuario ya lo vio
// y lo confirmó); este endpoint no vuelve a leer ningún archivo.
// `opciones` es lo que quede del body sin `filas` — cada módulo lee de
// ahí lo que le importa (materiales/productos/procesos leen `modo`;
// compras lee `afectar_inventario`; inventario/ventas no necesitan nada).
// La mayoría de módulos usan un arreglo plano de filas, pero algunos
// (ej. Finanzas) tienen varias hojas independientes y mandan el reporte
// completo como objeto — por eso aquí solo se valida que no venga vacío,
// dejando la forma exacta a cada importador.
router.post('/:modulo/importar', async (req, res, next) => {
  try {
    const modulo = obtenerModulo(req, res);
    if (!modulo) return;

    const { filas, ...opciones } = req.body || {};
    const vacio = filas == null || (Array.isArray(filas) && filas.length === 0)
      || (!Array.isArray(filas) && typeof filas === 'object' && Object.keys(filas).length === 0);
    if (vacio) {
      return res.status(400).json({ error: 'No hay filas para importar. Vuelve a analizar el archivo.' });
    }

    const resultado = await modulo.importar(req.usuarioId, filas, opciones);
    res.json(resultado);
  } catch (err) { next(err); }
});

// GET /api/excel/todo/plantillas — ZIP con la plantilla vacía de cada módulo
router.get('/todo/plantillas', async (req, res, next) => {
  try {
    const archivos = [];
    for (const clave of Object.keys(MODULOS)) {
      archivos.push({ nombre: MODULOS[clave].archivo, buffer: await MODULOS[clave].plantilla() });
    }
    const zip = await crearZip(archivos);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="Sistema_Control_Plantillas.zip"');
    res.send(zip);
  } catch (err) { next(err); }
});

// GET /api/excel/todo/exportar — ZIP con la información actual de cada módulo
router.get('/todo/exportar', async (req, res, next) => {
  try {
    const archivos = [];
    for (const clave of Object.keys(MODULOS)) {
      archivos.push({ nombre: MODULOS[clave].archivo, buffer: await MODULOS[clave].exportarActual(req.usuarioId) });
    }
    const zip = await crearZip(archivos);
    const fecha = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="Mi_Negocio_Exportacion_${fecha}.zip"`);
    res.send(zip);
  } catch (err) { next(err); }
});

module.exports = router;