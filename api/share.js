// Vercel Serverless Function — Relay de inventario con código de 6 dígitos
// Storage: Upstash Redis (REST API, gratis)

const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const TTL_SECONDS = 86400; // 24 horas
const MAX_PAYLOAD_BYTES = 5 * 1024 * 1024; // 5MB máximo

// Helper: ejecutar comando Redis via REST
async function redis(command, ...args) {
    const res = await fetch(`${UPSTASH_URL}`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${UPSTASH_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify([command, ...args]),
    });
    const data = await res.json();
    if (data.error) throw new Error(data.error);
    return data.result;
}

// Generar código de 6 dígitos (formato: XXX-XXX)
function generateCode() {
    const num = Math.floor(100000 + Math.random() * 900000);
    return num.toString();
}

export default async function handler(req, res) {
    // CORS — allowlist exacta de dominios permitidos
    const origin = req.headers?.origin || '';
    const ALLOWED_ORIGINS = [
        'http://localhost:5173',
        'http://localhost:4173',
    ];
    const allowed = ALLOWED_ORIGINS.includes(origin);
    res.setHeader('Access-Control-Allow-Origin', allowed ? origin : '');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // Verificar configuración
    if (!UPSTASH_URL || !UPSTASH_TOKEN) {
        return res.status(500).json({ error: 'Upstash Redis no configurado. Agrega UPSTASH_REDIS_REST_URL y UPSTASH_REDIS_REST_TOKEN en las variables de entorno de Vercel.' });
    }

    try {
        // POST — Compartir inventario
        if (req.method === 'POST') {
            const { products, categories } = req.body;

            if (!products || !Array.isArray(products) || products.length === 0) {
                return res.status(400).json({ error: 'No hay productos para compartir.' });
            }

            // Validar tamaño del payload
            const payloadSize = JSON.stringify({ products, categories }).length;
            if (payloadSize > MAX_PAYLOAD_BYTES) {
                return res.status(413).json({ error: `Payload demasiado grande (${(payloadSize / 1024 / 1024).toFixed(1)}MB). Máximo: 5MB.` });
            }

            // Generar código único (reintentar si existe)
            let code;
            let attempts = 0;
            do {
                code = generateCode();
                const exists = await redis('EXISTS', `inv:${code}`);
                if (!exists) break;
                attempts++;
            } while (attempts < 5);

            // Guardar en Redis con TTL de 24h
            const payload = JSON.stringify({
                products,
                categories: categories || null,
                createdAt: new Date().toISOString(),
                count: products.length,
            });

            await redis('SET', `inv:${code}`, payload, 'EX', TTL_SECONDS);

            return res.status(200).json({
                code: `${code.slice(0, 3)}-${code.slice(3)}`,
                expiresIn: '24 horas',
                productCount: products.length,
            });
        }

        // GET — Importar inventario por código
        if (req.method === 'GET') {
            const { code } = req.query;

            if (!code) {
                return res.status(400).json({ error: 'Código requerido.' });
            }

            // Limpiar formato (quitar guiones, espacios)
            const cleanCode = code.replace(/[-\s]/g, '');

            if (cleanCode.length !== 6 || !/^\d+$/.test(cleanCode)) {
                return res.status(400).json({ error: 'Código inválido. Usa el formato XXX-XXX.' });
            }

            const data = await redis('GET', `inv:${cleanCode}`);

            if (!data) {
                return res.status(404).json({ error: 'Código no encontrado o expirado.' });
            }

            const parsed = JSON.parse(data);
            return res.status(200).json(parsed);
        }

        return res.status(405).json({ error: 'Método no permitido.' });
    } catch (err) {
        console.error('Share API error:', err);
        return res.status(500).json({ error: 'Error interno del servidor.' });
    }
}
