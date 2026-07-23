// ============================================================
// ALMACENAMIENTO DE IMÁGENES  (/api/almacenamiento)
// Sube fotos de productos al bucket "productos-fotos" de Supabase
// Storage. Igual que el resto del sistema, el navegador nunca habla
// directo con Supabase: manda el archivo aquí, el backend valida
// que sea una imagen real (tipo y tamaño) y lo sube él mismo.
// ============================================================
const express = require('express');
const multer = require('multer');
const supabase = require('../supabase/cliente');
const router = express.Router();

const BUCKET = 'productos-fotos';
const TAMANO_MAXIMO = 5 * 1024 * 1024; // 5 MB

const subida = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANO_MAXIMO },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('El archivo debe ser una imagen'));
    cb(null, true);
  }
});

// POST /api/almacenamiento/foto-producto — campo de formulario: "foto"
router.post('/foto-producto', (req, res, next) => {
  subida.single('foto')(req, res, async (errSubida) => {
    if (errSubida) {
      const mensaje = errSubida.code === 'LIMIT_FILE_SIZE'
        ? 'La imagen no puede pesar más de 5 MB'
        : errSubida.message;
      return res.status(400).json({ error: mensaje });
    }
    if (!req.file) return res.status(400).json({ error: 'No se recibió ninguna imagen' });

    try {
      const extension = (req.file.originalname.split('.').pop() || 'jpg')
        .toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const nombreUnico = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
      const ruta = `${req.usuarioId}/${nombreUnico}`;

      const { error: eStorage } = await supabase.storage
        .from(BUCKET)
        .upload(ruta, req.file.buffer, { contentType: req.file.mimetype, upsert: false });
      if (eStorage) throw new Error(eStorage.message);

      const { data } = supabase.storage.from(BUCKET).getPublicUrl(ruta);
      res.status(201).json({ url: data.publicUrl });
    } catch (err) { next(err); }
  });
});

module.exports = router;