// Phase 1: legacy writes remain closed until operator + branch authorization
// and the scoped/idempotent server contract are implemented and verified.
import { guardLegacyCheckout } from '../src/server/checkoutGate.js';
import { applyCors } from '../src/server/cors.js';

export default async function handler(req, res) {
    // A4: orígenes desde APP_ORIGIN (ver src/server/cors.js).
    applyCors(res, req.headers?.origin || '', process.env, { methods: 'POST, OPTIONS', headers: 'Content-Type, Authorization' });
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const result = await guardLegacyCheckout({
        authorization: req.headers?.authorization,
        payload: req.body,
        env: process.env,
    });
    return res.status(result.status).json(result.body);
}
