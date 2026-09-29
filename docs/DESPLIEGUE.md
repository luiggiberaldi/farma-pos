# Guía de despliegue

## Vercel vs Cloudflare

| Ruta | Vercel (`api/`) | Cloudflare (`src/worker.js`) |
|---|---|---|
| `/api/operator-session` | ✅ | ❌ no implementada |
| `/api/business-operation` | ✅ | ❌ no implementada |
| `/api/checkout` | ✅ (contención: rechaza) | ✅ (contención: rechaza) |
| `/api/rates` | ✅ (banda ±30% + cache) | ✅ (proxy simple) |
| `/api/update-profile` | ✅ | ✅ |

M4: el deploy Cloudflare está incompleto (faltan `operator-session` y
`business-operation`; `vars:{}` vacío). **Declarado: Cloudflare es solo
lectura/contención** hasta completar esas rutas o decidir un borde único.
Recomendación: un solo borde (Vercel) para escritura; Worker solo estático.

## Variables por entorno

- Vercel: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`,
  `SUPABASE_ANON_KEY` (ver `docs/ENTORNO.md`).
- Cloudflare: `wrangler secret put SUPABASE_SERVICE_ROLE_KEY`, `APP_ORIGIN`
  en `vars` (no secretos en `vars`).

## Checklist de release

1. Migraciones aplicadas en orden (`docs/DATABASE.md`).
2. `APP_ORIGIN` = dominio real (si no, CORS bloquea la app).
3. `ALLOW_CREATE_TEST_ADMIN=0`.
4. Rate limits: defaults (login 60/min, commit 120/min, perfil 30/min).
5. Criterios del ADR-001 antes de tocar `REMOTE_OPERATIONS_PAUSED`.
