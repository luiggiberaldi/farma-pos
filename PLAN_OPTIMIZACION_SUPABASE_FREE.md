# PLAN DE OPTIMIZACIÓN — Supabase Free

Fecha inicial: 2026-08-30 · Revisión de implementación: 2026-09-13
Alcance: egress, CPU, Disk IO y requests del proyecto Farma POS.

## Estado de esta entrega: perfil Free local, servidor todavía no listo

El proyecto usará **Supabase Free por ahora**, manteniendo local-first. La propuesta es un proyecto para las tres sedes con separación por cuenta/sede, no tres proyectos. No se han creado ni modificado proyectos remotos, credenciales, datos reales o migraciones.

**No importar los SQL actuales a ciegas ni activar la sincronización.** La optimización de consumo no resuelve el contrato de autorización de operador/sede ni el commit atómico de venta/stock/outbox. `REMOTE_OPERATIONS_PAUSED=true` permanece fijo y el checkout remoto continúa rechazando operaciones sin autorización verificable.

### Cuotas oficiales consultadas el 2026-09-13

- Base de datos: **500 MB por proyecto**.
- Storage: **1 GB por organización**.
- Egress: **5 GB no cacheados y 5 GB cacheados, independientes, por ciclo de facturación de la organización**. Los cacheados no se suman a la cuota disponible para consultas normales de base de datos. Las cargas enviadas desde el navegador no equivalen a egress del proveedor.
- Auth: **50.000 usuarios activos mensuales**. Realtime: **2 millones de mensajes por ciclo / 200 conexiones simultáneas de pico**. Edge Functions: **500.000 invocaciones por ciclo**.
- Máximo **dos proyectos Free activos** entre las organizaciones en las que se es Owner o Administrator; no dos por sede.
- Proyectos de poca actividad pueden pausarse tras un período de **7 días**. No se implementan pings artificiales para evitarlo.
- No incluye backups diarios descargables ni PITR. Respaldos externos y prueba de recuperación son necesarios; un dump PostgreSQL no incluye los objetos de Storage.
- SMTP por defecto: solo destinatarios del equipo del proyecto, actualmente **2 correos/hora**, sin garantía de entrega. Para usuarios reales se necesita SMTP propio y redirects correctos; no desactivar confirmación de correo para eludir límites.

