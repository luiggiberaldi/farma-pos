# ADR-002 — Plan de división de componentes gigantes (B5, evaluado)

- **Estado:** evaluado, ejecución diferida
- **Fecha:** 2026-09-28

## Contexto

Cuatro componentes superan las 950 líneas y mezclan responsabilidades
(datos, UI, modales). B5 es prioridad **baja** en la auditoría.

| Componente | Líneas | Responsabilidades mezcladas |
|---|---|---|
| `DashboardView.jsx` | 1544 | KPIs, gráficas, navegación, install prompt, tema |
| `CheckoutModal.jsx` | 1173 | cobro, vueltos, métodos de pago, validación |
| `ProductsView.jsx` | 1153 | catálogo, importación, búsqueda, edición |
| `CustomersView.jsx` | 1054 | lista, modales add/edit (ya hay subcomponentes en el mismo archivo) |

## Decisión

**No dividir a ciegas en esta fase.** Un split mecánico de JSX sin pruebas de
regresión visual tiene más probabilidad de romper la UI que de ayudar, y los
tests existentes cubren lógica, no render. La división se hará por
responsabilidades seguras, en este orden:

1. Extraer helpers puros (formato, cálculos) a `src/utils/` — riesgo cero.
2. Extraer subcomponentes presentacionales ya delimitados (p. ej. los modales
   de `CustomersView`, líneas 896-1054) a archivos propios — props explícitas.
3. `CheckoutModal`: separar `PaymentMethodPicker`, `ChangeCalculator` y
   `ReceiptPreview`; la validación de cobro ya tiene tests
   (`changeValidation.test.mjs`) como red de seguridad.
4. `DashboardView` último: extraer `KpiGrid`, `SalesChart`, `StockAlerts` solo
   con una pasada visual en móvil + escritorio.

## Verificación requerida antes de mergear cada extracción

- `vite build` en verde.
- Recorrido manual de la vista afectada (móvil y escritorio).
- Sin cambios de comportamiento: solo movimiento de código.
