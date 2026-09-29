// Proxy de tasa BCV — con banda anti-manipulación (M6, 2026-09-28).
import { applyCors } from '../src/server/cors.js';
import { checkRateLimit, clientIp, rateLimitedResponse } from '../src/server/rateLimit.js';

const BCV_FEED_URL = 'https://bcv.today/api/v1/rate.json';
// M6: si el feed salta más de ±30% respecto a la última tasa buena, no se
// propaga el salto: se sirve la última buena marcada como stale y se alerta
// en logs. Protege contra un feed comprometido o un error del proveedor.
const RATE_BAND = 0.30;
let lastGood = null; // { usd, eur, validDate, observedAt, at }

function validRate(value) {
    const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(number) && number > 0 ? number : 0;
}

function withinBand(value, reference) {
    if (!reference || reference <= 0) return true;
    return Math.abs(value - reference) / reference <= RATE_BAND;
}

// Registra la tasa observada para todos los tenants vía RPC SECURITY DEFINER.
// Solo con service key (nunca expuesta al cliente).
async function recordObservedRate(usd) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
    if (!url || !key || !usd) return;
    const response = await fetch(`${url}/rest/v1/rpc/pharmacy_record_rate_all`, {
        method: 'POST',
        headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_rate: usd, p_source: 'bcv' }),
        signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error(`RPC respondió ${response.status}`);
}

export default async function handler(req, res) {
    const origin = req.headers.origin || '';
    applyCors(res, origin, process.env, { methods: 'GET, OPTIONS', headers: 'Content-Type' });
    res.setHeader('Cache-Control', 'no-store, max-age=0');

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const rl = checkRateLimit({ key: `rates:${clientIp(req)}`, max: 120, windowMs: 60_000 });
    if (!rl.allowed) return rateLimitedResponse(res, rl.retryAfterMs);

    try {
        const response = await fetch(BCV_FEED_URL, {
            headers: { Accept: 'application/json' },
            cache: 'no-store',
        });
        if (!response.ok) throw new Error(`BCV respondió ${response.status}`);

        const data = await response.json();
        const usd = validRate(data?.USD ?? data?.usd);
        const eur = validRate(data?.EUR ?? data?.eur);
        if (!usd && !eur) throw new Error('El feed BCV no contiene tasas válidas');

        const validDate = data?.effective_date || data?.effectiveDate || data?.date || null;
        const observedAt = data?.updated_at || data?.updatedAt || null;

        // M6: banda contra la última tasa buena.
        if (lastGood && ((usd && !withinBand(usd, lastGood.usd)) || (eur && !withinBand(eur, lastGood.eur)))) {
            console.error(`[api/rates] ALERTA: tasa fuera de banda ±${RATE_BAND * 100}% (usd ${usd} vs ${lastGood.usd}). Sirviendo última buena.`);
            return res.status(200).json({
                bcv: { price: lastGood.usd, validDate: lastGood.validDate, observedAt: lastGood.observedAt, source: 'BCV (cache de última tasa buena)' },
                euro: { price: lastGood.eur, validDate: lastGood.validDate, observedAt: lastGood.observedAt, source: 'BCV (cache de última tasa buena)' },
                lastUpdate: new Date().toISOString(),
                stale: true,
            });
        }

        if (usd || eur) {
            lastGood = { usd, eur, validDate, observedAt, at: new Date().toISOString() };
            // M6: alimentar la referencia de la banda ±5% de pharmacy_commit_sale.
            // Fire-and-forget: la venta no depende de este registro.
            recordObservedRate(usd).catch(error =>
                console.error('[api/rates] No se pudo registrar la tasa observada:', error?.message || error));
        }

        return res.status(200).json({
            bcv: {
                price: usd,
                validDate,
                observedAt,
                source: 'BCV (datos bcv.org.ve)',
            },
            euro: {
                price: eur,
                validDate,
                observedAt,
                source: 'BCV (datos bcv.org.ve)',
            },
            lastUpdate: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[api/rates] Error consultando BCV:', error);
        // Fallback: si hay última buena, servirla marcada como stale antes que fallar.
        if (lastGood) {
            return res.status(200).json({
                bcv: { price: lastGood.usd, validDate: lastGood.validDate, observedAt: lastGood.observedAt, source: 'BCV (cache de última tasa buena)' },
                euro: { price: lastGood.eur, validDate: lastGood.validDate, observedAt: lastGood.observedAt, source: 'BCV (cache de última tasa buena)' },
                lastUpdate: new Date().toISOString(),
                stale: true,
            });
        }
        return res.status(502).json({ error: 'No se pudo consultar la tasa BCV' });
    }
}
