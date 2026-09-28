# Plan de acceso, PIN administrativo y sede activa

## Decisión recomendada

El correo y la contraseña autentican la cuenta cloud. Después de autenticarse, la aplicación debe llevar siempre a la pantalla local de inicio con PIN. El PIN identifica el operador y autoriza la sede activa; no debe usarse el correo para decidir permisos de operación.

El administrador es una identidad administrativa única para las tres sedes. La sede no se fija permanentemente en la cuenta: se selecciona después del PIN desde un selector profesional. Cada cambio de sede exige nuevamente el PIN administrativo y deja huella.

## Flujo objetivo

1. Usuario introduce correo y contraseña.
2. Supabase valida la cuenta y limita la cantidad de dispositivos según la configuración actual.
3. La app fija la cuenta activa, limpia una sede operativa anterior y muestra el inicio local con PIN.
4. El administrador introduce su PIN.
5. Se muestra el selector de sede autorizado: C&Y 2025, C&Y 2026 o Farmacia Las 24 Horas.
6. Al elegir una sede, se confirma el PIN administrativo y se establece el scope local de esa sede.
7. La aplicación abre Gestión en el dashboard de esa sede.
8. Para cambiar de sede, el administrador pulsa el selector, valida el PIN y solo entonces se cambia el scope.

## Separación de responsabilidades

- Correo/contraseña: acceso a la cuenta cloud y estación autorizada.
- PIN: desbloqueo local, identidad del operador y autorización del cambio de sede.
- Sede activa: contexto operativo actual para inventario, ventas, caja, auditoría y reportes.
- Rol: permisos funcionales; nunca debe derivarse de la sede seleccionada.

## Seguridad y datos

- No guardar el PIN en la sesión ni en el navegador en texto plano.
- No permitir que un cajero seleccione otra sede.
- No permitir que cambiar la sede eleve el rol.
- Invalidar el contexto de sede al cerrar sesión y al cambiar de cuenta cloud.
- Todas las ventas, movimientos, ediciones, cambios de sede y cierres deben conservar sede, usuario, fecha, hora, timestamp y correlativo.
- El administrador puede consultar todas las sedes solo mediante un reporte consolidado explícito; el dashboard operativo muestra una sede a la vez.

## Fases

### A1 — Contrato de sesión

Separar sesión cloud, usuario local y sede operativa. El login cloud debe llevar a LockScreen, no directamente al dashboard.

### A2 — Administrador único multi-sede

Mantener una identidad ADMIN/DUENO común y eliminar la dependencia de usuarios admin duplicados por sede. Conservar cajeros independientes y asignados a una sola sede.

### A3 — Selección de sede con PIN

Crear un selector profesional en la pantalla posterior al PIN. Revalidar el PIN cada vez que se cambie de sede y persistir únicamente la sede activa, nunca el PIN.

### A4 — Scoping y navegación

Cambiar el scope antes de montar o recargar datos de inventario, ventas, caja y reportes. Al cambiar sede, refrescar las vistas dependientes y bloquear operaciones durante la transición.

### A5 — Huella y auditoría

Registrar `SEDE_CAMBIADA` con usuario, sede anterior, sede nueva, fecha, hora, ts y correlativo. Mostrar el cambio en el auditor para administradores.

### A6 — Validación

Probar login cloud → PIN → sede; cambio de sede con PIN correcto/incorrecto; cierre de sesión; cajero restringido; datos aislados; cruce de medianoche sin alterar cierres manuales; offline y reconexión.

## Criterios de aceptación

- Correo y contraseña nunca abren directamente una sede operativa.
- El administrador siempre pasa por PIN antes de operar.
- El administrador puede trabajar las tres sedes con la misma identidad.
- Cada cambio de sede exige PIN y deja huella.
- Un cajero solo opera su sede asignada.
- Inventario, ventas y caja nunca mezclan sedes accidentalmente.
- Reportes consolidados requieren una acción explícita y permisos administrativos.
