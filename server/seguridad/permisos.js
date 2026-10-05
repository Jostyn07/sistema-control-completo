// ============================================================
// MATRIZ DE PERMISOS — server/seguridad/permisos.js
// FASE 3. Única fuente de verdad de qué puede hacer cada rol.
// Un permiso es "modulo.accion". Ocultar botones en el frontend es
// solo comodidad: la autorización real se decide aquí.
//
// Roles (por empresa): propietario > administrador > supervisor > operador
// platform_owner NO es un rol de empresa (ver middleware/admin.js).
// ============================================================

const ACCIONES = ['ver', 'crear', 'editar', 'eliminar', 'administrar'];

const MODULOS = [
  'dashboard', 'materiales', 'productos', 'categorias', 'procesos',
  'colaboradores', 'inventario', 'ventas', 'compras', 'finanzas',
  'facturacion', 'configuracion', 'almacenamiento', 'excel',
  'suscripcion', 'equipo',
  'auditoria',
  'costos'   // no es una pantalla: decide si la respuesta incluye costos y márgenes (middleware/ocultarCostos.js)
];

const TODO = ['ver', 'crear', 'editar', 'eliminar', 'administrar'];
const OPERAR = ['ver', 'crear', 'editar'];

function todos(acciones, excepto = {}) {
  const r = {};
  for (const m of MODULOS) r[m] = excepto[m] !== undefined ? excepto[m] : acciones;
  return r;
}

const MATRIZ = {
  // Dueño de la empresa: todo, incluido pagar la suscripción.
  propietario: todos(TODO, { auditoria: ['ver'] }),  // la auditoría solo se lee

  // Igual que el propietario, pero no paga ni cambia el plan.
  administrador: todos(TODO, {
    suscripcion: ['ver'],
    auditoria: ['ver']
  }),

  // Opera el negocio y ve los números; no borra ni configura.
  supervisor: todos(['ver'], {
    auditoria: [],
    materiales: OPERAR, productos: OPERAR, categorias: OPERAR, procesos: OPERAR,
    colaboradores: OPERAR, inventario: OPERAR, ventas: OPERAR, compras: OPERAR,
    facturacion: OPERAR, almacenamiento: OPERAR, excel: OPERAR
  }),

  // Día a día: vender, recibir compras, mover inventario. Sin costos,
  // finanzas, facturación, nómina, configuración ni Excel.
  operador: {
    dashboard: ['ver'],
    materiales: ['ver'],
    productos: ['ver'],
    categorias: ['ver'],
    procesos: ['ver'],
    inventario: OPERAR,
    ventas: OPERAR,
    compras: OPERAR,
    suscripcion: ['ver'],   // para ver el aviso de estado en todas las pantallas
    equipo: [],
    costos: []              // nunca ve costos, márgenes ni utilidades
  }
};

function permisosDeRol(rol) {
  const fila = MATRIZ[rol];
  if (!fila) return [];
  const lista = [];
  for (const [modulo, acciones] of Object.entries(fila)) {
    for (const accion of acciones) lista.push(`${modulo}.${accion}`);
  }
  return lista;
}

function tienePermiso(rol, modulo, accion) {
  const fila = MATRIZ[rol];
  return !!(fila && fila[modulo] && fila[modulo].includes(accion));
}

// GET → ver, POST → crear, PUT/PATCH → editar, DELETE → eliminar
function accionDeMetodo(metodo) {
  switch (String(metodo).toUpperCase()) {
    case 'GET': case 'HEAD': case 'OPTIONS': return 'ver';
    case 'POST': return 'crear';
    case 'PUT': case 'PATCH': return 'editar';
    case 'DELETE': return 'eliminar';
    default: return 'administrar';
  }
}

const ROLES = Object.keys(MATRIZ);

module.exports = { MATRIZ, MODULOS, ACCIONES, ROLES, permisosDeRol, tienePermiso, accionDeMetodo };
