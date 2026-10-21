// ============================================================
// CONVERTIDOR CON IA — server/servicios/ia/convertidor.js
// Convierte CUALQUIER Excel (o CSV) al formato de plantilla de Fincil.
//
// Privacidad y costo: a la IA solo le llegan los encabezados y las
// primeras filas de cada hoja (MUESTRA_FILAS). La IA NO reescribe
// datos: solo devuelve un MAPEO ("la columna C es el costo unitario,
// como número"). Fincil aplica ese mapeo a TODAS las filas por su
// cuenta, con transformaciones fijas y seguras, arma un Excel con el
// formato de la plantilla y lo pasa por el MISMO importador de
// siempre — así se validan igual que un Excel hecho a mano y el
// usuario revisa todo antes de guardar.
// ============================================================
const XLSX = require('xlsx');
const { esquemaDe, MODULOS_IA, descripcionModulos } = require('./esquemas');
const { pedirJson } = require('./openai');

const MUESTRA_FILAS = 20;      // filas de datos que ve la IA por hoja (además de la zona de encabezado)
const FILAS_CABECERA = 6;      // filas iniciales extra por si el encabezado no está en la fila 1
const MAX_HOJAS = 6;
const MAX_COLUMNAS = 40;
const MAX_CARACTERES_CELDA = 60;
const MAX_FILAS_TOTALES = 20000;
const TRANSFORMACIONES = ['ninguna', 'numero', 'fecha', 'mayusculas', 'si_no', 'valor_fijo'];

class ErrorConversion extends Error { constructor(m) { super(m); this.status = 400; } }

// ---------- 1) Leer el archivo tal cual viene ----------
function leerLibroCrudo(buffer) {
  let libro;
  try { libro = XLSX.read(buffer, { type: 'buffer' }); }
  catch (_) { throw new ErrorConversion('No se pudo leer el archivo. Sube un Excel (.xlsx, .xls) o un CSV.'); }
  const hojas = [];
  for (const nombre of libro.SheetNames) {
    if (/^instrucciones$/i.test(nombre)) continue;
    const hoja = libro.Sheets[nombre];
    // valores "crudos" (números y fechas como número de serie) para transformar…
    const crudas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: true, defval: '', blankrows: false });
    // …y como se ven en Excel, para mostrárselos a la IA
    const vistas = XLSX.utils.sheet_to_json(hoja, { header: 1, raw: false, defval: '', blankrows: false });
    if (vistas.length === 0) continue;
    hojas.push({ nombre, crudas, vistas });
    if (hojas.length >= MAX_HOJAS) break;
  }
  if (hojas.length === 0) throw new ErrorConversion('El archivo no tiene datos');
  const total = hojas.reduce((s, h) => s + h.crudas.length, 0);
  if (total > MAX_FILAS_TOTALES) throw new ErrorConversion(`El archivo tiene más de ${MAX_FILAS_TOTALES} filas. Divídelo en partes.`);
  return hojas;
}

function recortar(v) {
  const t = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  return t.length > MAX_CARACTERES_CELDA ? t.slice(0, MAX_CARACTERES_CELDA) + '…' : t;
}

function muestraParaIA(hojas) {
  return hojas.map(h => ({
    hoja: h.nombre,
    filas_totales: h.vistas.length,
    // n = posición en la lista sin filas vacías (la misma que usa aplicarMapeo)
    filas: h.vistas.slice(0, FILAS_CABECERA + MUESTRA_FILAS).map((fila, i) => ({
      n: i + 1, celdas: fila.slice(0, MAX_COLUMNAS).map(recortar)
    }))
  }));
}

