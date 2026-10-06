// ============================================================
// MÓDULO — TELEMETRÍA DEL NAVEGADOR  (/api/telemetria)
// FASE 8. POST /eventos — cuerpo: { eventos: [{ nombre, propiedades }] }
// Solo acepta eventos del catálogo marcados como "navegador" y solo
// sus propiedades permitidas. Máximo 20 por llamada. Responde 204
// siempre que el formato sea válido (no revela qué se descartó).
// ============================================================
const express = require('express');
const { EVENTOS } = require('../servicios/telemetria/catalogo');
const { construirEvento, enviar } = require('../servicios/telemetria');
const router = express.Router();

router.post('/eventos', (req, res) => {
  const lista = Array.isArray(req.body && req.body.eventos) ? req.body.eventos.slice(0, 20) : null;
  if (!lista) return res.status(400).json({ error: 'Formato inválido' });

  const eventos = lista
    .filter(e => e && typeof e.nombre === 'string' && EVENTOS[e.nombre] && EVENTOS[e.nombre].navegador)
    .map(e => construirEvento(e.nombre, {
      empresaId: req.empresa.id,
      usuarioId: req.usuarioId,
      rol: req.empresa.rol,
      modulo: e.propiedades && typeof e.propiedades.pantalla === 'string' ? e.propiedades.pantalla : null,
      propiedades: e.propiedades,
      origen: 'navegador'
    }));

  enviar(eventos);
  res.status(204).end();
});

module.exports = router;
