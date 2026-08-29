# AUDITORÍA DE TRANSFORMACIÓN — Listo POS Lite → Farmacia César (Multi-Sede)

> FASE 0 completada. Este documento es el mapa completo del estado del proyecto antes de la transformación a sistema de farmacia multi-sede (3 sedes: Central, Norte, Sur).

---

## 1. Resumen ejecutivo

El repositorio clonado (`listo_pos_lite-`, repo GitHub `luiggiberaldi/listo_pos_lite-`) es una **PWA móvil-first** de punto de venta (React 19 + Vite + Tailwind + Capacitor/Android), con **arquitectura local-first**: los datos viven en IndexedDB (localforage) y se sincronizan clave-valor con Supabase (tabla `sync_documents`). No es el código base que describe el prompt maestro original (`listo-pos-only`): aquí **no existen** Firebase, Electron, Ghost AI, motor de simulación, scrapers ni sistema de licencias Fénix. La transformación se adapta a este código real.

**Hallazgo crítico de seguridad**: el archivo `.env` contiene secretos reales en texto plano (URL de Supabase, anon key JWT, dos llaves Groq `gsk_...`, token de management `sbp_...`) y hay project refs hardcodeados en `api/*.js` y `src/worker.js`. Se eliminan en la Fase 1.

## 2. Tech stack real

| Capa | Tecnología |
|------|-----------|
| Frontend | React 19 (JSX, sin TS) + Vite 7 (PWA via `vite-plugin-pwa`) |
| Estilos | Tailwind CSS 3.4 (paleta sky-blue/teal, darkMode class) |
| Estado | Contextos (ProductContext, CartContext) + 2 stores Zustand (`core/store.js` esqueleto, `hooks/store/useAuthStore.js` persistido) |
| Datos locales | localforage (IndexedDB `ListoPOSLiteApp_v1`, store `listo_pos_data`) con fallback a localStorage |
| Cloud | Supabase (`@supabase/supabase-js` 2.97) — auth email/password + tabla `sync_documents` (sync clave-valor) |
| Deploy | Vercel (4 funciones serverless en `api/`) + Cloudflare Worker (`src/worker.js`, `wrangler.jsonc`) |
| Móvil | Capacitor 8 (`android/`) |
| Otros | `groq-sdk` (IA), `localforage`, `jspdf`+`html2canvas`, `lucide-react`, tests con `node --test` |

## 3. Mapa de referencias a Supabase (proyecto `fgzwmwrugerptfqfrsjd`)

### 3.1 Cliente y configuración
| Archivo | Línea | Tipo | Contenido | Impacto al eliminar |
|---------|-------|------|-----------|---------------------|
| `src/config/supabaseCloud.js` | 1-19 | cliente | `createClient` leyendo `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY`, exporta `supabaseCloud` | Ninguno si se vacían envs (cliente null → modo offline) |
| `src/core/supabaseClient.js` | 1-3 | re-export | Comentario con el nombre del proyecto + re-export | Solo comentario |
| `.env` | — | secretos | URL real, anon key JWT real, `VITE_GROQ_API_KEY`(+SECOND), `VITE_LICENSE_SALT`, `SUPABASE_AUDIT_ACCESS_TOKEN=sbp_...` | Deben vaciarse (Fase 1) |
| `.env.example` | — | config | `VITE_SUPABASE_URL` real + placeholders; `VITE_LICENSE_SALT=PRECIOS_ALDIA_BODEGA_2026` | Reescribir con placeholders vacíos |

### 3.2 Project ref / URL hardcodeados
| Archivo | Línea | Contenido |
|---------|-------|-----------|
| `api/update-profile.js` | 4 | fallback `https://fgzwmwrugerptfqfrsjd.supabase.co` |
| `api/checkout.js` | 6 | ídem |
| `src/worker.js` | 11 | ídem |
| `supabase/.temp/pooler-url` | 1 | connection string postgres del pooler |
| `supabase/.temp/*` | — | project-ref, linked-project.json (metadata de `supabase link`) |
| `migrations/001..005*.sql` | — | links de dashboard SQL al mismo ref |

