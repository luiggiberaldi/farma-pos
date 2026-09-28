# Roadmap hasta producción — Farma POS

> Estado al 2026-09-15. Cada fase solo se cierra con evidencia reproducible. La operación remota permanece bloqueada por `REMOTE_OPERATIONS_PAUSED=true` hasta que la fase 4 esté verificada. No se contrata ningún plan de pago: se mantiene Supabase Free.

## Regla de avance

Una fase pasa a **completada** solo si: build correcto, pruebas de la fase en verde, lint sin errores nuevos, y evidencia guardada en `outputs/`. Si una fase depende de credenciales, catálogo o hardware que no están disponibles, se marca **bloqueada** con el motivo exacto y se continúa con la siguiente fase que no dependa de ella.

---

## Fase 1 — Integración local · COMPLETADA

Transacciones IndexedDB de venta, anulación, transferencia, cartera y cierre, con cola, auditoría, identidad de operación y aislamiento por sede.

**Evidencia:** `release-final-01` — 340/340 pruebas, 18/18 SQL secuencial, 18/18 navegador, build correcto.

**Criterio de cierre cumplido:** dos pestañas no venden dos veces la última unidad; venta y reverso en las tres sedes no alteran las otras.

---

## Fase 2 — Sesión de operador remoto · COMPLETADA (local)

Verificar contra el servidor que cuenta, sede, rol y equipo coinciden, sin habilitar negocio remoto.

**Alcance entregado:**
- `src/services/operatorRemoteSession.js` — cliente con transporte inyectable, credencial de equipo solo en `sessionStorage`, autoridad validada y con caducidad.
- `src/components/Settings/RemoteOperatorPanel.jsx` — panel administrativo: vincular equipo, consultar directorio, verificar operador, cerrar verificación.
- `tests/operatorRemoteClient.test.mjs` — 12 casos con transporte sintético.

**Garantías probadas:**
- Sin equipo vinculado o sin cuenta cloud no se hace ninguna petición.
- El PIN remoto y el token nunca se guardan; el comprobante del equipo solo vive en la pestaña.
- Autoridad mal formada, rol desconocido, caducada o de otro equipo se rechaza.
- 401/403/404/503 y respuestas ilegibles no crean autoridad local.
- Cerrar la verificación limpia el estado local aunque el servidor no responda.
- El respaldo exportado excluye estas claves.
- **No habilita** sincronización ni cobro remoto.

**Evidencia:** `phase2-02` — 352/352 pruebas, 18/18 SQL, lint 0 errores, build correcto, 245 archivos idénticos. `browser-phase2-03` — 23/23 en navegador, cero errores JS, cero solicitudes.

**Criterio de cierre cumplido:** el cliente no otorga ningún privilegio local y falla cerrado cuando falta configuración.

**Decisión pendiente del dueño:** el interruptor Gestión/Caja está solo para `ADMIN`, pero la regla 11 lo extiende también al Dueño. No se cambió el comportamiento; se documentó.

---

## Fase 3 — Contrato de operaciones remotas · COMPLETADA (local)

Definir y probar las escrituras de negocio en servidor: venta, movimiento de stock y anulación, con idempotencia duradera y autorización por operador/sede.

**Entregable:** `supabase/migrations/202609150001_business_operations.sql` + `supabase/tests/business-operations.mjs`.

**Alcance entregado:**
- Seis tablas nuevas: catálogo, stock por sede, ventas, líneas, movimientos y **recibos de operación**.
- Cuatro RPC de servicio: `pharmacy_commit_sale`, `pharmacy_commit_stock_movement`, `pharmacy_commit_void`, `pharmacy_upsert_catalogue_item`.
- Precisión alineada con el cliente: cantidades a 3 decimales y precio unitario a 4 (no redondea precios fraccionados).

**Garantías probadas:**
- El identificador de operación se reclama **antes** de escribir: repetirlo devuelve el recibo guardado con `duplicate: true` y no vuelve a descontar stock.
- Reusar el mismo identificador con otro contenido, otra sede u otro tipo de operación se rechaza sin efectos.
- Stock insuficiente, líneas duplicadas, producto desconocido y falta de receta abortan la venta completa.
- Una venta solo pertenece a la sede con la que el operador inició sesión; no se puede anular desde otra sede, ni siquiera siendo dueño.
- Una sesión por equipo: un segundo acceso en el mismo terminal revoca el anterior.
- `anon` y `authenticated` no pueden ejecutar ninguna RPC ni leer ninguna tabla; el servicio tampoco lee tablas directamente.
- Forma de las líneas validada con expresiones regulares antes de cualquier conversión, para que una entrada malformada no deje un recibo reclamado.

