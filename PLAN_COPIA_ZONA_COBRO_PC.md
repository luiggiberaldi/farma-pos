# Plan de implementación — Checkout PC completo para Farma POS

## Objetivo

Estudiar integralmente el módulo `src/components/Sales/CheckoutModalPOS/` de `preciosaldia-bodega` y portar a Farma POS una zona de cobro para PC **100% funcional**, no solo una copia visual. La implementación debe conservar las reglas financieras, de seguridad, sede, FEFO, huellas y cierres de Farma POS.

“Copiar toda la lógica” significa cubrir el comportamiento observable del módulo origen —estado, interacción, validaciones, métodos, referencias, cliente, crédito, Cashea, vuelto, teclado y confirmación— pero adaptado a los contratos y datos reales de Farma POS. No se copiarán credenciales, backups, datos ni nombres internos que puedan mezclar proyectos.

## Auditoría del módulo origen

El checkout de PC del proyecto origen está compuesto por:

- `CheckoutModalPOS/index.jsx`: orquestación del flujo, estado de modo, cliente, pagos, Cashea, vuelto, caja y confirmación.
- `hooks/usePaymentState.js`: estado de pagos, referencias, cliente, input activo y navegación entre campos.
- `hooks/usePaymentCalculations.js`: totales pagados, restante, vuelto, Cashea y equivalencias.
- `hooks/useClientWallet.js`: saldo a favor y proyección de cartera.
- `components/PaymentHeader.jsx`: encabezado, modo y cierre.
- `components/PaymentLeftColumn.jsx`: resumen, cliente, estado, Cashea y vuelto.
- `components/PaymentInputs.jsx`: captura de métodos y referencias.
- `components/PaymentFooter.jsx`: validación y acción principal.
- `components/ChangeConfirmationModal.jsx`: confirmación explícita de la distribución del vuelto.
- `components/WalletSection.jsx`: aplicación de saldo a favor.
- `components/TransactionSummary.jsx`: total y equivalentes.

El origen también contiene lógica repetida entre checkout básico y POS. La auditoría externa identificó riesgos concretos que no se deben portar sin corrección: doble conteo de vuelto USD/Bs, saldo a favor sin tope, autorrelleno incorrecto con Cashea, activación automática de Cashea, divergencia de cálculos entre modos y campos de payload ignorados.

## Contratos que deben permanecer en Farma POS

- `FinancialEngine` y `checkoutProcessor` son la fuente financiera.
- El checkout debe enviar pagos y opciones al contrato existente, sin persistir directamente ventas.
- La venta debe conservar `sedeId`, usuario y huella obligatoria.
- El procesador debe registrar `lotesConsumidos` al usar FEFO.
- La anulación debe reponer esos lotes exactos.
- COP continúa oculto.
- El cierre de caja sigue siendo manual por turno.
- Cada sede conserva sus ventas, stock, lotes y reportes aislados.
- No se permite doble envío ni doble descuento de stock.

## Fases en orden

### PC-0 — Inventario funcional y baseline ✅

La auditoría funcional ya identificó la composición completa del checkout POS origen, su contrato con `SalesView` y sus riesgos conocidos. La matriz ejecutable inicial queda cubierta por `tests/checkoutFlows.test.mjs` y será ampliada con cada integración.



Crear una matriz de paridad entre origen y Farma POS: cada estado, callback, campo de entrada, validación y salida observable. Ejecutar el checkout actual en desktop y registrar los estados de pago exacto, pendiente, mixto, vuelto, crédito, cliente, error de tasa y cierre.

**Salida:** contrato de props y matriz aprobada antes de editar producción.

### PC-1 — Modelo de estado adaptado

Portar el modelo de interacción del POS origen usando el estado local de Farma POS. No portar cálculos duplicados: cada valor visual debe derivar de `FinancialEngine`/hooks existentes. Separar claramente estado de presentación y datos financieros.

**Salida:** cliente, pagos, referencias, modo, vuelto y cierre del modal tienen transiciones deterministas.

### PC-2 — Shell de escritorio

