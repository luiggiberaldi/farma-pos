# Base de datos — tracks de migraciones (cierra C5)

## Regla de oro

> **Un proyecto = un track. Nunca mezclar.**

## Track vigente: `supabase/migrations/`

Esquema `app_private`, deny-by-default. Formato de nombre: `YYYYMMDDNNNN_nombre.sql`.
Orden de aplicación (numérico):

| # | Archivo | Contenido |
|---|---|---|
| 1 | `202609140001_pharmacy_core.sql` | Núcleo: tenants, sedes, operadores, sesiones, dispositivos |
| 2 | `202609150001_business_operations.sql` | RPCs `pharmacy_commit_*`, `verified_operator`, catálogo, stock, ventas |
| 3 | `202609280001_device_backups_hardening.sql` | C2: `device_backups` solo vía RPCs `SECURITY DEFINER` |
| 4 | `202609280002_sale_server_totals.sql` | C4: el servidor recalcula precios/totales/tasa; `tenant_rates` |
| 5 | `202609280003_void_stock_roles.sql` | A1: void y ajustes exigen `DUENO`/`ADMIN` |
| 6 | `202609280004_model_hardening.sql` | M7/M10/M11: RAISE en upsert deshabilitado, índices, `updated_at`, RLS en `tenant_rates` |
| 7 | `202609280005_tenant_tax.sql` | M2: `tax_rate` por tenant + `tax_usd` calculado en servidor |
| 8 | `202609280006_rate_broadcast.sql` | M6: `pharmacy_record_rate_all` — `/api/rates` difunde la tasa a todos los tenants |

Todas son idempotentes donde aplica (`IF NOT EXISTS`, `CREATE OR REPLACE`).
El núcleo aborta si detecta objetos legacy en `public`.

## Track archivado: `migrations/legacy/`

Track archivado e inactivo. **No aplicar: el modelo vigente vive en
`supabase/migrations/`.** Ver `migrations/legacy/README.md` (incluye la lista
de hallazgos cerrados por el archivo: A7, A8, A9, M8, M9, M12, M13, M14).

## Aplicar migraciones

Con la CLI de Supabase (requiere service key válida):

```bash
supabase db push --db-url "$DATABASE_URL"
# o aplicar cada archivo en orden desde el SQL editor, en una transacción
```

Antes de aplicar en producción: snapshot (`pg_dump`), aplicar en staging,
correr `tests/` y verificar los criterios del ADR-001.
