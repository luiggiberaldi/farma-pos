# Plan — Matrícula automática de equipos (2026-10-01)

**Origen:** pedido del usuario — "al iniciar sesión con correo y contraseña se vincula de inmediato el dispositivo; máximo 6 dispositivos por cuenta; lo más práctico posible".
**Objetivo:** eliminar el campo manual `uuid.secreto` del panel "Verificación remota de operador": el equipo se matricula solo al hacer login cloud con la cuenta del dueño, con tope de 6 por cuenta y gestión de cupos en el propio panel.
**Estado actual:** `pharmacy_enroll_device` existe en SQL pero `NO EXPONER VÍA HTTP` (B3); no hay forma de obtener un identificador desde la app. El panel solo acepta pegarlo a mano.

---

## 1. Fases de ejecución (orden obligatorio)

### Fase 1 — SQL: tope de 6 + gestión de equipos (~30 min)
Nueva migración `supabase/migrations/202610010001_device_cap.sql`:
- **D1.** Modificar `pharmacy_enroll_device`: antes del INSERT, contar `devices` con `enabled=true` del tenant; si `>= 6`, `RAISE EXCEPTION 'device_limit'`. El tope vive en la función (a prueba de carreras), no en el cliente.
- **D2.** Nueva función `pharmacy_list_devices(p_auth_uid uuid)` → `jsonb` con `[{id, label, enabled, created_at}]` ordenado por `created_at`. Solo service_role (REVOKE a PUBLIC/anon/authenticated, como las demás).
- **D3.** Nueva función `pharmacy_revoke_device(p_auth_uid uuid, p_device_id uuid)` → soft-disable (`enabled=false`) del equipo de ese tenant. No borra (auditoría).
- Aplicar en el proyecto live (`dpwfntuxgydtwgzbwxdz`) con service_role y verificar con `SELECT` de prueba. Actualizar `supabase/tests/access-contract.test.mjs`: tope (el 7.º falla), revoke, list.

### Fase 2 — Servidor: exponer matrícula solo al dueño (~45 min)
- **S1.** En `src/server/operatorAccess.js`: agregar `listDevices({authorization})` y `revokeDevice({authorization, deviceId})` usando `administrativeIdentity` (solo el UID del dueño autentica; mismo patrón que `enrollDevice`). Revisar el comentario B3: la matrícula deja de ser "solo invocación manual" y pasa a "solo el dueño autenticado por Supabase" — sigue sin ser pública.
- **S2.** En `api/operator-session.js`: nuevas acciones `enroll-device` (`{label}`), `list-devices` (`{}`), `revoke-device` (`{deviceId}`).
  - Extender `validPayload` con la allowlist de cada acción.
  - Rate limit propio para `enroll-device`: 10/min por IP (más estricto que el M5 de login: matricular es raro).
  - `enroll-device` traduce `device_limit` de SQL a 409 con mensaje legible ("Límite de 6 equipos").
- **S3.** Tests en `tests/operatorServerContract.test.mjs`: dueño matricula OK; no-dueño/cuenta ajena → denied; 7.º equipo → 409; revoke + re-matricula libera cupo; payload inválido → 400.

### Fase 3 — Cliente: servicio de matrícula (~30 min)
- **C1.** En `src/services/operatorRemoteSession.js`: `enrollDevice(label)`, `listDevices()`, `revokeDevice(deviceId)` reutilizando el `request()` existente (header `x-pharmacy-device` no requerido para enroll; sí Bearer del dueño vía `getAccessToken()`).
- **C2.** Utilidad `src/utils/deviceLabel.js`: etiqueta automática legible desde `navigator.userAgent` — navegador + SO + mes/año, ej. `"Chrome · Windows · oct 2026"` (máx 120 chars, cumple el CHECK de SQL). Sin dependencias nuevas.
- **C3.** Tras matricular, el servicio guarda el secreto en `farmapos_remote_device` y **nunca lo vuelve a mostrar completo** (el panel muestra etiqueta + fecha, no el `uuid.secreto`).

