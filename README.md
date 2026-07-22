# Sistema de Control — Sistema completo (7 módulos)

Los 7 módulos del sistema, siguiendo la estructura funcional detallada.
Stack: HTML/CSS/JS vanilla · Node.js (Express) · Supabase · Vercel.

## Qué incluye esta entrega

- **Base de datos completa** (`supabase/schema.sql`): las tablas de las 7 pestañas, con relaciones, validaciones y RLS activado. Se crea todo de una vez para que los módulos siguientes no necesiten migraciones improvisadas.
- **Servidor Express** (`server/`): arranque, conexión a Supabase (solo backend, con service_role) y las rutas de los 7 módulos, más un servicio interno compartido (punto de reorden) que también usará Compras.
- **Pestaña Materiales** (`public/materiales.html` + `js/materiales.js`): lista, formulario nuevo/editar, eliminación protegida e historial de precios — con recálculo automático de costos de productos cuando cambia un precio.
- **Pestaña Productos / Fichas técnicas** (`public/productos.html` + `js/productos.js`): tarjetas con foto, precio y margen; formulario de ficha técnica que agrega materiales y calcula costo y margen en vivo sin guardar (pide los precios una sola vez y calcula en el navegador); desglose de costo por producto; eliminación que se convierte en desactivación automática si el producto ya tiene ventas registradas (para no perder el historial).
- **Pestaña Inventario en tiempo real** (`public/inventario.html` + `js/inventario.js`): semáforo por material (rojo/amarillo/verde según punto de reorden), tarjetas de "cuánto puedes fabricar ahora" con el material limitante señalado, y ajuste manual con motivo obligatorio para trazabilidad. Se refresca sola cada 15 segundos y al volver a la pestaña del navegador.
- **Pestaña Ventas** (`public/ventas.html` + `js/ventas.js`): formulario de nueva venta con total en vivo y aviso de capacidad; al registrar, **descuenta automáticamente los materiales de cada ficha técnica** (congelando precio y costo del momento); si falta stock avisa con el detalle de faltantes y permite forzar; pedidos con estados pendiente → en producción → listo → entregado; historial con filtros por fecha y estado que muestra la ganancia de cada venta.
- **Pestaña Compras** (`public/compras.html` + `js/compras.js`): lista de pendientes que se genera sola (materiales en zona roja/amarilla según punto de reorden), con cantidad sugerida, proveedor sugerido y costo estimado; formulario de compra precargado y editable que al confirmar **suma el stock automáticamente** y guarda el precio pagado en el historial de precios del material; historial con filtros por proveedor y fecha.
- **Pestaña Finanzas** (`public/finanzas.html` + `js/finanzas.js`): panel con ingresos, costos, utilidad, punto de equilibrio y ROI del mes con datos reales; gestión de costos fijos mensuales; registro de capital invertido (base del ROI); y gráfico de ingresos vs. costos de los últimos 6 meses hecho con divs y CSS, sin librerías externas.
- **Pestaña Facturación** (`public/facturacion.html` + `js/facturacion.js`): configuración fiscal de carga única (RUT y resolución de numeración con validación de rango), lista de ventas por facturar, generación con consecutivo automático según la resolución (avisa cuando el rango se agota), historial, y vista de factura imprimible (Imprimir / Guardar PDF para enviar al cliente).
- **Página principal / dashboard** (`public/index.html` + `js/inicio.js`): es lo primero que se ve al entrar. Alertas de acción inmediata (materiales en rojo, productos sin stock, ventas sin facturar), indicadores del mes (ingresos, utilidad, cuánto falta para el equilibrio, ROI), pedidos activos por estado, materiales por comprar con costo estimado, capacidad de producción y ventas por facturar — todo con enlaces directos a cada pestaña. No tiene backend propio: reúne los endpoints ya existentes y se refresca sola cada 30 segundos.
- **CSS provisional** (`public/css/estilos.css`): usable desde ya; se reemplaza completo por el de Claude Design sin tocar los HTML.

## Nota sobre el "tiempo real"

El documento pedía suscripciones de Supabase Realtime, pero la regla de arquitectura del proyecto es que el navegador nunca hable con Supabase directamente (por seguridad, RLS bloquea la anon key). Por eso el refresco es por sondeo cada 15 segundos — suficiente para este uso. Si más adelante quieres push instantáneo, habría que crear una política de solo-lectura para la anon key: decisión de seguridad que se puede tomar después sin retrabajo.

## Fórmula del punto de reorden (ya con datos reales)

`(consumo_diario_promedio × tiempo_entrega_proveedor) + stock_seguridad` — el consumo se calcula con las ventas de los últimos 30 días según las fichas técnicas. Mientras no haya ventas, el punto de reorden es el stock de seguridad.

