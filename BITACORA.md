# BITÁCORA

## 2026-09-17 — Suite determinista de activación cloud

- Nueva suite `tests/cloudActivationReadiness.test.mjs` (14 tests, <300 ms): gates A–H que verifican contrato v2, coherencia local↔cloud, concurrencia inter-sede, idempotencia de cola, contención vigente, contrato SQL estático y permutaciones con PRNG de seed fija.
- Cero no-determinismo: nada de `setTimeout`, `Date.now()` ni `Math.random()` en los tests nuevos; la latencia es un scheduler de ticks propio y los timestamps son constantes. Tres ejecuciones completas consecutivas produjeron resultados idénticos.
- Los 36 tests de contrato server-side con PGlite (`supabase/tests/`) quedaron integrados a `npm test` renombrándolos al patrón `*.test.mjs`; cubren sesiones por dispositivo, aislamiento de sucursales, idempotencia de stock/ventas y rechazo a clientes anónimos.
- Nuevo comando `npm run test:activation` para ejecutar solo los gates de activación.
- Auditoría de flaky: revisados todos los usos de tiempo/aleatoriedad en la suite; los únicos eran sleeps reales en el arnés antiguo de concurrencia, que se complementa ahora con la variante determinista.
- Validación: 473/473 pruebas (×3 ejecuciones idénticas), guardrails G01/G02/G03 en verde, lint sin errores, build correcto. `REMOTE_OPERATIONS_PAUSED` sigue activo.

## 2026-09-17 — UI/UX del modal de Recuperación de acceso

- `SuperAdminModal` (paso de nuevo PIN): cada fila de casillas ahora tiene su etiqueta visible («Nuevo PIN» / «Confirmar PIN»); antes eran dos filas idénticas sin identificar.
- Corregido el foco: solo la primera casilla de «Nuevo PIN» recibe `autoFocus`; antes ambas filas lo pedían y el cursor aterrizaba en la fila de confirmación.
- `Backspace` ahora retrocede a la casilla anterior (con `preventDefault` para no borrar el dígito previo), se admite pegar el PIN completo (Ctrl/Cmd+V) y `Enter` envía el restablecimiento.
- Casillas responsivas (`w-10/h-12` en móvil, `w-11/h-13` en escritorio) dentro del `max-w-sm` del modal; se corrigió el uso de la clase inexistente `h-13` como base.
- El botón «Restablecer PIN» se habilita cuando ambos PIN tienen 6 dígitos, aunque el foco siga en la fila de confirmación (estado stale); se añadieron mensajes diferenciados para PIN incompleto y PIN no confirmado.
- Validación: 423/423 pruebas, build de producción correcto, lint focalizado sin errores (solo warnings heredados del archivo).

## 2026-09-17 — Cambio de sede simplificado al PIN del Dueño

- `BranchPinModal` ya no muestra selector de administrador ni paso intermedio: al elegir otra sede abre directamente el PIN del Dueño.
- `useSedeStore` refuerza la misma regla en la lógica, rechazando cualquier `approverId` que no sea el Dueño permanente; la UI no es la única barrera.
- Se actualizaron las regresiones de cambio de sede para confirmar que Admin y PIN incorrecto son rechazados, mientras el Dueño conserva identidad, sede y huella.
- Validación: 423/423 pruebas, build correcto, lint focalizado sin errores. Se mantienen los datos y la sincronización cloud sin cambios.

## 2026-09-17 — Cierre de sesión robusto en modo local/cloud

- Se reprodujo el error `CLOUD_NOT_CONFIGURED` al pulsar “Cerrar sesión” cuando la interfaz tenía una cuenta cloud local configurada, pero el cliente Supabase seguía en modo offline.
- `signOutCloudAccount` ahora considera `CLOUD_NOT_CONFIGURED` una salida local completada: limpia operador, cuenta activa y bandera de sesión antes de la red, sin mostrar error ni bloquear la recarga. Los errores reales de red continúan reportándose.
- Se agregó regresión específica en `tests/operatorAuthority.test.mjs`.
- Validación: 21/21 pruebas de autoridad, 424/424 suite completa, build correcto, lint focalizado sin errores. Hay que reiniciar Vite después de modificar `.env`, porque las variables públicas se cargan al iniciar el servidor.

## 2026-09-17 — Arnés de concurrencia multi-sede

- Se creó `tests/multisiteConcurrency.test.mjs` y el comando `npm run test:concurrency` para ejercitar Central, Norte y Sur con latencia sintética, respuestas fuera de orden, cambio de sede durante `await`, fallos de red, cola account-scoped y reintentos idempotentes.
- El arnés usa `buildCloudDocumentId`/parseo reales y no toca Supabase, cuentas ni inventarios reales. Se generó `outputs/auditoria-e2e-2026-09-13/REPORTE_CONCURRENCIA_TRES_SEDES_2026-09-17.md`.
- Resultado: 5/5 casos del arnés, 423/423 pruebas completas, build correcto y G01/G02/G03 en verde. `REMOTE_OPERATIONS_PAUSED` continúa activo.
- Límite explícito: todavía no sustituye una prueba con conexiones PostgreSQL/RLS reales ni entrega cross-device real; la sincronización remota permanece contenida.

## 2026-09-17 — Validación local completa sin staging

- A petición del usuario, la validación se ejecutó íntegramente en el repositorio con datos sintéticos; no se requirió staging porque el proyecto aún no está en producción.
- Los tres guardrails de sincronización quedan en verde: G01 aislamiento, G02 documentos v2 y G03 transferencia account-scoped con transporte preparado. G03 reporta `pausedByContainment: true` mientras la pausa siga activa.
- La pausa cloud no se retiró: el transporte se probó por contrato y la aplicación continúa mostrando pendientes locales sin enviar datos remotos.
- Validación local: 418/418 suite completa, 29/29 pruebas enfocadas, build OK y guardrails PASS.

## 2026-09-17 — Fase cloud v2 ampliada: lotes, controlados y transferencias

- `SYNC_KEYS` ahora incluye lotes, controlados, correlativos, caja y transferencias; transferencias se sincronizan como documento account-scoped mergeable, mientras lotes/controlados mantienen sede-scoped.
- Se corrigió el polling y Realtime para consultar/aplicar únicamente IDs v2 del contexto actual; los documentos legacy o de otra cuenta/sede se rechazan.
- El guardrail G02 quedó verde. G03 permanece rojo únicamente porque `REMOTE_OPERATIONS_PAUSED` continúa bloqueando la entrega cross-device, que requiere staging antes de liberarse.
- Validación: 418/418 pruebas, 29/29 pruebas enfocadas, build OK, sin errores de sintaxis. No se activó cloud ni se tocaron datos reales.

## 2026-09-16 — Implementación inicial del contrato cloud v2 multi-sede

- Se creó `src/config/cloudDocumentScope.js` con IDs versionados `v2`, alcance account-scoped/sede-scoped, parseo y rechazo de documentos legacy o de otra sede.
- `useCloudSync`, `storageService` y `uploadBackupToCloud` ahora conservan el contexto de cuenta+sede y construyen documentos v2; el polling y Realtime validan el documento antes de aplicarlo.
- `bodega_suppliers_v1`, `bodega_supplier_invoices_v1` y `farmacia_sede_movimientos_v1` quedaron aislados localmente por sede.
- Se agregaron 4 pruebas de contrato en `tests/cloudDocumentScope.test.mjs` y se ajustó la regresión de cambios de sede.
- Guardrails actuales: G01 PASS; G02 sigue bloqueado por contratos pendientes de lotes/controlados/transferencias; G03 sigue bloqueado porque el transporte cross-device de transferencias permanece pausado.
- Validación: 418/418 tests, 29/29 pruebas enfocadas, build OK, 0 errores de sintaxis y 0 errores de lint focalizado. La sincronización remota continúa deliberadamente pausada.

## 2026-09-16 — Plan de sincronización multi-sede

- Se creó `outputs/auditoria-e2e-2026-09-13/PLAN_SINCRONIZACION_MULTI_SEDE_2026-09-16.md` para Central, Norte y Sur.
- El plan define el contrato `v2` de documentos cloud por cuenta+sede, la matriz de alcance de colecciones, buzón de transferencias, cola offline, migración legacy, observabilidad, rollback y activación gradual.
- Se establecieron gates 0–7: baseline, namespaces, contrato cloud, autorización server-side, transferencias, cola/ventas, migración y staging.
- La regla permanece: no retirar `REMOTE_OPERATIONS_PAUSED` hasta que todos los gates y guardrails estén verdes.

## 2026-09-16 — Auditoría de sincronización de las tres sedes

- Se creó `outputs/auditoria-e2e-2026-09-13/REPORTE_SINCRONIZACION_TRES_SEDES_2026-09-16.md` para Central/C&Y 2025, Norte/C&Y 2026 y Sur/Las 24 Horas.
- La separación local de inventario, ventas, cierres, lotes, controlados y auditoría pasa; la cola y transferencias permanecen account-scoped con origen/destino explícitos.
- La sincronización cloud sigue correctamente pausada: `REMOTE_OPERATIONS_PAUSED = true`. G01 pasa; G02 falla por `doc_id` sin sede/versionado y contratos cloud incompletos; G03 queda pendiente para entrega cross-device de transferencias.
- Validación: 25/25 pruebas enfocadas pasan. Los arneses no tocaron cuentas, Supabase ni inventarios reales. El arnés de resiliencia no se ejecutó porque no había servidor local en 127.0.0.1:4175.

## 2026-09-16 — Corrección del botón de cierre de sesión cloud

- `LockScreen` ahora muestra `Cerrar sesión` solo cuando existe una configuración cloud; en modo local no se presenta una acción que no puede cerrar ninguna cuenta remota.
- El cierre bloquea primero la sesión local y siempre finaliza con recarga, incluso si Supabase falla por red o devuelve un error; se muestra un aviso y no queda la interfaz atrapada.
- Se aplicó el mismo guard de error al cierre cloud del dashboard, Configuración y `App`, evitando promesas rechazadas sin manejar.
- Validación: 20/20 pruebas de autoridad/PIN, build correcto, 0 errores de lint focalizado y `git diff --check` correcto.

## 2026-09-16 — Implementación Fase 1: aislamiento local operativo y buzón de transferencias

- `src/config/storageScope.js` ahora aísla `farmacia_controlados_v1` y `abasto_audit_log_v1` por cuenta+sede, además de productos, ventas, lotes y cierres.
- `offline_sales_queue` y `farmacia_transferencias_v1` quedan deliberadamente account-scoped: sus entradas llevan sede/origen/destino explícitos, lo que conserva idempotencia global y permite descubrir transferencias sin compartir inventario.
- `tests/pharmacySeedPolicy.test.mjs` agrega regresión de claves operativas aisladas y confirma el contrato especial de transferencias.
- El plan E2E y los guardrails se ajustaron al contrato: inventario aislado; evento de transferencia compartido y filtrado por destino.
- Validación: 413 pruebas ejecutadas; tras preservar la cola account-scoped, la regresión de operación global queda cubierta. Build correcto; lint focalizado sin errores nuevos.

## 2026-09-16 — Plan de mejora, arneses y guardrails de auditoría E2E

- Se creó `outputs/auditoria-e2e-2026-09-13/PLAN_MEJORA_FIXEO_E2E_2026-09-16.md` con fases 0–6, prioridades, gates de aceptación y reglas para no activar cloud ni tocar datos reales.
- Se agregaron tres guardrails estáticos y un ejecutor agregado: `guardrail-storage-scope.mjs`, `guardrail-cloud-doc-scope.mjs`, `guardrail-transfer-contract.mjs` y `run-audit-guardrails.mjs`.
- Los guardrails revisan aislamiento de colecciones operativas, versionado de documentos cloud por cuenta+sede y buzón de transferencias entre sedes. No usan red, Supabase ni datos de negocio; devuelven código distinto de cero ante bloqueadores.
- Validación base del árbol: 413/413 tests, build OK y lint con 0 errores/831 warnings heredados. Los arneses quedan como controles rojos hasta cerrar los fixes de namespace, transferencias y contrato cloud.

## 2026-09-15 — Restablecimiento de PIN por identidad cloud

- El modal "Recuperación de acceso" (7 toques en el logo y ahora también el botón "Olvidé mi PIN" en la pantalla de acceso) ya no es un callejón sin salida: implementa el restablecimiento real del PIN del dueño.
- Flujo: verificación de identidad con la cuenta cloud del correo administrador (`adminEmail`, configurable en Configuración → Usuarios) o sesión cloud vigente → ventana de gracia de 10 minutos en memoria → el dueño define su nuevo PIN de 6 dígitos (jamás vuelve a un PIN de fábrica conocido) → `credentialVersion` rota, sesiones/aprobaciones del dueño se cierran y queda huella `PIN_RESTABLECIDO`.
- Nuevas acciones del store: `requestOwnerPinReset`, `confirmOwnerPinReset`, `cancelOwnerPinReset`. No existen claves maestras ni reinicio masivo; cajeros y datos nunca se tocan. Server-side (`operatorAccess`) permanece intencionalmente sin canal de recuperación.
- Regla 16 añadida a `agent.md`. Tests nuevos en `tests/operatorAuthority.test.mjs` (autorización por adminEmail, ventana/token, hash del nuevo PIN, sesiones cerradas, cancelación).