Fuentes: [precios](https://supabase.com/pricing), [facturación y alcance](https://supabase.com/docs/guides/platform/billing-on-supabase), [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress), [backups](https://supabase.com/docs/guides/platform/backups), [SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [claves API](https://supabase.com/docs/guides/api/api-keys). Las cuotas pueden cambiar: el panel oficial de uso es la referencia operativa.

### Cambios implementados

- `supabaseFreeTier.js`: perfil único, documentos pesados agrupados 30 minutos (antes eran 30 **segundos**, pese al plan anterior), polling 60 minutos, cooldown visible 10 minutos y Realtime desactivado.
- `supabaseFreeTransport.js`: límite HTTP adicional al SDK; durante la pausa solo pasa Auth, el resto devuelve 503 sin red. Límite local de carga de **1 MiB**, también multipart/Request medibles; formatos streaming no verificables se rechazan. No corta ni consume las respuestas del SDK, no reintenta ni elimina datos.
- `supabaseCloud.js` + `supabasePublicKey.js` + `vite.config.js`: soporte de `VITE_SUPABASE_PUBLISHABLE_KEY` con fallback a `VITE_SUPABASE_ANON_KEY`; preflight bloquea claves secret/service_role antes de compilar. Las claves administrativas no pertenecen a variables `VITE_*`.
- `useCloudSync.js`: SHA-256 de todo el payload; aviso desde 250 KiB y deferencia de más de 1 MiB sin hash de éxito; verifica `error` del SDK; catch-up secuencial y detención ante error; no polling oculto o concurrente, ni avance de cursor si la lectura informa error. Estas rutas siguen **inactivas** por la pausa y no son una habilitación del sync legado.
- `SyncStatus.jsx`: sin pings a Supabase. La cola se refresca por eventos y al volver visible, con fallback **local** de 60 s. No lee cada 15 s ni permite reintentar/descartar durante la pausa.
- `App.jsx`: no crea temporizador de auditoría cloud mientras la pausa esté activa; perfil futuro visible cada 60 min.
- `syncMetrics.js` y `SupabaseFreeStatus.jsx`: contadores validados durante 14 días UTC, bytes UTF-8 y estimación HTTP separada de métricas legadas, sin payload/URLs/credenciales. Panel solo dueño/admin en Configuración → Sistema. No pretende medir la organización ni la facturación; las respuestas sin Content-Length quedan como tamaño desconocido.
- Backup local, datos de negocio, outbox, fechas de retención y lógica de ventas/stock permanecen intactos. No se añadió borrado por cuotas ni backup automático cloud.

### Bloqueos para un proyecto Supabase nuevo

1. `migrations/001_indexes_and_idempotency.sql` depende de tablas transaccionales que el repositorio no crea; hay dos migraciones con número 004 y referencias a relaciones/funciones ausentes.
2. `db_estacion_maestra_setup.sql` contiene una política de `device_backups` con `USING (true)` / `WITH CHECK (true)` y un RPC `process_checkout` de muestra que devuelve un UUID sin confirmar una venta. No es un bootstrap seguro.
3. RLS legada separa cuentas por uid/email, pero no acredita operador/sede. Los documentos cloud no incorporan la sede en su clave única; falta un esquema versionado y consistente.
4. Venta, stock, lotes, saldos y outbox todavía no son un único commit atómico/idempotente; no hay exclusión global de escritores.
5. En este repositorio, la web React/Vite y los endpoints de Vercel/Worker requieren su despliegue separado. Crear una BD Supabase no publica la web ni adapta `api/` a Edge Functions.
6. Falta comprobar Auth, SMTP, redirects, RLS/RPC con dos cuentas y tres sedes sobre un proyecto de pruebas, sin datos reales. No se conectó una cuenta real en esta entrega.

Los siguientes apartados conservan la hoja de ruta; no deben interpretarse como funcionalidades cloud ya habilitadas ni aceptación de producción.

## 1. Diagnóstico actual

La aplicación ya es local-first y conserva una buena base:

- IndexedDB/localForage es la fuente operativa local.
- La nube está prevista como réplica eventual; el envío operativo sigue pausado por seguridad.
- Realtime está desactivado en el perfil Free, incluidos datos ligeros.
- Hay hash de payload para evitar upserts idénticos.
- Hay debounce de 30 minutos para ventas, productos, clientes y facturas.
- El polling de datos pesados está configurado cada 60 minutos y primero consulta solo metadatos.
- Las ventas sincronizadas a `sync_documents` se limitan a una ventana de 30 días.
- Las imágenes base64 se excluyen del payload de productos.
- El backup cloud automático está deshabilitado; el remoto manual también queda bloqueado mientras dure la contención. Se conserva la exportación local.

Estos mecanismos reducen considerablemente el consumo, pero no constituyen todavía una medición ni un límite duro de presupuesto.

## 2. Objetivos operativos

1. Supabase debe ser la réplica y canal de sincronización, no la base de trabajo del POS.
2. Ninguna venta debe depender de una lectura remota para completarse.
3. Evitar subir el mismo payload o una colección completa cuando solo cambió un registro.
4. Mantener la cantidad de requests y bytes acotada aun con varios dispositivos.
5. No activar Realtime/Postgres Changes para datos pesados.
6. Poder medir bytes, requests, tamaño de payload, latencia y errores antes de optimizar a ciegas.

## 3. Prioridades por fase

### O0 — Instrumentación y límites (obligatorio antes de ampliar)

- Añadir métricas locales agregadas por día: `pushCount`, `pullCount`, `bytesUploaded`, `bytesDownloaded`, `skippedByHash`, `errors`, `durationMs`, agrupadas por clave.
- No guardar el contenido de los payloads en las métricas.
- Mostrar estas métricas solo a dueño/admin o en diagnóstico local.
- Definir alertas internas de tamaño: advertencia desde 250 KB y rechazo/cola desde un límite configurable (por ejemplo 1 MB) para documentos de sincronización.
- Medir desde Supabase Dashboard: Database size, Disk IO, Egress, API requests y Realtime messages.
- Registrar una línea base de 24 horas con 1 dispositivo y otra con 3 dispositivos.

### O1 — Eliminar trabajo y requests innecesarios

- No llamar a `pushCloudSync` desde escrituras que no se sincronizan (`BACKUP_KEY` y otras claves fuera de `SYNC_KEYS`). La comprobación debe ocurrir antes de preparar debounce/hash.
- Deduplificar también el catch-up inicial: no hacer upsert inmediato si el hash local coincide con el hash sembrado desde nube.
- Hacer el catch-up con una cola limitada y backoff, no con una ráfaga fija de todos los documentos.
- Pausar polling, Realtime y health checks cuando `document.visibilityState !== 'visible'` y reanudar con cooldown.
- Mantener un único canal Realtime por usuario y un único ciclo de polling por aplicación.
- No introducir compresión hasta medir; JSON comprimido puede aumentar CPU y complicar la depuración.

### O2 — Reducir el tamaño de los documentos

- Mantener imágenes exclusivamente locales o migrarlas a Storage con URLs y políticas de cache; nunca incluir base64 en `sync_documents`.
- Mantener la ventana de ventas sincronizada corta y documentada. El historial completo debe vivir en el dispositivo y/o tablas operativas, no en un documento JSON creciente.
- Eliminar campos redundantes o blobs de diagnóstico de los payloads de sync.
- Versionar el esquema de cada payload para permitir migraciones sin duplicar documentos.
- Medir el tamaño real de cada clave antes y después; no eliminar campos requeridos por reportes o auditoría.

### O3 — Cambiar colecciones completas por eventos o deltas donde aporte valor

Aplicar solo después de O0–O2 y de confirmar que el volumen lo justifica:

- `bodega_sales_v1`: conservar local-first, pero sincronizar ventas nuevas como eventos idempotentes por `sale.id`/`queue_id`; evitar reescribir el array completo en cada venta.
- `bodega_products_v1`: separar catálogo relativamente estable de stock por sede. Sincronizar cambios de producto/stock por registro o por lotes pequeños.
- Lotes, transferencias y auditoría: preferir registros append-only idempotentes con `event_id`, sede, `created_at` y huella.
- Usar upsert por clave única y paginación para lecturas; nunca descargar un historial ilimitado.
- Mantener una compactación periódica controlada para documentos legacy, nunca durante el checkout.

### O4 — Base de datos y CPU Supabase

- Revisar índices únicamente con evidencia de consultas lentas. Candidatos: `(user_id, collection, doc_id)`, `(user_id, updated_at)`, y claves idempotentes de ventas.
- Verificar que las políticas RLS sean simples y usen índices; evitar funciones RLS que hagan subconsultas por fila.
- Revisar `process_checkout` para que valide idempotencia antes de insertar y tenga transacciones cortas.
- Evitar triggers o funciones que serialicen documentos grandes.
- No usar Postgres Changes para `sync_documents` pesados.
- Configurar retención/limpieza de documentos y backups conforme a las necesidades legales del negocio; nunca borrar ventas o auditoría sin una política aprobada.

## 4. Presupuesto inicial sugerido

Estos valores son límites de diseño, no cifras garantizadas de Supabase:

- Payload normal de sync: < 250 KiB (límite de diseño de la aplicación).
- Payload máximo excepcional: 1 MiB; por encima se rechaza el envío sin eliminar el original local. La división automática en deltas no está implementada.
- Una sincronización completa solo al login/cambio de cuenta, no en cada foco.
- Polling pesado: mínimo 60 minutos y solo cuando la pestaña está visible.
- Realtime: desactivado por defecto. Una futura habilitación requiere canales privados autorizados, presupuesto y pruebas; no basta una bandera.
- Ventana de `sync_documents` para ventas: 30 días hasta medir.
- Backups cloud: manuales o con una frecuencia explícitamente aprobada; nunca cada 5 minutos.
- Cada operación de venta online: una llamada al checkout y, si procede, una escritura de auditoría; evitar duplicar la misma venta en varias rutas remotas.

## 5. Criterios de aceptación

- Checkout offline y online funcionan sin regresión.
- El mismo payload no produce un segundo upsert.
- Cambios locales se recuperan después de recargar y tras volver online.
- Una pestaña oculta no genera polling ni health requests periódicos.
- Las ventas y movimientos permanecen aislados por cuenta y sede.
- Auditoría y huella permanecen completas.
- Los reportes del dueño siguen funcionando por sede y consolidados.
- Las regresiones deben ejecutar el código real; el estado de la suite se registra por entrega, no se presupone un fallo de cierre nocturno.
- Objetivo de liberación: build, lint y `git diff --check` correctos. La deuda actual de lint se informa explícitamente y no se disfraza de aprobación.
- Las métricas permiten comparar bytes/requests antes y después.

## 6. Riesgos y decisiones

- No implementar deltas/eventos sin migración compatible: primero debe existir lectura de ambos formatos.
- No prometer stock global inmediato con polling de 60 minutos. Si se necesita coordinación casi inmediata, diseñar eventos/deltas autorizados y una política offline por estación; la acción de diagnóstico no sincroniza datos.
- No subir imágenes base64 a Supabase Database.
- No guardar secretos, contraseñas ni contenido sensible en métricas.
- No tocar la lógica de cierres nocturnos durante esta optimización.
- El tier gratuito no debe ser tratado como almacenamiento histórico ilimitado; definir exportación/archivo externo antes de retenciones largas.

## 7. Estado de implementación

- **O0 instrumentación:** implementada localmente en `src/utils/syncMetrics.js`; registra por día y clave solo contadores y bytes estimados, sin payloads, con retención de 14 días.
- **O1 poda inicial:** `pushCloudSync` descarta claves fuera de `SYNC_KEYS` antes de debounce; `SyncStatus` no consulta Supabase para comprobar salud, agrupa lecturas de cola por eventos y no lee cuando la pestaña está oculta.
- **Límites y panel:** implementados en esta entrega local; el preflight admite clave pública y rechaza clave administrativa, el transporte conserva errores HTTP y Auth, y el panel distingue estimación local de cuotas oficiales.
- **Pendiente:** deltas/versionado por sede, permisos de servidor, SQL inicial reproducible, medición de organización con 1/3 terminales y recuperación de respaldo probada. Los defaults de sync no autorizan su activación.

## 8. Orden recomendado de implementación

1. Instrumentar y obtener línea base.
2. Podar pushes no sincronizables y catch-up redundante.
3. Pausar ciclos cuando la app está oculta.
4. Medir tamaños y eliminar únicamente redundancias comprobadas.
5. Si el volumen lo exige, migrar ventas/productos/lotes a eventos idempotentes por registro.
6. Revisar índices/RLS/RPC con métricas de Supabase.
7. Validar con 1 y 3 dispositivos, offline/online y recuperación tras recarga.