### Fase 4 — Auto-matrícula al login cloud (~30 min)
- **C4.** En `src/hooks/useCloudAuthLogic.js`, tras el login exitoso con correo+contraseña (punto del evento `cloud_login_completed`): si `!remoteOperatorSession.isDeviceLinked()`, llamar `enrollDevice(autoLabel())`.
  - Éxito silencioso: toast `"Equipo vinculado"`.
  - Tope alcanzado: toast `"Límite de 6 equipos — desvincula uno en Ajustes → Sistema"` y no reintentar en ese login.
  - Fallo de red/servidor: no bloquear el login; reintentar en el próximo login (la venta sigue local).
- **C5.** El login con PIN local (cajero/operador) NO matricula: solo el dueño con cuenta cloud puede crear cupos.

### Fase 5 — Panel: lista de equipos + desvincular (~30 min)
- **P1.** `RemoteOperatorPanel.jsx`: reemplazar el campo manual "Identificador del equipo / Vincular equipo" por:
  - Estado del equipo actual (vinculado: etiqueta + fecha; no vinculado: explicación + botón "Vincular este equipo" que usa la matrícula automática).
  - Lista de equipos del tenant (etiqueta, fecha, "este equipo" resaltado) con botón "Desvincular" por fila (confirmación simple).
- **P2.** El resto del panel (directorio, verificación de operador, cierre de sesión remota) no se toca.

### Fase 6 — Cierre (~30 min)
- Suite completa verde (conteo anotado). Tests nuevos verificados por mutación (fallan sin el cambio).
- Un commit por fase. Push con `push_via_api.py`. Deploy manual a producción con verificación: marcador en bundle + `/api/rates` → 200 + prueba real de matrícula en un navegador limpio.

---

## 2. Guardarraíles (obligatorios durante toda la ejecución)

1. **Datos QA intocables.** No borrar ni modificar ventas, cierres, clientes, deudas, productos ni estaciones (ver Anexo C).
2. **Solo el dueño matricula.** Ningún otro rol, ninguna sesión anónima, ningún endpoint sin `administrativeIdentity`. La matrícula jamás es pública.
3. **El secreto nunca viaja ni se muestra en claro después de creado.** El servidor solo guarda `sha256(proof)`; el cliente no renderiza el `uuid.secreto` tras vincular (etiqueta + fecha).
4. **Tope de 6 en SQL, no solo en cliente.** Cualquier bypass del frontend choca con la función.
5. **La venta no se toca.** Local-first intacto; `REMOTE_OPERATIONS_PAUSED` sigue en `true`. Esta feature no habilita sincronización.
6. **PIN del dueño se mantiene en `000000`.** Nada de este plan lo toca.
7. **Cada cambio lleva test de regresión** verificado por mutación: falla sin el cambio, pasa con él.
8. **Suite 100% verde antes de cada commit.** Un commit por fase, mensajes consistentes con el historial.
9. **Push** con `python3 ~/workspace/push-farma-pos/push_via_api.py` (sin git link; el push no dispara deploy).
10. **Deploy manual:** `cd ~/workspace/farma-pos && VERCEL_TOKEN=$(grep '^VERCEL_TOKEN=' .env | cut -d= -f2) && npx -y vercel@latest --prod --token="$VERCEL_TOKEN" --yes --name farma-pos`, luego verificar bundle + `/api/rates` → 200.
11. **Secretos:** nunca commitear `.env`; nunca mostrar credenciales ni el `proof` en logs.
12. **Reporte final único** al terminar. Preguntar al usuario solo si algo bloquea de verdad.

---

## 3. Anexos

### Anexo A — Detalle técnico por archivo

