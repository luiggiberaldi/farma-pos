# Plan Maestro de Fixeo — Auditoría de debugging 2026-10-01

**Origen:** auditoría de debugging completa de todos los flujos y modales (2026-10-01).
**Objetivo:** eliminar los bugs de runtime encontrados y dejar guardarraíles para que esa clase de defectos no vuelva.
**Estado al cierre de la auditoría:** suite 612/612 verde, build PWA verde, producción estable.

---

## 1. Fases de ejecución (orden obligatorio)

### Fase 1 — Críticos (~1 h 15)
- **C1.** `TicketClientModal.jsx`: mover `useEscapeToClose` antes del `if (!ticketPendingSale) return null`. + test de regresión (render con y sin ticket, estilo `tests/loginWhiteScreen.test.mjs`).
- **C2.** `App.jsx`: envolver el árbol completo —incluida la zona pre-login (líneas ~436-505)— en `ErrorBoundary` con fallback seguro. Verificar que el fallback no dependa de contexto que pueda estar roto.

### Fase 2 — Altos (~25 min)
- **A1.** `ErrorBoundary.jsx`: eliminar el `removeItem('bodega_accounts_v2')` del botón de recuperación; dejar solo la recarga. La recuperación de errores jamás borra datos del usuario.
- **A2.** `ProductContext.jsx:169`: envolver el `JSON.parse(localStorage.getItem('bodega_use_auto_rate'))` en try/catch con default `'bcv'` + test.

### Fase 3 — Medios, parte 1 (~50 min)
- **M1.** Mover `AccordionSection` fuera del render en `DashboardPaymentSection.jsx` y `PaymentBreakdown.jsx` (Reports). Verificar que los acordeones conservan estado/foco.
- **M2.** `ProductPhoto.jsx`: reemplazar `setState` sincrónico en `useEffect` por lazy init en `useState`.

### Fase 4 — Medios, parte 2 (~2 h)
- **M3.** Guards en los puntos más expuestos: `BulkPriceAdjustModal` (`products.length`), `ProductShareModal` (`accounts.some`), `useCheckoutPayments` (`customers.find`), `TransactionModal` (guard antes de leer `isOpen`), `DiscountModal` (`cartSubtotalUsd.toFixed`). Principio: ningún render debe lanzar por un prop ausente.

### Fase 5 — Bajos + cobertura (~1 h 10)
- Bajos: claves duplicadas en `useConfirm.jsx`, `if (!usuarioActivo)` duplicado en `App.jsx`, `Date.now()` en render de `SalesHeader.jsx`.
- Tests de render (react-dom/server, patrón `loginWhiteScreen`) para los modales sin cobertura: `AperturaCajaModal`, `CashReconciliationModal`, `CheckoutModal`, `ReceiptModal`, `MobileCartSheet`, `MonitorView`, `DeleteHistoryModal`, `RecycleSaleModal` y los gates pre-login de `App.jsx`.

### Fase 6 — Cierre (~30 min)
- Suite completa verde. Build PWA verde. Push. Deploy a producción con verificación de marcador en bundle + `/api/rates` → 200.

---

## 2. Guardarraíles (obligatorios durante todo el fixeo)

1. **Datos QA intocables.** No borrar ni modificar ventas, cierres, clientes, deudas, productos de prueba ni estaciones (ver Anexo C).
2. **Solo fixes, sin refactors oportunistas.** No se cambia comportamiento de negocio; no se agregan features.
3. **PIN del dueño se mantiene en `000000`.** Ningún fix lo toca.
4. **Cada fix lleva test de regresión** verificado por mutación: el test debe fallar sin el fix y pasar con él.
5. **Suite 100% verde antes de cada commit.** Build PWA verde antes del deploy.
6. **Un commit por fase**, mensajes claros en español o inglés técnico consistente con el historial.
7. **Push** con `python3 ~/workspace/push-farma-pos/push_via_api.py` (no hay git link en Vercel; el push no dispara deploy).
8. **Deploy manual:** `cd ~/workspace/farma-pos && VERCEL_TOKEN=$(grep '^VERCEL_TOKEN=' .env | cut -d= -f2) && npx -y vercel@latest --prod --token="$VERCEL_TOKEN" --yes --name farma-pos`. Después: verificar un marcador único del cambio en el bundle JS de https://farma-pos.vercel.app/ y `/api/rates` → 200.
9. **Secretos:** nunca commitear `.env`; nunca mostrar credenciales.
10. **Reporte final único** al terminar (ver §4). Preguntar al usuario solo si algo bloquea de verdad.

