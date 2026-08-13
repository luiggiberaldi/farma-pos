const BCV_FEED_URL = 'https://bcv.today/api/v1/rate.json';

const ALLOWED_ORIGINS = new Set([
    'http://localhost:5173',
    'http://localhost:4173',
    'https://listo-pos-lite.vercel.app',
    'https://listo-pos-lite.camelai.app',
    'https://listo-pos-lite.apps.camelai.dev',
    'https://tasasaldia.com',
    'https://www.tasasaldia.com',
]);

function setCors(res, origin) {
    if (ALLOWED_ORIGINS.has(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function validRate(value) {
    const number = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
    return Number.isFinite(number) && number > 0 ? number : 0;
}

export default async function handler(req, res) {
    const origin = req.headers.origin || '';
    setCors(res, origin);

    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

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
        return res.status(502).json({ error: 'No se pudo consultar la tasa BCV' });
    }
}
