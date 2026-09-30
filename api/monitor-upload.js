// API del Monitor — subida de snapshots de sede.
// Auth: JWT de Supabase Auth de la estación (Authorization: Bearer).
// El tenant se deriva del dueño en el servidor; el branch_id se valida
// contra ese tenant (FK en la BD). Sin sesión válida no hay escritura.
import { applyCors } from '../src/server/cors.js';
import { checkRateLimit, clientIp, rateLimitedResponse } from '../src/server/rateLimit.js';
import { authenticateMonitorRequest } from '../src/server/monitorAuth.js';

export default async function handler(req, res) {
    const origin = req.headers.origin || '';
    applyCors(res, origin, process.env, { methods: 'POST, OPTIONS', headers: 'Content-Type, Authorization' });
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
    }

    if (req.method !== 'POST') {
        res.status(405).json({ error: 'Método no permitido' });
        return;
    }

    // Rate limit: 20 req/min por IP (subidas periódicas)
    const rl = checkRateLimit({ key: `monitor-upload:${clientIp(req)}`, max: 20, windowMs: 60_000 });
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

    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key) {
        res.status(500).json({ error: 'Configuración incompleta' });
        return;
    }

    try {
        const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
        const {
            p_branch_id, p_snapshot_date,
            p_total_sales_usd, p_total_sales_bs, p_transaction_count,
            p_cash_usd, p_pos_bs, p_credit_usd,
            p_cash_register_open, p_cashier_name, p_opening_usd, p_opening_bs,
            p_voids_count, p_voids_total_usd, p_discounts_total_usd,
            p_payment_breakdown,
        } = body;

        if (!p_branch_id || !p_snapshot_date) {
            res.status(400).json({ error: 'Faltan campos requeridos' });
            return;
        }

        // El tenant SIEMPRE es el derivado de la sesión — se ignora cualquier
        // p_tenant_id enviado por el cliente. La FK (tenant_id, branch_id)
        // en branch_snapshots rechaza sedes de otro tenant.
        const rpcUrl = `${url}/rest/v1/rpc/pharmacy_upsert_branch_snapshot`;
        const response = await fetch(rpcUrl, {
            method: 'POST',
            headers: {
                apikey: key,
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                p_tenant_id: auth.tenantId,
                p_branch_id,
                p_snapshot_date,
                p_total_sales_usd: p_total_sales_usd || 0,
                p_total_sales_bs: p_total_sales_bs || 0,
                p_transaction_count: p_transaction_count || 0,
                p_cash_usd: p_cash_usd || 0,
                p_pos_bs: p_pos_bs || 0,
                p_credit_usd: p_credit_usd || 0,
                p_cash_register_open: !!p_cash_register_open,
                p_cashier_name: p_cashier_name || null,
                p_opening_usd: p_opening_usd ?? null,
                p_opening_bs: p_opening_bs ?? null,
                p_voids_count: p_voids_count || 0,
                p_voids_total_usd: p_voids_total_usd || 0,
                p_discounts_total_usd: p_discounts_total_usd || 0,
                p_payment_breakdown: p_payment_breakdown || {},
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) {
            // 400/409 de PostgREST = FK violada (sede de otro tenant) o datos inválidos
            if (response.status === 400 || response.status === 409) {
                res.status(403).json({ error: 'Sede no autorizada' });
                return;
            }
            throw new Error(`RPC respondió ${response.status}`);
        }

        const data = await response.json();
        res.status(200).json({ id: data });
    } catch (error) {
        console.error('[Monitor Upload API] Error:', error.message);
        res.status(500).json({ error: 'No se pudo subir el snapshot' });
    }
}
