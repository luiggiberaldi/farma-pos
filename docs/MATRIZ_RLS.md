# Matriz RLS (cierra A2)

Esquema `app_private`: **RLS habilitado en todas las tablas, cero policies
permisivas**. `REVOKE ALL` incluso a `service_role`; el esquema no se expone
en PostgREST. Acceso directo: denegado para `anon`, `authenticated`, `PUBLIC`
y `service_role`.

| Tabla | Acceso directo | Vía |
|---|---|---|
| `pharmacy_tenants`, `branches`, `operators`, `devices` | denegado | RPCs `SECURITY DEFINER` |
| `operator_sessions`, `pin_attempts` | denegado | `verified_operator()` interno |
| `catalogue_items`, `branch_stock` | denegado | `pharmacy_commit_*`, `pharmacy_upsert_catalogue_item` |
| `sales`, `sale_items`, `stock_movements` | denegado | `pharmacy_commit_sale/void/stock_movement` |
| `operation_receipts` | denegado | claim de idempotencia dentro de los RPCs |
| `tenant_rates` | denegado (RLS sin policies, mig. `202609280004`) | `pharmacy_record_rate`, lectura en `pharmacy_commit_sale` |
| `device_backups` | denegado (mig. `202609280001`) | `device_backup_save/load/delete` (capacidad por `device_id`) |

Todas las funciones: `SECURITY DEFINER`, `SET search_path = ''`,
`REVOKE ALL … FROM PUBLIC, anon, authenticated` + `GRANT EXECUTE` solo a
`service_role`. El `device_id` en backups actúa como capacidad, no como secreto.