### 3.3 Consumidores del cliente (`supabaseCloud`)
`src/App.jsx` (auth + RPC `register_and_check_device` + tabla `cloud_licenses`), `src/main.jsx`, `src/hooks/useCloudSync.js`, `useCloudAuthLogic.js`, `useAutoBackup.js`, `useSecurity.js`, `src/services/auditService.js`, `notificationService.js`, `src/utils/checkoutProcessor.js`, `src/components/ShareInventoryModal.jsx`, `SyncStatus.jsx`, `security/LockScreen.jsx`, `Settings/tabs/SettingsTabUsuarios.jsx`, `SettingsTabLicencia.jsx`, vistas (`DashboardView`, `SettingsView`, `EmailConfirmedView`, `ResetPasswordView`), `src/testing/hybridFlowInjector.js`, `vite.config.js:100` (chunk `cloud`), `migrate_inventory.js`, `api/*.js`.

### 3.4 SQL / migraciones
- `db_estacion_maestra_setup.sql` (raíz): tablas de licencias/dispositivos (`cloud_licenses`, `account_devices`, `cloud_backups`, `sync_documents`).
- `migrations/001_indexes_and_idempotency.sql` … `005_device_status_rpc.sql`: índices, políticas de audit log, retención, hardening, RPC de estado de dispositivo.

## 4. Firebase

**No existe.** Cero imports, cero dependencias, sin `firestore.rules`. La sección 1.5 del prompt maestro (decidir sobre Firebase) queda **sin objeto**.

## 5. Referencias al repositorio/proyecto original

- `git remote -v` está **vacío** (no hay remote configurado).
- Sin URLs `github.com/luiggiberaldi` en el código. `package.json` sin campo `repository`.
- Identidad de deploy "listo-pos-lite": `wrangler.jsonc:2`, CORS origins en `src/worker.js:42-44`, `api/checkout.js`, `api/rates.js`, `api/update-profile.js`, `api/share.js:38` (`listo-pos-lite.vercel.app`, `.camelai.app`).
- Branding interno heredado: `package.json` name = **`tasas-al-dia-base`** (proyecto anterior); store de storage `listo_pos_data` (`src/config/storageScope.js:4-5`); backups `backup_listo_pos_*`; appName `Listo_POS`; README con estructura `abasto/`; `.env.example` con salt `PRECIOS_ALDIA_BODEGA_2026`. Linaje: "precios al día bodega" → "tasas al día" → "listo pos lite".

## 6. Arquitectura actual

```
Flujo de datos:
vistas/contextos → storageService (localforage/localStorage)
                 → evento 'app_storage_update' → React re-render
                 → pushCloudSync(key, value) → Supabase sync_documents (fire-and-forget)
useCloudSync: pull/push de SYNC_KEYS (productos, ventas, cierres, clientes, cuentas,
              categorías, proveedores, facturas + ~18 claves de config localStorage)
              Realtime para claves livianas, polling para pesadas; merge por updatedAt
              (MERGEABLE_KEYS); inventario = overwrite (cloud manda)

Aislamiento de datos: storageScope.js prefija account:{supabaseUserId}:key
              (una cuenta email = un inventario; dispositivos de la misma cuenta
               comparten inventario vía sync_documents)

Auth (2 capas):
  A) Cloud (obligatoria): Supabase email/password → CloudAuthModal gate en App.jsx
     → RPC register_and_check_device → cloud_licenses (trial 7d, max 2 dispositivos,
     grace 5d). SE ELIMINA el gate de licencia (se mantiene el login).
  B) Local: PIN por usuario (useAuthStore persistido en localStorage
     'abasto-auth-storage'). Roles: ADMIN (PIN 6 dígitos) / CAJERO (PIN 4).
     Sin matriz de permisos: checks ad-hoc rol === 'ADMIN'.

Vistas (SPA sin router de páginas, tabs + CSS): SalesView (POS), DashboardView,
ProductsView, CustomersView, ReportsView, SettingsView, + reset-password/email-confirmed
(enrutadas en main.jsx), TesterView (oculto), Monitor/Calculator/Wallet (no ruteadas).
```

