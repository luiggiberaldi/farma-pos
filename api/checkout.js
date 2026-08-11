// Vercel Serverless Function — Checkout proxy
// Upserts unknown products then calls process_checkout RPC using service_role key.

// La URL de producción debe venir de Vercel; el fallback conserva compatibilidad
// con despliegues antiguos, pero no debe ser la fuente principal.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fgzwmwrugerptfqfrsjd.supabase.co';

const CORS_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:4173',
    'https://listo-pos-lite.vercel.app',
    'https://listo-pos-lite.camelai.app',
    'https://listo-pos-lite.apps.camelai.dev',
];

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': CORS_ORIGINS.includes(origin) ? origin : '',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
    };
}

export default async function handler(req, res) {
    const origin = req.headers['origin'] || '';
    const headers = corsHeaders(origin);

    Object.entries(headers).forEach(([k, v]) => res.setHeader(k, v));

    if (req.method === 'OPTIONS') {
        return res.status(204).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    const SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
    if (!SERVICE_KEY) {
        return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });
    }

    const payload = req.body;
    if (!payload || typeof payload !== 'object') {
        return res.status(400).json({ error: 'Invalid JSON' });
    }

    const { cart = [] } = payload;

    // Idempotencia persistente para ventas que vuelven desde la cola offline.
    // Si el servidor ya confirmó este operation_id, devolver el resultado
    // anterior en lugar de ejecutar nuevamente el checkout.
    if (payload.queue_id && payload.sync_origin === 'offline_sync') {
        const safeQueueId = encodeURIComponent(payload.queue_id);
        const duplicateResponse = await fetch(
            `${SUPABASE_URL}/rest/v1/sales?queue_id=eq.${safeQueueId}&select=id&limit=1`,
            { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }
        );
        if (duplicateResponse.ok) {
            const existing = await duplicateResponse.json();
            if (existing?.length > 0) {
                return res.status(200).json({ ok: true, duplicate: true, sale_id: existing[0].id });
            }
        }
    }

    // Upsert unknown products (ON CONFLICT DO NOTHING)
    // name may be absent in offline queue entries saved before the fix — use fallback
    const productsToUpsert = cart
        .filter(item => item.id)
        .map(item => ({
            id: item.id,
            name: item.name || `Producto ${item.id.slice(0, 8)}`,
            price: item.priceUsd || 0,
            stock: 0,
            cost_price: 0,
        }));

    if (productsToUpsert.length > 0) {
        await fetch(`${SUPABASE_URL}/rest/v1/products`, {
            method: 'POST',
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=ignore-duplicates,return=minimal',
            },
            body: JSON.stringify(productsToUpsert),
        });
    }

    // Call process_checkout RPC (strip name from cart items)
    const payments = Array.isArray(payload.payments) ? payload.payments : [];
    const fiadoUsd = payload.fiadoUsd || 0;
    const paymentsSum = payments.reduce((s, p) => s + (p.amountUsd || 0), 0);
    const expectedSum = (payload.total || 0) - fiadoUsd;

    // RPC requires sum(payments) + fiadoUsd == total (double-entry balance).
    // In change scenarios the gross cash payment exceeds the sale total.
    // Scale all payments proportionally to the expected sum so they balance.
    const normalizedPayments = paymentsSum > expectedSum + 0.005
        ? payments.map(p => ({ ...p, amountUsd: Math.round(p.amountUsd / paymentsSum * expectedSum * 100) / 100 }))
        : payments;

    const rpcPayload = {
        ...payload,
        cart: cart.map(({ id, qty, priceUsd }) => ({ id, qty, priceUsd })),
        payments: normalizedPayments,
    };

    const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/process_checkout`, {
        method: 'POST',
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ payload: rpcPayload }),
    });

    const result = await rpcRes.json();

    // Estampar queue_id antes de confirmar al dispositivo. Si el marcado
    // falla, no afirmar que la operación quedó protegida contra duplicados.
    if (rpcRes.ok && payload.queue_id && result?.sale_id) {
        const markResponse = await fetch(`${SUPABASE_URL}/rest/v1/sales?id=eq.${encodeURIComponent(result.sale_id)}`, {
            method: 'PATCH',
            headers: {
                apikey: SERVICE_KEY,
                Authorization: `Bearer ${SERVICE_KEY}`,
                'Content-Type': 'application/json',
                Prefer: 'return=minimal',
            },
            body: JSON.stringify({ queue_id: payload.queue_id }),
        });
        if (!markResponse.ok) {
            return res.status(502).json({
                error: 'La venta fue procesada, pero no se pudo confirmar su idempotencia.',
                retryable: true,
            });
        }
    }

    return res.status(rpcRes.ok ? 200 : rpcRes.status).json(result);
}
