/**
 * Cloudflare Worker — Farmacia César
 *
 * /api/checkout — Contención fase 1: verifica la cuenta y rechaza escrituras
 *                 hasta disponer de autorización de operador/sede en servidor.
 *                 No crea productos ni invoca el RPC legado.
 * Todo lo demás cae al SPA estático.
 */

import { guardLegacyCheckout, readSupabaseServerConfig } from './server/checkoutGate.js';

function corsHeaders(request) {
    const origin = request.headers.get('Origin') || '';
    const ALLOWED = [
        'http://localhost:5173',
        'http://localhost:4173',
    ];
    return {
        'Access-Control-Allow-Origin': ALLOWED.includes(origin) ? origin : '',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };
}

// ── Update Profile handler (Admin API — service key never exposed al cliente) ─
async function handleUpdateProfile(request, env) {
    const headers = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });

    const SERVICE_KEY = env.SUPABASE_SERVICE_KEY;
    const config = readSupabaseServerConfig(env);
    if (!SERVICE_KEY || !config) return Response.json({ error: 'Not configured' }, { status: 503, headers });
    const SUPABASE_URL = config.url;

    let body;
    try { body = await request.json(); } catch { return Response.json({ error: 'Invalid JSON' }, { status: 400, headers }); }

    const { accessToken, businessName, phone } = body;
    if (!accessToken) return Response.json({ error: 'accessToken required' }, { status: 400, headers });

    // 1. Verificar el access token y obtener el UID del usuario
    const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${accessToken}` },
    });
    if (!userRes.ok) return Response.json({ error: 'Token inválido' }, { status: 401, headers });
    const user = await userRes.json();
    if (!user?.id) return Response.json({ error: 'Usuario no encontrado' }, { status: 404, headers });

    // 2. Actualizar vía Admin API (servicio — nunca expuesto al frontend)
    const updateBody = { user_metadata: { ...user.user_metadata } };
    if (businessName) updateBody.user_metadata.full_name = businessName;
    if (phone) updateBody.phone = phone;

    const updateRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
            apikey: SERVICE_KEY,
            Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(updateBody),
    });

    if (!updateRes.ok) {
        const err = await updateRes.text();
        return Response.json({ error: err }, { status: updateRes.status, headers });
    }

    return Response.json({ ok: true }, { headers });
}

// ── Checkout proxy handler ─────────────────────────────────────────────────
async function handleCheckout(request, env) {
    const headers = corsHeaders(request);

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });

    if (!/^Bearer\s+\S+$/i.test(request.headers.get('Authorization') || '')) {
        return Response.json({ error: 'Inicia sesión para acceder al checkout.', code: 'AUTH_REQUIRED', retryable: false }, { status: 401, headers });
    }

    let payload;
    try {
        payload = await request.json();
    } catch {
        return Response.json({ error: 'Invalid JSON' }, { status: 400, headers });
    }

    const result = await guardLegacyCheckout({
        authorization: request.headers.get('Authorization'), payload, env,
    });
    return Response.json(result.body, { status: result.status, headers: { ...headers, 'Cache-Control': 'no-store' } });
}

// ── BCV rates proxy ─────────────────────────────────────────────────────────
async function handleRates(request) {
    const headers = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'GET') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });

    try {
        const response = await fetch('https://bcv.today/api/v1/rate.json', {
            headers: { Accept: 'application/json' },
            cf: { cacheTtl: 0, cacheEverything: false },
        });
        if (!response.ok) throw new Error(`BCV respondió ${response.status}`);

        const data = await response.json();
        const usd = Number(data?.USD ?? data?.usd);
        const eur = Number(data?.EUR ?? data?.eur);
        if ((!Number.isFinite(usd) || usd <= 0) && (!Number.isFinite(eur) || eur <= 0)) {
            throw new Error('El feed BCV no contiene tasas válidas');
        }

        const validDate = data?.effective_date || data?.effectiveDate || data?.date || null;
        const observedAt = data?.updated_at || data?.updatedAt || null;
        return Response.json({
            bcv: { price: usd > 0 ? usd : 0, validDate, observedAt, source: 'BCV (datos bcv.org.ve)' },
            euro: { price: eur > 0 ? eur : 0, validDate, observedAt, source: 'BCV (datos bcv.org.ve)' },
            lastUpdate: new Date().toISOString(),
        }, { status: 200, headers });
    } catch (error) {
        console.error('[rates] Error consultando BCV:', error);
        return Response.json({ error: 'No se pudo consultar la tasa BCV' }, { status: 502, headers });
    }
}

// ── Main fetch handler ─────────────────────────────────────────────────────
export default {
    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname.startsWith('/api/update-profile')) {
            return handleUpdateProfile(request, env);
        }

        if (url.pathname.startsWith('/api/rates')) {
            return handleRates(request);
        }

        if (url.pathname.startsWith('/api/checkout')) {
            return handleCheckout(request, env);
        }

        // Static SPA assets for everything else
        return env.ASSETS.fetch(request);
    },
};
