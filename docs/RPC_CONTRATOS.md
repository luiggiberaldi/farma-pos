# Contratos de los RPC `pharmacy_*` (cierra C4)

Todos: `SECURITY DEFINER`, `SET search_path = ''`, `REVOKE ALL` + `GRANT EXECUTE`
solo a `service_role`. Sesión vía `verified_operator(p_auth_uid, p_device_id,
p_device_proof_hash, p_token_hash)`; sesión inválida → `NULL` (→ HTTP 401).

## `pharmacy_commit_sale(...)`

Compromete una venta. **El servidor recalcula todo** (C4):

- Precio de cada línea desde `catalogue_items` (el precio del cliente se ignora).
- `line_total_usd = round(qty × precio, 2)`; valida ±0.01 contra el cliente.
- `tax_usd = round(neto × tax_rate, 2)` (M2; `tax_rate` del tenant, default 0).
- `total_usd = neto + impuesto`; valida ±0.01 contra `p_total_usd`.
- Tasa: si hay tasa observada < 24h, `p_rate` debe estar en banda ±5%;
  `total_bs = round(total_usd × rate, 2)` validado ±0.01.
- `business_date` acotada a ±1 día del servidor (M1).
- Stock: `SELECT … FOR UPDATE` en orden determinista; `RAISE` si insuficiente.
- Idempotencia: claim en `operation_receipts` con `UNIQUE (tenant_id, operation_id)`;
  reintento con el mismo `operation_id` devuelve el recibo original.

Rechazos permanentes (el gateway **no** los reintenta): `Sale total mismatch`,
`Bs total mismatch`, `Rate … out of band`, `Insufficient stock`,
`Product … not available`, `business_date fuera de rango permitido`.

## `pharmacy_commit_void(...)`

Anula una venta. Exige rol `DUENO`/`ADMIN` en servidor (A1), si no
`RAISE EXCEPTION 'OPERATION_NOT_AUTHORIZED'` (→ HTTP 403 no reintentable).

## `pharmacy_commit_stock_movement(...)`

Movimiento de inventario. `reason = 'ADJUSTMENT'` exige `DUENO`/`ADMIN` (A1);
`SALE`/`RECEIPT`/`TRANSFER` aceptan cualquier sesión válida de la sede.

## `pharmacy_upsert_catalogue_item(...)`

Alta/edición de catálogo. Solo `DUENO`/`ADMIN`. Si el producto existe pero está
deshabilitado → `RAISE EXCEPTION` (M7, ya no es no-op silencioso).

## `pharmacy_record_rate(p_rate)`

Registra la tasa observada por el tenant (la alimenta `/api/rates`). Es la
referencia para la banda ±5% de `pharmacy_commit_sale`.

## `device_backup_save / device_backup_load / device_backup_delete`

Respaldo por dispositivo (C2). El `device_id` actúa como capacidad: cada
dispositivo solo toca su propia fila; sin acceso directo a la tabla.

## `pharmacy_bootstrap_owner` / `pharmacy_enroll_device`

Arranque administrativo. **No exponer vía HTTP** (B3): solo CLI/consola del
operador con identidad del dueño verificada por un humano.