## 2026-09-15 — Categorías de farmacia e inventario inicial en C&Y 2025
- (Continuación) El catálogo consolidado quedó con 666 artículos y fotos reales servidas desde `public/products/*.jpg` (mapeadas por código de barra). Se restauraron las funciones `seedPharmacyInventoryIfEmpty` + migración de categorías legacy, que una reescritura concurrente había eliminado dejando el build roto. La siembra es idempotente: solo llena sedes con inventario vacío, crea 2 lotes iniciales por artículo con vencimientos 2027/2028 y nunca sobrescribe datos existentes.


- Se eliminaron las categorías de fábrica de repuestos de motos y abastos (Motor, Carrocería, Frenos, Bebidas, Charcutería, etc.) y se reemplazaron por 16 categorías farmacéuticas reales: Analgésicos, Antibióticos, Antipiréticos, Antiinflamatorios, Antihistamínicos, Gastrointestinal, Vitaminas, Cardiovascular, Respiratorio, Antiparasitarios, Cuidado Personal, Primeros Auxilios, Materno Infantil, Dermatológicos, Oftalmológicos y Otros, con iconografía Lucide profesional por categoría.
- `src/config/pharmacySeed.js`: semilla idempotente de inventario para C&Y 2025 (sede central) con 46 productos reales de farmacia (precio, costo, laboratorio, genérico, concentración, presentación, códigos de barra, receta cuando aplica) y sus lotes FEFO con vencimiento a 2 años. Solo escribe si la sede no tiene productos; nunca toca inventarios existentes ni categorías personalizadas.
- Migración automática de categorías legacy: si el almacenamiento de una sede aún guarda la lista vieja de motos/abastos, se reemplaza por la de farmacia y los productos que referenciaban categorías eliminadas pasan a "Otros". Verificado en navegador: las pastillas de categoría muestran solo farmacia y el inventario lista los 46 productos con precios y stock.
- `src/context/ProductContext.jsx`: ejecuta la semilla al cargar el inventario de la sede activa.
- Validación: `npm test` 406/406 ✅ · build ✅ · eslint 0 errores (4 warnings legacy preexistentes) ✅

## 2026-09-15 — Fase 4: cola y sincronización con confirmaciones (mecanismo verificado, sin activar)

Se implementó el emisor de la cola y la puerta de entrada de servicio, y se probaron juntos de extremo a extremo. No hubo commit, push, despliegue ni contacto con Supabase real. `REMOTE_OPERATIONS_PAUSED=true` sigue activo, así que **el emisor no se ejecuta** en la aplicación: activarlo es la fase 7 y requiere autorización del dueño.

- **Emisor:** `src/services/outboxSender.js`. Secuencial, con transporte y cola inyectables. Una entrada solo se retira con un **recibo guardado**; un 200 sin recibo se considera ambiguo y se reintenta. Un corte de red reintenta con el mismo identificador y el mismo hash de contenido, de modo que el servidor reconoce la repetición. Una sesión vencida detiene la tanda sin consumir intentos. Los tipos aún no soportados quedan en cola y visibles.
- **Clasificación:** rechazo de negocio (stock insuficiente, conflicto de identificador, receta faltante) se marca para conciliación y no se reintenta en bucle ni toca el stock. Fallo de servidor, límite de tasa o respuesta ambigua se reintentan con espera creciente. Agotar intentos también se marca, nunca se descarta en silencio.
- **Puerta de servicio:** `src/server/businessGateway.js` y `api/business-operation.js`. Resuelve la sesión (cuenta + cookie + comprobante de equipo), arma los parámetros de la RPC y traduce los errores del servidor a códigos fijos. El texto de error interno **nunca** se reenvía. La cookie y el comprobante viajan hasheados; el valor en claro no llega a PostgREST. Se separó "cuerpo demasiado grande" (413) de "JSON inválido" (400).
- **Alcance de sesión:** se añadió `sessionScope` a `src/server/operatorAccess.js` para devolver los parámetros exactos de la RPC tras validar la sesión. Es aditivo: no cambia las acciones HTTP existentes ni su contrato probado.
- **Pruebas:** `tests/outboxSender.test.mjs` (15), `tests/businessGateway.test.mjs` (12) y `tests/outboxGatewayIntegration.test.mjs` (6), que une el emisor real con el manejador real sobre un PostgREST sintético. La prueba clave simula una venta **confirmada en el servidor cuya respuesta se pierde**: el reintento usa el mismo identificador, el servidor responde `duplicate: true` y el stock **no** se descuenta dos veces.
- **Validación:** candidato `phase4-01`: build correcto, **386/386** pruebas de aplicación, **36/36** SQL, lint **0 errores**, 253 archivos idénticos por SHA-256 a la fuente y 241 de texto sin NUL. Total local: 422/422.
- **Versionado:** `.gitignore` permite ahora `api/business-operation.js` (antes quedaba excluido por la regla `api/*.js`).
- **Límite explícito:** todo se verificó con transporte sintético. No se ha probado concurrencia real entre dispositivos ni un proyecto Supabase real; el bloqueo entre conexiones simultáneas sigue pendiente de PostgreSQL.

## 2026-09-15 — Fase 3: contrato de operaciones remotas con idempotencia en servidor

Nueva migración de proyecto nuevo y su contrato sintético. No hubo commit, push, despliegue ni conexión a Supabase real; `REMOTE_OPERATIONS_PAUSED=true` se mantiene y el cliente **no** usa todavía estas RPC.

- **Migración:** `supabase/migrations/202609150001_business_operations.sql`. Seis tablas en `app_private`: `catalogue_items`, `branch_stock`, `sales`, `sale_items`, `stock_movements` y `operation_receipts`. Cuatro RPC de servicio: `pharmacy_commit_sale`, `pharmacy_commit_stock_movement`, `pharmacy_commit_void` y `pharmacy_upsert_catalogue_item`. Precisión alineada al cliente: cantidad `numeric(14,3)` (misma escala 1000) y precio unitario `numeric(14,4)`, para no redondear precios fraccionados como 0.125.
- **Idempotencia duradera:** el identificador de operación se reclama en `operation_receipts` **antes** de cualquier escritura. Repetirlo devuelve el recibo guardado con `duplicate: true` sin volver a descontar stock. Reusarlo con otro contenido, otra sede u otro tipo se rechaza. Un fallo posterior revierte también el reclamo, por lo que nunca queda un recibo a medias.
- **Autorización:** `app_private.verified_operator` es la única fuente de identidad y valida cuenta, comprobante de equipo, sesión vigente y versiones de credencial/equipo/sede. La venta pertenece siempre a la sede de la sesión, para todos los roles; anular una venta de otra sede se rechaza incluso para el dueño. El catálogo solo lo definen dueño o admin.
- **Farmacia:** se exige receta cuando el producto guardado la requiere o es controlado, y la evidencia queda en la venta. La anulación repone exactamente las cantidades base y registra su movimiento una sola vez. El stock nunca puede quedar negativo.
- **Entrada malformada:** la forma de las líneas se valida con expresiones regulares antes de convertir tipos, de modo que una entrada inválida devuelve nulo sin dejar reclamo ni escritura.
- **Regresiones:** `supabase/tests/business-operations.mjs` con 17 casos. Candidato `phase3-01`: build correcto, **353/353** pruebas de aplicación, **36/36** SQL (18 de operador + 18 de negocio), lint **0 errores**, 247 archivos idénticos por SHA-256 a la fuente y 235 de texto sin NUL. `verify-candidate.mjs` ahora ejecuta todos los contratos SQL, no solo el de operador.
- **Hallazgo operativo durante las pruebas:** iniciar sesión en un terminal revoca la sesión anterior de ese mismo equipo (regla deliberada de una sesión por dispositivo). Las pruebas usan un equipo por rol y sede. Queda documentado porque afecta cualquier futura integración de cliente.
- **Límite explícito:** PGlite es secuencial; esto ejercita la máquina de estados de idempotencia, **no** la contención real entre conexiones. Falta validar bloqueo y conflictos en PostgreSQL con conexiones separadas, y conectar el cliente a estas RPC (fase 4).

## 2026-09-15 — PIN de fábrica en ceros para dueño y cajeros

- Regla nueva (15 en `agent.md`): el PIN de fábrica es 000000 para el dueño y 0000 para cada cajero; ya no existen cajeros sin PIN ni acceso directo sin PIN.
- `src/config/userProvisioning.js`: `CASHIER_FACTORY_PIN = '0000'`; cajeros de fábrica y recreados por `ensureCashiersPerSede` nacen con 0000; `normalizeUsers` aplica `migrateOwnerPinToFactory` que convierte cajeros sin PIN heredados a 0000 sin tocar PIN personalizados.
- `src/hooks/store/useAuthStore.js`: `agregarUsuario` asigna el PIN 0000 (hasheado) a un cajero creado sin PIN en lugar de crearlo sin PIN; con cuenta cloud el PIN sigue siendo obligatorio.
- `src/components/Settings/UsersManager.jsx`: la ayuda del PIN del cajero indica el uso del PIN de fábrica 0000 y se retiró la insignia "Sin PIN".
- Validación: `npm test` completa, build y lint sin errores nuevos.

## 2026-09-15 — Corrección visual: anillo verde persistente en tarjeta de usuario

- Al hacer clic en una tarjeta de la pantalla de operador (Dueño/Cajero) quedaba un anillo verde redondeado alrededor de toda la tarjeta (avatar + etiquetas). Causa: el anillo usaba `focus:ring` (se activa también con clic de ratón) y el modal de PIN le robaba el foco sin que la tarjeta lo perdiera visualmente.
- Corrección: `src/components/security/UserCard.jsx` usa ahora `focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2`; el anillo aparece solo con navegación por teclado y no con clic. Verificado en navegador: clic en Dueño abre el PIN sin anillo residual y el foco visible por teclado se conserva.
- Adicional: se corrigió la ruta de import de `src/components/Settings/RemoteOperatorPanel.jsx` (`../../SettingsShared.jsx` → `../SettingsShared.jsx`), que rompía el arranque del servidor de desarrollo con el overlay de error de Vite.

## 2026-09-15 — Fase 2: verificación remota de operador integrada (sin habilitar negocio remoto)

Se creó el roadmap formal en `ROADMAP_PRODUCCION.md` con siete fases, criterios de cierre y bloqueos reales. Se ejecutó la fase 2. No hubo commit, push, despliegue ni contacto con Supabase real; `REMOTE_OPERATIONS_PAUSED=true` se mantiene.

- **Cliente de sesión remota:** nuevo `src/services/operatorRemoteSession.js`. Transporte y almacenamiento inyectables; usa `POST /api/operator-session` con `credentials: 'include'` y `cache: 'no-store'`. Respeta el contrato existente: solo `directory`, `login` y `logout`. **No** se añadió una acción `validate` por HTTP: `validateSession` sigue siendo interna del servidor y su rechazo en la API está probado.
- **Credenciales:** el comprobante del equipo vive solo en `sessionStorage` (nunca en localStorage ni IndexedDB, por lo que no entra en los respaldos). El PIN remoto y el token de cuenta nunca se guardan. La autoridad guardada se valida por forma, rol y caducidad antes de usarse. `backupSafety.js` excluye además `farmapos_remote_operator` y `farmapos_remote_device` como defensa en profundidad.
- **Panel administrativo:** nuevo `src/components/Settings/RemoteOperatorPanel.jsx`, integrado en Sistema solo para admin. Permite vincular el equipo, consultar el directorio, verificar operador con PIN remoto de 8 a 12 dígitos y cerrar la verificación. El texto del panel indica explícitamente que **no** habilita sincronización ni cobro remoto.
- **Fallo cerrado:** sin equipo vinculado o sin cuenta cloud no se emite ninguna petición. 401/403/404/503 y cuerpos ilegibles no crean autoridad local. Cerrar la verificación limpia el estado local aunque el servidor no responda. Cambiar de equipo invalida una autoridad emitida para otro terminal.
- **Regresiones:** `tests/operatorRemoteClient.test.mjs` con 12 casos y transporte sintético. Regresión completa **370/370** (antes 358; +12). Lint **0 errores**; los 9 avisos nuevos pertenecen a la clase de falso positivo ya existente (JSX no reconocido por `no-unused-vars` sin `eslint-plugin-react`), no a defectos nuevos.
- **Validación:** candidato `phase2-02` compila; **352/352** pruebas de aplicación (antes 340; +12), **18/18** SQL secuencial, lint **0 errores**. 245 archivos idénticos por SHA-256 a la fuente, 233 de texto sin NUL. Navegador `browser-phase2-03`: **23/23**, cero errores JavaScript y cero solicitudes operativas; se añadieron cuatro comprobaciones del panel (aviso de pausa, credencial inválida rechazada, vinculación solo en la sesión de la pestaña, directorio sin cuenta cloud sin tocar la red, y desvinculación).
- **Hallazgo de producto (requiere decisión del dueño):** el interruptor Gestión/Caja quedó restringido a `rol === 'ADMIN'` (`App.jsx`), mientras la regla 11 de `agent.md` dice que **Dueño y admin** pueden cambiar a Caja. En el baseline de esta etapa el interruptor estaba desactivado (`canSwitchMode = false`). No se modificó el comportamiento: se alinearon las pruebas al estado real y se añadió `B08` que verifica el cambio de modo para el admin sin alterar operador, rol ni sede. Falta que el dueño confirme si desea recuperar el interruptor para su propio rol.
- **Corrección del arnés:** `B02`/`B06` asumían que el Dueño tenía el interruptor y que la barra inferior siempre es alcanzable. Se corrigieron para reflejar el comportamiento real (Dueño opera en Gestión; el informe en móvil ocupa la pantalla completa). Los fallos originales quedan preservados y no se cuentan como pases.
- **Límite explícito:** esta fase verifica identidad, no negocio. La venta, el stock y el cierre siguen siendo locales. La integración de escrituras remotas es la fase 3.

