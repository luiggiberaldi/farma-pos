# Plan de roles y modos — Gestión / Caja

## Objetivo

Separar la experiencia administrativa de la experiencia de cobro sin cambiar roles, sedes ni permisos.

## Modo Gestión

Disponible para dueño y administrador:

- Dashboard y supervisión.
- Inventario y lotes.
- Reportes y auditoría.
- Configuración y usuarios según permisos.
- Transferencias según sede.

El dueño puede consultar todas las sedes; el administrador solo la asignada.

## Modo Caja

Disponible para dueño/admin cuando lo necesiten y para cajero:

- Punto de venta.
- Clientes necesarios para cobrar.
- Consulta mínima de productos y precios.
- Historial y resumen del turno.
- Cobro y recibos.

El cajero no ve configuración, reportes, edición, costos, márgenes, transferencias ni usuarios.

## Flujo

1. Dueño/admin entra por defecto en Gestión.
2. Un selector profesional permite cambiar a Caja.
3. Cambiar de modo no cambia rol, sede ni permisos.
4. El cajero entra directamente en Caja y no ve selector de modo.
5. El modo se guarda solo en la sesión local y se restablece al cerrar sesión.
6. Todo cambio de modo de dueño/admin deja huella con usuario, rol, sede, modo anterior/nuevo, fecha, hora y ts.

## Fases

### M1 — Estado de modo

Añadir `appMode: 'gestion' | 'caja'` al estado de aplicación. Inicializarlo según el rol y resetearlo al cerrar sesión.

### M2 — Navegación

Gestión mostrará módulos administrativos autorizados. Caja mostrará POS y resumen de turno. Toda pestaña incompatible se redirigirá al cambiar de modo.

### M3 — Selector

Usar `ProfessionalSelect` o un control segmentado profesional, accesible, redondeado y compatible con teclado/móvil. No usar `<select>` nativo para el selector principal.

### M4 — Restricciones

No renderizar funciones administrativas en Caja cuando sea posible. Mantener una validación por rol además de la validación por modo para impedir accesos directos.

### M5 — Huella y validación

Probar dueño, admin y cajero; cambio de modo, recarga, cierre de sesión, offline y cambio de sede. No modificar la lógica de cierres nocturnos.

## Criterios de aceptación

- Dueño/admin abre Gestión por defecto.
- Dueño/admin puede entrar a Caja sin cambiar de usuario.
- Cajero solo ve Caja y funciones necesarias.
- Cambiar modo no eleva permisos.
- Iconografía y selectores cumplen `agent.md`.
- Build, tests, eslint y `git diff --check` pasan.