**Multi-sede: NO EXISTE.** `src/config/tenant.js` es un switch de vertical de producto (REVENDEDOR/BODEGA/COMIDA/...), no de sedes. `ShareInventoryModal` es una transferencia única por código de 6 dígitos que **reemplaza** el inventario del receptor — no sirve como sistema de transferencias.

## 7. Evaluación de módulos para farmacia

| Módulo | Decisión | Notas |
|--------|----------|-------|
| POS (SalesView) | Adaptar | Añadir: íconos ℞/🧊/controlado, validación receta, bloqueo vencidos, FEFO |
| Productos/Inventario | Adaptar | Campos: genérico, laboratorio, concentración, presentación; stock por sede; lotes |
| Dashboard | Adaptar | Vista consolidada multi-sede para dueño |
| Cierre de caja | Adaptar | Scoping por sede (ya existe wizard completo) |
| Clientes | Adaptar | Campo alergias + historial |
| Reportes | Adaptar | Filtro sede, reporte controlados, por vencer |
| Login PIN | Adaptar | Rol DUENO/ADMIN/CAJERO + sede asignada |
| Auth cloud | Mantener (simplificada) | Sin licencias/trial/dispositivos |
| Sistema licencias | **Eliminar** | `cloud_licenses`, `register_and_check_device`, SettingsTabLicencia, CloudLicenseViewer (muerto) |
| Sync cloud | Extender | SYNC_KEYS sede-aware; dueño consolida 3 sedes |
| Tasa BCV (bcvApiClient) | Mantener | Venezuela: precios/divisa |
| Wallet/Cashea | Mantener (evaluar) | Cashea = método de pago cuotas usado en VE |
| Monitor/Calculator views | Evaluar eliminar | No ruteadas desde App.jsx |
| ShareInventoryModal | **Reemplazar** | Por sistema real de transferencias entre sedes |
| Firebase/Electron/Ghost/Simulación/Scrapers | N/A | No existen en este código |

## 8. Datos de inventario reales de la farmacia

`inventario/inventario_general_farmacia.json` (fuera del repo, carpeta padre): **666 registros** con campos `categoria, generico, comercial, laboratorio, concentracion, presentacion, cantidad, unidad, precio_usd, estado, observaciones`. El modelo actual de producto no tiene estos campos → se extiende el esquema y se crea importador (F3.5).

## 9. Riesgos identificados

1. **Secretos comprometidos** en `.env` (Groq, Supabase JWT, sbp token) → rotar/revocar en los paneles respectivos tras desvincular.
2. **Rename de claves de storage** rompería migraciones de datos locales existentes → se mantienen claves internas (`listo_pos_data`, `abasto-auth-storage`) y se documenta.
3. **Sync multi-escritor**: si varias sedes escriben la misma clave, el merge actual es overwrite para inventario → el diseño sede-aware evita escritores cruzados (cada sede solo escribe sus colecciones).
4. **`SalesView_temp.jsx`** (copia stale) y `CloudLicenseViewer` (imports rotos) son riesgos de confusión → eliminar en limpieza.
5. **api/\* serverless y worker.js** referencian dominios CORS del deploy viejo → se limpian pero quedarán inactivos hasta nuevo deploy.

## 10. Dependencias NPM

- **Conservar**: react, react-dom, zustand, localforage, @supabase/supabase-js, lucide-react, tailwindcss, vite, jspdf, html2canvas, vite-plugin-pwa, autoprefixer/postcss, eslint stack, capacitor (si se mantiene Android).
- **Eliminar (candidatas)**: `groq-sdk` si no se usa IA (verificar en Fase 1).
- **Añadir**: ninguna (regla del prompt maestro: sin dependencias nuevas innecesarias).