Implementar el layout de dos columnas únicamente para pantallas amplias. Reutilizar el modal actual para móvil o mantener una ruta responsive explícita. Añadir encabezado, scroll único, CTA y soporte de teclado sin cubrir campos.

**Salida:** el checkout funciona en PC sin scroll horizontal ni regresión móvil.

### PC-3 — Métodos de pago y referencias

Portar la organización visual y la navegación del origen para USD y Bs. COP no se muestra. Mantener métodos configurables, referencias obligatorias, completar saldo y pagos combinados.

**Guards:** tasa inválida bloquea; NaN y montos negativos bloquean; completar saldo descuenta Cashea y saldo a favor; los valores no visibles no se pierden.

### PC-4 — Cliente, crédito, Cashea y saldo a favor

Portar la experiencia de selección de cliente y sus estados. Mantener las reglas de Farma POS: cliente obligatorio para crédito, Cashea y saldo a favor; Cashea no se activa automáticamente; el saldo a favor no puede exceder el saldo disponible ni el monto pendiente.

**Salida:** cambiar cliente reinicia únicamente estados dependientes y nunca pisa cartera ni pagos ajenos.

### PC-5 — Vuelto progresivo

Portar el resumen y la confirmación explícita del vuelto. Usar una única magnitud canónica en USD y convertir a Bs para mostrar. La suma de vuelto físico, saldo a favor y caja debe coincidir exactamente con el vuelto real.

**Guards:** sin doble conteo USD/Bs; distribución incompleta bloquea; entregar todo funciona; caja y billetera requieren intención explícita; la venta no se escribe antes de confirmar.

### PC-6 — Integración de venta, FEFO y huellas

Conectar el layout al `useCheckoutFlow` y `checkoutProcessor` actual. Verificar que una venta confirmada conserve sede, usuario, correlativo, huella, `lotesConsumidos` y datos del cliente. No implementar una segunda persistencia.

**Salida:** venta normal, venta mixta, lote FEFO y anulación mantienen sus invariantes.

### PC-7 — Pruebas adversariales

Ejercitar el flujo real en Preview y con pruebas headless: pago exacto, parcial, combinado, exceso, tasa inválida, cliente requerido, Cashea manual, saldo a favor, vuelto en USD, vuelto en Bs, mixto, caja, billetera, doble clic, cierre, cambio de usuario/sede y desconexión.

**Salida:** cada estado tiene aserciones sobre el resultado financiero, no solo sobre el render.

### PC-8 — Validación de entrega

Ejecutar `npm test`, `npm run build`, ESLint de todos los archivos tocados y `git diff --check`. Revisar consola y red en Preview. Registrar paridad, defectos corregidos y pendientes en `BITACORA.md`.

## Reglas de no regresión

- No cambiar `checkoutProcessor` salvo para integrar un campo que el checkout necesite y que esté cubierto por prueba.
- No copiar el bug conocido del origen.
- No copiar soporte COP visible.
- No copiar lógica de cierres automáticos.
- No copiar almacenamiento o usuarios del proyecto externo.
- No usar `.env` del proyecto externo.
- No duplicar cálculos financieros.
- No considerar terminada la fase por compilar: cada flujo debe ejecutarse y asertar su estado final.

## Criterios finales de aceptación

1. El flujo de PC reproduce las capacidades observables del módulo origen.
2. El resultado financiero coincide con el procesador de Farma POS.
3. No existe doble conteo de vuelto.
4. No se acredita saldo a favor sin confirmación.
5. FEFO registra y repone lotes correctamente.
6. La huella identifica usuario, sede, cliente, fecha, hora y correlativo.
7. Los cajeros no acceden a funciones de gestión.
8. Ventas y reportes permanecen aislados por sede.
9. Móvil y escritorio funcionan en sus breakpoints.
10. Tests, build, lint y diff-check pasan.

## Siguiente paso

Ejecutar PC-1: implementar el shell de escritorio en Farma POS y conectar progresivamente sus componentes al contrato existente, sin duplicar cálculos ni persistencia.
