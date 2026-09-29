# ADR-001 — Modo contención: sincronización remota pausada (C6)

- **Estado:** vigente
- **Fecha:** 2026-09-28
- **Flag:** `REMOTE_OPERATIONS_PAUSED = true` (`src/config/operationSafety.js`)

## Contexto

La auditoría E2E encontró que el contrato servidor de escrituras no existía o
no era confiable (precios/totales/tasa fijados por el cliente, sin roles en
anulaciones, dos tracks de migraciones incompatibles). Ante eso se decidió
contención deliberada: la app opera 100% local y **ninguna venta sale del
dispositivo**.

## Qué implica hoy

- La cola offline crece pero nada la drena; `uploadBackupToCloud` rechaza.
- Si el equipo se pierde, se daña o se desinstala la app, **se pierde todo el
  historial**. La UI lo advierte (tarjeta en Ajustes → Sistema) y existe
  **exportación de respaldo cifrado** (AES-256-GCM con contraseña,
  `src/services/encryptedBackupService.js`): el dueño debe guardar copias
  fuera del equipo con regularidad.

## Criterios medibles de salida (todos deben cumplirse)

1. Migraciones `20260928*` aplicadas y verificadas en la base de datos.
2. `pharmacy_commit_sale` acepta una venta de prueba end-to-end y recalcula
   totales/tasa en servidor (rechaza totales manipulados).
3. `pharmacy_commit_void` rechaza a un `CAJERO` (403 no reintentable).
4. `/api/rates` alimenta `pharmacy_record_rate` (banda ±5% con referencia real).
5. Rotación de la credencial filtrada completada y force-push del historial
   reescrito publicado.
6. Runbook de incidentes probado en un simulacro (revocar sesión/dispositivo).

## Decisión

No se reactiva el sync por toggle local ni variable de entorno: solo con el
contrato servidor revisado de fase 2/3 y la verificación anterior. Quitar el
flag sin cumplir los criterios reabre C1–C6.