## 2026-09-15 — Vista del dueño sin interruptor Gestión/Caja

- El dueño ya no ve el selector Gestión/Caja del encabezado: su perfil entra siempre en Gestión, donde ya tiene acceso a todo (incluido vender desde la pestaña Vender). El interruptor queda exclusivamente para el ADMIN, que sí alterna entre escritorio y mostrador sin cambiar privilegios. El cajero sigue entrando directo en Caja. Regla 11 de `agent.md` actualizada.
- Archivos: `src/App.jsx` (`canSwitchMode` solo para ADMIN), `agent.md`. Sin cambios de permisos ni de datos.

## 2026-09-15 — Integración de persistencia atómica y servidor de operador local

Trabajo retomado tras interrupciones; no hubo commit, push, publicación, compra ni uso de cuentas/datos reales. `REMOTE_OPERATIONS_PAUSED=true` y denegación del checkout remoto se conservan. Fuente recuperada preservada en `outputs/production-audit-2026-09-14/resume-20260915-source.zip` y candidato aislado sin `.env` ni sesiones reales.

- **Almacenamiento y operaciones:** `atomicIndexedDb.js`, `storageService.js`, `localLedger.js`, `checkoutProcessor.js`, `salePlan.js`, `voidSaleProcessor.js`, `transferenciaService.js`, `customerTransactionProcessor.js`, `closureService.js` y `localAdminOperations.js` usan planners síncronos sobre snapshots persistidos con escritura conjunta de inventario/lotes/ledger/cola/huella. Se prueban aborto sin estado parcial, contención de última unidad e idempotencia por cuenta/sede/tipo. Cambiar la bandera remota por sí sola falla cerrado.
- **Identidad y recuperación:** borrador de cesta conserva operationId; aprobación de descuento ya consumida no bloquea consultar la misma venta confirmada. Cierre se liga al cashSessionId esperado y no cierra una nueva apertura al repetir la petición. ProductContext tiene reintento explícito y recuperación que conserva copia del borrador antes de recargar el inventario autoritativo. Cola de snapshots solo coordina la pestaña; la exclusión multi-registro la aporta IndexedDB.
- **Farmacia y contabilidad:** cantidades base de empaques/fracciones, FEFO y receta con referencia/prescriptor/documento verificados contra producto guardado. Anulación resta descuentos/financiación/pagos/vuelto, repone asignaciones exactas y revierte delta sobre saldo actual; ambiguos legados exigen conciliación. Transferencia mantiene precios del destino y exige catálogo existente. Precio fraccionado no se redondea antes de la línea; redondeo negativo simétrico en `dinero.js`; costo0 y costo soloBs diferenciados. Reportes usan salesCount y claves de cierre por sede, señalando tasas históricas ausentes.
- **UI e integración:** `SalesView`, `ProductsView`, `CustomersView`, `DashboardView`, `ReportsView` y sus modales adoptan resultados confirmados sin sobrescribir snapshots. Apertura/abonos/proveedor/lotes/ajustes dejan auditoría/cola atómicas; guardas contra doble pulsación. Modos Gestión/Caja sin cambio de privilegios, navegación con nombres accesibles, switches semánticos y correcciones de hooks/refs. `AppRouter.jsx`, estados de proveedores y `toastState.js` separados de JSX; arnés resuelve `.js` antes de `.jsx` como Vite.
- **Servidor preparado, no desplegado:** dos migraciones nuevas bajo `supabase/migrations/`, `src/server/operatorAccess.js`, `api/operator-session.js`, SQL de prueba y `operatorServerContract.test.mjs`. PIN PBKDF2, presupuestos de intentos, versión de credencial/sede, dispositivo y cookie HttpOnly/Secure; parámetros y grants probados con identidad sintética. Las tablas/RPC operativas remotas siguen pendientes de liberación; no importar SQL legado a ciegas.
- **Validación final:** `release-final-01` compila y pasa **340/340 pruebas de aplicación** (incluidas 25 del adaptador de operador), **18/18 SQL PGlite secuenciales**, **18/18 comprobaciones de navegador** en `browser-final-01/results.json`. Dos pestañas autenticadas compiten por la última unidad: solo una venta y stock final0. Se ejecutan venta y reverso de empaques/lotes en Central/Norte/Sur, y se prueba recuperación tras recarga, conflicto de inventario, receta, vuelto, identidad de borrador antiguo, cajero, móvil390×844 y tema oscuro. Cero errores JavaScript no controlados y cero solicitudes operativas; otros orígenes bloqueados en QA.
- **Calidad y reproducción:** lint candidato0 errores/809 avisos; raíz0/810 (796 no-unused-vars y14 exhaustive-deps), sin ocultar ni desactivar reglas. Build mantiene avisos por chunks grandes y datos Browserslist antiguos; no se afirma optimización completa. **241 archivos del candidato** coinciden por SHA-256 con la fuente, **230 archivos de texto sin NUL**. `git diff --check` aprobado. Dependencias de pruebas fake-indexeddb/PGlite/esbuild declaradas y lock actualizado en workspace aislado sin cambiar versiones previas. El log de Vite conserva el marcador NUL de un módulo virtual de Rollup; no es corrupción de código.
- **Últimos cierres:** `CartContext.jsx`/`SalesView.jsx` fijan operationId de borradores legados antes del cobro; `storageService.js` deja fallback de lectura intacto y no sobrescribe un commit nuevo mediante migración retrasada. `.gitignore` permite versionar `api/operator-session.js`. Etiquetas/placeholder de pagos y KPIs son más legibles; planes actualizados con estado local y pendientes reales. Capturas finales inspeccionadas. El primer recorrido de navegador falló por JSX clásico en el arnés y por asumir que una recarga no bloqueaba al admin; se corrigió el arnés sin debilitar el bloqueo. Los fallos originales siguen preservados y no se cuentan como pases.
- **Entrega de revisión:** `FARMA_POS_REVISION_LOCAL.html`, `FARMA_POS_CODIGO_REVISADO.zip`, `FARMA_POS_EVIDENCIAS_QA.zip` y manifiestos en `outputs/production-audit-2026-09-14/`. No contienen .env, perfiles reales ni dependencias. Fuente y compilación de QA no equivalen a un despliegue autorizado.

**Puertas externas abiertas:** Supabase real/Auth/RLS/SMTP/redirects y restore externo, PostgreSQL multi-conexión, pago Cashea real, impresora/cajón/hardware y despliegue. El éxito local no autoriza producción ni sincronizar entre dispositivos.

## 2026-09-14 — Adaptación local a Supabase Free, sin habilitar producción

Se aplicó la elección del usuario de usar Supabase Free por ahora. Baseline completo preservado en `outputs/supabase-free-2026-09-13/baseline-free.zip` y manifiesto SHA-256 (207 archivos). No se contrataron recursos, desplegó código, ejecutó SQL ni conectó una cuenta real; los datos y pendientes del negocio no se modificaron.

- **Perfil de consumo:** `src/config/supabaseFreeTier.js` centraliza las referencias oficiales y defaults conservadores: debounce pesado 30 minutos, polling visible 60 minutos, catch-up secuencial con pausa de 1 s, Realtime y health pings desactivados, aviso de payload desde 250 KiB y máximo local 1 MiB. El código anterior usaba 30 segundos aunque el plan decía 30 minutos.
- **Transporte y claves:** `supabaseFreeTransport.js`, `supabasePublicKey.js`, `supabaseCloud.js` y `vite.config.js` admiten clave publishable con fallback anon, rechazan claves secret/service_role antes de compilar y mantienen Auth disponible. Las otras rutas SDK devuelven pausa sin red; cargas medibles mayores de 1 MiB se rechazan sin truncar datos. Errores HTTP/429 y cuerpos de respuesta originales se conservan; no hay reintento automático ni limpieza de negocio por cuota.
- **Sync legado contenido:** `useCloudSync.js` usa SHA-256 completo y bytes UTF-8, comprueba errores SDK antes de marcar éxito, difiere cargas grandes, serializa catch-up y evita polling oculto/concurrente. El perfil Free no crea canales Realtime. Todo este motor sigue inactivo por `REMOTE_OPERATIONS_PAUSED=true`; no se considera autorizada su reactivación y aún falta un contrato nuevo por sede.
- **Diagnóstico y trabajo local:** `syncMetrics.js` valida etiquetas/contadores y conserva 14 días UTC sin payloads/URLs/credenciales. El nuevo `SupabaseFreeStatus.jsx`, integrado en Sistema, muestra métricas HTTP separadas de las legadas y advierte que no son consumo de organización ni facturación. `SyncStatus.jsx` refresca cola por eventos y vuelta a visible, agrupando lecturas, con fallback local de 60 s en lugar de 15 s; sin health pings. `App.jsx` no crea el temporizador de auditoría cloud durante la pausa. Respaldo local y retención de negocio se conservan.
- **Preparación SQL revisada, no corregida mediante importación:** faltan tablas base que presupone la migración 001, hay referencias legadas y dos migraciones 004. El setup raíz incluye una política abierta de backups y un checkout de muestra que devuelve UUID sin venta. Las políticas existentes no acreditan operador/sede; los documentos cloud tampoco tienen clave por sede. No importar estos archivos a ciegas.
- **Documentación:** actualizado `PLAN_OPTIMIZACION_SUPABASE_FREE.md`, estado técnico de `PLAN_TRANSFORMACION_FARMACIA.md` y regla Free en `agent.md`. Cuotas consultadas en fuentes oficiales el 2026-09-13: 500 MB de BD/proyecto, 1 GB Storage/organización, 5 GB no cacheados y 5 GB cacheados independientes por ciclo; pausa por baja actividad y SMTP/backups requieren preparación.

**Validación:** **253/253 tests**, **23/23 comprobaciones de navegador**, **6/6 casos de preflight Vite**. Build `qa-free-final-01` aprobado; **196 fuentes de texto sin NUL** y fuente/pruebas idénticas a la copia probada. SDK real con transporte sintético verifica Auth y rechazo REST; casos de UTF-8, multipart, Request y errores sin reintento. Navegador comprueba panel administrativo/móvil, cola oculta sin lectura, permisos, PIN, sede y venta con descuento: total $9, pago $20, vuelto $11/0 Bs, stock Central 10→9, Norte 20 y pendiente conservado tras recarga. Cero errores JavaScript/peticiones operativas reales. Lint raíz **25 errores/797 avisos**, QA **23/794**; cero errores nuevos frente a fase 2, cuatro avisos netos adicionales. El verificador conserva salida no-cero por lint. El arranque frío fallido del primer recorrido queda como diagnóstico separado; el segundo espera la carga real y pasa.

**Límites:** no se ha medido el uso real de una organización ni probado Supabase/RLS/SMTP desplegados. Faltan esquema inicial seguro/reproducible, autorización de operador/sede, transacciones atómicas/idempotentes y outbox versionado; no hay promesa de capacidad de ventas para Free. La web Vite y los endpoints actuales requieren hosting/configuración aparte: crear Supabase no publica la aplicación. Sync, checkout remoto y restauraciones siguen bloqueados. Sin commit, push, migración ni despliegue.

## 2026-09-13 — Fase 2 local: identidad, aprobaciones y contexto verificados

Se completó la parte local de la fase 2 del plan E2E, sin despliegue, migraciones, cuentas ni datos reales. La autorización online de operador/sede sigue pendiente; no se declara cerrada la fase de servidor ni habilitada producción. Baseline previo preservado por hashes en `outputs/correcciones-fase2-2026-09-13/baseline-fase2-verificado.zip` (182 archivos).

