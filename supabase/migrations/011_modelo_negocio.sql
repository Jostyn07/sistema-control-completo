-- ============================================================
-- 011 — FABRICANTE, COMERCIANTE O AMBOS
-- supabase/migrations/011_modelo_negocio.sql
--
--  1. empresas.configuracion.modelo_negocio = { fabricacion, reventa }
--     (sin la clave = todavía no eligió; el sistema la trata como
--      fabricante y le pregunta al entrar)
--  2. productos.tipo: 'fabricado' (receta/procesos) o 'reventa'
--     (se compra terminado; su costo es el costo de compra)
--  3. compras acepta productos: material_id O producto_id, nunca ambos
--
-- Idempotente. No cambia ningún dato existente: todo producto actual
-- queda como 'fabricado' y toda compra actual sigue siendo de material.
-- ============================================================
BEGIN;

-- 1. Configuración de la empresa
ALTER TABLE public.empresas
  ADD COLUMN IF NOT EXISTS configuracion jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 2. Tipo de producto
ALTER TABLE public.productos
  ADD COLUMN IF NOT EXISTS tipo text NOT NULL DEFAULT 'fabricado';
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'productos_tipo_check') THEN
    ALTER TABLE public.productos
      ADD CONSTRAINT productos_tipo_check CHECK (tipo IN ('fabricado', 'reventa'));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_productos_empresa_tipo ON public.productos (empresa_id, tipo);

-- 3. Compras de materiales o de productos
ALTER TABLE public.compras ALTER COLUMN material_id DROP NOT NULL;
ALTER TABLE public.compras
  ADD COLUMN IF NOT EXISTS producto_id uuid REFERENCES public.productos(id) ON DELETE RESTRICT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'compras_articulo_check') THEN
    ALTER TABLE public.compras
      ADD CONSTRAINT compras_articulo_check CHECK (num_nonnulls(material_id, producto_id) = 1);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_compras_producto ON public.compras (producto_id) WHERE producto_id IS NOT NULL;

COMMIT;

-- ------------------------------------------------------------
-- Verificación (correr aparte; todo debe dar true)
-- ------------------------------------------------------------
-- SELECT
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='empresas'  AND column_name='configuracion') AS empresas_configuracion,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='productos' AND column_name='tipo')          AS productos_tipo,
--   EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='compras'   AND column_name='producto_id')   AS compras_producto,
--   (SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_name='compras' AND column_name='material_id') AS material_opcional;
