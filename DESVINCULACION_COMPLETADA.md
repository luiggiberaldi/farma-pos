# DESVINCULACIÓN COMPLETADA — Fase 1

> El proyecto quedó desvinculado del proyecto Supabase original (`fgzwmwrugerptfqfrsjd`), de los dominios de deploy anteriores y del sistema de licencias. Compila y funciona en **modo local 100% offline** mientras se configuran las credenciales del nuevo proyecto Supabase.

## Archivos modificados

| Archivo | Cambio |
|---------|--------|
| `.env` | Secretos reales eliminados (URL Supabase, anon key JWT, 2 llaves Groq `gsk_...`, token `sbp_...`, salt de licencia). Quedan variables vacías. |
| `.env.example` | Reescrito: solo placeholders vacíos + instrucciones. |
| `src/config/supabaseCloud.js` | Reescrito: exporta `isCloudConfigured`; si no hay credenciales crea un **stub offline** (cliente inerte) en lugar de lanzar error. |
| `src/App.jsx` | Eliminado el gate de licencias/dispositivos completo (RPC `register_and_check_device`, cache de verificación, expulsión de dispositivos, período de gracia y banner). Nueva lógica: sin cloud configurado → modo local directo. Gate cloud solo si `isCloudConfigured`. |
| `src/hooks/useCloudAuthLogic.js` | Eliminados: bloque RPC `register_and_check_device`, verificación `license_inactive/expired/limit_reached`, límite de dispositivos (`get_my_device_status`), creación de licencias trial, lecturas de `cloud_licenses`. Se mantiene login email/contraseña + registro + conflictos de backup. |
| `src/views/SettingsView.jsx` | Eliminada pestaña "Licencia" (import + TABS + render) y `BadgeCheck` sin uso. Footer renombrado. |
| `src/components/Settings/tabs/SettingsTabUsuarios.jsx` | Eliminado `CloudLicenseViewer` (código muerto con imports rotos). |
| `src/core/supabaseClient.js` | Comentario con project ref eliminado. |
| `src/worker.js` | URL Supabase hardcodeada → vacía (leer de env del worker). Dominios CORS viejos (`camelai.app`, `tasasaldia.com`, `listo-pos-lite.*`) eliminados. |
| `api/checkout.js` | Fallback URL hardcodeada eliminado (solo `process.env.VITE_SUPABASE_URL`); CORS limpio. |
| `api/update-profile.js` | Ídem. |
| `api/rates.js` | CORS viejos eliminados. |
| `api/share.js` | Ídem. |
| `db_estacion_maestra_setup.sql`, `migrations/00*.sql` | Project refs → `<NUEVO_PROJECT_REF>`. |
| `package.json` | Name `tasas-al-dia-base` → **`farmacia-cesar-pos`** v2.0.0 + descripción. Dependencia `groq-sdk` **eliminada** (sin uso en src). |
| `vite.config.js` | Manifest PWA → "Farmacia César POS", theme color `#0B8D63`; chunk `ai: ['groq-sdk']` eliminado. |
| `wrangler.jsonc` | Name → `farmacia-cesar-pos`. |
| `index.html` | Título, meta tags, theme-color → Farmacia César POS, verde `#0B8D63`. |

## Archivos eliminados

- `src/components/Settings/tabs/SettingsTabLicencia.jsx` (toda la pestaña de licencias)
- `supabase/.temp/` (metadata del proyecto vinculado: project-ref, pooler-url, linked-project.json)
- 22 paquetes npm de `groq-sdk` (con `npm install`)

## Decisiones

1. **Claves internas de storage se mantienen** (`ListoPOSLiteApp_v1`, `listo_pos_data`, `abasto-auth-storage`, `bodega_*`): renombrarlas rompería migraciones de datos y el sync existente en dispositivos ya desplegados. Se renombró solo el branding visible.
2. **`account_devices` se mantiene** como registro informativo de equipos (upsert en login), pero sin gates ni límites.
3. **Modo local**: sin `VITE_SUPABASE_URL/ANON_KEY` la app arranca sin login cloud, operada por el PIN local — crítico para Venezuela (internet intermitente).

## Verificación

- ✅ `npm install` — OK (groq-sdk fuera, sin dependencias rotas)
- ✅ `npm run build` — OK (`farmacia-cesar-pos@2.0.0`, 2141 módulos, PWA generada)
- ✅ Sin refs a `fgzwmwrugerptfqfrsjd` en código (solo quedan en `AUDITORIA_TRANSFORMACION.md` como registro histórico)
- ✅ Sin refs a `listo-pos-lite`/`tasasaldia` en código (quedan las claves internas de storage documentadas arriba)

## Pendientes cuando se proporcione el nuevo repo + Supabase

1. Crear el nuevo proyecto Supabase y ejecutar `migrations/farmacia_setup.sql` (se genera en F3.12).
2. Completar `VITE_SUPABASE_URL` y `VITE_SUPABASE_ANON_KEY` en `.env` / variables del deploy.
3. Crear la cuenta del dueño (email+contraseña) desde la app.
4. `git remote add origin <nuevo-repo>` y primer push.
5. Configurar `SUPABASE_URL` como secreto del Cloudflare Worker (si se usa `src/worker.js`).
6. **Rotar/revocar** las llaves viejas expuestas en el `.env` original (Groq, token `sbp_` de Supabase) en sus respectivos paneles.
