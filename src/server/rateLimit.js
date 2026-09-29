// Rate limiting simple por IP (M5, 2026-09-28).
// Token bucket en memoria: suficiente para frenar fuerza bruta contra
// login (/api/operator-session), commit (/api/business-operation) y perfil.
// En serverless la memoria es por instancia/isolate: no es un límite
// distribuido perfecto, pero eleva el costo del ataque varios órdenes de
// magnitud. Para un límite global usar el rate limit del borde (Vercel/Cloudflare).
const buckets = new Map();

function bucketFor(key, now, maxTokens, windowMs) {
    let b = buckets.get(key);
    if (!b || now - b.windowStart >= windowMs) {
        b = { tokens: maxTokens, windowStart: now };
        buckets.set(key, b);
    }
    return b;
}

// Prune perezoso para no crecer sin cota.
let lastPrune = 0;
function prune(now, windowMs) {
    if (now - lastPrune < windowMs) return;
    lastPrune = now;
    for (const [k, b] of buckets) {
        if (now - b.windowStart >= windowMs * 2) buckets.delete(k);
    }
}

// Solo para tests: aisla cada invocación del estado compartido en memoria.
export function resetRateLimitBuckets() {
    buckets.clear();
    lastPrune = 0;
}

export function checkRateLimit({ key, max = 60, windowMs = 60_000 } = {}) {
    const now = Date.now();
    prune(now, windowMs);
    const b = bucketFor(`rl:${key}`, now, max, windowMs);
    if (b.tokens <= 0) return { allowed: false, retryAfterMs: b.windowStart + windowMs - now };
    b.tokens -= 1;
    return { allowed: true, remaining: b.tokens };
}

export function clientIp(req) {
    // Vercel / Cloudflare / proxies comunes.
    const h = req.headers || {};
    const fwd = h['x-forwarded-for'] || h['cf-connecting-ip'] || '';
    const ip = String(Array.isArray(fwd) ? fwd[0] : fwd).split(',')[0].trim();
    return ip || h['x-real-ip'] || req.socket?.remoteAddress || 'unknown';
}

// Respuesta 429 estándar para Vercel.
export function rateLimitedResponse(res, retryAfterMs) {
    res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
    return res.status(429).json({ error: 'Demasiadas solicitudes. Intenta de nuevo en unos segundos.' });
}
