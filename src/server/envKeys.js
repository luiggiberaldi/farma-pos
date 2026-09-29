// Nombres canónicos de secretos del backend (A6, 2026-09-28).
// Canónico: SUPABASE_SERVICE_ROLE_KEY. Se acepta el nombre antiguo
// SUPABASE_SERVICE_KEY como fallback transitorio (con aviso en logs) para no
// romper deploys existentes; el fallback se eliminará en una versión posterior.
export function readServiceRoleKey(env = {}) {
    if (env.SUPABASE_SERVICE_ROLE_KEY) return env.SUPABASE_SERVICE_ROLE_KEY;
    if (env.SUPABASE_SERVICE_KEY) {
        console.warn('[envKeys] SUPABASE_SERVICE_KEY está deprecado: usa SUPABASE_SERVICE_ROLE_KEY');
        return env.SUPABASE_SERVICE_KEY;
    }
    return '';
}
