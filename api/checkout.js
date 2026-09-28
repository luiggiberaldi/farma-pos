// Phase 1: legacy writes remain closed until operator + branch authorization
// and the scoped/idempotent server contract are implemented and verified.
import { guardLegacyCheckout } from '../src/server/checkoutGate.js';

const CORS_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

export default async function handler(req, res) {
    const origin = req.headers?.origin || '';
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGINS.includes(origin) ? origin : '');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
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
