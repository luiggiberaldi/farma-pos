// API del Monitor de supervisión — lee snapshots de sedes.
// Auth: JWT de Supabase Auth de la estación (Authorization: Bearer).
// Solo el dueño puede leer, y solo los snapshots de SU tenant
// (derivado en el servidor, no del parámetro del cliente).
import { applyCors } from '../src/server/cors.js';
import { checkRateLimit, clientIp, rateLimitedResponse } from '../src/server/rateLimit.js';
import { authenticateMonitorRequest } from '../src/server/monitorAuth.js';

export default async function handler(req, res) {
    const origin = req.headers.origin || '';
    applyCors(res, origin, process.env, { methods: 'GET, OPTIONS', headers: 'Content-Type, Authorization' });
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'GET') {
        res.status(405).json({ error: 'Método no permitido' });
        return;
    }

    // Rate limit: 30 req/min por IP
    const rl = checkRateLimit({ key: `monitor:${clientIp(req)}`, max: 30, windowMs: 60_000 });
    if (!rl.allowed) {
        rateLimitedResponse(res, rl.retryAfterMs);
        return;
    }

    // Auth real: sesión del dueño; el tenant lo deriva el servidor
    const auth = await authenticateMonitorRequest(req, process.env);
    if (!auth.ok) {
        res.status(auth.status).json({ error: auth.error });
        return;
    }

    const { date } = req.query;

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
        res.status(500).json({ error: 'Configuración incompleta' });
        return;
    }

    try {
        const rpcUrl = `${url}/rest/v1/rpc/pharmacy_get_branch_snapshots`;
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                // El tenant SIEMPRE es el derivado de la sesión — se ignora
                // cualquier tenant_id enviado como query param.
                p_tenant_id: auth.tenantId,
                p_snapshot_date: date || new Date().toISOString().split('T')[0],
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            throw new Error(`RPC respondió ${response.status}`);
        }

        const data = await response.json();
        res.status(200).json({ snapshots: data });
    } catch (error) {
        console.error('[Monitor API] Error:', error.message);
        res.status(500).json({ error: 'No se pudieron cargar los datos' });
    }
}
