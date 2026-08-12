// Vercel Serverless Function — actualizar metadatos del perfil
// La clave de servicio solo se usa en este backend y nunca se envía al cliente.

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'https://fgzwmwrugerptfqfrsjd.supabase.co';

const ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://localhost:4173',
    'https://listo-pos-lite.vercel.app',
    'https://listo-pos-lite.camelai.app',
    'https://listo-pos-lite.apps.camelai.dev',
]);

function applyCors(res, origin) {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS.has(origin) ? origin : '');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

export default async function handler(req, res) {
    applyCors(res, req.headers.origin || '');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const serviceKey = process.env.SUPABASE_SERVICE_KEY;
    if (!serviceKey) return res.status(500).json({ error: 'SUPABASE_SERVICE_KEY not configured' });

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
