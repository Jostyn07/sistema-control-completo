// ============================================================
// MÓDULO — CATEGORÍAS DE PRODUCTOS  (/api/categorias)
// Requiere sesión. Se filtra por req.empresa.id.
// Clasificación del catálogo (ej: "Flores", "Panadería"). Cada
// producto pertenece a UNA categoría (o ninguna) vía
// productos.categoria_id. Distinto de la "categoria" de
// ventas_items, que es una variante dentro de una venta (ej: color).
// - GET  /            lista las categorías del usuario
// - POST /            crea una categoría nueva { nombre }
// - DELETE /:id       borra una categoría sin productos
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
      .eq('empresa_id', req.empresa.id)
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
      .eq('empresa_id', req.empresa.id)
      .ilike('nombre', nombre)
      .maybeSingle();
    if (eGet) throw new Error(eGet.message);
    if (existente) return res.status(200).json(existente);

    const { data, error } = await supabase
      .from('categorias_productos')
      .insert({ empresa_id: req.empresa.id, usuario_id: req.usuarioId, nombre })
      .select('id, nombre').single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// DELETE /api/categorias/:id — solo si ningún producto la usa
router.delete('/:id', async (req, res, next) => {
  try {
    const { count, error: eUso } = await supabase.from('productos')
      .select('id', { count: 'exact', head: true })
      .eq('empresa_id', req.empresa.id).eq('categoria_id', req.params.id);
    if (eUso) throw new Error(eUso.message);
    if (count > 0) return res.status(409).json({ error: `No se puede eliminar: ${count} producto(s) usan esta categoría` });
    const { data, error } = await supabase.from('categorias_productos').delete()
      .eq('id', req.params.id).eq('empresa_id', req.empresa.id).select('id');
    if (error) throw new Error(error.message);
    if (!data || !data.length) return res.status(404).json({ error: 'Categoría no encontrada' });
    res.json({ eliminado: true });
  } catch (err) { next(err); }
});

module.exports = router;