# Plan de fixeo completo — Farma POS (2026-09-29) — ✅ EJECUTADO (commit `8afcd97`)

## Decisiones vigentes
- **Una sola caja por sede** (confirmado 2026-09-29; un cajero por sede).
- PINs de fábrica `0000`/`000000` se mantienen, con advertencia persistente y cambio voluntario.
- Solo roles `DUENO` y `CAJERO`; eliminar referencias remanentes a `ADMIN`.
- Monitor: Supabase Realtime con polling fallback cada 10–15 s.

## Fase A — Hallazgos medios/bajos del audit auth/sede
- **A1.** `DashboardPaymentSection`: pasar `copEnabled` desde `DashboardView.jsx` (línea ~509). Hoy la condición `copEnabled && ...` siempre es falsy y los métodos COP nunca se muestran en el desglose del dashboard aunque estén habilitados.
- **A2.** Eliminar referencias remanentes a `ADMIN` (~13 archivos): `src/config/permissionsFarmacia.js`, `src/hooks/store/useAuthStore.js`, `src/components/Sales/DiscountModal.jsx`, `src/components/security/LockScreen.jsx`, `src/components/security/LoginPinModal.jsx`, `src/components/security/UserCard.jsx`, `src/components/Settings/UsersManager.jsx`, `src/App.jsx`, `src/components/Dashboard/DashboardHeader.jsx`, `src/config/sedes.js`, `src/components/Settings/SupabaseFreeStatus.jsx`. Verificar que ningún flujo dependa del rol antes de remover.
- **A3.** `useSedeStats`: agregar polling de 10–15 s para que el monitor en vivo del dueño se refresque solo (hoy solo se recalcula cuando cambian `sales`/`bcvRate`).
- **A4.** `BranchPinModal`: mensaje preciso cuando el dueño existe pero no tiene PIN configurado (hoy muestra "No se encontró el Dueño").

## Fase B — Una sola caja por sede
- **B1.** Exclusividad de apertura: una sola sesión de caja abierta por sede a la vez. La apertura ya es idempotente en local; verificar el caso de dos dispositivos en la misma sede (¿se necesita bloqueo visible en nube o basta con el local?).
- **B2.** UI: si la sede ya tiene caja abierta, impedir u ocultar una segunda apertura; el cierre opera sobre la sesión abierta de la sede.
- **B3.** Revisar flujos que asuman múltiples cajas simultáneas (si existen) y ajustarlos a una sola.

## Fase C — Re-auditoría de sincronización (completada 2026-09-29)
Sin críticos. El diseño de sync es sólido y está correctamente pausado por ADR-001 (las ventas nunca salen del dispositivo por decisión de contención, no por bug).
- **C1 (medio).** `src/utils/dailyClose/generateDailyClosePDF.js`: el PDF de cierre 80mm no pagina (`addPage` = 0); en días movidos el contenido se recorta. La variante carta sí pagina. → Agregar paginación.
- **C2 (medio).** `src/hooks/useRates.js`: el flag `stale` de `/api/rates` no se propaga al estado; el indicador ámbar queda dependiendo solo del umbral de edad (>5h). Si la tasa es stale pero tiene <5h, el cajero no ve la advertencia. → Propagar `stale`.
- **C3 (medio, alcance mayor).** No hay monitor de ventas en vivo entre dispositivos: `MonitorView` solo muestra tasas y `useSedeStats` no tiene polling. Mitigación inmediata: polling 10–15 s en `useSedeStats` (Fase A3). El monitor en vivo real queda para cuando se reactive el sync + input del cliente (móvil vs pantalla fija).
- **C4 (bajo).** `generateDailyClosePDF.js` duplica `getLocalISODate`; importar desde `src/utils/dateHelpers.js`.
- **C5 (bajo).** Umbrales de "tasa vieja" inconsistentes: `SalesHeader` >5 h vs `MonitorView` >4 h. Unificar en 5 h.
- **C6 (bajo).** `voidSaleProcessor.js:15` referencia `ADMIN`; incluir en la limpieza de Fase A2.

## Fase D — Verificación y cierre
- **D1.** `vite build` en verde + suite 479/479 en verde.
- **D2.** Pruebas manuales pendientes: cobro mixto con vuelto (USD+Bs, Cashea, fiado), cambio de sede con PIN del dueño, apertura/cierre de caja punta a punta, recorrido responsive (DUENO móvil, CAJERO laptop ≥1024 px).
- **D3.** Commit final con todos los fixes.

## Pendiente del usuario (no bloquea este plan)
- Revocar el token Vercel expuesto en el chat.
- Rotar la secret key de Supabase expuesta; actualizar `SUPABASE_SERVICE_ROLE_KEY` en Vercel y redesplegar/verificar.
- Rotar la contraseña expuesta en el historial git y hacer force-push del historial reescrito.
- Crear tenant/sede/dueño reales con `pharmacy_bootstrap_owner` cuando vaya a operar.
- Definir si el monitor del dueño será solo móvil o también pantalla fija.

## Bug crítico post-QA 2026-09-30: crash Vender/Inventario (resuelto)
- **Causa raíz Vender**: `ReferenceError: bcvRate is not defined` en `src/views/SalesView.jsx:392`. El refactor `def3776` introdujo una referencia a `bcvRate` sin definirla en la llamada a `useCheckout`. Es el 8vo bug de la misma clase que los 7 corregidos en `f0aa79b` (esbuild no valida identificadores no resueltos y la suite no cubre ese hook). Fix: `bcvRate: effectiveRate` (commit `5196a2c`).
- **Inventario**: `ProductsView.jsx:470` hacía `rates.bcv` sin guardia; `useRates()` devolvía `null` en instalación fresca o si el fetch fallaba. Fix doble: guardia en el spread (commit `6db0c66`) + `useRates` ahora nunca devuelve null (fallback a `DEFAULT_RATES`, commit `9f4ce5e`).
- **ErrorBoundary**: ahora muestra mensaje + stack real en `<details>` colapsable para diagnóstico en producción (commit `6db0c66`).
- **Overlays**: `TermsOverlay` (z-9999) tapaba el botón Omitir de `OnboardingOverlay` (z-9998). Ahora el tutorial solo se monta tras aceptar términos (commit `6db0c66`).
- Lección: añadir a la suite una prueba que monte SalesView y ProductsView para detectar ReferenceErrors en render.