// ---------- 2) Pedir el mapeo a la IA ----------
function esquemaRespuesta() {
  return {
    type: 'object', additionalProperties: false,
    required: ['modulo', 'confianza', 'resumen', 'hojas', 'advertencias'],
    properties: {
      modulo: { type: 'string', enum: MODULOS_IA },
      confianza: { type: 'number' },
      resumen: { type: 'string' },
      advertencias: { type: 'array', items: { type: 'string' } },
      hojas: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['hoja_destino', 'hoja_origen', 'fila_encabezado', 'fila_inicio_datos', 'columnas'],
          properties: {
            hoja_destino: { type: 'string' },
            hoja_origen: { type: 'string' },
            fila_encabezado: { type: 'integer' },
            fila_inicio_datos: { type: 'integer' },
            columnas: {
              type: 'array',
              items: {
                type: 'object', additionalProperties: false,
                required: ['clave', 'columna_indice', 'encabezado_origen', 'transformacion', 'valor_fijo'],
                properties: {
                  clave: { type: 'string' },
                  columna_indice: { type: 'integer' },
                  encabezado_origen: { type: 'string' },
                  transformacion: { type: 'string', enum: TRANSFORMACIONES },
                  valor_fijo: { type: 'string' }
                }
              }
            }
          }
        }
      }
    }
  };
}

function textoEsquemas(modulos) {
  return modulos.map(m => `### Módulo "${m}"\n` + esquemaDe(m).map(h =>
    `Hoja destino "${h.hoja}":\n` + h.columnas.map(c =>
      `  - ${c.clave} ("${c.encabezado}")${c.obligatorio ? ' [OBLIGATORIA]' : ''}: ${String(c.descripcion || '').slice(0, 160)} Ej: ${c.ejemplo ?? ''}`
    ).join('\n')
  ).join('\n')).join('\n\n');
}

const INSTRUCCIONES = `Eres un asistente que organiza datos de pequeños negocios en Colombia para cargarlos en Fincil.
Recibes una MUESTRA de un Excel cualquiera y las columnas que espera Fincil. Tu trabajo es devolver un MAPEO, no los datos.
Reglas:
- Cada fila de la muestra trae su número en "n" (desde 1; las filas vacías ya se quitaron, así que usa SIEMPRE ese n, no el número de fila de Excel). Indica fila_encabezado (la fila con los títulos de columna; 0 si no hay) y fila_inicio_datos (la primera fila con datos reales, sin títulos, subtítulos ni filas vacías).
- columna_indice empieza en 0 (columna A = 0). Usa -1 si ninguna columna del archivo corresponde.
- transformacion: "numero" para cantidades, precios y costos (aunque traigan $, puntos de miles o comas); "fecha" para fechas; "mayusculas" para listas de valores como estados o tipos (ej. RECIBIDA, ENTRADA); "si_no" para columnas de sí/no; "valor_fijo" cuando no hay columna pero el valor es obvio y el mismo para todas las filas (ponlo en valor_fijo, ej. unidad "unidad"); "ninguna" para texto normal.
- valor_fijo debe ser "" salvo con transformacion "valor_fijo".
- Incluye en "columnas" SOLO las claves del esquema destino. No inventes claves.
- Si una columna obligatoria no existe en el archivo y no hay un valor obvio, déjala con columna_indice -1 y explícalo en advertencias.
- Las fechas en Colombia suelen venir como día/mes/año.
- Ignora filas de totales, subtotales, notas o firmas al final.
- Si el archivo mezcla datos de dos hojas destino (ej. ventas con sus productos en la misma tabla), puedes mapear la misma hoja de origen a ambas hojas destino.
- resumen y advertencias en español, cortos y claros para una persona no técnica.
- confianza entre 0 y 1.`;

async function pedirMapeo({ hojas, modulo }) {
  const modulos = modulo === 'auto' ? MODULOS_IA : [modulo];
  const usuario = [
    modulo === 'auto'
      ? `Primero decide a cuál módulo pertenece el archivo:\n${descripcionModulos()}\n`
      : `El usuario indicó que el archivo es del módulo "${modulo}". Usa ese módulo.\n`,
    `Columnas que espera Fincil:\n${textoEsquemas(modulos)}`,
    `\nMuestra del archivo (JSON):\n${JSON.stringify(muestraParaIA(hojas))}`
  ].join('\n');
  return pedirJson({ sistema: INSTRUCCIONES, usuario, esquemaJson: esquemaRespuesta(), nombreEsquema: 'mapeo_excel' });
}

