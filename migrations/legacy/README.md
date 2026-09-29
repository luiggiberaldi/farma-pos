# Migraciones LEGACY — archivadas (2026-09-28)

Este directorio contiene un track de migraciones **archivado e inactivo**.
**No aplicar: el modelo vigente vive en `supabase/migrations/`.**

## Por qué se archivó

El modelo canónico actual vive en `supabase/migrations/` (esquema `app_private`,
deny-by-default) y **aborta si existen objetos legacy en `public`**. Este track
archivado crea exactamente esos objetos. Aplicar ambos tracks sobre la misma
base deja dos modelos conviviendo y las protecciones del modelo vigente
dejan de aplicar (hallazgo C5 de la auditoría E2E 2026-09-28).

## Orden original de aplicación (solo referencia histórica)

1. `001_indexes_and_idempotency.sql`
2. `002_remove_realtime_logical_decoding.sql`
3. `003_audit_log_policies.sql`
4. `004_audit_retention.sql` y `004_security_and_checkout_hardening.sql`
   (colisión de numeración histórica: ambos se llamaban `004`; ninguno es
   idempotente — ver hallazgo M13)
5. `005_device_status_rpc.sql`

## Reglas

- **Nunca** aplicar estos archivos: el modelo vigente es `supabase/migrations/`.
- Si se necesita alguna lógica de aquí (p. ej. retención de `audit_log`),
  portarla como migración nueva en `supabase/migrations/` con el formato
  `YYYYMMDDNNNN_nombre.sql`, idempotente y sobre `app_private`.
- El stub `process_checkout` del setup legacy fue neutralizado para que falle
  con `RAISE EXCEPTION` en vez de retornar un `sale_id` falso
  (hallazgo C5; ver `db_estacion_maestra_setup.sql`).

## Hallazgos de la auditoría E2E cerrados por el archivo (2026-09-28)

Estos hallazgos aplicaban **solo** al track archivado y quedan cerrados al
no aplicarse este track:

- **A7 (licencias en fail-open):** `register_and_check_device` retornaba `'ok'`
  sin fila de licencia. El modelo vigente (`app_private.devices`) no tiene
  licencias: el registro de dispositivos se autoriza por sesión de operador
  verificada en `verified_operator`. Si se reintroduce licenciamiento,
  hacerlo en `app_private` con default-deny y documentarlo.
- **A8 (checkout legacy):** `process_checkout` permitía stock negativo y no
  validaba totales. Cerrado por C5: el stub ahora lanza `RAISE EXCEPTION` y el
  checkout real vive en `pharmacy_commit_sale` (servidor recalcula todo).
- **A9 (drift):** `validate_double_entry`, `auto_register_device`,
  `heartbeat_device` y tablas `public.*` solo existían vía dashboard. Al
  archivar el track, la base vigente es reconstruible 100% desde
  `supabase/migrations/`. Conservar `pg_dump --schema-only` del track
  archivado solo como referencia histórica (no aplicar).
- **M8 (policies legacy por email):** `auth.jwt()->>'email'` en `cloud_backups`,
  `audit_log`, etc. El modelo vigente no usa policies por email: `app_private`
  es deny-by-default y solo `service_role` accede vía RPCs `SECURITY DEFINER`
  con sesión verificada.
- **M9 (`audit_log` con `ts`/`id` del cliente):** el modelo vigente usa
  `clock_timestamp()` del servidor en `operation_receipts`; el cliente no
  provee timestamps.
- **M12 (`pg_cron` sin monitoreo):** la retención legacy requería superuser.
  En el modelo vigente no hay jobs de retención en la nube todavía; cuando se
  añadan, documentar el requisito y alertar sobre `cron.job_run_details`.
- **M13 (colisión `004`):** documentada arriba; el track nuevo usa formato
  `YYYYMMDDNNNN` sin colisiones.
- **M14 (realtime):** `sync_documents` se quitó de realtime en el track legacy.
  El modelo vigente no publica nada en realtime hoy; inventariar suscriptores
  antes de habilitarlo.