## Cómo se conectan los dos módulos

Cuando edites el costo de un material en la pestaña Materiales, el backend recalcula automáticamente el `costo_calculado` de todos los productos que lo usan (esto ya estaba implementado desde el módulo 1). Ahora que Productos existe, ese recálculo se ve reflejado de inmediato en las tarjetas y en el margen mostrado.

## Puesta en marcha (una sola vez)

1. **Supabase**: crea el proyecto (si no existe), abre *SQL Editor*, pega el contenido de `supabase/schema.sql` y ejecuta.
2. **Credenciales**: copia `.env.ejemplo` como `.env` y llena `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` (Project Settings → API). Usa la **service_role**, no la anon.
3. **Instalar y correr en local**:
   ```bash
   npm install
   npm run dev
   ```
   Abre `http://localhost:3000` (la página principal).

## Despliegue en Vercel

1. Sube el proyecto a un repositorio de GitHub.
2. En Vercel: *New Project* → importa el repo → agrega las variables de entorno `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Deploy. El `vercel.json` ya enruta `/api/*` al servidor y el resto a los archivos estáticos.

## Estructura

```
/public                  → lo que ve el navegador
  index.html             → página principal (dashboard)
  materiales.html
  productos.html
  /js
    api.js               → fetch compartido (todas las pestañas lo usan)
    inicio.js
    materiales.js
    productos.js
    inventario.js
    ventas.js
    compras.js
    finanzas.js
    facturacion.js
  /css
    estilos.css          → provisional, se reemplaza por Claude Design
/server
  index.js               → Express; aquí están montadas las rutas de los 7 módulos
  /rutas
    materiales.js
    productos.js
    inventario.js
    ventas.js
    compras.js
    finanzas.js
    facturacion.js
  /servicios
    inventario.js        → punto de reorden y consumo promedio (compartido con Compras)
    facturacion-proveedor.js → adaptador DIAN (único archivo a tocar al elegir proveedor)
  /supabase
    cliente.js
/supabase
  schema.sql             → base de datos completa (7 módulos)
```

## Decisiones del módulo Compras

- **Cantidad sugerida**: lo necesario para quedar con el doble del punto de reorden — `(punto_reorden × 2) − stock_actual` — una cobertura cómoda sin inmovilizar capital de más. La cantidad siempre es editable en el formulario.
- **El precio pagado NO cambia el costo del material automáticamente**: queda en el historial (origen "compra") y el sistema sugiere actualizarlo en la pestaña Materiales si es el nuevo precio normal. Así el recálculo de costos de todos los productos siempre es una decisión consciente, no un efecto colateral de una compra puntual (ej. una promoción).

## Fórmulas de Finanzas (tal como pide el documento)

- `ingresos_mes` = suma de ventas del mes
- `costos_variables_mes` = suma del costo congelado (materiales + mano de obra) de cada venta del mes
- `utilidad_mes` = ingresos − costos variables − costos fijos
- `punto_equilibrio` = costos fijos ÷ margen de contribución ponderado, donde el margen sale del mix REAL vendido en el mes: `(ingresos − costos variables) ÷ ingresos`. El panel además muestra cuánto falta vender para alcanzarlo.
- `roi_acumulado` = utilidad acumulada ÷ capital invertido. Decisión documentada: la utilidad acumulada resta los costos fijos por cada mes transcurrido desde la primera venta (inclusive).

Si aún no hay ventas o capital registrado, el panel lo dice claramente en vez de mostrar un número engañoso.

## Facturación: modo interno y adaptador de proveedor

La decisión sobre cómo validar ante la DIAN (servicio gratuito manual, proveedor tecnológico con API, o desarrollo propio) sigue abierta, así que el módulo funciona en **modo interno**: genera las facturas con la numeración de la resolución, las guarda, permite imprimirlas o guardarlas como PDF — pero el CUFE queda pendiente porque solo lo emite la DIAN o un proveedor autorizado.

Todo lo que depende de esa decisión vive en un solo archivo: `server/servicios/facturacion-proveedor.js`. Cuando se elija proveedor (Factus, Siigo, Alegra…), se implementa `emitirAnteProveedor()` con su API, se cambia `MODO` a `'proveedor'`, y nada más del sistema se toca.

## Estado del proyecto

Los 7 módulos del documento de estructura funcional están implementados y conectados. Pendientes fuera del código: ejecutar `schema.sql` en Supabase, configurar el `.env`, reemplazar el CSS por el diseño de Claude Design, y decidir el proveedor de facturación DIAN.
