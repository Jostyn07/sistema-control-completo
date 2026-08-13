// ============================================================
// MÓDULO — CATEGORÍAS DE PRODUCTOS  (/api/categorias)
// Requiere sesión. Se filtra por req.usuarioId.
// Clasificación del catálogo (ej: "Flores", "Panadería"). Cada
// producto pertenece a UNA categoría (o ninguna) vía
// productos.categoria_id. Distinto de la "categoria" de
// ventas_items, que es una variante dentro de una venta (ej: color).
// - GET  /            lista las categorías del usuario
// - POST /            crea una categoría nueva { nombre }
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const router = express.Router();

// GET /api/categorias
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('categorias_productos')
      .select('id, nombre')
      .eq('usuario_id', req.usuarioId)
      .order('nombre');
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/categorias — cuerpo: { nombre }
router.post('/', async (req, res, next) => {
  try {
    const nombre = (req.body.nombre || '').trim();
    if (!nombre) return res.status(400).json({ error: 'El nombre de la categoría es obligatorio' });

    // Si ya existe una categoría con ese nombre para este usuario, la
    // reutiliza en vez de fallar por la restricción unique — así el
    // formulario de "crear categoría al vuelo" nunca truena si alguien
    // escribe una que ya existía (con otra mayúscula/minúscula, etc.)
    const { data: existente, error: eGet } = await supabase
      .from('categorias_productos')
      .select('id, nombre')
      .eq('usuario_id', req.usuarioId)
      .ilike('nombre', nombre)
      .maybeSingle();
    if (eGet) throw new Error(eGet.message);
    if (existente) return res.status(200).json(existente);

    const { data, error } = await supabase
      .from('categorias_productos')
      .insert({ usuario_id: req.usuarioId, nombre })
      .select('id, nombre').single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

module.exports = router;