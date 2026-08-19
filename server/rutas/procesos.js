// ============================================================
// MÓDULO — PROCESOS  (/api/procesos)
// Requiere sesión. Cada consulta se filtra por req.usuarioId.
// Mismo patrón que Materiales (catálogo con nombre, unidad y costo
// unitario), pero para pasos de trabajo/producción en vez de
// insumos físicos — ej: "Armado de ramo", "Pintura", "Empacado".
// Lo usa el módulo de Nóminas para asignarle trabajo a un
// colaborador y calcular cuánto se le paga por unidad completada.
// - GET    /        lista los procesos activos
// - POST   /        crear proceso
// - PUT    /:id     editar proceso
// - DELETE /:id     eliminar solo si ningún colaborador lo tiene asignado
// ============================================================
const express = require('express');
const supabase = require('../supabase/cliente');
const router = express.Router();

function validarProceso(datos) {
  const errores = [];
  if (!datos.nombre || !datos.nombre.trim()) errores.push('El nombre es obligatorio');
  if (!datos.unidad || !datos.unidad.trim()) errores.push('La unidad es obligatoria');
  if (datos.costo_unitario == null || isNaN(datos.costo_unitario) || Number(datos.costo_unitario) < 0)
    errores.push('El costo unitario debe ser un número mayor o igual a 0');
  return errores;
}

// GET /api/procesos
router.get('/', async (req, res, next) => {
  try {
    const { data, error } = await supabase
      .from('procesos')
      .select('*')
      .eq('usuario_id', req.usuarioId)
      .eq('activo', true)
      .order('nombre');
    if (error) throw new Error(error.message);
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/procesos
router.post('/', async (req, res, next) => {
  try {
    const errores = validarProceso(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const nuevo = {
      usuario_id: req.usuarioId,
      nombre: req.body.nombre.trim(),
      unidad: req.body.unidad.trim(),
      costo_unitario: Number(req.body.costo_unitario),
      descripcion: (req.body.descripcion || '').trim() || null
    };
    const { data, error } = await supabase.from('procesos').insert(nuevo).select().single();
    if (error) throw new Error(error.message);
    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PUT /api/procesos/:id
router.put('/:id', async (req, res, next) => {
  try {
    const errores = validarProceso(req.body);
    if (errores.length) return res.status(400).json({ error: errores.join('. ') });

    const cambios = {
      nombre: req.body.nombre.trim(),
      unidad: req.body.unidad.trim(),
      costo_unitario: Number(req.body.costo_unitario),
      descripcion: (req.body.descripcion || '').trim() || null,
      actualizado_en: new Date().toISOString()
    };
    const { data, error } = await supabase
      .from('procesos').update(cambios).eq('id', req.params.id).eq('usuario_id', req.usuarioId).select().single();
    if (error) throw new Error(error.message);
    if (!data) return res.status(404).json({ error: 'Proceso no encontrado' });
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/procesos/:id — solo si ningún colaborador lo tiene asignado
router.delete('/:id', async (req, res, next) => {
  try {
    const { data: proceso, error: eGet } = await supabase
      .from('procesos').select('id').eq('id', req.params.id).eq('usuario_id', req.usuarioId).single();
    if (eGet || !proceso) return res.status(404).json({ error: 'Proceso no encontrado' });

    const { count, error: eRef } = await supabase
      .from('colaboradores_encargos')
      .select('id', { count: 'exact', head: true })
      .eq('proceso_id', req.params.id);
    if (eRef) throw new Error(eRef.message);

    if (count > 0) {
      return res.status(409).json({
        error: `No se puede eliminar: este proceso está asignado a ${count} encargo(s) de colaboradores.`
      });
    }

    const { error } = await supabase.from('procesos').delete().eq('id', req.params.id).eq('usuario_id', req.usuarioId);
    if (error) throw new Error(error.message);
    res.json({ eliminado: true });
  } catch (err) { next(err); }
});

module.exports = router;