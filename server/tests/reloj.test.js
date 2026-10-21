// Reintento ante "JWT issued at future" (desfase de relojes en Supabase)
const test = require('node:test');
const assert = require('node:assert');
process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'https://demo.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'llave';
const reintentar = require('../supabase/cliente')._fetchConReintentoDeReloj;

test('reintenta una vez si el token "viene del futuro"', async () => {
  const original = global.fetch; let llamadas = 0;
  global.fetch = async () => (++llamadas === 1
    ? new Response('{"message":"JWT issued at future"}', { status: 401 })
    : new Response('[]', { status: 200 }));
  try {
    const r = await reintentar('https://x');
    assert.equal(r.status, 200); assert.equal(llamadas, 2);
  } finally { global.fetch = original; }
});

test('no reintenta otros 401', async () => {
  const original = global.fetch; let llamadas = 0;
  global.fetch = async () => { llamadas++; return new Response('{"message":"Invalid API key"}', { status: 401 }); };
  try {
    const r = await reintentar('https://x');
    assert.equal(r.status, 401); assert.equal(llamadas, 1);
  } finally { global.fetch = original; }
});