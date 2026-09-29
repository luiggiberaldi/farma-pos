// Vercel Serverless Function — actualizar metadatos del perfil
// La clave de servicio solo se usa en este backend y nunca se envía al cliente.

// La URL del proyecto debe venir de las variables de entorno del deploy.
// TODO: Configurar VITE_SUPABASE_URL con las credenciales del NUEVO proyecto Supabase.
const SUPABASE_URL = process.env.VITE_SUPABASE_URL;

import { applyCors } from '../src/server/cors.js';
import { checkRateLimit, clientIp, rateLimitedResponse } from '../src/server/rateLimit.js';
import { readServiceRoleKey } from '../src/server/envKeys.js';

export default async function handler(req, res) {
    // A4: orígenes desde APP_ORIGIN (ver src/server/cors.js).
    applyCors(res, req.headers.origin || '', process.env, { methods: 'POST, OPTIONS', headers: 'Content-Type' });

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // M5: este endpoint toca la Admin API: límite estricto.
    const rl = checkRateLimit({ key: `profile:${clientIp(req)}`, max: 30, windowMs: 60_000 });
    if (!rl.allowed) return rateLimitedResponse(res, rl.retryAfterMs);

    // A6: nombre canónico SUPABASE_SERVICE_ROLE_KEY (con fallback transitorio).
    const serviceKey = readServiceRoleKey(process.env);
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY not configured' });

    const { accessToken, businessName, phone } = req.body || {};
    if (!accessToken) return res.status(400).json({ error: 'accessToken required' });

    const userResponse = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${accessToken}`,
        },
    });

    if (!userResponse.ok) return res.status(401).json({ error: 'Token inválido' });

    const user = await userResponse.json();
    if (!user?.id) return res.status(404).json({ error: 'Usuario no encontrado' });

    const userMetadata = { ...(user.user_metadata || {}) };
    if (businessName) userMetadata.full_name = businessName;

    const updateResponse = await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, {
        method: 'PUT',
        headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            user_metadata: userMetadata,
            ...(phone ? { phone } : {}),
        }),
    });

    if (!updateResponse.ok) {
        const detail = await updateResponse.text();
        console.error('[update-profile] Supabase rechazó la actualización:', detail);
        return res.status(updateResponse.status).json({ error: 'No se pudo actualizar el perfil' });
    }

    return res.status(200).json({ ok: true });
}