// ---------- 3) Aplicar el mapeo a TODAS las filas (sin IA) ----------
function aNumeroTexto(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number') return String(v);
  let t = String(v).replace(/[^\d.,-]/g, '');
  if (!t) return String(v).trim();
  const ultimoPunto = t.lastIndexOf('.'), ultimaComa = t.lastIndexOf(',');
  if (ultimoPunto > -1 && ultimaComa > -1) {
    // el separador que aparece de último es el decimal
    t = ultimaComa > ultimoPunto ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '');
  } else if (ultimaComa > -1) {
    // solo comas: 1,5 → decimal; 1,234,567 → miles
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (ultimoPunto > -1) {
    // solo puntos: 1.234.567 o 12.500 → miles (formato colombiano); 3.5 → decimal
    if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  }
  const n = Number(t);
  return isNaN(n) ? String(v).trim() : String(n);
}

function dosDigitos(n) { return String(n).padStart(2, '0'); }
function aFechaTexto(v) {
  if (v === '' || v == null) return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    const p = XLSX.SSF.parse_date_code(v);
    if (p) return `${p.y}-${dosDigitos(p.m)}-${dosDigitos(p.d)}`;
  }
  const t = String(v).trim();
  let m = t.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (m) return `${m[1]}-${dosDigitos(m[2])}-${dosDigitos(m[3])}`;
  m = t.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/); // día/mes/año (Colombia)
  if (m) {
    const anio = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${anio}-${dosDigitos(m[2])}-${dosDigitos(m[1])}`;
  }
  return t; // el validador del importador lo marcará si no es fecha
}

function aSiNo(v) {
  const t = String(v == null ? '' : v).trim().toUpperCase();
  if (!t) return '';
  if (['SI', 'SÍ', 'S', 'X', '1', 'TRUE', 'VERDADERO', 'YES', 'Y', 'ACTIVO', 'ACTIVA'].includes(t)) return 'SI';
  if (['NO', 'N', '0', 'FALSE', 'FALSO', 'INACTIVO', 'INACTIVA'].includes(t)) return 'NO';
  return t;
}

function transformar(valorCrudo, valorVisto, regla) {
  switch (regla.transformacion) {
    case 'valor_fijo': return String(regla.valor_fijo || '');
    case 'numero': return aNumeroTexto(valorCrudo);
    case 'fecha': return aFechaTexto(valorCrudo);
    case 'mayusculas': return String(valorVisto == null ? '' : valorVisto).trim().toUpperCase();
    case 'si_no': return aSiNo(valorVisto);
    default: return String(valorVisto == null ? '' : valorVisto).trim();
  }
}

// Devuelve [{ hoja, columnas, filas }] en el orden de la plantilla
function aplicarMapeo(hojasOrigen, mapeo) {
  const esquema = esquemaDe(mapeo.modulo);
  const porNombre = new Map(hojasOrigen.map(h => [h.nombre, h]));
  return esquema.map(destino => {
    const regla = (mapeo.hojas || []).find(h => h.hoja_destino === destino.hoja);
    const origen = regla && porNombre.get(regla.hoja_origen);
    if (!regla || !origen) return { hoja: destino.hoja, columnas: destino.columnas, filas: [] };

    const reglasPorClave = new Map((regla.columnas || [])
      .filter(c => destino.columnas.some(d => d.clave === c.clave) && TRANSFORMACIONES.includes(c.transformacion))
      .map(c => [c.clave, c]));
    const inicio = Math.max(1, Number(regla.fila_inicio_datos) || (Number(regla.fila_encabezado) || 0) + 1);
    const filas = [];
    for (let i = inicio - 1; i < origen.crudas.length; i++) {
      const cruda = origen.crudas[i] || [], vista = origen.vistas[i] || [];
      let conDatos = false;
      const fila = destino.columnas.map(col => {
        const r = reglasPorClave.get(col.clave);
        if (!r) return '';
        const idx = Number(r.columna_indice);
        if (r.transformacion !== 'valor_fijo' && (idx < 0 || idx >= MAX_COLUMNAS * 4)) return '';
        const valor = transformar(cruda[idx], vista[idx], r);
        if (valor !== '' && r.transformacion !== 'valor_fijo') conDatos = true;
        return valor;
      });
      if (conDatos) filas.push(fila);
    }
    return { hoja: destino.hoja, columnas: destino.columnas, filas };
  });
}

// Excel con el formato exacto de la plantilla. A diferencia del
// generador de plantillas, una hoja sin filas queda SOLO con
// encabezados (sin fila de ejemplo que pudiera importarse como dato).
function construirLibro(hojasDestino) {
  const libro = XLSX.utils.book_new();
  for (const h of hojasDestino) {
    const hoja = XLSX.utils.aoa_to_sheet([h.columnas.map(c => c.encabezado), ...h.filas]);
    XLSX.utils.book_append_sheet(libro, hoja, h.hoja);
  }
  return XLSX.write(libro, { type: 'buffer', bookType: 'xlsx' });
}

// Para mostrarle al usuario qué entendió la IA
function describirMapeo(mapeo, hojasOrigen) {
  const esquema = esquemaDe(mapeo.modulo);
  return esquema.map(destino => {
    const regla = (mapeo.hojas || []).find(h => h.hoja_destino === destino.hoja);
    const origen = regla && hojasOrigen.find(h => h.nombre === regla.hoja_origen);
    return {
      hoja_destino: destino.hoja,
      hoja_origen: origen ? origen.nombre : null,
      columnas: destino.columnas.map(col => {
        const r = regla && (regla.columnas || []).find(c => c.clave === col.clave);
        let desde = null;
        if (r && r.transformacion === 'valor_fijo') desde = `Valor fijo: "${r.valor_fijo}"`;
        else if (r && r.columna_indice >= 0) desde = r.encabezado_origen || `Columna ${XLSX.utils.encode_col(r.columna_indice)}`;
        return { destino: col.encabezado, obligatorio: col.obligatorio, desde };
      })
    };
  });
}

async function convertirConIA({ buffer, modulo }) {
  if (modulo !== 'auto' && !MODULOS_IA.includes(modulo)) throw new ErrorConversion('Módulo no válido');
  const hojas = leerLibroCrudo(buffer);
  const ia = await pedirMapeo({ hojas, modulo });
  const mapeo = ia.json;
  if (modulo !== 'auto') mapeo.modulo = modulo; // el usuario manda
  const hojasDestino = aplicarMapeo(hojas, mapeo);
  const filasConvertidas = hojasDestino.reduce((s, h) => s + h.filas.length, 0);
  if (filasConvertidas === 0) throw new ErrorConversion('No se encontraron filas con datos que correspondan a este módulo. Revisa que elegiste el módulo correcto.');
  return {
    modulo: mapeo.modulo,
    confianza: Math.max(0, Math.min(1, Number(mapeo.confianza) || 0)),
    resumen: mapeo.resumen || '',
    advertencias: Array.isArray(mapeo.advertencias) ? mapeo.advertencias.slice(0, 10) : [],
    mapeo: describirMapeo(mapeo, hojas),
    filas_convertidas: filasConvertidas,
    buffer: construirLibro(hojasDestino),
    uso: { modelo: ia.modelo, tokensEntrada: ia.tokensEntrada, tokensSalida: ia.tokensSalida }
  };
}

module.exports = {
  convertirConIA, ErrorConversion,
  // para pruebas
  _interno: { leerLibroCrudo, muestraParaIA, aplicarMapeo, aNumeroTexto, aFechaTexto, aSiNo, construirLibro, esquemaRespuesta }
};
