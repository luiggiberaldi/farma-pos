# Migraciones LEGACY — archivadas (2026-09-28)

Este directorio contiene el track de migraciones del **proyecto Supabase anterior**.
**No aplicar sobre el proyecto nuevo (`dpwfntuxgydtwgzbwxdz`).**

## Por qué se archivó

El modelo canónico actual vive en `supabase/migrations/` (esquema `app_private`,
deny-by-default) y **aborta si existen objetos legacy en `public`**. Este track
legacy crea exactamente esos objetos. Aplicar ambos tracks sobre el mismo
proyecto deja dos modelos conviviendo y las protecciones del modelo nuevo
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

- **Nunca** aplicar estos archivos sobre el proyecto nuevo.
- Si se necesita alguna lógica de aquí (p. ej. retención de `audit_log`),
  portarla como migración nueva en `supabase/migrations/` con el formato
  `YYYYMMDDNNNN_nombre.sql`, idempotente y sobre `app_private`.
- El stub `process_checkout` del setup legacy fue neutralizado para que falle
  con `RAISE EXCEPTION` en vez de retornar un `sale_id` falso
  (hallazgo C5; ver `db_estacion_maestra_setup.sql`).
