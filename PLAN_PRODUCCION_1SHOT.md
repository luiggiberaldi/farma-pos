# Plan 1-shot hasta producción — Farma POS

## Actualización 2026-09-15 — Candidato local; producción no autorizada

- El bloqueo JSX inicial está resuelto. El candidato aislado `release-final-01` compila y supera **340/340 pruebas de aplicación**, **18/18 pruebas SQL secuenciales** y **18/18 comprobaciones de navegador**. Lint del candidato: **0 errores / 809 avisos**; árbol completo: **0 errores / 810 avisos**.
- Navegador final `browser-final-01`: escritorio/móvil, vuelto, receta, permisos, recarga, recuperación de inventario, borrador legado y competencia por la última unidad en dos pestañas. Cero errores JavaScript no controlados y cero solicitudes operativas. Reporte y paquetes de revisión en `outputs/production-audit-2026-09-14/`.
- Venta, anulación, FEFO, abono, transferencia, cierre y operaciones administrativas principales usan transacciones IndexedDB, identidad de operación, origen capturado y cola/auditoría. Se probaron venta y reverso en Central, Norte y Sur sin alterar las otras sedes. Los cierres continúan siendo manuales; repetir un cierre no puede cerrar un turno nuevo.
- El vuelto conserva la moneda nativa y compara el reparto en centavos de Bs; no se elimina precisión convirtiendo primero toda la caja a USD. La regla PC-5 antigua de convertir siempre desde USD queda sustituida por este contrato probado.
- Las nuevas migraciones bajo `supabase/migrations/` y el adaptador `api/operator-session.js` son preparación de proyecto nuevo, no una migración desplegada. El cliente todavía no utiliza esa autoridad para operar en nube; faltan bootstrap/enrolamiento reales y RPC/sincronizador operativo revisado.
- **PC-8 permanece abierto:** `REMOTE_OPERATIONS_PAUSED=true`, cola retenida en el equipo, checkout remoto denegado. Faltan integración en Supabase/hosting autorizado, concurrencia real entre dispositivos, copias/restauración externa, SMTP y hardware. No hay commit, push ni publicación.
- F3.5 sigue pendiente del catálogo real de 666 productos. No se importaron ni generaron datos de negocio. Los gates de abajo se conservan como matriz de aceptación, no como afirmación de que todos estén completados.

## Estado de partida histórico

- Aplicación local-first multi-sede con roles Dueño, Admin y Cajero.
- Inventario, ventas, lotes/FEFO, huellas, anulaciones, transferencias, cierres manuales y reportes ya implementados.
- F3.5 permanece bloqueada hasta recibir el JSON real de 666 productos; no se inventarán registros.
- PC-0 (auditoría y contrato headless) está completada.
- PC-1 está en curso y actualmente bloqueada por un error JSX en `src/components/Sales/CheckoutModal.jsx`; no se debe avanzar hasta que el build vuelva a pasar.
- El Preview debe usar un puerto libre; el puerto 5173 no se considera disponible.

## Reglas no negociables

1. Ejecutar las fases en el orden indicado, sin saltar un gate.
2. Cada cambio debe registrarse en `BITACORA.md`.
3. No cambiar la lógica de cierres manuales.
4. No mezclar datos entre sedes: stock, lotes, ventas, caja, cierres y reportes deben conservar scope.
5. Toda venta, movimiento, edición y anulación debe incluir huella completa.
6. No copiar almacenamiento, usuarios, credenciales, dependencias ni bugs del proyecto externo.
7. COP continúa oculto.
8. No aceptar “compila” como validación suficiente: los flujos deben ejecutarse determinísticamente.

## Secuencia de ejecución

### Gate 0 — Higiene y baseline

- Revisar `git diff`, archivos tocados y referencias rotas.
- Confirmar que no existen secretos del proyecto externo.
- Ejecutar la suite actual y guardar resultado base.
- Confirmar que el JSON real de 666 productos no está disponible y dejar F3.5 pendiente.

**Salida:** lista de cambios propios, bloqueos explícitos y baseline reproducible.

### PC-1 — Modelo de estado del checkout

- Reparar el JSX del checkout actual antes de cualquier mejora visual.
- Mantener una única fuente financiera: `FinancialEngine`, `useCheckoutCalculations`, `useCheckoutFlow` y `checkoutProcessor`.
- Verificar transiciones de pagos, cliente, fiado, Cashea, saldo a favor, vuelto, cancelación y doble envío.

**Gate:** build + test determinista del checkout pasan.

### PC-2 — Shell PC responsive

- Aplicar dos columnas solamente en desktop.
- Mantener el flujo móvil existente sin duplicar persistencia ni cálculos.
- Comprobar que el modal no genera scroll horizontal, que cada columna tiene scroll usable y que el CTA permanece accesible.

**Gate:** Preview en un puerto libre, snapshot/screenshot y prueba móvil/desktop.

### PC-3 — Pagos y referencias

