import { webcrypto, timingSafeEqual } from 'node:crypto';

export const PIN_ITERATIONS = 210000;
export const OPERATOR_COOKIE = '__Secure-pharmacy_operator';
export const OPERATOR_TTL_SECONDS = 900;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX = /^[0-9a-f]{64}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const encoder = new TextEncoder();
const randomToken = () => Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('base64url');

export class OperatorAccessError extends Error {
  constructor(status = 401) {
    super(status === 503 ? 'Operator access unavailable' : 'Operator access denied');
    this.status = status;
  }
}
const denied = () => { throw new OperatorAccessError(); };

export function validPin(pin) {
  if (typeof pin !== 'string' || !/^\d{8,12}$/.test(pin) || new Set(pin).size < 4) return false;
  if ('01234567890123456789'.includes(pin) || '98765432109876543210'.includes(pin)) return false;
  return !/^(\d{1,6})\1+$/.test(pin);
}

export async function sha256(value) {
  return Buffer.from(await webcrypto.subtle.digest('SHA-256', encoder.encode(value))).toString('hex');
}

async function derivePin(pin, salt, iterations) {
  const key = await webcrypto.subtle.importKey('raw', encoder.encode(pin), 'PBKDF2', false, ['deriveBits']);
  return Buffer.from(await webcrypto.subtle.deriveBits({
    name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(salt, 'hex'), iterations,
  }, key, 256));
}

export async function hashPin(pin) {
  if (!validPin(pin)) throw new OperatorAccessError(400);
  const pin_salt = Buffer.from(webcrypto.getRandomValues(new Uint8Array(32))).toString('hex');
  const pin_hash = (await derivePin(pin, pin_salt, PIN_ITERATIONS)).toString('hex');
  return { pin_salt, pin_hash, pin_iterations: PIN_ITERATIONS };
}

export async function verifyPin(pin, record) {
  if (!validPin(pin) || !record || !HEX.test(record.pin_salt) || !HEX.test(record.pin_hash)
    || !Number.isInteger(record.pin_iterations) || record.pin_iterations < PIN_ITERATIONS
    || record.pin_iterations > 1000000) return false;
  return timingSafeEqual(await derivePin(pin, record.pin_salt, record.pin_iterations), Buffer.from(record.pin_hash, 'hex'));
}

function originUrl(raw, allowTestHttp) {
  try {
    const url = new URL(raw);
    const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if (url.username || url.password || url.pathname !== '/' || url.search || url.hash
      || (url.protocol !== 'https:' && !(allowTestHttp && loopback && url.protocol === 'http:'))) return null;
    return url.origin;
  } catch { return null; }
}

export function readOperatorConfig(env = {}, { allowTestHttp = false } = {}) {
  const url = originUrl(env.SUPABASE_URL, allowTestHttp);
  const appOrigin = originUrl(env.APP_ORIGIN, allowTestHttp);
  const apiKey = env.SUPABASE_ANON_KEY;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !appOrigin || typeof apiKey !== 'string' || !apiKey.trim()
    || typeof serviceKey !== 'string' || !serviceKey.trim() || apiKey === serviceKey) return null;
  return { url, appOrigin, apiKey, serviceKey };
}

function deviceIdentity(credential) {
  if (typeof credential !== 'string') return denied();
  const parts = credential.split('.');
  if (parts.length !== 2 || !UUID.test(parts[0]) || !TOKEN.test(parts[1])) return denied();
  return { id: parts[0], proof: parts[1] };
}

function safeAuthority(value) {
  if (!value || !UUID.test(value.operator_id) || !UUID.test(value.tenant_id) || !UUID.test(value.branch_id)
    || !['DUENO', 'ADMIN', 'CAJERO'].includes(value.role) || typeof value.name !== 'string'
    || !Number.isFinite(Date.parse(value.expires_at))) return denied();
  return Object.fromEntries(['operator_id', 'tenant_id', 'branch_id', 'role', 'name', 'expires_at']
    .map(key => [key, value[key]]));
}

