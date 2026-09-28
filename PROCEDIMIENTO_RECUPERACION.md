# Procedimiento de recuperación — Farma POS

> Documento operativo. La restauración ya no está pausada: desde la fase 5 reemplaza los datos en **una sola transacción** de IndexedDB. Aun así es **destructiva e irreversible**: reemplaza todo el historial de una sede en un equipo.

## Alcance

Un respaldo corresponde a **una cuenta y una sede**. No existe respaldo global ni fusión entre sedes: restaurar Central no toca Norte ni Sur, y un archivo de otra sede se rechaza.

## Cuándo usar cada acción

| Situación | Acción |
|---|---|
| Cambiar de equipo o reinstalar | Exportar en el equipo viejo, restaurar en el nuevo |
| Equipo dañado con respaldo reciente | Restaurar y revisar las ventas posteriores al respaldo |
| Dudas sobre la integridad de los datos | **No restaurar**: primero exportar y comparar |
| Hay ventas pendientes de sincronizar | **No restaurar todavía** (ver abajo) |

## Antes de restaurar

1. **Exportar el estado actual** aunque esté dañado. Es la única copia del historial reciente.
2. **Resolver las operaciones pendientes.** Si el equipo tiene operaciones sin confirmar, la restauración se **rechaza** con el número exacto de pendientes. Esto es deliberado: adoptar la cola del respaldo podría reenviar una venta que el servidor ya confirmó.
3. **Confirmar el origen.** El archivo indica cuenta, sede y fecha. Un respaldo de otra sede o de otra cuenta se rechaza.
4. **Revisar el resumen** que muestra la aplicación antes de confirmar: productos, ventas, clientes y operaciones pendientes del archivo.

## Qué ocurre al restaurar

- Se reemplazan todas las colecciones de esa sede (productos, ventas, clientes, lotes, cierres, proveedores, cuentas, transferencias, controlados) dentro de **una única transacción**. Si algo falla, no se modifica nada.
- La configuración visual se aplica después del commit y, si falla, se revierte sola; en ese caso los datos ya quedaron correctos y la aplicación lo advierte.
- Las operaciones pendientes que traiga el archivo se guardan como **evidencia** y **no** se reenvían.
- Queda un registro con la fecha, el usuario que restauró y las colecciones reemplazadas.
- Se exige **cerrar sesión y volver a entrar por PIN** después de restaurar.

## Después de restaurar

1. Volver a iniciar sesión por PIN.
2. Verificar contra el respaldo: número de productos, últimas ventas y saldos de clientes.
3. Revisar las ventas posteriores a la fecha del respaldo y registrarlas si faltan.
4. Confirmar que la sede activa es la correcta antes de vender.

## Estado de verificación

| Aspecto | Estado |
|---|---|
| Reemplazo atómico de todas las colecciones | Verificado |
| Rechazo de respaldo de otra cuenta o sede | Verificado |
| Rechazo con operaciones pendientes | Verificado |
| Fallo de almacenamiento sin cambios parciales | Verificado |
| Cambio de sesión durante la restauración | Verificado |
| Credenciales excluidas del respaldo | Verificado |
| **Restauración ejecutada en un equipo real con datos reales** | **Pendiente** |

Las comprobaciones anteriores usan datos sintéticos y almacenamiento de prueba. La prueba con un respaldo real en un equipo limpio debe hacerse con el dueño presente, y es requisito antes de considerar cerrada la fase 5.

## Respaldo externo programado

Pendiente. Requiere definir destino (almacenamiento externo o Supabase Storage) y credenciales fuera del repositorio. Mientras no exista, el respaldo es **manual** y su única copia es el archivo que el operador descarga.
