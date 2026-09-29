import {
  createOperatorAccess, OperatorAccessError, readOperatorConfig, readSessionCookie, sessionCookie,
} from '../src/server/operatorAccess.js';
import { checkRateLimit, clientIp, rateLimitedResponse } from '../src/server/rateLimit.js';

export const config = { api: { bodyParser: false } };
const BODY_LIMIT = 4096;

async function readBody(req) {
  const length = req.headers?.['content-length'];
  if (length !== undefined && (typeof length !== 'string' || !/^\d+$/.test(length) || Number(length) > BODY_LIMIT))
    throw new OperatorAccessError(413);
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
      if (size > BODY_LIMIT) throw new OperatorAccessError(413);
      chunks.push(buffer);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > BODY_LIMIT) throw new OperatorAccessError(413);
  try { return JSON.parse(raw); } catch { throw new OperatorAccessError(400); }
}

function validPayload(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const allowed = body.action === 'login' ? ['action', 'operatorId', 'branchId', 'pin']
    : ['directory', 'logout'].includes(body.action) ? ['action'] : null;
  return allowed && Object.keys(body).every(key => allowed.includes(key))
    && allowed.every(key => Object.hasOwn(body, key));
}

// allowTestHttp is an explicit test injection only, never an environment flag.
// There is deliberately no bootstrap/enrollment action and no business write.
export function createOperatorSessionHandler({ env = process.env, fetchImpl = globalThis.fetch, allowTestHttp = false } = {}) {
  const serverConfig = readOperatorConfig(env, { allowTestHttp });
  const access = createOperatorAccess({ env, fetchImpl, allowTestHttp });
  return async function operatorSession(req, res) {
    res.setHeader('Cache-Control', 'no-store, private');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Vary', 'Origin');
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return res.status(405).json({ error: 'Method not allowed' });
    }
    // M5: frena fuerza bruta contra el login de operadores.
    const rl = checkRateLimit({ key: `login:${clientIp(req)}`, max: 60, windowMs: 60_000 });
    if (!rl.allowed) return rateLimitedResponse(res, rl.retryAfterMs);
    if (!serverConfig) return res.status(503).json({ error: 'Operator access unavailable' });
    if (req.headers?.origin !== serverConfig.appOrigin
      || (req.headers?.['sec-fetch-site'] && req.headers['sec-fetch-site'] !== 'same-origin'))
      return res.status(403).json({ error: 'Operator access denied' });
    if (typeof req.headers?.['content-type'] !== 'string'
      || !/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(req.headers['content-type']))
      return res.status(415).json({ error: 'JSON request required' });
    try {
      const body = await readBody(req);
      if (!validPayload(body)) throw new OperatorAccessError(400);
      const credentials = { authorization: req.headers?.authorization,
        deviceCredential: req.headers?.['x-pharmacy-device'] };
      if (body.action === 'directory') return res.status(200).json(await access.directory(credentials));
      if (body.action === 'login') {
        const result = await access.login({ ...credentials, operatorId: body.operatorId, branchId: body.branchId, pin: body.pin });
        res.setHeader('Set-Cookie', sessionCookie(result.token));
        return res.status(200).json({ operator: result.authority });
      }
      await access.logout({ ...credentials, token: readSessionCookie(req.headers?.cookie) });
      res.setHeader('Set-Cookie', sessionCookie('', { clear: true }));
      return res.status(200).json({ ok: true });
    } catch (error) {
      const status = error instanceof OperatorAccessError ? error.status : 503;
      return res.status(status).json({ error: status === 503 ? 'Operator access unavailable' : 'Operator access denied' });
    }
  };
}

export default createOperatorSessionHandler();
