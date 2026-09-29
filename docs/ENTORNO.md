# Variables de entorno (cierra A6)

## Reglas

1. Un secreto = un nombre. El canónico para la service key es
   `SUPABASE_SERVICE_ROLE_KEY` (el antiguo `SUPABASE_SERVICE_KEY` solo vive
   como fallback transitorio con aviso en logs).
2. Nada con `VITE_` contiene secretos: `VITE_*` llega al bundle del navegador.
3. CORS se configura con `APP_ORIGIN` (lista separada por comas, sin barra
   final). En producción es **obligatorio**; en dev se admiten los localhost
   de Vite. Ver `src/server/cors.js`.

## Referencia

| Variable | Dónde | Secreto |
|---|---|---|
| `VITE_SUPABASE_URL` | navegador | no |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | navegador | no |
| `VITE_SUPABASE_ANON_KEY` | navegador (compat) | no |
| `SUPABASE_URL` | backend | no |
| `SUPABASE_SERVICE_ROLE_KEY` | backend/Vercel/`wrangler secret` | **sí** |
| `APP_ORIGIN` | backend/Worker | no |
| `ALLOW_CREATE_TEST_ADMIN` | solo QA local (`0` en prod) | no |

Ver `.env.example` (plantilla completa). Los `wrangler secret` se configuran
aparte; `wrangler.jsonc` no debe llevar `vars` con secretos.
