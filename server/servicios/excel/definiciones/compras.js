// ============================================================
// DEFINICIÓN DE COLUMNAS — Compras (05_Compras.xlsx)
// Igual que Inventario, cada fila es un registro NUEVO (un pedido),
// no algo que se "actualice" — no existe un código que identifique
// una compra para la plataforma (no hay nada más que la referencie),
// así que el "Código compra" es solo una referencia tuya y se guarda
// al principio de las Notas, para que no se pierda.
// ============================================================

const TITULO = 'Compras';

const PARA_QUE_SIRVE =
  'Usa este archivo para registrar de una sola vez varios pedidos hechos a proveedores — pendientes de llegar, o ya recibidos.';

const ESTADOS_VALIDOS = ['PENDIENTE', 'RECIBIDA'];

const ADVERTENCIAS = [
  'Este archivo NO crea materiales ni productos: el "Código material" o el "Código producto" debe existir ya.',
  'Cada fila lleva "Código material" (insumos) O "Código producto" (productos de reventa), nunca los dos.',
  'PENDIENTE: se registra el pedido pero el stock NO se suma todavía (se sumará cuando se confirme la llegada, igual que una compra normal).',
  'RECIBIDA: antes de importar, eliges si estas compras deben sumar el stock automáticamente o no (por ejemplo, si el stock ya lo cargaste aparte por Materiales o Inventario).',
  'El "Código compra" es solo tu referencia — no se usa para relacionar con otros Excel. Se guarda al inicio de las Notas.',
  'Si el precio pagado es distinto al costo registrado, queda en el historial pero el costo no cambia solo: cámbialo en la plataforma si quieres. Un producto de reventa sin costo toma el de la compra.'
];

const COLUMNAS = [
  {
    clave: 'codigo',
    encabezado: 'Código compra',
    obligatorio: false,
    descripcion: 'Identificador que tú le pones a esta compra, solo para tu referencia.',
    ejemplo: 'COM001'
  },
  {
    clave: 'fecha',
    encabezado: 'Fecha',
    obligatorio: false,
    descripcion: 'Fecha en que se hizo el pedido, formato DD/MM/AAAA. Si lo dejas vacío, se usa la fecha de hoy.',
    ejemplo: '05/09/2026'
  },
  {
    clave: 'codigo_material',
    encabezado: 'Código material',
    obligatorio: false,
    descripcion: 'Código del material (de 01_Materiales.xlsx) que se compró. Vacío si es un producto.',
    ejemplo: 'MAT001'
  },
  {
    clave: 'codigo_producto',
    encabezado: 'Código producto',
    obligatorio: false,
    descripcion: 'Código del producto de reventa (de 02_Productos.xlsx) que se compró. Vacío si es un material.',
    ejemplo: ''
  },
  {
    clave: 'proveedor',
    encabezado: 'Proveedor',
    obligatorio: true,
    descripcion: 'Proveedor al que se le hizo la compra.',
    ejemplo: 'Flores SAS'
  },
  {
    clave: 'cantidad',
    encabezado: 'Cantidad',
    obligatorio: true,
    descripcion: 'Cantidad comprada. Debe ser mayor a 0.',
    ejemplo: 100
  },
  {
    clave: 'precio_unitario',
    encabezado: 'Precio unitario',
    obligatorio: true,
    descripcion: 'Precio pagado por unidad. Debe ser mayor o igual a 0.',
    ejemplo: 2500
  },
  {
    clave: 'estado',
    encabezado: 'Estado',
    obligatorio: true,
    descripcion: `Uno de: ${ESTADOS_VALIDOS.join(', ')}.`,
    ejemplo: 'RECIBIDA'
  },
  {
    clave: 'notas',
    encabezado: 'Notas',
    obligatorio: false,
    descripcion: 'Notas adicionales sobre esta compra (opcional).',
    ejemplo: ''
  }
];

module.exports = { TITULO, PARA_QUE_SIRVE, ADVERTENCIAS, ESTADOS_VALIDOS, COLUMNAS };
