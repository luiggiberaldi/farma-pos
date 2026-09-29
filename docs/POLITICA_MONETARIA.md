# Política de redondeo, impuestos y tasa (cierra C4/M2/M3/M6)

## Dinero

- Siempre `numeric` en servidor, nunca float. En cliente, `src/utils/dinero.js`
  (redondeo financiero) e idempotencia de cobro (`operationId` + botón
  deshabilitado).
- Redondeo servidor: `round(x, 2)` por línea y totales, tolerancia explícita
  ±0.01 al comparar contra el cliente (M3).

## Impuestos (M2)

- `pharmacy_tenants.tax_rate` (0–1, default 0). `pharmacy_commit_sale` calcula
  `tax_usd = round(neto × tax_rate, 2)`; `total_usd = neto + impuesto`.
- Con `tax_rate = 0` el comportamiento es idéntico al anterior.
- Con `tax_rate > 0`, el cliente **debe** incluir el impuesto en
  `p_total_usd`/`p_total_bs`; si no cuadra, la venta se rechaza (fail-closed).

## Tasa de cambio (M6)

- Fuente: `/api/rates` (proxy del feed BCV). Banda anti-manipulación ±30%
  contra la última tasa buena + fallback cacheado marcado `stale` + alerta en
  logs.
- En ventas: el servidor exige banda ±5% contra `tenant_rates` (últimas 24h).
  `/api/rates` debe alimentar `pharmacy_record_rate`; sin referencia reciente,
  modo bootstrap permisivo (temporal y documentado).
- UI: la tasa muestra su antigüedad ("hace X h", B7); en ámbar si supera ~5h.
