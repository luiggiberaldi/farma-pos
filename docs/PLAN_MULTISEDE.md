# Plan Multi-sede — Farma POS (cliente, 3 locales)

Fecha: 2026-09-28. Estado: propuesta aprobada por el usuario, pendiente de ejecución.

## 1. Decisiones cerradas

- **1 tenant = el cliente**, con **3 sedes** (`app_private.branches`). Cada venta,
  movimiento de stock, sesión y usuario lleva `branch_id`.
- **Roles: DUENO y CAJERO.** Sin rol intermedio (Encargado) por decisión del usuario.
- **DUENO mobile-first**: sus vistas (reportes, monitor en vivo, selector de sedes)
  se diseñan primero para teléfono (PWA instalable).
- **CAJERO en laptop**: POS e inventario optimizados para pantallas ≥1024px,
  con atajos de teclado.
- **Catálogo compartido, existencias separadas**: el catálogo de productos es del
  tenant; el stock y sus movimientos son por sede.
- **Tasa BCV a nivel tenant** (es nacional, no varía por sede).
- **PINs de fábrica 0000/000000 se mantienen** con aviso persistente (decisión previa).
- La separación entre sedes se aplica **a nivel base de datos (RLS)**, no solo visual.

## 2. Fase 1 — Amarre del aislamiento por sede (backend)

1. Auditoría de la matriz RLS: toda tabla operativa con `branch_id`
   (`sales`, `sale_lines`, `stock`/`inventory`, `sessions`, `operators`,
   `business_operations`, `customers` si aplica) debe cumplir
   `branch_id = sede_de_la_sesion OR rol = 'DUENO'`.
2. **Cajero atado a su sede**: la sesión fija `branch_id` en el login/PIN.
   El selector de sede solo existe para DUENO; CAJERO no puede cambiar de sede
   sin cerrar sesión y re-autenticarse.
3. Verificar que ningún endpoint PostgREST/RPC exponga agregados cross-sede
   a roles no-DUENO.
4. Tests PGlite (matriz negativa): cajero de sede A **no** lee ventas ni stock
   de sede B; DUENO sí lee todo.

## 3. Fase 2 — Vistas por rol + responsividad

**CAJERO (laptop):**
- SalesView (punto de venta), ProductsView (inventario **de su sede**),
  CustomersView, cierre de turno.
- Oculto para este rol: gestión de usuarios, configuración, reportes
  consolidados, selector de sede.
- Atajos de teclado en el POS (cobrar, buscar producto, nuevo ticket).

**DUENO (móvil primero):**
- Dashboard con selector de sede: Todas / Sede 1 / Sede 2 / Sede 3.
- Navegación inferior por tabs (En vivo, Reportes, Sedes, Más), tarjetas de
  una columna, objetivos táctiles ≥44px. El modo oscuro ya existe.

- Guards por rol en el router + navegación adaptativa según rol y sede.
- **Limpieza del rol ADMIN**: el código aún lo referencia (`getVisibleSedes`,
  RLS `role IN ('DUENO','ADMIN')`). Como no habrá rol intermedio, eliminar esas
  referencias y dejar solo `DUENO` (ve todo) y `CAJERO` (solo su sede).

## 4. Fase 3 — Reportes (DUENO)

**Por sede:** ventas día/semana/mes, ticket promedio, USD vs Bs por método de pago,
top productos, anulaciones, ventas por cajero, inventario valorizado, stock bajo.

**Consolidados:** comparativa entre las 3 sedes (ranking, participación %),
totales generales. (ReportsView ya tiene el concepto de filtro `todas`; hay que
completar el desglose y las vistas.)

**Implementación:** RPCs `pharmacy_report_*` en servidor — los totales se calculan
en servidor, coherente con el modelo de seguridad (el cliente nunca confía en
totales del frontend). Exportación a PDF (el build ya incluye el chunk pdf).

## 5. Fase 4 — Monitor en vivo (DUENO, móvil)

Nueva vista **"En vivo"** solo para DUENO:
- Feed de ventas en tiempo real por sede, KPIs del día, cajeros con sesión activa,
  alertas (stock crítico, anulaciones).
- Técnico: Supabase Realtime (`postgres_changes` sobre INSERT en ventas) con
  **fallback a polling cada 10–15s** (el proyecto está en plan free de Supabase,
  con límites de Realtime).
- Opcional: reutilizar el patrón kiosco de `MonitorView` si el dueño quiere una
  pantalla fija en oficina además del teléfono.

## 6. Fase 5 — Puesta en marcha y despliegue

1. Bootstrap: tenant + 3 sedes + DUENO + cajeros por sede
   (vía `pharmacy_bootstrap_owner` + script de alta).
2. Enrolar dispositivos por sede.
3. Redeploy en Vercel al cierre de cada fase (el proyecto ya está desplegado en
   `https://farma-pos.vercel.app`).
4. Guía rápida de uso por rol (1 página cada uno).

## 7. Inputs necesarios del cliente

- **Nombres de las 3 sedes: RESUELTO** (auditoría del repo, 2026-09-28).
  Definidas en `src/config/sedes.js` con logo y color propio:
  - `central` → **C&Y 2025** → `#0B8D63` → `/logos/casa-medica-2025.png`
  - `norte` → **C&Y 2026** → `#0066CC` → `/logos/casa-medica-2026.png`
  - `sur` → **Farmacia Las 24 Horas** → `#8B5CF6` → `/logos/farmacia-24horas.png`
  Los 3 PNG existen y son válidos. Hallazgo: `casa-medica-2025.png` (2.25MB) y
  `casa-medica-2026.png` (2.6MB) son muy pesados para móvil — optimizarlos
  (redimensionar/comprimir a <200KB) dentro de la Fase 2.
- Cantidad de cajeros por sede (para pre-crear usuarios).
- ¿Monitor en vivo solo en el teléfono del dueño o también en pantalla fija?

## 8. Criterios de aceptación

- Cajero de sede A no ve ni vende inventario de sede B (test negativo en verde).
- El dueño ve cada sede individual y el consolidado desde el móvil.
- Una venta se refleja en el monitor en vivo en <15s.
- Los reportes cuadran con la suma de ventas (tolerancia 0).
- `npm test` (479+ tests) y `vite build` en verde antes de cada redeploy.