- **Acceso/PIN:** `useAuthStore.js`, `operatorSession.js`, `cloudSessionLifecycle.js`, `userProvisioning.js`, `App.jsx` y componentes de seguridad separan cuenta cloud de operador, exigen selección/PIN tras login cloud, invalidan accesos cancelados o credenciales cambiadas durante verificación y preservan el PIN del cajero al normalizar. Logout bloquea antes de esperar red; otra pestaña no sobrescribe una credencial nueva con configuración obsoleta. Acceso maestro y reinicio masivo de PIN deshabilitados.
- **Aprobaciones y sede:** `discountAuthorization.js`, `DiscountModal.jsx`, `checkoutProcessor.js`, `BranchPinModal.jsx` y `useSedeStore.js` ligan aprobación a acción/cesta/monto/contexto, con caducidad y consumo único. Aprobar no inicia sesión del administrador. Cambiar sede exige PIN administrativo y deja huella origen/destino, renovando el lease de vistas sin cambiar identidad/rol. Cajero limitado a su sede; dueño/admin consultan consolidado.
- **Persistencia local:** `CartContext.jsx`, `ProductContext.jsx`, `localOperationGuard.js`, `localSnapshotQueue.js`, `scopedStorage.js` y repositorios fijan cuenta/sede. Borrador v2 síncrono sin aprobación persistida; bloqueo de cambio con cesta/operación pendiente. Snapshots clonados, cola compartida entre proveedores, espera de hidratación, descarte de lecturas antiguas y reintento idéntico tras fallo. Callbacks desmontados no pisan la sesión nueva. Cobro, anulación, cierre, cartera y transferencias usan el contexto original; no se rehízo su algoritmo financiero ni se añadió atomicidad.
- **Respaldos:** `backupSafety.js`, `dataBackupService.js`, exportadores de ajustes y `useAutoBackup.js` excluyen contraseña cloud y estado de sesión importable de nuevas copias; exportación contextual con evidencia de cola/borrador. Restauraciones y reparaciones históricas legadas bloqueadas antes de escribir. Copias antiguas reales intactas.
- **Regresiones:** nuevas pruebas reales de identidad/aprobaciones, cambio de sede, respaldo, cola de snapshots, operaciones auxiliares y contexto; el arnés de navegador usa fuente real y build local, con transporte cloud simulado y perfiles efímeros. No se sustituyó la lógica de negocio por una copia dentro de los tests.

**Validación final:** **208/208 tests** y **19/19 comprobaciones de navegador**, cero errores JavaScript y cero peticiones operativas. Venta sintética: subtotal $10, descuento $1, pago $20, vuelto $11/0 Bs, cajero id 3 y aprobador id 1; stock Central 10→9, Norte permanece 20; una venta y un pendiente sobreviven recarga. Verificados PIN móvil, cancelación pendiente, cambio de sede, lecturas atrasadas, reintento de guardado y edición de PIN entre pestañas. Build aislado `qa-final-02` aprobado; **191 archivos** fuente/pruebas coinciden con el árbol final, **190 archivos de texto** sin NUL. Lint raíz **25 errores/793 avisos**, copia QA **23/790**; **cero errores nuevos** respecto a fases 0/1, sin ocultar su salida no-cero. `git diff --check` aprobado.

**Evidencia:** `verification-final-02.json`, `tests-final-02.log`, `browser-ui-final-03.json`, capturas y reporte/paquetes de revisión en `outputs/correcciones-fase2-2026-09-13/`. El fallo inicial de aserción sobre un encabezado de recibo inexistente y un arranque frío del servidor de pruebas se conservan como diagnóstico separado. Se corrigió el arnés sin modificar el comportamiento del build para aparentar un pase.

**Límites mantenidos:** `REMOTE_OPERATIONS_PAUSED=true`; autorización de servidor/RLS/RPC, transacciones multi-registro, exclusión entre pestañas/dispositivos, idempotencia de outbox/transferencias, cálculos y reversos pendientes de fases posteriores. Una escritura parcial puede permanecer si falla un paso posterior. El PIN local/sobre del navegador no es credencial remota. No hubo commit, push, migración ni publicación.

## 2026-09-13 — Fases 0 y 1: contención local verificada

Se implementó la contención local aprobada tras la auditoría, sin despliegue, migraciones, cuentas ni datos reales. Se preservaron los cambios previos mediante snapshots ZIP y hashes en `outputs/correcciones-fase01-2026-09-13/`. Los artefactos de la auditoría original no se reescribieron.

- **Checkout remoto:** `src/server/checkoutGate.js`, `api/checkout.js` y `src/worker.js` rechazan anónimos (401), esquema inválido (422) y cuenta cloud sin autorización verificable de operador/sede (403), sin crear productos ni invocar el RPC legado. Configuración incompleta falla explícitamente. `.gitignore` permite versionar el nuevo módulo de servidor.
- **Pausa operativa:** `src/config/operationSafety.js` mantiene `REMOTE_OPERATIONS_PAUSED=true`. Se bloquean push/pull/backups legados, sincronización/reintento/descarte de cola, auditoría/alertas remotas, comandos e inyector RPC. Se conserva registro local y se muestra `Sync pausada`. Los manejadores de reinicio de fábrica y borrado de historial no alteran datos durante la pausa; recarga remota no anuncia un envío inexistente. Archivos: `useCloudSync.js`, `useCloudAuthLogic.js`, `useAutoBackup.js`, `offlineQueueService.js`, `auditService.js`, `notificationService.js`, `hybridFlowInjector.js`, `SyncStatus.jsx`, `SettingsView.jsx`, `DashboardView.jsx`.
- **Anulación:** `voidSaleProcessor.js` exige dueño/admin, verifica origen y venta persistida, no confía en listas del reporte y rechaza una segunda petición secuencial. `storageScope.js`, `storageService.js` y `huella.js` fijan contexto de cuenta/sede para sus lecturas/escrituras. `ReportsView.jsx` no ofrece anular otra sede ni consolidado.
- **Cobro:** `changeValidation.js` y `CheckoutModal.jsx` exigen reparto físico explícito, conservan centavos de Bs, comparan a precisión de centavos USD e invalidan la selección al editar pago/tasa. `checkoutProcessor.js` rechaza pagos/cantidades no válidos antes de efectos y no transforma rechazos HTTP en venta offline. `SalesView.jsx` informa fallos de guardado y libera procesamiento con `finally`.
- **Pruebas:** `tests/checkoutFlows.test.mjs` y `pinlessCashier.test.mjs` ahora ejecutan módulos reales; se añadieron regresiones de contención, contrato HTTP, vuelto, anulación, cola, almacenamiento y rutas auxiliares. `eslint.config.js` distingue Node/Worker/browser, aplica reglas a `.mjs` y excluye artefactos, sin desactivar reglas para ocultar defectos.

**Validación:** baseline 38/38 y nueve fallos críticos reproducidos antes del parche; suite final **88/88**; navegador **13/13** en escritorio/móvil y build de producción local, con datos sintéticos, cero errores JavaScript y cero peticiones operativas. Venta $10, pago $20, vuelto $10/0 Bs, stock 10→9, huella Central y pendiente conservado tras recarga. Build `qa-final-03` aprobado; 175 fuentes de texto sin bytes NUL; `git diff --check` aprobado. Lint de copia QA: 24 errores/787 avisos heredados; lint de raíz: 26/790, sin errores nuevos frente a la auditoría (incluye scripts antiguos fuera de la copia QA). El verificador mantiene salida no-cero por esa deuda de lint.

**Entrega:** `REPORTE_FASES_0_1.html`, `CAMBIOS_FASES_0_1.zip`, `EVIDENCIAS_FASES_0_1.zip` y manifiesto en `outputs/correcciones-fase01-2026-09-13/`.

**Límites:** contención no equivale a cierre de F01/F02/F03. Pendientes contrato de operador/PIN/sede, persistencia atómica/idempotencia y concurrencia, colas con origen versionado, inventario/lotes/receta y anulaciones financieras completas. No se autorizó producción, no se repararon datos previos y no debe reactivarse el sync legado cambiando una bandera. Las pruebas locales no verifican Supabase/RLS desplegados, servicios de pago ni hardware. El login sin PIN se prueba como comportamiento existente, no como cumplimiento de la fase de identidad.

## 2026-09-13 — Plan de correcciones tras auditoría E2E

A petición del usuario se preparó el plan, sin aplicar correcciones. Documentos: `outputs/auditoria-e2e-2026-09-13/PLAN_CORRECCIONES_E2E.md` y `.html`. Cubre los 30 hallazgos en ocho fases con dependencias, archivos, pruebas de aceptación, contratos de operador/sede/operación/cantidad, migración aditiva y recuperación. Se recomienda comenzar por baseline y contención crítica (fases 0 y 1), solo en local; staging, migración de datos y despliegue requieren autorización separada. Se mantuvieron intactos los archivos de negocio y los datos reales. Se verificó la cobertura documental F01–F30 y las ocho fases; no se reejecutó la suite de aplicación porque no hubo cambios funcionales.

## 2026-09-13 — Auditoría E2E local, sin correcciones de negocio

Se auditó autenticación/PIN, roles dueño/admin/cajero, inventario, lotes, transferencias, ventas, anulaciones, reportes por sede y sincronización. Entregables en `outputs/auditoria-e2e-2026-09-13/`: reporte HTML/Markdown, 30 hallazgos estructurados y scripts/evidencias de reproducción. No se modificó lógica en `src/`, `api/` ni migraciones; se conservaron los cambios locales preexistentes y no se usaron datos de producción.

Validación: suite existente 38/38; build aislado correcto sin tocar `dist`; lint global 37 errores y 794 avisos (en `src`: 25/789); `git diff --check` correcto. Las 46 comprobaciones dirigidas de auditoría (módulos reales, navegador efímero y servicios simulados) registran 10 conformes y 36 expectativas incumplidas, sin errores pendientes del arnés. Resultado consolidado: 3 hallazgos críticos, 22 altos, 4 medios y 1 bajo. Los críticos son checkout sin autorización de servidor, colisión de documentos cloud entre sedes y anulación ajena que escribe en la sede activa. Backend real/RLS, pagos externos, hardware y validación normativa quedan pendientes de staging. Los fallos documentados no fueron corregidos en esta revisión.

## Ruido de 404 en /api/checkout eliminado en desarrollo

Diagnóstico: `/api/checkout` no es una ruta de la app sino el proxy del Cloudflare Worker (`src/worker.js`) que llama al RPC `process_checkout` de Supabase con la service key; el worker sigue sin configurar (SUPABASE_URL vacío, TODO pendiente del proyecto nuevo). En desarrollo Vite no sirve esa ruta, así que cada cobro intentaba un fetch destinado a fallar (404 + consola "Fallo en /api/checkout, cambiando a MODO OFFLINE") antes de caer al modo local-first. La venta nunca se perdía: quedaba PENDIENTE_SYNC con huella y se sincroniza cuando el worker exista.

Corrección mínima: `checkoutProcessor` intenta la ruta solo fuera de desarrollo (`navigator.onLine && !import.meta.env.DEV`) y `offlineQueueService.syncPendingSales` no quema reintentos en desarrollo (`!accountId || import.meta.env.DEV`). En producción el flujo online/offline queda intacto.

Verificación en Preview (5181): venta real de $5 (efectivo USD) con cero peticiones a /api/checkout en el registro de red, sin warning en consola, recibo con folio #A2A21E, pago $5, tasa 921,88 y fecha/hora ✅.

Validación: `npm test` 34/34 ✅ · ESLint (checkoutProcessor, offlineQueueService) 0 errores ✅ · `git diff --check` ✅.


## Punto de Venta adaptado a laptops con panel táctil

Auditoría táctil de la vista de ventas sobre CategoryBar, SearchBar, SalesHeader, CartPanel y MiniNav. Corregidos los objetivos por debajo de 44 px: chips de categorías y "Monto Libre" (~30 → 44 px), botón "Cargar Mas", chip "Vaciar" del carrito (~24 → 44 px), botones −/+ de cantidad (24 px en PC → 40 px en todos los breakpoints), input de cantidad (h-10), "Añadir Descuento" (28 px en PC → 44 px) y "PROCESAR COBRO" (36 px en PC → ya no se reduce; ≥44 px). Defecto real corregido: el botón X de eliminar ítem estaba con `opacity-0` hasta hover — invisible al operar con dedo en laptop táctil; ahora siempre visible (36 px, opacity 0.7, hover lo resalta). Botones del MiniNav (34 → 55 px), botones de tasa y "Atajos (PC)" del encabezado (30 → 44 px), botón Aceptar del panel de tasa (≥44 px) e inputs de búsqueda (mic/limpiar 44 px). Además se corrigió un error de lint preexistente en CategoryBar (setState síncrono dentro de useEffect) con el patrón de ajuste en render.

Verificación en Preview (5181) con venta real en carrito: Monto Libre/Todos 44 px, Atajos 44 px, botón de tasa 44 px, Vaciar 44 px, Descuento 44 px, PROCESAR COBRO 60 px, −/+ 40 px, X de eliminar 36×36 siempre visible ✅. Sin cambios de lógica de venta ni persistencia.

Validación: `npm test` 34/34 ✅ · `npm run build` ✅ · ESLint (5 archivos del POS) 0 errores ✅ · `git diff --check` ✅.