| ID | Archivo | Cambio |
|---|---|---|
| D1–D3 | `supabase/migrations/202610010001_device_cap.sql` (nueva) | Tope 6 en `pharmacy_enroll_device`; `pharmacy_list_devices`; `pharmacy_revoke_device`; GRANTs solo service_role |
| S1 | `src/server/operatorAccess.js` | `listDevices`, `revokeDevice` (patrón `administrativeIdentity`); revisión del comentario B3 |
| S2 | `api/operator-session.js` | Acciones `enroll-device`, `list-devices`, `revoke-device`; allowlist en `validPayload`; rate limit 10/min IP para enroll; 409 en `device_limit` |
| C1 | `src/services/operatorRemoteSession.js` | `enrollDevice(label)`, `listDevices()`, `revokeDevice(deviceId)` |
| C2 | `src/utils/deviceLabel.js` (nuevo) | `"Chrome · Windows · oct 2026"` desde UA; ≤120 chars |
| C4 | `src/hooks/useCloudAuthLogic.js` | Auto-matrícula tras `cloud_login_completed` si `!isDeviceLinked()`; toasts de éxito/tope/fallo |
| P1 | `src/components/Settings/RemoteOperatorPanel.jsx` | Lista de equipos + desvincular; fuera el campo manual |
| T1 | `supabase/tests/access-contract.test.mjs` | Tope, revoke, list a nivel SQL |
| T2 | `tests/operatorServerContract.test.mjs` | Dueño OK / no-dueño denied / 7.º → 409 / payload inválido |

### Anexo B — Modelo de seguridad (antes → después)

| Actor | Antes | Después |
|---|---|---|
| Dueño con login cloud | No puede matricular desde la app | Matrícula automática (1 por equipo); lista y revoca |
| Dueño sin login cloud (solo PIN local) | — | No matricula (sin Bearer no hay `administrativeIdentity`) |
| Cajero / anónimo / cuenta ajena | — | `denied` en las 3 acciones |
| Servidor SQL | Guarda `sha256(proof)` | Igual; además tope 6 y soft-revoke |

Lo que NO cambia: formato `uuid.secreto` (43-char base64url), header `x-pharmacy-device`, verificación de operador (directory/login/logout), rate limit M5 de login, `INSERT-only` de `pharmacy_enroll_device` (un id/proof no se re-matricula ni se sobrescribe).

### Anexo C — Datos QA protegidos (no tocar)
- Central: caja abierta, `$14.87 · 10 ventas`, ~45 operaciones pendientes.
- Ventas `#11FA96`, `#CD9DF9`, `#644941`, `#F2F4E9`, Cashea `#F2C166/#0000018`.
- `QA Test Producto` (stock 95), `QA Test Producto 2` (`7590000000021`), `QA Test Producto 3`, lote `QA-LOT-001` (vence 31/12/2026).
- Norte y sur: cajas abiertas, 30 productos de prueba.
- Estación `QA-TEST` enrolada, caja abierta en norte.
- Cliente `Cliente Prueba QA`.

### Anexo D — Casos borde y límites honestos
- **localStorage borrado / navegador reinstalado:** el equipo se matricula de nuevo y ocupa otro cupo (sin el secreto no se le reconoce). La lista con fechas permite limpiar los viejos. No hay `last_seen` en `devices`; si se quiere, es migración aparte (fuera de este plan).
- **Mismo equipo, otra pestaña:** el secreto vive en `localStorage` (origen), no por pestaña; no consume cupo extra.
- **Tope alcanzado:** el 7.º login cloud entra igual a la app (la venta no se bloquea), solo no se matricula hasta liberar cupo.
- **Revoke del equipo en uso:** la próxima verificación de operador falla (`denied`); el equipo debe re-matricularse (ocupa cupo de nuevo si sigue dentro del tope).

### Anexo E — Checklist pre-deploy
- [ ] Migración aplicada en live y verificada (`pharmacy_enroll_device` rechaza el 7.º).
- [ ] Suite completa verde (conteo anotado); tests nuevos verificados por mutación.
- [ ] Matrícula real en navegador limpio: login cloud → toast "Equipo vinculado" → panel lista 1 equipo.
- [ ] Tope real: 6 equipos → 7.º muestra el toast de límite (probar con revoke para limpiar).
- [ ] Producción: bundle con marcador + `/api/rates` → 200.
