/**
 * Cloudflare Worker — Farmacia César
 *
 * /api/checkout — Contención fase 1: verifica la cuenta y rechaza escrituras
 *                 hasta disponer de autorización de operador/sede en servidor.
 *                 No crea productos ni invoca el RPC legado.
 * Todo lo demás cae al SPA estático.
 */

import { guardLegacyCheckout, readSupabaseServerConfig } from './server/checkoutGate.js';
import { corsHeadersObject } from './server/cors.js';
import { readServiceRoleKey } from './server/envKeys.js';
import { checkRateLimit } from './server/rateLimit.js';

// A4: orígenes desde APP_ORIGIN (variable del Worker) — ver src/server/cors.js.
function corsHeaders(request, env) {
    const origin = request.headers.get('Origin') || '';
    return corsHeadersObject(origin, env);
}

// M5: rate limit mínimo en el borde del Worker (por isolate).
function workerRateLimited(request, scope) {
    const ip = request.headers.get('cf-connecting-ip')
        || (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
        || 'unknown';
    const rl = checkRateLimit({ key: `${scope}:${ip}`, max: 120, windowMs: 60_000 });
    return rl.allowed ? null : rl.retryAfterMs;
}

// ── Update Profile handler (Admin API — service key never exposed al cliente) ─
async function handleUpdateProfile(request, env) {
    const headers = corsHeaders(request, env);
    const rlMs = workerRateLimited(request, 'profile');
    if (rlMs !== null) return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429, headers });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return Response.json({ error: 'Method not allowed' }, { status: 405, headers });

    // A6: nombre canónico SUPABASE_SERVICE_ROLE_KEY (con fallback transitorio).
    const SERVICE_KEY = readServiceRoleKey(env);
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
        // A5: nunca filtrar el texto crudo del upstream al cliente.
        console.error('[update-profile] Admin API respondió', updateRes.status);
        return Response.json({ error: 'No se pudo actualizar el perfil' }, { status: 502, headers });
    }

    return Response.json({ ok: true }, { headers });
}

// ── Checkout proxy handler ─────────────────────────────────────────────────
async function handleCheckout(request, env) {
    const headers = corsHeaders(request, env);
    const rlMs = workerRateLimited(request, 'checkout');
    if (rlMs !== null) return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429, headers });

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
// M6 (2026-09-28): misma banda anti-manipulación que api/rates.js — si el feed
// salta más de ±30% respecto a la última tasa buena, se sirve la última buena
// marcada como stale y se alerta en logs.
const WORKER_RATE_BAND = 0.30;
let workerLastGood = null; // { usd, eur, validDate, observedAt } por isolate

function workerWithinBand(value, reference) {
    if (!reference || reference <= 0) return true;
    return Math.abs(value - reference) / reference <= WORKER_RATE_BAND;
}

function workerStaleResponse(headers) {
    return Response.json({
        bcv: { price: workerLastGood.usd, validDate: workerLastGood.validDate, observedAt: workerLastGood.observedAt, source: 'BCV (cache de última tasa buena)' },
        euro: { price: workerLastGood.eur, validDate: workerLastGood.validDate, observedAt: workerLastGood.observedAt, source: 'BCV (cache de última tasa buena)' },
        lastUpdate: new Date().toISOString(),
        stale: true,
    }, { status: 200, headers });
}

async function workerRecordRate(env, usd) {
    const url = env.SUPABASE_URL;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key || !usd) return;
    try {
        await fetch(`${url}/rest/v1/rpc/pharmacy_record_rate_all`, {
            method: 'POST',
            headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ p_rate: usd, p_source: 'bcv' }),
        });
    } catch (error) {
        console.error('[rates] No se pudo registrar la tasa observada:', error?.message || error);
    }
}

async function handleRates(request, env) {
    const headers = corsHeaders(request, env);
    const rlMs = workerRateLimited(request, 'rates');
    if (rlMs !== null) return Response.json({ error: 'Demasiadas solicitudes' }, { status: 429, headers });
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

        if (workerLastGood && ((usd > 0 && !workerWithinBand(usd, workerLastGood.usd)) || (eur > 0 && !workerWithinBand(eur, workerLastGood.eur)))) {
            console.error(`[rates] ALERTA: tasa fuera de banda ±${WORKER_RATE_BAND * 100}% (usd ${usd} vs ${workerLastGood.usd}). Sirviendo última buena.`);
            return workerStaleResponse(headers);
        }

        if (usd > 0 || eur > 0) {
            workerLastGood = { usd, eur, validDate, observedAt };
            if (usd > 0) workerRecordRate(env, usd);
        }
        return Response.json({
            bcv: { price: usd > 0 ? usd : 0, validDate, observedAt, source: 'BCV (datos bcv.org.ve)' },
            euro: { price: eur > 0 ? eur : 0, validDate, observedAt, source: 'BCV (datos bcv.org.ve)' },
            lastUpdate: new Date().toISOString(),
        }, { status: 200, headers });
    } catch (error) {
        console.error('[rates] Error consultando BCV:', error);
        if (workerLastGood) return workerStaleResponse(headers);
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
            return handleRates(request, env);
        }

        if (url.pathname.startsWith('/api/checkout')) {
            return handleCheckout(request, env);
        }

        // Static SPA assets for everything else
        return env.ASSETS.fetch(request);
    },
};