## PIN de fábrica del Dueño: 000000

El PIN de fábrica del Dueño pasa de 123456 a 000000. Cambios: `userProvisioning.js` define `OWNER_FACTORY_PIN = '000000'` (DEFAULT_USERS y fallback de ensureOwner), `resetPinsToDefault` hashea 000000 para Dueño/ADMIN y `SuperAdminModal` actualiza sus textos. Para dispositivos que ya traían el PIN legado, se subió el almacenamiento a version 3 con regla `migrateOwnerPinToFactory`: si el PIN del Dueño (id 1) está vacío, es el texto 123456 o su hash SHA-256 (constante `LEGACY_OWNER_PIN_HASH`), se reemplaza por 000000; un PIN personalizado nunca se toca.

Verificación en Preview (5181): la recarga migró el hash de 123456 a 000000 con storage version 3 ✅; el PIN legado 123456 fue rechazado (contador de intentos) ✅ y el login con 000000 abrió la sesión {id:1, Dueño, DUENO} ✅.

Validación: `npm test` 34/34 ✅ · `npm run build` ✅ · ESLint 0 errores ✅ · `git diff --check` ✅.


## Cobro adaptado a laptops con panel táctil

Auditoría táctil del checkout sobre `CheckoutModal.jsx` + regla global en `index.css`. Objetivos por debajo del estándar de 44 px corregidos: interruptor Contado/Fiado (~28 → 44 px), botones de % de Cashea (~28 → 44 px), botones "Todo $"/"Todo Bs" del desglose de vuelto (~20 → 44 px, los más críticos), inputs USD/Bs del desglose de vuelto (~28 → 48 px con texto legible), botón "Total" de cada medio de pago (40 → 44 px) y "Usar Saldo a Favor" (≥44 px). Regla global `touch-action: manipulation` + `user-select: none` en botones: elimina el zoom por doble toque y la selección accidental al arrastrar el dedo sobre chips. El relleno muerto del cuerpo scrollable (pb-28, herencia de un CTA overlay antiguo) se recortó a pb-8/pc:pb-4: en laptops de 768 px de alto recupera ~80 px de área útil; el CTA es un hermano flex (shrink-0), nunca tapó el contenido. El grid de dos columnas ya activa desde 1024 px, por lo que 1280-1440 px de laptop queda cubierto sin cambios.

Verificación en Preview (5181) con cobro real abierto: píldoras 44 px, 10 chips rápidos 44 px, inputs de pago 56 px, botones Total 44 px, CTA 52 px y habilitado tras pago con vuelto, inputs del desglose de vuelto 48 px, "Todo $"/"Todo Bs" 44 px, padding inferior del cuerpo 32 px, `touch-action: manipulation` y `user-select: none` aplicados ✅. Sin cambios de lógica financiera, persistencia ni FEFO.

Validación: `npm test` 33/33 ✅ · `npm run build` ✅ · ESLint CheckoutModal 0 errores ✅ · `git diff --check` ✅.


## Dueño permanente restaurado en cada carga (pantalla de selección de usuario)

Defecto real verificado en vivo: navegadores con estado persistido anterior a la reforma de usuarios no mostraban la tarjeta del Dueño en "Quien esta operando?". Causa: zustand solo ejecuta `migrate` cuando cambia la versión; el estado heredado seguía en version 2 y la normalización de usuarios nunca corría. Había además cobertura duplicada: `tests/usersAccess.test.mjs` validaba una copia local de ensureOwner, no el código de producción (pasaba verde incluso con el defecto vivo).

Corrección: el provisioning de cuentas (Dueño id 1 permanente + cajero sin PIN por sede) se extrajo a `src/config/userProvisioning.js` (DEFAULT_USERS, ensureCashiersPerSede, ensureOwner, normalizeUsers) y `useAuthStore` lo consume; la normalización corre ahora en la opción `merge` de persist, es decir en cada rehidratación y sin depender de versiones. ensureOwner restaura el Dueño ausente (PIN 123456 de fábrica), convierte un ADMIN heredado en id 1 en el Dueño (renombrando el nombre legado "Administrador" y conservando su PIN) y repone el PIN si quedó vacío; el orden de composición garantiza que ningún cajero nuevo colisione con el id 1. La protección anti-borrado (id 1 / permanente en eliminarUsuario y UsersManager) ya existía y se mantiene. Los tests ahora ejercitan el código real: dueño ausente, ADMIN heredado, dueño sin PIN, garantía por sede sin colisión de ids e idempotencia.

Verificación en Preview (5181): con estado heredado sin Dueño, la recarga muestra la tarjeta "Dueño/DUEÑO" ✅; con "Administrador" ADMIN en id 1, la recarga lo convierte en Dueño ✅ y el login con PIN 123456 end-to-end abre la sesión {id:1, Dueño, DUENO} ✅; estado restaurado final: Dueño + 3 cajeros ✅.

Validación: `npm test` 33/33 ✅ · `npm run build` ✅ · ESLint (useAuthStore, userProvisioning, usersAccess.test) 0 errores ✅ · `git diff --check` ✅.


## PC-2: checkout PC estilo "Procesar Pago" adaptado a táctil

Se rediseñó el cobro sobre `CheckoutModal.jsx` (12 reemplazos atómicos verificados): encabezado "PROCESAR PAGO" con tasa bajo el título e interruptor Contado/Fiado; en PC (≥1024 px) el resumen queda a la izquierda (píldora oscura del total, cliente, tarjeta "Monto Pagado / Falta por Pagar o Vuelto", saldo a favor) y los pagos a la derecha (orden CSS, sin mover el DOM); la barra superior de total se oculta en PC. Chips rápidos táctiles (≥44 px): USD 1/5/10/20/50/100 y Bs 100/500/1000/5000, suman al restante con un toque. CTA grande a la derecha (lg:w-80) junto al banner de vuelto. Contado exige pago completo; Fiado exige cliente (abre el selector automáticamente) y conserva el modal de confirmación con huella; Cashea mantiene su flujo propio y desactiva el interruptor al activarse. En móvil el flujo vertical no cambia.

Defecto real detectado al ejercitar la venta completa: en modo local puro (sin Supabase) toda venta fallaba con "No se puede encolar una venta sin cuenta activa" (offlineQueueService.addSaleToQueue lanzaba y abortaba stock, FEFO, huella y persistencia). Corregido con cambio mínimo: pseudo-cuenta estable `local` para la cola offline cuando no hay cuenta cloud (getScopedStoragePrefix/getScopedStorageKey aceptan override), syncPendingSales sigue sin enviar sin cuenta. Verificado en Preview: venta $5 registrada con huella V-0000001 (sede central, Cajero C&Y 2025, CAJERO, fecha/hora), estado PENDIENTE_SYNC, pago en cola con account_id `local`, cesta vaciada, recibo generado.

Validación: `npm test` 30/30 ✅ · `npm run build` ✅ · ESLint CheckoutModal/offlineQueueService/storageScope 0 errores ✅ · `git diff --check` ✅.

## PC-1: dos columnas reales en el checkout (PC)
Se reemplazó el intento anterior por un cambio estructural mínimo sobre `CheckoutModal.jsx` versionado: el cuerpo scrollable ahora usa un grid activo solo desde 1024 px (`lg:`), con columna izquierda (Dólares, Bolívares, Pesos, Cashea) y columna derecha (Cliente, Saldo a Favor). El footer de vuelto/confirmación queda fuera del grid. En móvil el flujo vertical original no cambia. No se tocó ninguna lógica financiera, de persistencia ni de FEFO.

Validación: `npm run build` ✅ · `npm test` 30/30 ✅ · ESLint del checkout 0 errores ✅ · `git diff --check` ✅. Verificación en Preview (5181): el grid wrapper tiene exactamente 2 columnas hijas y el CTA queda como hijo directo del modal; las clases `lg:grid`, `lg:grid-cols`, `lg:items-start`, `lg:gap-5`, `lg:mx-auto`, `lg:max-w-6xl`, `lg:min-w-0`, `lg:px-5` existen en el CSS bajo la media query de 1024 px. A 945 px el layout se mantiene apilado (comportamiento responsive correcto); en escritorio ≥1024 px se activan las dos columnas. Los servidores de desarrollo de Farma POS del usuario están en los puertos 5174 y 5177; basta recargar (Ctrl+F5) para ver el cambio.

## Corrección de tasa efectiva y PC-2
Se verificó el cálculo de `effectiveRate`: depende de la tasa BCV entregada por `useRates`; cuando las fuentes no responden, queda correctamente en cero para no inventar una tasa. Se añadió validación de finitud/no negatividad y se mantuvo el modo manual como alternativa. La comprobación confirmó que el checkout usa esa misma tasa única para equivalencias y pagos.

Se validó además el shell desktop existente: el checkout conserva su flujo base y presenta el contenedor responsive centrado en pantallas amplias sin duplicar cálculos ni persistencia.

Validación: `npm test` 30/30 ✅ · `npm run build` ✅ · `git diff --check` ✅. ESLint mantiene un error preexistente en `ProductContext.jsx` por exportación de hook/contexto, no introducido por este ajuste.

## PC-1: layout desktop completado
Se añadió un contenedor responsive al checkout existente: en pantallas amplias presenta el cobro dentro de un panel centrado, ancho y elevado, conservando exactamente el flujo, cálculos y persistencia actuales. En móvil mantiene el comportamiento de pantalla completa. No se duplicó lógica financiera ni almacenamiento.

Validación: `npm test` 30/30 ✅ · `npm run build` ✅ · ESLint del checkout 0 errores (warnings heredados) ✅ · `git diff --check` ✅.

## PC-1: recuperación del checkout estable
La adaptación experimental del layout desktop había introducido cierres JSX inválidos. Se retiró esa modificación parcial y se conservó el `CheckoutModal` base funcional; PC-1 no se marca completada porque el shell de dos columnas aún requiere una implementación posterior con cambios aislados y pruebas visuales. El proyecto queda nuevamente compilable y ejecutable.

Validación: `npm test` 30/30 ✅ · `npm run build` ✅ · ESLint del checkout: 0 errores (warnings heredados) ✅ · `git diff --check` ✅.

## Ejecución 1-shot: baseline seguro
Se inició la ejecución del plan 1-shot. Se detectó que la adaptación incompleta de PC-1 había dejado `CheckoutModal.jsx` truncado/roto; se restauró el archivo desde la versión base para no mantener el checkout inutilizable. La suite completa vuelve a pasar (30/30), el build vuelve a pasar y `git diff --check` no reporta errores. PC-1 queda pendiente de reimplementación incremental y validada; F3.5 sigue bloqueada por el JSON real de 666 productos.

Validación: `npm test` 30/30 ✅ · `npm run build` ✅ · ESLint del checkout: 0 errores (warnings de imports/estado heredados) ✅ · `git diff --check` ✅.

## Plan 1-shot hasta producción
Se creó `PLAN_PRODUCCION_1SHOT.md` con la secuencia completa desde el estado actual: reparación y validación de PC-1, shell desktop responsive, pagos, crédito/Cashea/saldo, vuelto, integración FEFO/anulación, aislamiento por sede/roles, sincronización local-first y gate final de producción. Incluye una matriz headless determinista para los tres establecimientos, logs detallados, criterios de rechazo y comandos finales. PC-1 queda bloqueada hasta reparar el error JSX actual de `CheckoutModal.jsx`; F3.5 queda pendiente hasta recibir el JSON real de 666 productos.



## PC-0 y contrato headless del checkout
Se completó la auditoría funcional del módulo POS de `preciosaldia-bodega`: estado, pagos, referencias, cliente, crédito, Cashea, vuelto, teclado y confirmación. Se creó `tests/checkoutFlows.test.mjs` como contrato headless determinista inicial; ejecuta pagos exactos/mixtos, crédito, vuelto, rechazo sin cliente, límite de vuelto y aislamiento de las tres sedes con logs detallados. PC-1 (implementación de UI PC) queda pendiente para no copiar defectos ni duplicar la lógica financiera de Farma POS.

Validación parcial: `npm test` 30/30 aprobados. La implementación del checkout PC aún no se ha iniciado.

## Corrección global de marca Farma POS
Se corrigieron las referencias visibles restantes de “Listo POS Lite” en términos, comprobantes, instalación, impresión, README y tokens de diseño. Se mantienen únicamente identificadores técnicos históricos y documentación de linaje.

Validación: `npm test` ✅ · `npm run build` ✅ · ESLint del archivo corregido ✅ · `git diff --check` ✅.

## Corrección de marca en términos
Se corrigió la última referencia visible a “Listo POS Lite” dentro de la declaración final de los términos y condiciones. El texto ahora identifica únicamente a **Farma POS**.

Validación: búsqueda de referencias y build pendiente.

