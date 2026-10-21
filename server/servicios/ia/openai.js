// ============================================================
// CLIENTE OPENAI — server/servicios/ia/openai.js
// Una sola llamada: Chat Completions con salida JSON estricta
// (json_schema). Variables de entorno:
//   OPENAI_API_KEY   (obligatoria)
//   OPENAI_MODELO    (opcional, por defecto gpt-4o-mini)
// ============================================================
const MODELO_POR_DEFECTO = 'gpt-4o-mini';
const TIEMPO_MAXIMO_MS = 45000;

function iaConfigurada() { return !!process.env.OPENAI_API_KEY; }

async function pedirJson({ sistema, usuario, esquemaJson, nombreEsquema }) {
  if (!iaConfigurada()) throw Object.assign(new Error('La importación con IA no está configurada (falta OPENAI_API_KEY)'), { status: 503 });
  const modelo = process.env.OPENAI_MODELO || MODELO_POR_DEFECTO;
  const control = new AbortController();
  const reloj = setTimeout(() => control.abort(), TIEMPO_MAXIMO_MS);
  let respuesta;
  try {
    respuesta = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: control.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model: modelo,
        temperature: 0,
        store: false, // OpenAI no guarda la conversación como registro consultable
        messages: [{ role: 'system', content: sistema }, { role: 'user', content: usuario }],
        response_format: { type: 'json_schema', json_schema: { name: nombreEsquema, strict: true, schema: esquemaJson } }
      })
    });
  } catch (err) {
    throw Object.assign(new Error(err.name === 'AbortError' ? 'La IA tardó demasiado en responder. Intenta de nuevo.' : 'No se pudo conectar con la IA'), { status: 502 });
  } finally { clearTimeout(reloj); }

  const datos = await respuesta.json().catch(() => ({}));
  if (!respuesta.ok) {
    const motivo = respuesta.status === 429 ? 'La IA está saturada o se agotó el saldo de la cuenta de OpenAI.' : 'La IA no pudo procesar el archivo.';
    throw Object.assign(new Error(motivo), { status: 502, detalle: datos.error && datos.error.message });
  }
  const contenido = datos.choices && datos.choices[0] && datos.choices[0].message && datos.choices[0].message.content;
  let json;
  try { json = JSON.parse(contenido); } catch (_) { throw Object.assign(new Error('La IA devolvió una respuesta inválida'), { status: 502 }); }
  return {
    json, modelo,
    tokensEntrada: (datos.usage && datos.usage.prompt_tokens) || 0,
    tokensSalida: (datos.usage && datos.usage.completion_tokens) || 0
  };
}

module.exports = { pedirJson, iaConfigurada, MODELO_POR_DEFECTO };