function safeDirectory(value) {
  if (!value || !Array.isArray(value.operators) || !Array.isArray(value.branches)) return denied();
  return {
    operators: value.operators.map(o => {
      if (!o || !UUID.test(o.id) || typeof o.local_code !== 'string' || typeof o.name !== 'string'
        || !['DUENO', 'ADMIN', 'CAJERO'].includes(o.role) || (o.branch_id !== null && !UUID.test(o.branch_id))) return denied();
      return { id: o.id, local_code: o.local_code, name: o.name, role: o.role, branch_id: o.branch_id };
    }),
    branches: value.branches.map(b => {
      if (!b || !UUID.test(b.id) || !['central', 'norte', 'sur'].includes(b.code) || typeof b.name !== 'string') return denied();
      return { id: b.id, code: b.code, name: b.name };
    }),
  };
}

// Not imported by any business write path. Each entry verifies Auth before RPC.
export function createOperatorAccess({ env = {}, fetchImpl = globalThis.fetch, allowTestHttp = false } = {}) {
  const config = readOperatorConfig(env, { allowTestHttp });
  async function authenticate(authorization) {
    if (!config) throw new OperatorAccessError(503);
    const match = typeof authorization === 'string' && /^Bearer ([^\s]{1,8192})$/i.exec(authorization);
    if (!match) return denied();
    let response;
    try {
      response = await fetchImpl(`${config.url}/auth/v1/user`, {
        method: 'GET', headers: { apikey: config.apiKey, Authorization: `Bearer ${match[1]}` },
        cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new OperatorAccessError(response.status >= 500 ? 503 : 401);
      const user = await response.json();
      if (!user || !UUID.test(user.id) || user.is_anonymous !== false || user.role !== 'authenticated') return denied();
      return user.id;
    } catch (error) {
      if (error instanceof OperatorAccessError) throw error;
      throw new OperatorAccessError(503);
    }
  }
  async function rpc(name, args) {
    try {
      const response = await fetchImpl(`${config.url}/rest/v1/rpc/${name}`, {
        method: 'POST', headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`,
          'Content-Type': 'application/json' }, body: JSON.stringify(args), cache: 'no-store',
        redirect: 'error', signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw new OperatorAccessError(503);
      return await response.json();
    } catch { throw new OperatorAccessError(503); }
  }
  async function scope(authorization, deviceCredential) {
    const authUid = await authenticate(authorization);
    const device = deviceIdentity(deviceCredential);
    return { p_auth_uid: authUid, p_device_id: device.id, p_device_proof_hash: await sha256(device.proof) };
  }
  async function administrativeIdentity(authorization, expectedOwnerAuthUid) {
    if (!UUID.test(expectedOwnerAuthUid)) return denied();
    const authUid = await authenticate(authorization);
    if (authUid !== expectedOwnerAuthUid) return denied();
    return authUid;
  }
  return {
    async directory({ authorization, deviceCredential }) {
      return safeDirectory(await rpc('pharmacy_operator_directory', await scope(authorization, deviceCredential)));
    },
    async login({ authorization, deviceCredential, operatorId, branchId, pin }) {
      if (!UUID.test(operatorId) || !UUID.test(branchId) || !validPin(pin)) return denied();
      const args = await scope(authorization, deviceCredential);
      const attempt = await rpc('pharmacy_reserve_pin_attempt', { ...args, p_operator_id: operatorId, p_branch_id: branchId });
      if (!attempt || !UUID.test(attempt.attempt_id) || !Number.isSafeInteger(attempt.credential_version)
        || attempt.credential_version < 1) return denied();
      const verified = await verifyPin(pin, attempt);
      const token = randomToken();
      const authority = await rpc('pharmacy_finish_pin_attempt', { ...args, p_operator_id: operatorId,
        p_attempt_id: attempt.attempt_id, p_credential_version: attempt.credential_version,
        p_verified: verified, p_token_hash: verified ? await sha256(token) : null });
      if (!verified || !authority) return denied();
      // Token is server-internal; the HTTP adapter may emit it ONLY as a cookie.
      return { authority: safeAuthority(authority), token };
    },
    async validateSession({ authorization, deviceCredential, token }) {
      if (!TOKEN.test(token)) return denied();
      const args = await scope(authorization, deviceCredential);
      return safeAuthority(await rpc('pharmacy_validate_operator_session', { ...args, p_token_hash: await sha256(token) }));
    },
    // Resolves the exact RPC parameters for a business write. The session is
    // validated first, so a revoked or expired cookie never reaches a commit.
    async sessionScope({ authorization, deviceCredential, token }) {
      if (!TOKEN.test(token || '')) return denied();
      const args = await scope(authorization, deviceCredential);
      const authority = safeAuthority(await rpc('pharmacy_validate_operator_session', { ...args, p_token_hash: await sha256(token) }));
      return { authority, scope: { ...args, p_token_hash: await sha256(token) } };
    },
    async logout({ authorization, deviceCredential, token }) {
      if (!TOKEN.test(token)) return denied();
      const args = await scope(authorization, deviceCredential);
      await rpc('pharmacy_revoke_operator_session', { ...args, p_token_hash: await sha256(token) });
    },
    // Trusted administrative invocation only. expectedOwnerAuthUid must come from
    // a human-verified owner record, not an HTTP payload or auth metadata.
    async bootstrapOwner({ authorization, expectedOwnerAuthUid, tenantName, ownerName, localCode, pin }) {
      const authUid = await administrativeIdentity(authorization, expectedOwnerAuthUid);
      if (![tenantName, ownerName, localCode].every(s => typeof s === 'string' && s.trim() && s.length <= 80))
        throw new OperatorAccessError(400);
      const record = await hashPin(pin);
      const result = await rpc('pharmacy_bootstrap_owner', { p_auth_uid: authUid, p_tenant_name: tenantName,
        p_owner_name: ownerName, p_local_code: localCode, p_pin_salt: record.pin_salt,
        p_pin_hash: record.pin_hash, p_pin_iterations: record.pin_iterations });
      if (!result || !UUID.test(result.tenant_id) || !UUID.test(result.operator_id)) return denied();
      return { tenant_id: result.tenant_id, operator_id: result.operator_id };
    },
    async enrollDevice({ authorization, expectedOwnerAuthUid, label }) {
      const authUid = await administrativeIdentity(authorization, expectedOwnerAuthUid);
      if (typeof label !== 'string' || !label.trim() || label.length > 120) throw new OperatorAccessError(400);
      const deviceId = webcrypto.randomUUID();
      const proof = randomToken();
      const result = await rpc('pharmacy_enroll_device', { p_auth_uid: authUid,
        p_device_id: deviceId, p_proof_hash: await sha256(proof), p_label: label });
      if (!result || result.device_id !== deviceId) return denied();
      // One-time administrative delivery; never persisted in plaintext by SQL.
      return { deviceId, deviceCredential: `${deviceId}.${proof}` };
    },
  };
}

export function sessionCookie(token, { clear = false } = {}) {
  if (!clear && !TOKEN.test(token)) return denied();
  return `${OPERATOR_COOKIE}=${clear ? '' : token}; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=${clear ? 0 : OPERATOR_TTL_SECONDS}`;
}

export function readSessionCookie(header = '') {
  if (typeof header !== 'string' || header.length > 8192) return null;
  const matches = header.split(';').map(s => s.trim()).filter(s => s.startsWith(`${OPERATOR_COOKIE}=`));
  if (matches.length !== 1) return null;
  const token = matches[0].slice(OPERATOR_COOKIE.length + 1);
  return TOKEN.test(token) ? token : null;
}
