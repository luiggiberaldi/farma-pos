// CORS centralizado (A4, 2026-09-28).
// Todos los endpoints HTTP (Vercel `api/*` y Cloudflare `src/worker.js`)
// resuelven los orígenes permitidos desde APP_ORIGIN (lista separada por
// comas, obligatorio en producción). Los localhost de Vite solo se admiten
// fuera de producción. Antes cada archivo hardcodeaba su propia lista y
// producción quedaba rota.
const DEV_ORIGINS = ['http://localhost:5173', 'http://localhost:4173'];

function isProduction(env = {}) {
    return env.NODE_ENV === 'production' || env.VERCEL_ENV === 'production';
}

export function parseAllowedOrigins(env = {}) {
    const fromEnv = String(env.APP_ORIGIN || '')
        .split(',')
        .map(s => s.trim().replace(/\/+$/, ''))
        .filter(Boolean);
    return new Set(isProduction(env) ? fromEnv : [...fromEnv, ...DEV_ORIGINS]);
}

export function isOriginAllowed(origin, env = {}) {
    if (!origin) return false;
    return parseAllowedOrigins(env).has(origin.replace(/\/+$/, ''));
}

// Estilo Vercel (res.setHeader). Si el origen no está permitido, no se emite
// Access-Control-Allow-Origin: el navegador bloquea la lectura.
export function applyCors(res, origin, env = {}, { methods = 'GET, POST, OPTIONS', headers = 'Content-Type, Authorization' } = {}) {
    res.setHeader('Vary', 'Origin');
    if (isOriginAllowed(origin, env)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', methods);
    res.setHeader('Access-Control-Allow-Headers', headers);
}

// Estilo Cloudflare Worker (objeto plano de headers).
export function corsHeadersObject(origin, env = {}, { methods = 'GET, POST, OPTIONS', headers = 'Content-Type, Authorization' } = {}) {
    const headersOut = {
        'Vary': 'Origin',
        'Access-Control-Allow-Methods': methods,
        'Access-Control-Allow-Headers': headers,
    };
    if (isOriginAllowed(origin, env)) headersOut['Access-Control-Allow-Origin'] = origin;
    return headersOut;
}