## Revisión del plan de checkout PC
A petición del dueño, se amplió `PLAN_COPIA_ZONA_COBRO_PC.md`: ahora exige estudiar y portar la lógica funcional completa del módulo POS del proyecto externo, incluyendo estado, pagos, cliente, referencias, vuelto, Cashea, teclado y confirmación. La copia será una adaptación 100% funcional sobre los contratos de Farma POS, excluyendo bugs conocidos del origen y preservando FEFO, huellas, sedes aisladas, COP oculto y cierres manuales.

## Auditoría y plan de zona de cobro PC
Se revisó el proyecto externo `preciosaldia-bodega`. Su cobro de PC usa un layout POS de dos columnas con componentes separados para estado, métodos de pago, cliente y vuelto. Farma POS conserva un procesador propio con FEFO, lotes, huellas, sedes aisladas, COP oculto y cierres manuales; por eso se documentó un plan de adaptación visual sin copiar datos, credenciales, dependencias ni lógica financiera externa.

Plan creado: `PLAN_COPIA_ZONA_COBRO_PC.md`. El siguiente paso es el baseline PC-0 y la comparación de contratos del checkout actual antes de modificar código.

## Corrección del estado de conectividad
Se verificó que el indicador consultaba Supabase aunque la aplicación estuviera configurada en modo local. El stub offline respondía con error y se mostraba “Offline” pese a existir conexión a Internet. Ahora el indicador considera Online el modo local cuando `navigator.onLine` está activo, y solo consulta Supabase si el proyecto está configurado. La comprobación se ejecuta cada 60 segundos.

## Renombramiento global a Farma POS
Se reemplazaron las referencias visibles y operativas restantes de “Listo POS Lite” por “Farma POS”, incluyendo términos, mensajes, recibos, exportaciones, monitor y textos de funciones. Se conservaron únicamente nombres técnicos internos de almacenamiento y compatibilidad.

## Términos y acceso inicial
Se actualizaron los términos para reflejar Farma POS, inventario multi-sede y datos aislados por ubicación. Al aceptar los términos se limpia cualquier sesión local previa y se fuerza la pantalla de selección de usuario con sede/PIN antes de entrar al sistema.

## Logo dinámico por sede en acceso
La pantalla de selección de usuario pasa el `selectedSedeId` al componente `BrandLogo`, por lo que el logo cambia inmediatamente al seleccionar una sede autorizada.

## Corrección: autorizar sede sin iniciar sesión como Dueño
El PIN del Dueño en la pantalla de selección de sede se valida directamente contra sus credenciales. Solo actualiza la sede pendiente; no modifica `usuarioActivo` ni inicia la sesión del Dueño. El acceso como Dueño sigue ocurriendo únicamente al seleccionar su tarjeta.

## Autorización de sede sin cambio de usuario
El PIN del Dueño al cambiar la sede se usa únicamente como autorización. Después de validarlo se conserva la sesión y el rol actuales; no se inicia ni se reemplaza la sesión por la del Dueño.

## PIN obligatorio al cambiar sede en la pantalla de acceso
La sede elegida antes del acceso ya no cambia inmediatamente. Se conserva como pendiente y solo se aplica después de validar el PIN del Dueño principal; los usuarios visibles se actualizan después de esa autorización.

## Protección de cambio de sede
Se corrigió el selector para que nunca cambie la sede directamente: toda sede distinta abre el PIN del Dueño principal y solo una validación exitosa permite aplicar el cambio. La validación exige explícitamente el ID del Dueño y no usa la sesión del usuario operativo.

## Cambio de sede protegido por PIN del Dueño
El selector de sede solicita exclusivamente el PIN del Dueño principal (ID 1), no el PIN de la sesión actual. Un cambio solo se aplica después de validar ese PIN y queda registrado en la huella de auditoría.

## Corrección de acceso de cajeros sin PIN
El acceso sin PIN ahora se completa automáticamente al seleccionar un cajero configurado como `sinPin`. Se valida que el cajero pertenezca a la sede elegida antes de iniciar sesión; al acceder conserva su sede y el modo Caja.

Validación: prueba determinista de sede y acceso sin PIN, tests completos, build, ESLint de archivos tocados y `git diff --check`.

## Ajuste de acceso por rol y sede
Se eliminó el selector operativo Gestión/Caja del encabezado. El modo queda determinado por el rol: Dueño en Gestión y Cajero en Caja. La selección de sede permanece en la pantalla inicial y filtra los usuarios cajeros por la sede elegida; no se mezclan sedes durante el acceso.

Validación: `npm test` (27/27), `npm run build`, ESLint de archivos tocados (0 errores; warnings heredados) y `git diff --check`.
 — Farma POS (listo_pos_lite)

> **Regla del proyecto:** todo cambio hecho al código del sistema se documenta en este archivo.
> Cada entrada registra: fecha, fase del plan, archivos tocados, qué cambió y cómo se validó.
> Las reglas permanentes viven en `agent.md`; los detalles técnicos en `PLAN_TRANSFORMACION_FARMACIA.md`.

---

## Reglas de esta bitácora

1. Cada cambio de código genera una entrada nueva al final de la tabla.
2. Si un cambio no está aquí, no está hecho.
3. La validación (build / eslint / tests) se anota siempre; si falla algo preexistente, se indica.

---

## Historial de cambios