---

## 3. Anexos

### Anexo A — Detalle de hallazgos

| ID | Severidad | Archivo | Problema | Reproducción | Impacto | Fix |
|---|---|---|---|---|---|---|
| C1 | Crítica | `src/components/Dashboard/TicketClientModal.jsx:6-7` | Hook después de early return | Dashboard → venta → "enviar ticket" | El dashboard cae al fallback "Error de Carga" | Mover `useEscapeToClose` antes del return |
| C2 | Crítica | `src/App.jsx:436-505` (boundary solo en 529-572) | Pre-login fuera del ErrorBoundary | Cualquier throw en login/PIN/sede/bloqueo/Supervisión | Pantalla blanca total | Envolver árbol completo |
| A1 | Alta | `src/components/ErrorBoundary.jsx:~37` | "Limpiar y Recargar" borra `bodega_accounts_v2` | Crash → pulsar el botón | Borra cuentas de pago sin reparar nada | Quitar el `removeItem` |
| A2 | Alta | `src/context/ProductContext.jsx:169` | `JSON.parse` sin try/catch en `useState` inicial | Valor corrupto en localStorage | Pantalla blanca (fuera del boundary) | try/catch, default `'bcv'` |
| M1 | Media | `DashboardPaymentSection.jsx:96`, `Reports/PaymentBreakdown.jsx` | Componentes creados dentro del render (8×) | Cada render remonta acordeones | Pierden estado/foco; trampa futura | Moverlos fuera del padre |
| M2 | Media | `src/components/Products/ProductPhoto.jsx:18` | `setState` sincrónico en `useEffect` | Cada tarjeta con foto | Renders en cascada; loop potencial | Lazy init en `useState` |
| M3 | Media | 6-8 puntos (ver Fase 4) | Accesos sin guards asumiendo props definidos | Hoy no crashea (padres los pasan) | Misma fragilidad que el bug de ayer | Guards defensivos |
| B1 | Baja | `src/hooks/useConfirm.jsx:14-15` | Claves `danger`/`warning` duplicadas | — | Sin efecto, ruido | Eliminar duplicada |
| B2 | Baja | `src/App.jsx:460` | `if (!usuarioActivo)` duplicado | — | Dead code | Eliminar |
| B3 | Baja | `src/components/Sales/SalesHeader.jsx:49` | `Date.now()` en render | — | Impureza visual | Memoizar o mover |

### Anexo B — Flujos sin cobertura de render (tests a crear en Fase 5)
`AperturaCajaModal`, `CashReconciliationModal`, `CheckoutModal`, `ReceiptModal`, `MobileCartSheet`, `MonitorView`, `DeleteHistoryModal`, `RecycleSaleModal`, gates pre-login de `App.jsx`.
Ya cubiertos: `LoginPinModal`, `BranchPinModal`, `SedeName`, `SuperAdminModal`.

### Anexo C — Datos QA protegidos (no tocar)
- Central: caja abierta, `$14.87 · 10 ventas`, ~45 operaciones pendientes.
- Ventas `#11FA96`, `#CD9DF9`, `#644941`, `#F2F4E9`, Cashea `#F2C166/#0000018`.
- `QA Test Producto` (stock 95), `QA Test Producto 2` (`7590000000021`), `QA Test Producto 3`, lote `QA-LOT-001` (vence 31/12/2026).
- Norte y sur: cajas abiertas, 30 productos de prueba.
- Estación `QA-TEST` enrolada, caja abierta en norte.
- Cliente `Cliente Prueba QA`.

### Anexo D — Checklist pre-deploy
- [ ] Suite completa verde (conteo anotado).
- [ ] Build PWA verde (sin errores nuevos).
- [ ] Push verificado (SHA local = remoto).
- [ ] Deploy en producción con marcador único del cambio en el bundle.
- [ ] `https://farma-pos.vercel.app/` responde 200.
- [ ] `/api/rates` responde 200.
- [ ] Ningún dato QA modificado.

---

## 4. Reporte final (al terminar la Fase 6)
Un solo reporte con: qué se corrigió por fase, tests agregados (con verificación por mutación), conteo final de la suite, commits, bundle verificado en producción, y límites honestos que queden pendientes.