**Criterio de cierre cumplido:** repetir la misma operación no duplica stock ni venta; operador de otra sede o rol es rechazado; ninguna RPC es invocable por `anon`/`authenticated`.

**Límite explícito:** PGlite es **secuencial**. La contención real entre conexiones simultáneas debe verificarse en PostgreSQL con conexiones separadas. Este contrato **no** está desplegado ni conectado al cliente; la sincronización sigue pausada.

---

## Fase 4 — Cola y sincronización · COMPLETADA (local, sin activar)

Conectar la cola local con el servidor: envío, confirmación, reintento con espera creciente, recuperación tras corte y clasificación de conflictos.

**Entregables:**
- `src/services/outboxSender.js` — emisor secuencial con transporte y cola inyectables.
- `src/server/businessGateway.js` + `api/business-operation.js` — puerta de entrada de servicio.
- `tests/outboxSender.test.mjs` (15), `tests/businessGateway.test.mjs` (12) y `tests/outboxGatewayIntegration.test.mjs` (6).

**Garantías probadas:**
- Una entrada **solo** se retira con un recibo guardado. Un 200 sin recibo se trata como ambiguo y se reintenta.
- Un corte de red reintenta con el **mismo** identificador y el **mismo** hash de contenido; el servidor reconoce la repetición y **no vuelve a descontar stock**.
- Un rechazo de negocio (por ejemplo, stock insuficiente) se marca para conciliación y **no** se reintenta en bucle ni toca el stock.
- Una sesión vencida o revocada detiene la tanda completa **sin** consumir intentos de ninguna entrada.
- El envío es secuencial: nunca hay dos operaciones en vuelo.
- Tipos aún no soportados quedan en cola y visibles, no se descartan.
- El servidor responde con códigos fijos y **nunca** reenvía el texto de error interno.
- La cookie de sesión y el comprobante del equipo viajan **hasheados**; el valor en claro nunca llega a PostgREST.

**Criterio de cierre cumplido:** con red intermitente no se pierde ni se duplica ninguna venta; la cola queda vacía solo tras confirmación real; un conflicto de stock se marca para conciliación sin sobrescribir datos ajenos.

**Estado de activación:** el emisor existe y está verificado, pero `REMOTE_OPERATIONS_PAUSED=true` sigue activo, así que **no se ejecuta** en la aplicación. Activarlo es la fase 7 y requiere tu autorización explícita.

**Límite explícito:** toda la verificación usa transporte sintético; no se ha hablado con un Supabase real ni se ha probado concurrencia entre dispositivos.

---

## Fase 5 — Catálogo, respaldos y recuperación · PENDIENTE

Carga del catálogo real, respaldo externo programado y restauración probada de extremo a extremo.

**Criterio de cierre:** restaurar un respaldo en un equipo limpio reproduce inventario, ventas, clientes y saldos; el procedimiento está documentado y se ejecutó al menos una vez.

**Bloqueado por:** catálogo real de 666 productos (no se inventa) y almacenamiento externo.

---

## Fase 6 — Validación real, calidad y equipos · BLOQUEADA

**Bloqueado por:** proyecto Supabase real, entorno de staging autorizado, impresora térmica, cajón y lector.

**Incluye:** RLS y Auth reales, concurrencia entre conexiones, SMTP y redirecciones, prueba de impresión, reducción de avisos de lint y del tamaño del bundle, y revisión de accesibilidad.

---

## Fase 7 — Autorización de publicación · PENDIENTE

Solo tras cerrar las fases 3 a 6. Requiere decisión explícita del dueño. Incluye definir dominio, variables de entorno de producción y procedimiento de reversión.

---

## Trabajo que puede avanzar sin bloqueos

| Tema | Fase | Estado |
|---|---|---|
| Reducir avisos de lint (796 falsos positivos de JSX) | 6 | Pendiente |
| Dividir el bundle principal (~900 kB) | 6 | Pendiente |
| Documentar procedimiento de restauración | 5 | Pendiente |
| Especificar RPC de negocio | 3 | Siguiente |

## Fuera de alcance por decisión

- No se activa COP.
- No se reactiva el sync legado cambiando una bandera.
- No se importan los SQL legados en bloque.
- No se contratan planes de pago sin autorización nueva.