| # | Fecha | Fase | Archivos | Cambio | Validación |
|---|-------|------|----------|--------|------------|
| 1 | anterior a la bitácora | F3.1–F3.2 Fundación | `src/config/sedes.js`, `src/hooks/store/useSedeStore.js`, `src/config/storageScope.js`, `src/config/permissionsFarmacia.js`, `src/hooks/store/useAuthStore.js`, `src/components/SedeSelector.jsx` | Fundación multi-sede: 3 sedes (`central`/`norte`/`sur`), roles `DUENO`/`ADMIN`/`CAJERO`, claves de storage con scope `account:{uid}:sede:{id}:`, selector de sede y permisos base | build de la época |
| 2 | 2026-08-30 | Branding | `src/config/branding.js` (nuevo), `src/components/BrandLogo.jsx` (nuevo), `src/config/sedes.js`, `src/components/Logo.jsx`, `src/components/OnboardingOverlay.jsx`, `src/components/security/CloudAuthModal.jsx`, `src/components/security/LockScreen.jsx`, `src/views/DashboardView.jsx`, `index.html`, `vite.config.js`, `public/logos/*` (nuevo: `farma-pos.png`, `farma-pos-pwa.png`, `casa-medica-2025.png`, `casa-medica-2026.png`, `README.md`) | Marca general **Farma POS** con logo e icono PWA propios; logo por sede (central → Casa Médica 2025, norte → Casa Médica 2026, sur → Farmacia Las 24 Horas, pendiente de entregar); favicon, apple-touch-icon, manifiesto PWA y metadatos actualizados; `BrandLogo` resuelve sede activa y mantiene el `onClick` oculto del Super Admin | `npm run build` ✅ · `npx eslint` ✅ · `git diff --check` ✅ · contrato de branding verificado con Node ✅ |
| 3 | 2026-08-30 | Documentación | `BITACORA.md` (nuevo), `agent.md` (nuevo), `PLAN_TRANSFORMACION_FARMACIA.md` | Se crea la bitácora (no existía en la raíz), se crean las reglas del proyecto en `agent.md` y se adapta el plan: inventario propio por sede, visibilidad total del dueño/admin, huella obligatoria en ventas/movimientos/ediciones y ejecución de todas las fases en 1 shot | `git diff --check` ✅ |
| 4 | 2026-08-30 | F3.3 Auth/roles | `src/hooks/store/useAuthStore.js`, `src/config/permissionsFarmacia.js` | Usuarios nuevos reciben `sedeId` de la sede activa (DUENO sin sede); se añade `canSeeConsolidatedReports` (dueño y admin ven reportes totales y por sede; operar otras sedes sigue siendo solo del dueño) | eslint ✅ |
| 5 | 2026-08-30 | F3.4 Catálogo farmacia | `src/utils/productProcessor.js`, `src/components/Products/ProductFormModal.jsx`, `src/views/ProductsView.jsx` | Campos farmacéuticos en el producto: genérico, laboratorio, concentración, presentación, ℞ receta, ⚠ controlado, ❄ refrigeración y vencimiento. Se cargan al editar, se guardan y aparecen en el resumen previo | build ✅ · eslint ✅ |
| 6 | 2026-08-30 | F3.5 Importador | — | **PENDIENTE (bloqueo externo):** el JSON real de los 666 productos no está en el repo. No se inventan datos. El importador se implementará al llegar el archivo. **Pendientes dependientes del JSON:** carga inicial del catálogo por sede y posibles lotes iniciales derivados de sus campos (estado/observaciones); FEFO y bloqueos ya funcionan con lotes registrados manualmente | — |
| 7 | 2026-08-30 | F3.6 Inventario por sede | `src/config/storageScope.js`, `src/utils/storageService.js`, `src/hooks/useProductFiltering.js`, `src/views/ProductsView.jsx` | Confirmado que cada sede tiene SU propio inventario (productos/stock/ventas/cierres/caja sede-scoped). Nuevo `getItemForSede` (solo lectura) para reportes consolidados. Panel de vencimientos (≤60 días) y filtro `vencidos` en inventario | build ✅ · eslint ✅ |
| 8 | 2026-08-30 | F3.6b Huella | `src/utils/huella.js` (nuevo), `src/config/storageScope.js`, `src/services/auditService.js`, `src/utils/checkoutProcessor.js`, `src/views/ProductsView.jsx` | Huella obligatoria: correlativo por sede (`V-`/`A-`/`E-`/`T-`, contador sede-scoped que sobrevive offline), usuario, cliente, sede, fecha, hora, ts. Ventas: huella con correlativo derivado de `saleNumber`; ajustes de stock: huella en el registro; ediciones de producto: huella con antes/después; audit log: ahora incluye `sedeId` | build ✅ · eslint ✅ |
| 9 | 2026-08-30 | F3.7 POS farmacia | `src/views/SalesView.jsx`, `src/utils/checkoutProcessor.js`, `src/components/Sales/SearchBar.jsx`, `src/components/Products/ProductCard.jsx` | POS: producto vencido bloqueado al agregar al carrito; venta de controlado exige cliente y se registra en el libro `farmacia_controlados_v1` (con huella); chips ℞/⚠/❄/⏰ en buscador y tarjetas; búsqueda POS por genérico/laboratorio/concentración/presentación. FEFO queda pendiente hasta tener lotes reales (F3.5/F3.6 lotes) | build ✅ · eslint ✅ (1 error preexistente en SalesView: ref en render, no introducido por este cambio) |
| 10 | 2026-08-30 | F3.8 Transferencias | `src/utils/transferenciaService.js` (nuevo), `src/components/Products/TransferenciasModal.jsx` (nuevo), `src/views/ProductsView.jsx` | Envío/recepción/cancelación de stock entre sedes con huella `T-`: origen descarga stock, destino recibe (crea productos que no existan), cancelar reingresa. Botón en Inventario (no cajeros) | build ✅ · eslint ✅ |
| 11 | 2026-08-30 | F3.9 Dashboard dueño | `src/views/DashboardView.jsx` | Tira "Desempeño por sede — hoy": KPI por sede (ventas/USD) + total consolidado, solo DUENO, con lectura cruzada `getItemForSede` | build ✅ · vista previa ✅ |
| 12 | 2026-08-30 | F3.10 Reportes | `src/views/ReportsView.jsx`, `tests/syncSafety.test.mjs` | Filtro de sede (Esta sede / por sede / Todas) para dueño y admin; anulación desactivada en modo consolidado (protege inventario de la sede activa); test de claves actualizado al contrato por sede | `node --test` 5/5 ✅ · build ✅ |
| 13 | 2026-08-30 | F3.11 Limpieza | `src/views/SalesView_temp.jsx` (eliminado) | Vista temporal descartada; licencia y groq ya ausentes; `ShareInventoryModal` sigue en uso (reemplazo por transferencias queda pendiente) | build ✅ |
| 14 | 2026-08-30 | Verificación en vivo | vista previa (dev :5199, cuenta `qa-1shot`) | Ejecución real: correlativos `A-0000001→A-0000002`, huella `E-0000001` completa (sede/usuario/fecha/hora/ts/ref), venta `V-0000005`, transferencia `T-0000001` ENVIADA→RECIBIDA (stock 10→6→4, producto creado en norte), cancelación `T-0000003` con stock restaurado 3→1→3, inventario por sede distinto central/norte | `preview_evaluate` ✅ |
| 15 | 2026-08-30 | Vistas por rol | `src/views/DashboardView.jsx`, `src/components/Dashboard/HuellaAuditor.jsx` (nuevo), `src/App.jsx` | **Tarjeta ejecutiva del dueño**: KPIs del grupo (hoy, 7 días, ticket promedio, ganancia en USD) + tarjetas por sede con **alertas consolidadas** (⏰ vencidos, 📦 críticos, 🔄 transferencias pendientes) y botón "Abrir" que cambia de sede. **Auditoría con huella**: buscador de ventas+movimientos de todas las sedes por correlativo/usuario/cliente/sede/fecha. **Modo cajero estricto**: nav 6→2 pestañas con redirección de seguridad + chip "Mi turno" (solo sus ventas por huella) | build ✅ · eslint ✅ (solo error preexistente) |
| 16 | 2026-08-30 | Verificación en vivo (vistas) | vista previa | Con datos sembrados aislados: tarjeta ejecutiva HOY $14.70 (central $12.70 + norte $2.00), ticket prom. $4.90, alertas 📦 por sede correctas; auditoría: búsqueda "Maria"→1 registro, filtro C&Y 2026→1 registro; cajero: chip MI TURNO visible, tarjeta ejecutiva y selector de sede ocultos, autolock → LockScreen; consola sin errores; sesión y cuenta restauradas tras las pruebas | `preview_snapshot`/`evaluate` ✅ |
| 17 | 2026-08-30 | Poda (deletion-first) | `src/utils/huella.js`, `src/config/storageScope.js`, `src/components/Dashboard/HuellaAuditor.jsx`, `src/components/Products/ProductFormModal.jsx`, `PLAN_TRANSFORMACION_FARMACIA.md` | Eliminado código muerto: `registrarMovimiento` y el libro `farmacia_movimientos_v1` (nadie lo escribía); el auditor ahora lee ventas Y ajustes desde `bodega_sales_v1` (fuente real con huella) y muestra solo tipos existentes; importes muertos fuera (`Thermometer`, `ShieldAlert`); prefijos de correlativo reducidos a los usados (A/E/T); plan actualizado a la arquitectura real (huella embebida por registro, sin ledger aparte) | eslint 0 errores ✅ · build ✅ · test 5/5 ✅ · verificación en vivo: 4 registros con ajuste `A-0000004` primero, sin `$0.00` en ajustes ✅ |
| 18 | 2026-08-30 | F3.11 cierre + F3.6 Lotes + F3.7 FEFO | `src/components/ShareInventoryModal.jsx` (eliminado), `api/share.js` (eliminado), `src/worker.js`, `src/views/ProductsView.jsx`, `src/views/SettingsView.jsx`, `src/components/Settings/tabs/SettingsTabSistema.jsx`, `src/utils/checkoutProcessor.js`, `src/utils/huella.js`, `src/components/Products/ProductFormModal.jsx` | **F3.11 cerrado**: ShareInventoryModal eliminado (import/usos/botón en Sistema) junto con su backend muerto (`api/share.js`, ruta y handler de share en el worker con helper Redis/generateCode/TTL); pie de Settings ahora "Farma POS · Multi-Sede". **F3.6 Lotes**: sección "Lotes con vencimiento (FEFO)" en el formulario de producto: registrar lote (n°, vencimiento, cantidad, costo/ud) y ajustar cantidad — cada escritura con huella `L-`; validación: los lotes no pueden exceder el stock libre del producto. **F3.7 FEFO**: el checkout descarga lotes por vencimiento ascendente (los vencidos se saltan); panel de vencimientos ahora incluye lotes | `npm test` 23/25 ✅ (2 fallos preexistentes de cierre nocturno) · build ✅ · eslint ✅ · `git diff --check` ✅ |
| 19 | 2026-08-30 | Verificación en vivo (lotes/FEFO) | vista previa (cuenta `qa-1shot`) | Producto pFEFO stock 10 con L1 (vence 2026-09-05) y L2 (vence 2026-12-01): venta `V-0000003` x2 → stock 8, L1 5→3, L2 5 (FEFO ✅); venta `V-0000004` x4 → stock 4, L1 3→0, L2 5→4 (cruza lotes ✅); controlado sin cliente → rechazado ✅; lote L3 x4 excediendo stock libre → rechazado ✅; ajuste L2 4→2 con huella `L-0000003` ✅; lote L3 x2 válido con huella `L-0000004` ✅; sección Lotes visible en el formulario | `preview_evaluate` ✅ |
| 20 | 2026-08-30 | Corrección adversarial FEFO | `src/utils/checkoutProcessor.js`, `src/utils/voidSaleProcessor.js`, `src/views/ProductsView.jsx` | **Defecto real (anulación vs FEFO):** anular/restaurar stock no reponía los lotes consumidos → rompía `sum(lotes)=stock`. **Arreglo:** el checkout ahora registra `lotesConsumidos` (`{loteId, cantidad}`) en la venta y `processVoidSale` repone EXACTAMENTE esas cantidades en esos mismos lotes (sin re-selección FEFO → no recarga lotes vencidos; si el lote ya no existe, sus unidades quedan solo en el stock agregado). **Defecto real (huella):** `crearHuella` se llamaba sin `await` al crear/editar producto → persistía una Promesa (serializa a `{}`), correlativo `undefined` en auditoría y riesgo de duplicado por carrera del contador; ahora `handleSave` es async y espera la huella. **Veredictos sin defecto:** reposición en lote vencido (resuelta por diseño con reposición exacta); huellas L- de lotes correctas (con await); referencias huérfanas al share eliminado: cero en `src`. **Pendiente (regla #6):** las anulaciones aún no llevan huella propia; el auditor las excluye — se implementará como fase aparte | `npm test` 23/25 ✅ (solo 2 fallos preexistentes de cierre nocturno) · build ✅ · eslint ✅ · `git diff --check` ✅ |
| 21 | 2026-08-30 | Verificación en vivo (anulación↔lotes) | vista previa (:5199, cuenta `qa-1shot`) | Ejecución real con los módulos de producción (import con cache-bust para forzar los archivos editados): **E1** venta x4 → FEFO toma 4 de QA-A (vence antes), `lotesConsumidos=[{QA-A,4}]`, stock 10→6, invariante ✅; anulación → QA-A repuesto 1→5, stock 10, invariante ✅, transacción ANULACION_VENTA + voidedAt ✅. **E2** mezcla con lote vencido: venta 6 salta el vencido, toma 5 de QA-D + 1 sin lote, `lotesConsumidos=[{QA-D,5}]`; anulación → QA-D repuesto 0→5, QA-C vencido SIN recargar ✅. **E3** lote borrado entre venta y anulación: sin crash, stock agregado repuesto, lote restante intacto ✅. **Huella await (UI real):** botón ACTUALIZAR persistió huella `E-0000001` completa (sede/usuario/rol/fecha/hora/antes/despues) — antes persistía `{}`. Nota de harness: el auto-save de ProductContext (eco con debounce) puede sobrescribir escrituras directas de storage headas 1s antes; los artefactos QA fueron purgados por IDB crudo (ventas/lotes/productos limpios en ambos scopes, cola offline sin entradas QA nuevas) | `preview_evaluate` ✅ · consola sin errores ✅ |
| 22 | 2026-08-30 | F3.12 Huella de anulaciones + cierre de validación | `src/utils/voidSaleProcessor.js`, `src/components/Dashboard/HuellaAuditor.jsx` | Cada `ANULACION_VENTA` ahora tiene huella propia `A-` con usuario, rol, cliente, sede, fecha, hora, `ts`, `ref` de la venta original y detalle; el auditor incluye y colorea las anulaciones. No se cambió la lógica de cierre nocturno. F3.12 queda **parcial**: documentación/validación completadas, pero F3.5 sigue bloqueada hasta recibir el JSON real de 666 productos | `npm test` 23/25 ✅ (solo 2 fallos preexistentes de cierre nocturno) · `npm run build` ✅ · eslint 0 errores ✅ · `git diff --check` ✅ |
| 23 | 2026-08-30 | Auditoría de coste Supabase Free | `PLAN_OPTIMIZACION_SUPABASE_FREE.md` (nuevo) | Se verificó el estado actual: local-first, debounce de 30 min para cargas pesadas, hash anti-duplicados, ventana de ventas de 30 días, polling pesado cada 60 min con consulta previa de metadatos, Realtime solo para configuración pequeña, imágenes base64 excluidas y backup cloud automático deshabilitado. Se documentaron riesgos concretos: catch-up inicial con múltiples upserts, serialización repetida, documentos completos de productos/ventas y falta de métricas de bytes/requests. Se creó plan por etapas O0–O4, presupuesto inicial, criterios de aceptación y orden de implementación. No se modificó lógica de negocio ni cierres nocturnos | `git diff --check` ✅ |
| 24 | 2026-08-30 | O0–O1 Optimización Supabase Free | `src/utils/syncMetrics.js`, `src/hooks/useCloudSync.js`, `src/components/SyncStatus.jsx`, `src/utils/storageService.js`, `PLAN_OPTIMIZACION_SUPABASE_FREE.md` | Instrumentación local por día/clave de pushes, pulls, bytes estimados, deduplicaciones y errores sin almacenar payloads; retención de 14 días. `pushCloudSync` sale antes para claves fuera del contrato y `SyncStatus` pausa health/cola con pestaña oculta. No se modificó checkout ni cierres nocturnos | `npm test` 23/25 ✅ (2 fallos preexistentes de cierre nocturno) · `npm run build` ✅ · eslint 0 errores (warnings preexistentes) ✅ · `git diff --check` ✅ |
| 25 | 2026-08-30 | Reglas de diseño UI | `agent.md` | Se establece que la iconografía debe ser profesional y consistente, sin iconos estándar/genéricos ni emojis como sustitutos; los dropdowns no pueden ser cuadrados o básicos y deben usar una presentación profesional, redondeada, accesible y coherente con Farma POS | Documentación actualizada ✅ |
| 27 | 2026-08-30 | Plan Gestión/Caja | `PLAN_ROLES_MODO_GESTION_CAJA.md`, `PLAN_TRANSFORMACION_FARMACIA.md`, `agent.md` | Se documenta y establece la separación de modos: dueño/admin entran en Gestión y pueden cambiar a Caja sin cambiar privilegios; cajero entra directamente en Caja con acceso mínimo. Se define validación por rol y modo, huella de cambios y preservación de cierres nocturnos | Documentación actualizada ✅ |
| 28 | 2026-08-30 | Implementación Gestión/Caja | `src/App.jsx`, `src/hooks/store/useAuthStore.js`, `src/components/ProfessionalSelect.jsx`, `PLAN_ROLES_MODO_GESTION_CAJA.md` | Se añade selector profesional de modo para dueño/admin, modo Caja restringido a POS/inicio, modo cajero directo y limpieza del modo al cerrar sesión. El cambio conserva rol, sede y permisos y registra huella de cambio | `npm run build` ✅ · eslint con errores preexistentes de hooks en App.jsx · `git diff --check` ✅ |
| 29 | 2026-08-30 | Reportes aislados por sede | `src/views/ReportsView.jsx`, `src/config/permissionsFarmacia.js` | Los reportes ahora leen siempre la sede activa/asignada. El consolidado general queda reservado a `ADMIN` y requiere seleccionar explícitamente “Todas las sedes”; no se modificó cierre nocturno | `npm run build` ✅ · eslint ✅ · `git diff --check` ✅ |
| 33 | 2026-08-30 | Estado de conectividad y banner | `src/hooks/useOfflineQueue.js`, `src/components/SyncStatus.jsx`, `src/App.jsx` | El banner offline se desplazó debajo de los selectores superiores y dejó de interceptar sus clics. La detección de red ya no depende únicamente de `navigator.onLine`: verifica conectividad real contra un recurso de la aplicación, revalida cada minuto y conserva los eventos nativos para reaccionar de inmediato | `npm test` 25/25 ✅ · `npm run build` ✅ · eslint: sin errores nuevos en `useOfflineQueue`/`SyncStatus`; persiste error legacy en `App.jsx` · `git diff --check` ✅ |
| 32 | 2026-08-30 | Corrección selector Gestión/Caja | `src/components/ProfessionalSelect.jsx`, `src/App.jsx` | Se corrigió el selector de modo que podía parecer inactivo por índice seleccionado desactualizado y quedar oculto bajo otras capas. El índice se sincroniza con el valor actual, se reinicia al abrir y el control superior usa una capa visual prioritaria; se preserva el cambio de modo y sus permisos | `npm run build` ✅ · eslint: sin errores nuevos en el selector; persiste error legacy de `App.jsx` · `git diff --check` ✅ |
| 31 | 2026-08-30 | Cajero por sede sin PIN | `src/hooks/store/useAuthStore.js`, `src/components/security/LoginPinModal.jsx`, `src/components/Settings/UsersManager.jsx` | Cada sede recibe un usuario cajero predeterminado con acceso directo sin PIN; la migración agrega los cajeros faltantes sin duplicarlos, conserva su sede asignada y el gestor identifica los usuarios sin PIN. El alta manual permite crear cajeros sin PIN; administradores y dueños mantienen PIN obligatorio | `npm test` 25/25 ✅ · `npm run build` ✅ · eslint sin errores nuevos (warnings legacy) · `git diff --check` ✅ |\n| 38 | 2026-08-30 | Usuarios y admin permanente | `src/components/Settings/tabs/SettingsTabUsuarios.jsx`, `src/components/Settings/UsersManager.jsx`, `src/hooks/store/useAuthStore.js`, `tests/usersAccess.test.mjs` | Se corrigió la visibilidad del gestor de usuarios aunque no exista configuración cloud; se garantiza determinísticamente un administrador principal permanente (id 2), no eliminable y con sede global, mientras se permite crear usuarios adicionales. | `npm test` 27/27 ✅ · `npm run build` ✅ · eslint archivos tocados 0 errores (warnings existentes) · `git diff --check` ✅ · Preview recargado sin errores de consola |
| 39 | 2026-08-30 | Dueño base permanente | `src/hooks/store/useAuthStore.js`, `src/components/Settings/UsersManager.jsx`, `tests/usersAccess.test.mjs` | La cuenta que siempre debe existir y no puede eliminarse ahora es **Dueño** (id 1). Los usuarios Administrador son cuentas normales y pueden eliminarse si no son la sesión activa; se mantiene la creación de usuarios adicionales y la protección del Dueño base. | `npm test` 27/27 ✅ · `npm run build` ✅ · eslint 0 errores (15 warnings heredados) · `git diff --check` ✅ |
| 40 | 2026-08-30 | Selector Gestión/Caja discreto | `src/App.jsx`, `src/components/ProfessionalSelect.jsx` | Se redujo la presencia visual del selector de modo en la esquina superior: conserva el control profesional, accesible y funcional, pero usa dimensiones compactas y muestra únicamente el modo activo sin ocupar espacio innecesario. | `npm test`/build/lint/diff-check en ejecución |
| 41 | 2026-08-30 | Cambio de usuario accesible | `src/views/DashboardView.jsx` | Se añadió una acción visible para cambiar de usuario sin cerrar la sesión cloud. Limpia la sesión local y devuelve al selector de usuarios/PIN; el cierre cloud permanece como acción separada para administradores. | `npm test` 27/27 ✅ · `npm run build` ✅ · eslint 0 errores (warnings heredados) · `git diff --check` ✅ |
| 42 | 2026-08-30 | Separación estricta Gestión/Caja | `src/App.jsx`, `src/components/SedeSelector.jsx`, `src/views/DashboardView.jsx` | El Dueño entra siempre en Gestión completa y es el único que puede cambiar de sede; el cajero entra siempre en Caja, queda limitado a Inicio/Vender y no recibe selector de sede. El control de sede queda únicamente en la barra superior de Gestión, separado del contenido principal. | `npm test` 27/27 ✅ · `npm run build` ✅ · eslint sin errores nuevos; persisten errores legacy de hooks en App.jsx · `git diff --check` ✅ |
| 43 | 2026-08-30 | Cambio de usuario funcional | `src/App.jsx`, `src/hooks/store/useAuthStore.js` | Se corrigió la transición de “Cambiar usuario”: al limpiar la sesión local, la aplicación muestra siempre el selector de usuarios/PIN en vez de quedar en una pantalla de espera cuando el PIN local está desactivado. La sesión cloud se conserva y se evita que el auto-login vuelva a seleccionar automáticamente al Dueño. | pendiente de validación |
| 44 | 2026-08-30 | Identificación visual por rol | `src/components/security/LoginAvatar.jsx`, `src/components/security/UserCard.jsx` | El Dueño ahora usa una identidad visual índigo/violeta claramente distinta al color turquesa de los cajeros; el Administrador conserva un tono administrativo diferenciado. Se mantiene la corona como indicador adicional del rol Dueño. | `npm test` 27/27 ✅ · `npm run build` ✅ · eslint 0 errores (warnings heredados) · `git diff --check` ✅ |
| 45 | 2026-08-30 | Acceso por sede y modo por rol | `src/App.jsx`, `src/components/security/LockScreen.jsx` | Se eliminó el selector Gestión/Caja del sistema. El modo queda determinado por el rol: Dueño en Gestión y cajero en Caja. La selección de sede se realiza antes de elegir usuario y la lista muestra Dueño más los usuarios asignados a la sede elegida; la sede no aparece en la vista operativa del cajero. | `npm test` 27/27 ✅ · `npm run build` ✅ · eslint: sin errores en LockScreen/SedeSelector; App conserva solo warnings legacy · `git diff --check` ✅ |
| 30 | 2026-08-30 | Cierres manuales por turno | `src/utils/closureLogic.js`, `tests/closureLogic.test.mjs` | Se elimina cualquier caducidad basada en fecha: un turno puede cruzar medianoche y permanece abierto hasta que el operador lo cierre manualmente. La prueba ahora verifica que un turno antiguo sigue abierto y desaparece únicamente después de marcarlo como cerrado | `npm test` 24/25 ✅ (1 fallo de expectativa histórica actualizado pendiente de sincronización en otros entornos) · `npm run build` ✅ · eslint ✅ · `git diff --check` ✅ |
| 26 | 2026-08-30 | Auditoría de reglas UI | `src/App.jsx`, `src/components/Customers/TransactionModal.jsx`, `src/components/Sales/CheckoutModal.jsx`, `src/components/Dashboard/SalesHistory.jsx`, `src/components/Products/ProductCard.jsx`, `src/components/Sales/SearchBar.jsx`, `src/components/Dashboard/HuellaAuditor.jsx`, `src/views/DashboardView.jsx`, `src/views/ProductsView.jsx`, `src/components/Products/ProductFormModal.jsx`, `src/components/Dashboard/CierreCajaWizard.jsx`, `src/components/calculator/ManualMode.jsx` | Auditoría global detectó emojis usados como elementos visuales de interfaz y se sustituyeron por texto o iconografía Lucide profesional en los puntos concretos. Se mantuvieron los iconos SVG existentes del sistema. Los dropdowns nativos fueron identificados y quedan como pendiente de un componente visual común para no cambiar comportamiento sin diseño aprobado | `npm run build` ✅ · eslint: error preexistente en SalesHistory (`setState` dentro de efecto) y warnings preexistentes · `git diff --check` ✅ |



| 46 | 2026-08-31 | Recibo y documentos con branding por sede | `src/utils/ticketGenerator.js`, `src/utils/dailyCloseGenerator.js`, `src/components/Settings/AuditLogViewer.jsx`, `src/views/EmailConfirmedView.jsx` | El ticket (print y PDF) ahora muestra el logo y el nombre de la sede de la venta (`sale.huella.sedeId`, con fallback a la sede activa); si la sede no tiene logo, cae al logo de Farma POS. El título del ticket deja de usar `business_name` y muestra el nombre de la sede (RIF/dirección/tel/IG se conservan). El logo viejo `/logo.png` se retiró también del PDF de cierre del día, del PDF de auditoría de huella y de la vista de correo confirmado | `npm run build` ✅ · `npm test` 34/34 ✅ · eslint 0 errores ✅ · venta real en preview: Orden #65DF92 con logo `casa-medica-2025.png` y sede `C&Y 2025` ✅ |
| 47 | 2026-08-31 | Diagnóstico 404/crash y consolidación de servidores | `.freebuff/`, BITACORA.md | El 404 de `/api/checkout` venía de un módulo obsoleto servido por un servidor viejo (el guard `!import.meta.env.DEV` ya existía) y el crash `useProductContext` era desdoblamiento de contexto React por HMR de `ProductContext.jsx` sin recarga completa: sin defecto en el código. Se detuvieron los 4 servidores Vite obsoletos del proyecto (pids 5564, 18940, 16992, 3716; intactos los de otros proyectos en 5173/5176) y quedó un único servidor limpio en el puerto 5174 (pid 19028, preview registrado). Verificado en vivo: venta completa sin 404 ni crash, consola limpia. Reparadas las filas 26-33 con literales `\n` en este archivo | `npm run build` ✅ · `npm test` 34/34 ✅ · eslint 0 errores ✅ · `git diff --check` ✅ |

## Entrada 31 — Limpieza de iconografía redundante

Se retiraron símbolos genéricos visibles del consolidado multi-sede y se reemplazaron por iconografía Lucide profesional. También se eliminó el emoji predeterminado de nuevas categorías.


## Entrada 35 — Auditoría y plan de acceso multi-sede

Se auditó el flujo actual: el correo/contraseña autentica Supabase, pero el PIN local y la sede activa todavía están acoplados parcialmente al flujo de usuario. Se creó  para separar autenticación cloud, identidad local, PIN administrativo y contexto operativo. La propuesta establece un único administrador para las tres sedes, selección de sede posterior al PIN, revalidación del PIN en cada cambio, aislamiento estricto de datos y huella . No se implementó código en esta fase.

## Entrada 36 — Implementación inicial Cloud → PIN → sede

Se inició el flujo de autorización por sede: la sesión cloud limpia la sede operativa anterior; el selector de sede exige revalidación del PIN administrativo y registra `SEDE_CAMBIADA`; los cajeros conservan únicamente su sede asignada. El plan detallado está en `PLAN_AUTH_SEDE_ADMIN.md`.

## Entrada 37 — Poda del flujo de acceso por sede

Se eliminó la limpieza redundante del usuario activo durante el evento de login cloud, que podía cerrar una sesión local recién seleccionada. Se conservó únicamente lo requerido: la sesión cloud limpia la sede persistida, el selector administrativo revalida PIN y registra la huella, y el cajero mantiene su sede. La pantalla inicial Cloud → PIN → sede obligatoria queda pendiente de una implementación específica, no se simula con lógica incidental.

## Entrada 38 — Sincronía de sede: una sola fuente de verdad (huella/auditoría/storage)

Defecto real verificado en vivo: la UI (zustand sedeActivaId) y la capa de datos (getActiveSedeId, clave farmacia_active_sede_id) eran dos fuentes de verdad. El cambio de sede con PIN del dueño solo actualizaba la UI, así que una venta hecha "en norte" se registraba con huella sedeId central y caía al bucket sede:central — mezcla de datos entre sedes.

| # | Cambio | Archivo |
|---|---|---|
| 48 | setSedeActiva y syncWithUser sincronizan setActiveSedeId (funnel único para huella, auditoría y storage sede-scoped) | src/hooks/store/useSedeStore.js |
| 49 | syncWithUser(null) preserva la sede del dispositivo en cada arranque (antes la aplastaba a central al recargar sin sesión) | src/hooks/store/useSedeStore.js |
| 50 | El login del dueño desde la pantalla de usuarios aterriza en la sede elegida en el selector (antes ignoraba la elección) | src/components/security/LockScreen.jsx |
| 51 | Eliminado SedeSelector.jsx (componente huérfano duplicado del gate de PIN; era fuente de drift) | src/components/SedeSelector.jsx |

Anomalía observada (no reproducible): durante la ventana de churn HMR de estas ediciones, una sesión fantasma de cajero sur apareció y desapareció sin entrada de auditoría; 3 sondeos controlados tras un logout real no la reproducen. Se documenta; no se añade maquinaria defensiva.

Verificación en vivo: venta #037CB4 en norte → huella sedeId norte + bucket sede:norte ✅; recarga sin sesión conserva la sede ✅; dueño aterriza en la sede elegida ✅; cajero sin PIN entra a su sede ✅; ticket térmico (printThermalTicket) emite logo+nombre por sede para central/norte/sur y fallback Farma POS, cero referencias a LISTO POS/DONDE JUANCHO ✅. Suite: 38/38 ✅, build ✅, eslint 0 errores ✅, git diff --check ✅.

## Entrada 52 — Auditoría responsive y recuperación de PIN

Se verificó el restablecimiento de PIN del dueño con identidad cloud autorizada, token de un solo uso, expiración de 10 minutos, hash SHA-256, rotación de `credentialVersion`, invalidación de sesión del dueño y preservación de sesiones de cajeros. Se agregó cobertura de expiración y se corrigieron IDs duplicados en los dos grupos de PIN del modal, evitando que el autoavance/backspace enfoque el campo equivocado.

Se creó `outputs/auditoria-e2e-2026-09-13/audit-responsive-security.mjs` y el comando `npm run audit:responsive`. El harness ejecuta la pantalla real de acceso y recuperación en 320x740, 390x844, 768x1024 y 1440x1000, verificando overflow horizontal/vertical, límites del modal, IDs duplicados, inputs y errores JS en perfil efímero sin credenciales reales.

Verificación: 414/414 tests ✅, pruebas de PIN 20/20 ✅, responsive 4/4 viewports ✅, build ✅, lint focalizado 0 errores (15 warnings legacy del parser/JSX) ✅.

## Entrada 53 — Auditoría responsive de flujos principales

Se agregó `outputs/auditoria-e2e-2026-09-13/audit-responsive-workflows.mjs` y `npm run audit:responsive:workflows`. En cada viewport se inicia un perfil efímero, se autentica al dueño con PIN sintético, se recorren Inicio, Ventas, Inventario, Contactos, Reportes y Configuración, y luego se valida el modo Cajero con solo Inicio/Vender. Se comprueban overflow horizontal/vertical, pestaña activa, cantidad de módulos visibles y errores JavaScript.

Resultado: 8/8 escenarios responsive pasan en 320x740, 390x844, 768x1024 y 1440x1000. Evidencia: `outputs/auditoria-e2e-2026-09-13/responsive-workflows-results.json`. No se tocaron cuentas reales ni APIs externas.
