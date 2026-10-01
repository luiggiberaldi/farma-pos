# ADR-003 — Sincronización bidireccional multi-equipo (camino 2)

- **Estado:** propuesto (implementación en curso)
- **Fecha:** 2026-09-30
- **Supersede:** levanta el modo contención de ADR-001 por decisión explícita del dueño
  (2026-09-30: "crea el camino 2"). ADR-001 queda como referencia histórica.
- **Flag:** `REMOTE_OPERATIONS_PAUSED` en `src/config/operationSafety.js`

## Contexto

El dueño exige: **todo equipo que abra la cuenta debe ver la misma cantidad de
artículos y la misma información**. Hoy cada equipo es una isla: productos se
siembran localmente por equipo, ventas/caja/clientes/deudas nunca salen del
dispositivo. ADR-001 pausó el sync por falta de contrato servidor confiable.

## Decisión

Activar la sincronización bidireccional sobre la infraestructura ya construida
(`useCloudSync` + `public.sync_documents`), adaptada al tier gratis de Supabase.
El track de RPCs operacionales (`/api/business-operation` → `pharmacy_commit_*`)
**sigue pausado**: es para una fase posterior de ventas server-authoritative y no
es necesario para cumplir el requisito.

## Arquitectura

Un documento por (cuenta, [sede], entidad) en `public.sync_documents`:

| Entidad | Alcance | Resolución de conflictos |
|---|---|---|
| Productos (`bodega_products_v1`) | por sede | **La nube es autoritativa**: último documento gana |
| Ventas (`bodega_sales_v1`) | por sede | Merge por ID (append-only; las ventas no se editan) |
| Clientes (`bodega_customers_v1`) | por sede | Merge por ID |
| Cuentas/deudas (`bodega_accounts_v2`) | por sede | Merge por ID |
| Cierres, métodos de pago, lotes, caja, correlativos, proveedores | por sede | Merge por ID o LWW según llave |
| Config, tasas, categorías, transferencias | por cuenta | LWW por timestamp + protección anti-sobreescritura |

Flujo: pull inicial al abrir sesión → catch-up push de lo local no subido →
push con debounce ante cambios → poll horario + flush al ocultar la pestaña.

## Adaptaciones al tier gratis de Supabase

Auditoría de documentación oficial completada el 2026-09-30 (reporte en
`/tmp/audit_report.md`; fuentes: supabase.com/pricing y supabase.com/docs).
Números vigentes verificados hoy:

- DB 500 MB/proyecto · Egress 5 GB no-cacheado + 5 GB cacheado · MAU 50.000 ·
  Realtime 200 conexiones / 2 M mensajes · Edge 500 K invocaciones/mes ·
  Storage 1 GB · 2 proyectos activos máx.
- API REST: "Unlimited API requests" (sin límite numérico oficial).
- **Sin backups automáticos en Free** y **pausa por 1 semana de inactividad**.

Adaptaciones aplicadas:

- **Sin Realtime**: polling horario + pull al abrir. Evita conexiones y mensajes.
- **Debounce**: 3 s para cambios ligeros, 30 min para llaves pesadas (ventas).
- **Hash-skip**: no se re-sube un documento sin cambios reales.
- **Payloads**: máximo 1 MiB por documento, aviso a 250 KiB.
- **Ventas**: el documento en nube lleva ventana de 30 días (`SALES_SYNC_WINDOW_DAYS`);
  el historial completo permanece en cada equipo y en backups cifrados.
- **Un solo proyecto** para las 3 sedes; sin Edge Functions en el camino crítico.
- **Backups**: se conserva la exportación cifrada local (ya existe) como red ante
  la falta de backups automáticos; se recomienda Pro ($25/mes) si el cliente lo aprueba.
- **Pausa por inactividad**: el poll horario y la operación diaria mantienen el
  proyecto activo; una semana cerrada requeriría restauración manual desde el dashboard.

Estimación de consumo (3 sedes, ~6 equipos):
- DB: documentos ≈ 3 sedes × ~1.2 MB + config ≈ **< 10 MB** (límite 500 MB).
- Egress: pulls iniciales + deltas ≈ **< 100 MB/mes** (límite 5 GB).
- API: polls horarios + pushes con debounce: sin límite numérico oficial; órdenes
  de magnitud por debajo de cualquier fair-use.

## Límites conocidos y aceptados

1. Equipos nuevos ven ventas de los últimos 30 días, no el historial completo.
2. Ediciones concurrentes del mismo producto: gana el último push (sin merge a nivel campo).
3. El track `pharmacy_commit_*` (totales recalculados en servidor) sigue pausado;
   la venta se registra local primero y se replica como documento.
4. Rotación de credenciales sigue diferida por decisión del dueño (2026-09-29).

## Criterios de salida de ADR-001 (estado)

1. ✅ Migraciones `20260928*` aplicadas y verificadas.
2. ⏭️ `pharmacy_commit_sale` E2E — diferido (track pausado, no bloquea camino 2).
3. ⏭️ `pharmacy_commit_void` 403 a CAJERO — diferido con el track.
4. ✅ `/api/rates` alimenta tasas (verificado en producción).
5. ⏸️ Rotación de credencial — diferida por el dueño.
6. ⏭️ Runbook de incidentes — pendiente, no bloquea.
