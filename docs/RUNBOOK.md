# Runbook de incidentes

## Rotar `service_role` (key comprometida)

1. En el dashboard de Supabase: generar nueva `service_role`, revocar la anterior.
2. Actualizar `SUPABASE_SERVICE_ROLE_KEY` en Vercel, `wrangler secret` y QA local.
3. Redesplegar. Verificar `/api/operator-session` (health) y un commit de prueba.
4. Las sesiones de operador (`operator_sessions`) siguen válidas (no dependen
   de la key); si la exposición fue amplia, revocarlas: `UPDATE
   app_private.operator_sessions SET revoked_at = clock_timestamp()`.

## Revocar sesión / dispositivo

- Sesión: `pharmacy_revoke_operator_session` o `revoked_at` manual.
- Dispositivo perdido: revocar sus sesiones y rotar su `device_proof`
  (re-enroll con `pharmacy_enroll_device`, solo vía administrativa, B3).
- Tras revocar, el equipo queda fuera en ≤15 min (TTL de sesión).

## Reprocesar por `operation_id`

Toda escritura de negocio es idempotente por `(tenant_id, operation_id)`:
reenviar el mismo payload devuelve el recibo original sin duplicar. Para
reconciliar: listar `operation_receipts` por `business_date` y comparar contra
la cola local.

## Caída del feed de tasa

`/api/rates` sirve la última tasa buena marcada `stale` si el feed falla o
salta > ±30% (M6). En ventas, la banda servidor es ±5% contra
`tenant_rates`; sin tasa reciente el servidor opera en modo bootstrap
permisivo (documentado en la migración `202609280002`).

## Pérdida de equipo (modo contención)

Sin sync, no hay recuperación remota: restaurar desde el **respaldo cifrado**
más reciente del dueño (Ajustes → Sistema → Exportar respaldo cifrado).
Sin respaldo, las ventas se pierden: es el riesgo aceptado del ADR-001.
