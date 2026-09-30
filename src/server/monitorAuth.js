// Autenticación real para las APIs del Monitor (/api/monitor-upload, /api/monitor-snapshots).
//
// Reemplaza la API key compartida (VITE_MONITOR_API_KEY incrustada en el frontend,
// extraíble por cualquiera) por autenticación basada en sesión:
//
// 1. El cliente envía el JWT de Supabase Auth de la estación (Authorization: Bearer).
// 2. El servidor verifica el JWT contra Supabase Auth (/auth/v1/user).
// 3. El servidor deriva el tenant desde pharmacy_tenants(owner_auth_uid) vía RPC
//    con service key — el cliente NUNCA decide el tenant ni la sede.
// 4. En subida, el branch_id se valida contra el tenant (FK en la BD).
//
// Solo el dueño (owner_auth_uid) puede subir/leer snapshots.

/**
 * Autentica una petición del Monitor.
 * @returns {Promise<{ok:true, tenantId:string, userId:string} | {ok:false, status:number, error:string}>}
 */
export async function authenticateMonitorRequest(req, env = {}, fetchImpl = fetch) {
    const headers = req.headers || {};
    const authHeader = headers.authorization || headers.Authorization || '';
    const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();

    if (!token) {
        return { ok: false, status: 401, error: 'No autorizado' };
    }

    const url = env.SUPABASE_URL;
    const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY;
    // Para verificar el JWT se usa la publishable (header apikey); si no está,
    // se usa la service key como apikey (también aceptada por /auth/v1/user).
    const apiKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY || serviceKey;

    if (!url || !serviceKey) {
        return { ok: false, status: 500, error: 'Configuración incompleta' };
    }

    // 1. Verificar el JWT contra Supabase Auth
    let userId;
    try {
        const resp = await fetchImpl(`${url}/auth/v1/user`, {
            headers: { apikey: apiKey, Authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) {
            return { ok: false, status: 401, error: 'No autorizado' };
        }
        const user = await resp.json();
        userId = user?.id;
    } catch {
        return { ok: false, status: 401, error: 'No autorizado' };
    }

    if (!userId) {
        return { ok: false, status: 401, error: 'No autorizado' };
    }

    // 2. Derivar el tenant del dueño (autoridad del servidor)
    try {
        const resp = await fetchImpl(`${url}/rest/v1/rpc/pharmacy_monitor_owner_tenant`, {
            method: 'POST',
            headers: {
                apikey: serviceKey,
                Authorization: `Bearer ${serviceKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ p_auth_uid: userId }),
            signal: AbortSignal.timeout(8000),
        });
        if (!resp.ok) {
            return { ok: false, status: 500, error: 'No se pudo verificar el tenant' };
        }
        const tenantId = await resp.json();
        if (!tenantId) {
            return { ok: false, status: 403, error: 'Sin acceso al monitor' };
        }
        return { ok: true, tenantId, userId };
    } catch {
        return { ok: false, status: 500, error: 'No se pudo verificar el tenant' };
    }
}
