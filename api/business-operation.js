import { createBusinessGateway } from '../src/server/businessGateway.js';
import { readOperatorConfig, readSessionCookie } from '../src/server/operatorAccess.js';

export const config = { api: { bodyParser: false } };
const BODY_LIMIT = 64 * 1024;
// A body that is too large and a body that is not JSON are different failures:
// one is a size refusal, the other a malformed request.
class BodyError extends Error {
    constructor(status) { super('body'); this.status = status; }
}

async function readBody(req) {
    const length = req.headers?.['content-length'];
    if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) {
        throw new BodyError(413);
    }
    let raw;
    if (req.body !== undefined) {
        raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8')
            : typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
    } else {
        const chunks = [];
        let size = 0;
        for await (const chunk of req) {
            const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            size += buffer.length;
            if (size > BODY_LIMIT) throw new BodyError(413);
            chunks.push(buffer);
        }
        raw = Buffer.concat(chunks).toString('utf8');
    }
    if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > BODY_LIMIT) throw new BodyError(413);
    try { return JSON.parse(raw); } catch { throw new BodyError(400); }
}

// The browser sends one queued operation at a time. It never receives the
// service key, the device proof hash or any upstream error text.
export function createBusinessOperationHandler({ env = process.env, fetchImpl = globalThis.fetch, allowTestHttp = false } = {}) {
    const serverConfig = readOperatorConfig(env, { allowTestHttp });
    const gateway = createBusinessGateway({ env, fetchImpl, allowTestHttp });
    return async function businessOperation(req, res) {
        res.setHeader('Cache-Control', 'no-store, private');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('Vary', 'Origin');
        if (req.method !== 'POST') {
            res.setHeader('Allow', 'POST');
            return res.status(405).json({ error: 'METHOD_NOT_ALLOWED' });
        }
        if (!serverConfig) return res.status(503).json({ error: 'UNAVAILABLE' });
        if (req.headers?.origin !== serverConfig.appOrigin
            || (req.headers?.['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin')) {
            return res.status(403).json({ error: 'ORIGIN_NOT_ALLOWED' });
        }
        if (typeof req.headers?.['content-type'] !== 'string'
            || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type'])) {
            return res.status(415).json({ error: 'JSON_REQUIRED' });
        }
        let body;
        try { body = await readBody(req); }
        catch (error) {
            const status = error instanceof BodyError ? error.status : 400;
            return res.status(status).json({ error: status === 413 ? 'BODY_TOO_LARGE' : 'INVALID_OPERATION' });
        }
        const token = readSessionCookie(req.headers?.cookie);
        if (!token) return res.status(401).json({ error: 'OPERATOR_SESSION_REQUIRED' });
        try {
            const result = await gateway.commit({
                authorization: req.headers?.authorization,
                deviceCredential: req.headers?.['x-pharmacy-device'],
                token, operation: body,
            });
            return res.status(result.status).json(result.body);
        } catch { return res.status(503).json({ error: 'UNAVAILABLE' }); }
    };
}

export default createBusinessOperationHandler();
