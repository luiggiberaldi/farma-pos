# Contrato de autorización de escritura (cierra A1/A2)

Matriz rol × operación y **dónde** se enforcea cada permiso. Fuente de verdad:
el servidor (PostgreSQL). El cliente solo refleja permisos para UX; nunca
decide.

## Roles

| Rol | Alcance |
|---|---|
| `DUENO` | Todo: catálogo, ventas, anulaciones, ajustes de stock, usuarios, respaldo |
| `ADMIN` | Igual que dueño salvo gestión del dueño (id 1) |
| `CAJERO` | Vender y cobrar en su sede; sin anulaciones, sin ajustes, sin catálogo |

## Matriz (enforceada en servidor)

| Operación | RPC | DUENO | ADMIN | CAJERO | Dónde se enforcea |
|---|---|---|---|---|---|
| Vender | `pharmacy_commit_sale` | ✅ | ✅ | ✅ (su sede) | `verified_operator` + branch de la sesión |
| Anular venta | `pharmacy_commit_void` | ✅ | ✅ | ❌ | `v_session.role NOT IN ('DUENO','ADMIN') → EXCEPTION` (mig. `202609280003`) |
| Ajuste de stock (`ADJUSTMENT`) | `pharmacy_commit_stock_movement` | ✅ | ✅ | ❌ | Idem (mig. `202609280003`) |
| Movimiento normal (`SALE`/`RECEIPT`/`TRANSFER`) | `pharmacy_commit_stock_movement` | ✅ | ✅ | ✅ | `verified_operator` |
| Alta/edición de catálogo | `pharmacy_upsert_catalogue_item` | ✅ | ✅ | ❌ | `RETURN NULL` si rol no autorizado (mig. `202609150001` + `202609280004`) |
| Registrar tasa observada | `pharmacy_record_rate` | ✅ | ✅ | ✅ | cualquier sesión válida (dato de mercado) |
| Backups de dispositivo | `device_backup_save/load/delete` | ✅ | ✅ | ✅ | capacidad: `device_id` (ver C2) |

## Modelo de amenaza asumido (A2)

La sesión local (`localStorage`) y el rol en el store de Zustand **se asumen
forjables** con devtools en un POS físico. Por eso:

1. Ninguna decisión de autorización vive solo en el cliente.
2. Al reactivar el sync, cada escritura pasa por `verified_operator`
   (sesión + prueba de dispositivo + hash de token, todo verificado en SQL).
3. El esquema `app_private` es deny-by-default: RLS habilitado sin policies
   permisivas, `REVOKE ALL` incluso a `service_role`; el acceso es solo vía
   funciones `SECURITY DEFINER` con `SET search_path = ''`.
4. La lista local de usuarios lleva verificación de integridad oportunista
   (migración de PIN a PBKDF2 con salt por usuario, ver A3).

## Rechazos

- Sesión inválida → el RPC retorna `NULL` → el gateway responde `401`.
- Rol insuficiente → `RAISE EXCEPTION 'OPERATION_NOT_AUTHORIZED'` → el gateway
  responde `403` **no reintentable** (no se reintenta un rechazo permanente).