- Cubrir USD y Bs según métodos configurados.
- Mantener COP oculto.
- Validar tasa inválida, NaN, negativos, pagos parciales, mixtos, exactos y exceso.
- Validar referencias obligatorias sin perder pagos ya introducidos.

**Gate:** cada caso deja resultado financiero esperado y no persiste ventas inválidas.

### PC-4 — Cliente, crédito, Cashea y saldo

- Consumidor final para ventas pagadas.
- Cliente obligatorio para fiado, Cashea y saldo a favor.
- Cashea solo se activa manualmente y respeta el mínimo configurado.
- Saldo a favor limitado al saldo disponible y al restante.
- Crear y seleccionar cliente no debe alterar pagos no relacionados.

**Gate:** cliente, deuda, saldo y métodos quedan consistentes antes y después de confirmar.

### PC-5 — Vuelto

- Usar USD como magnitud canónica.
- Convertir a Bs solo para presentación y entrega.
- Validar vuelto USD, Bs y mixto, fondo insuficiente, distribución incompleta y confirmación.
- Un doble clic no crea dos ventas ni duplica el vuelto.

**Gate:** suma entregada = vuelto calculado; una sola venta y una sola huella.

### PC-6 — Integración farmacia

- Venta confirmada conserva sede, usuario, cliente, huella y correlativo.
- FEFO descuenta lotes válidos por vencimiento ascendente y omite vencidos.
- Se guarda `lotesConsumidos`.
- Anulación repone exactamente esos lotes y la sede correcta.
- Controlados requieren cliente y dejan registro correspondiente.

**Gate:** invariantes de stock y lotes pasan después de venta, anulación y lote inexistente.

### PC-7 — Aislamiento multi-sede y roles

- Ejecutar los mismos flujos en Central, Norte y Sur.
- Confirmar códigos únicos de sede, usuario y correlativos por sede.
- Confirmar que el cajero solo ve y modifica su sede.
- Confirmar que Dueño/Admin ven los reportes permitidos sin mezclar inventario operativo.
- Cambio de sede exige PIN del Dueño y no cambia el usuario activo.

**Gate:** escrituras en una sede no aparecen en las otras; reportes por sede y consolidado son coherentes.

### PC-8 — Sync y producción

- Verificar local-first con red activa, sin red y reconexión.
- Confirmar que la nube solo sincroniza cuando está configurada y que no se hacen cargas innecesarias.
- Revisar métricas de requests/bytes y errores de sincronización.
- Revisar PWA, branding Farma POS, logos por sede, favicon y rutas de producción.
- Confirmar que no quedan referencias visibles antiguas ni flujo de compartir eliminado.

**Gate:** no hay errores de consola/red, pérdidas de datos ni duplicados tras reconexión.

## Contrato headless determinista

El test final debe ejecutarse sin interfaz y producir logs por sede y por caso. Debe usar datos sintéticos pequeños, nunca inventar el catálogo real de 666 productos.

Matriz mínima:

| Grupo | Casos |
|---|---|
| Pagos | exacto USD, exacto Bs, mixto, parcial, exceso, tasa inválida, NaN, negativo |
| Crédito | sin cliente rechazado, cliente aceptado, deuda actualizada |
| Cashea | desactivado por defecto, activación manual, mínimo, cliente requerido |
| Saldo | límite por saldo disponible y restante, confirmación única |
| Vuelto | USD, Bs, mixto, fondo insuficiente, suma exacta, doble confirmación |
| FEFO | lote más próximo, varios lotes, vencido omitido, sin lotes suficientes |
| Anulación | reposición exacta, lote eliminado, sede preservada, huella propia |
| Auditoría | venta, ajuste, edición, transferencia y anulación con correlativo único |
| Sedes | ejecutar cada caso en Central/Norte/Sur; probar aislamiento cruzado |
| Roles | Dueño consolidado, Admin sede, Cajero sede, cambio de sede con PIN |
| Ciclo de vida | offline, cola, reconexión, recarga, doble envío |

Cada caso debe afirmar estado final, no solo que una función no lanzó error. Los logs deben incluir:
`[sede][caso] resultado`, stock antes/después, lotes antes/después, venta, huella y motivo de rechazo cuando aplique.

## Comandos de validación final

```bash
npm test
npm run build
npm run lint -- --no-warn-ignored
npx eslint <archivos-tocados>
git diff --check
```

El resultado esperado debe distinguir fallos preexistentes de fallos introducidos. No se marca producción lista si el build falla, si hay errores ESLint nuevos, si el test final no cubre las tres sedes o si el Preview muestra errores.

## Entrega

Antes de declarar listo:

1. Registrar cada fase y su resultado en `BITACORA.md`.
2. Actualizar el plan con completadas y pendientes.
3. Entregar el JSON real de 666 productos para desbloquear F3.5.
4. Configurar variables Supabase de producción fuera del repositorio.
5. Hacer una última prueba de venta y anulación en cada sede con datos QA aislados.
6. Generar backup/exportación y documentar procedimiento de recuperación.
7. Publicar solo después de todos los gates verdes.
