-- ============================================================
-- SISTEMA DE CONTROL — ESQUEMA COMPLETO SUPABASE (PostgreSQL)
-- Ejecutar en: Supabase > SQL Editor > New query > pegar y Run
-- Cubre las 7 pestañas. Se crea todo de una vez para que los
-- módulos siguientes no requieran migraciones improvisadas.
-- ============================================================

-- ---------- 1. MATERIALES ----------
create table if not exists materiales (
  id            uuid primary key default gen_random_uuid(),
  nombre        text not null,
  unidad        text not null,                  -- ej: 'unidad', 'metro', 'gramo'
  costo_unitario numeric(12,2) not null check (costo_unitario >= 0),
  proveedor     text not null,
  tiempo_entrega_dias integer not null default 1 check (tiempo_entrega_dias >= 0),
  stock_actual  numeric(12,2) not null default 0 check (stock_actual >= 0),
  stock_seguridad numeric(12,2) not null default 0,
  activo        boolean not null default true,
  creado_en     timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists materiales_historial_precio (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materiales(id) on delete cascade,
  costo_anterior numeric(12,2) not null,
  costo_nuevo    numeric(12,2) not null,
  origen      text not null default 'edicion',   -- 'edicion' | 'compra'
  fecha       timestamptz not null default now()
);

-- ---------- 2. PRODUCTOS (FICHAS TÉCNICAS) ----------
create table if not exists productos (
  id             uuid primary key default gen_random_uuid(),
  nombre         text not null,
  foto_url       text,
  precio_venta   numeric(12,2) not null check (precio_venta >= 0),
  minutos_fabricacion integer not null default 0,
  costo_minuto_mano_obra numeric(12,4) not null default 0,
  costo_calculado numeric(12,2) not null default 0,  -- recalculado por el backend
  activo         boolean not null default true,
  creado_en      timestamptz not null default now(),
  actualizado_en timestamptz not null default now()
);

create table if not exists productos_materiales (
  id          uuid primary key default gen_random_uuid(),
  producto_id uuid not null references productos(id) on delete cascade,
  material_id uuid not null references materiales(id) on delete restrict,
  cantidad    numeric(12,4) not null check (cantidad > 0),
  unique (producto_id, material_id)
);

-- ---------- 3. INVENTARIO ----------
create table if not exists inventario_ajustes (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materiales(id) on delete cascade,
  stock_anterior numeric(12,2) not null,
  stock_nuevo    numeric(12,2) not null,
  motivo      text not null,
  usuario     text,
  fecha       timestamptz not null default now()
);

-- ---------- 4. COMPRAS ----------
create table if not exists compras (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materiales(id) on delete restrict,
  proveedor   text not null,
  cantidad    numeric(12,2) not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null check (precio_unitario >= 0),
  total       numeric(12,2) generated always as (cantidad * precio_unitario) stored,
  fecha       timestamptz not null default now(),
  notas       text
);

-- ---------- 5. VENTAS ----------
create table if not exists ventas (
  id          uuid primary key default gen_random_uuid(),
  cliente     text,
  total       numeric(12,2) not null default 0,
  costo_total numeric(12,2) not null default 0,   -- congelado al momento de la venta
  estado      text not null default 'pendiente'
              check (estado in ('pendiente','en_produccion','listo','entregado')),
  facturada   boolean not null default false,
  fecha       timestamptz not null default now()
);

create table if not exists ventas_items (
  id          uuid primary key default gen_random_uuid(),
  venta_id    uuid not null references ventas(id) on delete cascade,
  producto_id uuid not null references productos(id) on delete restrict,
  cantidad    integer not null check (cantidad > 0),
  precio_unitario numeric(12,2) not null,
  costo_unitario  numeric(12,2) not null
);

-- ---------- 6. FINANZAS ----------
create table if not exists costos_fijos (
  id      uuid primary key default gen_random_uuid(),
  nombre  text not null,
  valor_mensual numeric(12,2) not null check (valor_mensual >= 0),
  activo  boolean not null default true,
  creado_en timestamptz not null default now()
);

create table if not exists capital_invertido (
  id      uuid primary key default gen_random_uuid(),
  concepto text not null,
  valor   numeric(12,2) not null,
  fecha   timestamptz not null default now()
);

-- ---------- 7. FACTURACIÓN ----------
create table if not exists configuracion_fiscal (
  id  integer primary key default 1 check (id = 1),   -- fila única
  razon_social text,
  nit          text,
  regimen      text,
  resolucion_numero text,
  resolucion_prefijo text,
  resolucion_desde bigint,
  resolucion_hasta bigint,
  resolucion_vigencia date
);

create table if not exists facturas (
  id        uuid primary key default gen_random_uuid(),
  venta_id  uuid not null references ventas(id) on delete restrict,
  numero    text,
  cufe      text,
  pdf_url   text,
  estado    text not null default 'generada',
  fecha     timestamptz not null default now()
);

-- ---------- ÍNDICES ÚTILES ----------
create index if not exists idx_hist_precio_material on materiales_historial_precio(material_id, fecha desc);
create index if not exists idx_pm_producto on productos_materiales(producto_id);
create index if not exists idx_pm_material on productos_materiales(material_id);
create index if not exists idx_compras_material on compras(material_id, fecha desc);
create index if not exists idx_ventas_fecha on ventas(fecha desc);
create index if not exists idx_vitems_venta on ventas_items(venta_id);

-- ---------- SEGURIDAD ----------
-- El navegador NUNCA habla con Supabase directamente: solo el backend
-- (con la service_role key). Activamos RLS sin políticas públicas para
-- que la anon key no pueda leer ni escribir nada.
alter table materiales enable row level security;
alter table materiales_historial_precio enable row level security;
alter table productos enable row level security;
alter table productos_materiales enable row level security;
alter table inventario_ajustes enable row level security;
alter table compras enable row level security;
alter table ventas enable row level security;
alter table ventas_items enable row level security;
alter table costos_fijos enable row level security;
alter table capital_invertido enable row level security;
alter table configuracion_fiscal enable row level security;
alter table facturas enable row level security;
