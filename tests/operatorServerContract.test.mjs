import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync, createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Readable } from 'node:stream';
import {
  createOperatorAccess, hashPin, verifyPin, validPin, sha256, readOperatorConfig,
  OperatorAccessError, OPERATOR_COOKIE, OPERATOR_TTL_SECONDS, PIN_ITERATIONS,
  sessionCookie, readSessionCookie,
} from '../src/server/operatorAccess.js';
import { createOperatorSessionHandler, config as apiConfig } from '../api/operator-session.js';
import { resetRateLimitBuckets } from '../src/server/rateLimit.js';

// No server is started. Every Auth/RPC request uses this synthetic fetch boundary.
// SQL names/types are checked here, not its locking/RLS behavior (access-contract.mjs).
const sql = await readFile(new URL('../supabase/migrations/202609140002_operator_access.sql', import.meta.url), 'utf8');
const signatures = new Map([...sql.matchAll(/CREATE FUNCTION public\.(pharmacy_\w+)\(\s*([\s\S]*?)\) RETURNS/g)]
  .map(([, name, args]) => [name, args.split(',').map(arg => arg.trim().split(/\s+/))]));
const PIN = '49382716';
const BAD_PIN = '48392716';
const UID = '10000000-0000-4000-8000-000000000001';
const OTHER_UID = '10000000-0000-4000-8000-000000000002';
const TENANT = '20000000-0000-4000-8000-000000000001';
const OPERATOR = '30000000-0000-4000-8000-000000000001';
const BRANCH = '40000000-0000-4000-8000-000000000001';
const DEVICE = '50000000-0000-4000-8000-000000000001';
const PROOF = randomBytes(32).toString('base64url');
const DEVICE_CREDENTIAL = `${DEVICE}.${PROOF}`;
const PROOF_HASH = await sha256(PROOF);
const PIN_RECORD = await hashPin(PIN);
const ENV = Object.freeze({ SUPABASE_URL: 'https://supabase.operator-test.invalid',
  APP_ORIGIN: 'https://app.operator-test.invalid', SUPABASE_ANON_KEY: 'synthetic-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' });
const AUTHORIZATION = 'Bearer synthetic-account-token';
const USER = { id: UID, is_anonymous: false, role: 'authenticated',
  user_metadata: { role: 'DUENO', tenant_id: 'untrusted', operator_id: 'untrusted' } };
const CREDENTIALS = { authorization: AUTHORIZATION, deviceCredential: DEVICE_CREDENTIAL };
const LOGIN = { action: 'login', operatorId: OPERATOR, branchId: BRANCH, pin: PIN };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const hex = /^[0-9a-f]{64}$/;
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const authority = () => ({ operator_id: OPERATOR, tenant_id: TENANT, branch_id: BRANCH,
  role: 'CAJERO', name: 'Synthetic cashier', expires_at: new Date(Date.now() + 900000).toISOString() });
const directory = () => ({ operators: [{ id: OPERATOR, local_code: 'fixture-cashier', name: 'Synthetic cashier',
  role: 'CAJERO', branch_id: BRANCH, ...PIN_RECORD, credential_version: 1, proof: PROOF }],
  branches: [{ id: BRANCH, code: 'central', name: 'Central', proof_hash: PROOF_HASH }], pin_hash: PIN_RECORD.pin_hash });

function validateRpc(name, args) {
  const signature = signatures.get(name);
  assert.ok(signature, `Unknown RPC ${name}`);
  assert.deepEqual(Object.keys(args).sort(), signature.map(([key]) => key).sort());
  for (const [key, type] of signature) {
    const value = args[key];
    if (key === 'p_token_hash' && value === null && args.p_verified === false) continue;
    if (type === 'uuid') assert.ok(typeof value === 'string' && uuid.test(value), `${key} must be uuid text`);
    else if (type === 'text') assert.equal(typeof value, 'string', key);
    else if (type === 'integer' || type === 'bigint') assert.ok(Number.isSafeInteger(value), key);
    else if (type === 'boolean') assert.equal(typeof value, 'boolean', key);
    else assert.fail(`Unverified SQL type ${type}`);
  }
  assert.equal(args.p_auth_uid, UID);
  assert.ok(!Object.hasOwn(args, 'pin') && !Object.hasOwn(args, 'role') && !Object.hasOwn(args, 'tenant_id'));
}

function fixture(options = {}) {
  const calls = [];
  const protocolErrors = [];
  const tickets = new Map();
  const sessions = new Map();
  const state = { credentialVersion: 1 };
  let authenticated = false;
  const fetchImpl = async (url, init) => {
    const auth = url === `${ENV.SUPABASE_URL}/auth/v1/user`;
    const name = auth ? 'auth' : url.split('/').at(-1);
    const args = auth ? null : JSON.parse(init.body);
    calls.push({ name, url, init, args });
    try {
      assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
      assert.ok(init.signal instanceof AbortSignal);
      if (auth) {
        assert.equal(init.method, 'GET');
        assert.equal(init.headers.apikey, ENV.SUPABASE_ANON_KEY);
        assert.equal(init.headers.Authorization, AUTHORIZATION);
        if (options.authThrows) throw new Error('Synthetic network failure containing no real secrets');
        if (options.authMalformed) return { ok: true, status: 200, json: async () => { throw new SyntaxError('invalid'); } };
        const user = Object.hasOwn(options, 'user') ? options.user : USER;
        authenticated = user?.id === UID && user?.is_anonymous === false && user?.role === 'authenticated';
        return response(user, options.authStatus || 200);
      }
      assert.equal(authenticated, true, 'Service RPC must follow successful Auth verification');
      assert.ok(url.startsWith(`${ENV.SUPABASE_URL}/rest/v1/rpc/`));
      assert.equal(init.method, 'POST');
      assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
      assert.equal(init.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
      assert.equal(init.headers['Content-Type'], 'application/json');
      validateRpc(name, args);
      if (options.rpcThrows) throw new Error('Synthetic service failure');
      if (options.rpcStatus) return response({ message: 'private failure', detail: PIN_RECORD.pin_hash }, options.rpcStatus);
      if (options.rpcMalformed) return { ok: true, status: 200, json: async () => { throw new SyntaxError('invalid'); } };
      if (options.rpc) return response(await options.rpc(name, args, state));
      if (name === 'pharmacy_bootstrap_owner') return response({ tenant_id: TENANT, operator_id: OPERATOR });
      if (name === 'pharmacy_enroll_device') return response({ device_id: args.p_device_id });
      const scoped = args.p_device_id === DEVICE && args.p_device_proof_hash === PROOF_HASH;
      if (!scoped) return response(null);
      if (name === 'pharmacy_operator_directory') return response(directory());
      if (name === 'pharmacy_reserve_pin_attempt') {
        if (args.p_operator_id !== OPERATOR || args.p_branch_id !== BRANCH) return response(null);
        const ticket = { attempt_id: randomUUID(), credential_version: state.credentialVersion, ...PIN_RECORD };
        tickets.set(ticket.attempt_id, ticket);
        if (options.resetDuringPin) state.credentialVersion++;
        return response(ticket);
      }
      if (name === 'pharmacy_finish_pin_attempt') {
        const ticket = tickets.get(args.p_attempt_id);
        tickets.delete(args.p_attempt_id);
        if (!ticket || !args.p_verified || args.p_credential_version !== state.credentialVersion) return response(null);
        assert.match(args.p_token_hash, hex);
        sessions.set(args.p_token_hash, { ...authority(), credentialVersion: state.credentialVersion });
        return response({ ...authority(), ...PIN_RECORD, token_hash: args.p_token_hash, device_proof: PROOF });
      }
      if (name === 'pharmacy_validate_operator_session') {
        const session = sessions.get(args.p_token_hash);
        return response(session?.credentialVersion === state.credentialVersion ? session : null);
      }
      if (name === 'pharmacy_revoke_operator_session') return response(sessions.delete(args.p_token_hash));
      assert.fail(`Unhandled RPC ${name}`);
    } catch (error) {
      if (error.code === 'ERR_ASSERTION') protocolErrors.push(error);
      throw error;
    }
  };
  const access = createOperatorAccess({ env: ENV, fetchImpl });
  const handler = createOperatorSessionHandler({ env: ENV, fetchImpl });
  return { calls, protocolErrors, state, access, handler, fetchImpl };
}

async function invoke(handler, body = { action: 'directory' }, extra = {}) {
  resetRateLimitBuckets(); // el bucket en memoria es global: aislar cada invocación
  const req = { method: 'POST', headers: { origin: ENV.APP_ORIGIN, 'content-type': 'application/json',
    authorization: AUTHORIZATION, 'x-pharmacy-device': DEVICE_CREDENTIAL, 'sec-fetch-site': 'same-origin',
    ...extra.headers }, body };
  if (extra.method) req.method = extra.method;
  if (extra.chunks) { delete req.body; req[Symbol.asyncIterator] = () => Readable.from(extra.chunks)[Symbol.asyncIterator](); }
  const result = { status: null, headers: {}, body: null };
  const res = {
    setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
    status(value) { result.status = value; return this; },
    json(value) { result.body = value; return this; },
  };
  await handler(req, res);
  assert.equal(result.headers['cache-control'], 'no-store, private');
  assert.equal(result.headers.pragma, 'no-cache');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers.vary, 'Origin');
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  return result;
}
const noProtocolErrors = f => assert.deepEqual(f.protocolErrors, []);
const errorStatus = status => error => error instanceof OperatorAccessError && error.status === status;
function noSecrets(body, extra = []) {
  const raw = JSON.stringify(body);
  for (const secret of [PIN, PROOF, PROOF_HASH, PIN_RECORD.pin_hash, PIN_RECORD.pin_salt,
    ENV.SUPABASE_SERVICE_ROLE_KEY, AUTHORIZATION, ...extra]) assert.ok(!raw.includes(secret));
  assert.doesNotMatch(raw, /pin_hash|pin_salt|pin_iterations|credential_version|token_hash|device_proof/);
}

 test('SQL RPC signature inventory matches the seven service-only helpers', () => {
  assert.equal(signatures.size, 7);
  assert.deepEqual(signatures.get('pharmacy_finish_pin_attempt').map(([, type]) => type),
    ['uuid', 'uuid', 'text', 'uuid', 'uuid', 'bigint', 'boolean', 'text']);
});

test('PBKDF2 uses SHA256, 210000+ iterations and independent random 32-byte salts', async () => {
  const second = await hashPin(PIN);
  assert.ok(PIN_ITERATIONS >= 210000);
  assert.match(PIN_RECORD.pin_salt, hex); assert.match(PIN_RECORD.pin_hash, hex);
  assert.notEqual(PIN_RECORD.pin_salt, second.pin_salt); assert.notEqual(PIN_RECORD.pin_hash, second.pin_hash);
  assert.equal(PIN_RECORD.pin_hash, pbkdf2Sync(PIN, Buffer.from(PIN_RECORD.pin_salt, 'hex'), PIN_ITERATIONS, 32, 'sha256').toString('hex'));
  assert.equal(await verifyPin(PIN, PIN_RECORD), true);
  assert.equal(await verifyPin(BAD_PIN, PIN_RECORD), false);
  assert.equal(await sha256('abc'), createHash('sha256').update('abc').digest('hex'));
});

test('weak/default/numeric/oversized PINs and malformed hash parameters are rejected', async () => {
  for (const pin of [undefined, null, 49382716, '', '1234', '11111111', '12345678', '87654321', '12341234', '4938271619284', '4938x716']) {
    assert.equal(validPin(pin), false); await assert.rejects(hashPin(pin), errorStatus(400));
  }
  for (const changes of [{ pin_salt: 'not-hex' }, { pin_hash: '00' }, { pin_iterations: 209999 },
    { pin_iterations: 1000001 }, { pin_iterations: 210000.5 }, { pin_iterations: '210000' }]) {
    assert.equal(await verifyPin(PIN, { ...PIN_RECORD, ...changes }), false);
  }
  assert.equal(await verifyPin(PIN, null), false);
});

test('server configuration requires explicit distinct keys and HTTPS origins', () => {
  assert.ok(readOperatorConfig(ENV));
  for (const key of Object.keys(ENV)) assert.equal(readOperatorConfig({ ...ENV, [key]: '' }), null);
  assert.equal(readOperatorConfig({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: ENV.SUPABASE_ANON_KEY }), null);
  for (const raw of ['http://remote.invalid', 'https://user:pass@remote.invalid', 'https://remote.invalid/path',
    'https://remote.invalid?query=1', 'https://remote.invalid#fragment', 'not-a-url']) {
    assert.equal(readOperatorConfig({ ...ENV, APP_ORIGIN: raw }), null);
    assert.equal(readOperatorConfig({ ...ENV, SUPABASE_URL: raw }), null);
  }
  const local = { ...ENV, APP_ORIGIN: 'http://localhost:5173', SUPABASE_URL: 'http://127.0.0.1:54321', ALLOW_TEST_HTTP: 'true' };
  assert.equal(readOperatorConfig(local), null);
  assert.ok(readOperatorConfig(local, { allowTestHttp: true }));
  assert.equal(readOperatorConfig({ ...local, APP_ORIGIN: 'http://remote.invalid' }, { allowTestHttp: true }), null);
});

test('POST-only method and missing configuration deny before fetch', async () => {
  assert.deepEqual(apiConfig, { api: { bodyParser: false } });
  const f = fixture();
  for (const method of ['GET', 'OPTIONS', 'PUT', 'DELETE']) {
    const result = await invoke(f.handler, { action: 'directory' }, { method });
    assert.equal(result.status, 405); assert.equal(result.headers.allow, 'POST');
  }
  const result = await invoke(createOperatorSessionHandler({ env: {}, fetchImpl: f.fetchImpl }));
  assert.equal(result.status, 503); assert.equal(f.calls.length, 0);
});

test('missing/cross-origin/null origins and cross-site fetch metadata deny before fetch', async () => {
  const f = fixture();
  for (const origin of [undefined, null, 'null', 'https://attacker.invalid', `${ENV.APP_ORIGIN}/`, 'http://localhost:5173']) {
    assert.equal((await invoke(f.handler, undefined, { headers: { origin } })).status, 403);
  }
  for (const site of ['cross-site', 'same-site', 'none']) {
    assert.equal((await invoke(f.handler, undefined, { headers: { 'sec-fetch-site': site } })).status, 403);
  }
  assert.equal(f.calls.length, 0);
});

test('JSON content type, malformed body, stream size and content-length are bounded', async () => {
  const f = fixture();
  for (const type of [undefined, 'text/plain', 'application/x-www-form-urlencoded', 'application/json; charset=latin1']) {
    assert.equal((await invoke(f.handler, undefined, { headers: { 'content-type': type } })).status, 415);
  }
  for (const body of ['{', 'null', '[]', '"directory"', '42', {}, { action: 'unknown' }]) {
    assert.equal((await invoke(f.handler, body)).status, 400);
  }
  for (const length of ['4097', '-1', 'garbage', ['25']]) {
    assert.equal((await invoke(f.handler, undefined, { headers: { 'content-length': length } })).status, 413);
  }
  assert.equal((await invoke(f.handler, ' '.repeat(4097))).status, 413);
  assert.equal((await invoke(f.handler, undefined, { chunks: [Buffer.alloc(2000), Buffer.alloc(2097)] })).status, 413);
  assert.equal(f.calls.length, 0);
});

test('payload authority claims, missing login fields and administrative actions are rejected', async () => {
  const f = fixture();
  for (const extra of [{ role: 'DUENO' }, { tenant_id: TENANT }, { auth_uid: UID }, { verified: true },
    { token: 'in-body' }, { p_verified: true }, { deviceCredential: DEVICE_CREDENTIAL }]) {
    assert.equal((await invoke(f.handler, { ...LOGIN, ...extra })).status, 400);
    assert.equal((await invoke(f.handler, { action: 'directory', ...extra })).status, 400);
  }
  for (const action of ['bootstrap', 'bootstrapOwner', 'enroll', 'enrollDevice', 'validateSession']) {
    assert.equal((await invoke(f.handler, { action })).status, 400);
  }
  for (const key of ['operatorId', 'branchId', 'pin']) {
    const body = { ...LOGIN }; delete body[key]; assert.equal((await invoke(f.handler, body)).status, 400);
  }
  assert.equal(f.calls.length, 0);
});

test('invalid Bearer authorization never reaches Auth or service RPC', async () => {
  const f = fixture();
  for (const authorization of [undefined, null, '', 'Basic value', 'Bearer', 'Bearer  value', 'Bearer token with spaces', ['Bearer value']]) {
    assert.equal((await invoke(f.handler, undefined, { headers: { authorization } })).status, 401);
  }
  assert.equal(f.calls.length, 0);
});

test('Auth denial, anonymous/wrong role/malformed users cause zero service RPCs', async () => {
  for (const options of [{ authStatus: 401 }, { authStatus: 403 }, { user: null }, { user: { ...USER, id: 'bad' } },
    { user: { ...USER, is_anonymous: true } }, { user: { ...USER, is_anonymous: undefined } },
    { user: { ...USER, role: 'service_role' } }, { user: { ...USER, role: 'anon' } },
    { user: { id: UID, user_metadata: { role: 'authenticated', is_anonymous: false } } }]) {
    const f = fixture(options); const result = await invoke(f.handler);
    assert.equal(result.status, 401); assert.deepEqual(f.calls.map(c => c.name), ['auth']);
    noSecrets(result.body); noProtocolErrors(f);
  }
});

test('Auth and RPC transport failures are generic and never issue cookies', async () => {
  for (const options of [{ authStatus: 500 }, { authThrows: true }, { authMalformed: true },
    { rpcStatus: 401 }, { rpcStatus: 500 }, { rpcThrows: true }, { rpcMalformed: true }]) {
    const f = fixture(options); const result = await invoke(f.handler);
    assert.equal(result.status, 503); assert.deepEqual(result.body, { error: 'Operator access unavailable' });
    assert.equal(result.headers['set-cookie'], undefined); noSecrets(result.body); noProtocolErrors(f);
    if (options.authStatus || options.authThrows || options.authMalformed) assert.deepEqual(f.calls.map(c => c.name), ['auth']);
  }
});

test('malformed device credentials and weak login input never reach service RPC', async () => {
  const f = fixture();
  for (const device of [undefined, null, '', DEVICE, `${DEVICE}.short`, `not-uuid.${PROOF}`, `${DEVICE}.${PROOF}.extra`, [DEVICE_CREDENTIAL]]) {
    assert.equal((await invoke(f.handler, undefined, { headers: { 'x-pharmacy-device': device } })).status, 401);
  }
  for (const body of [{ ...LOGIN, pin: '12345678' }, { ...LOGIN, pin: 49382716 },
    { ...LOGIN, operatorId: 'not-uuid' }, { ...LOGIN, branchId: null }]) {
    assert.equal((await invoke(f.handler, body)).status, 401);
  }
  assert.ok(f.calls.every(c => c.name === 'auth')); noProtocolErrors(f);
});

test('directory uses verified account plus hashed device proof and strips upstream secrets', async () => {
  const f = fixture(); const result = await invoke(f.handler);
  assert.equal(result.status, 200); assert.deepEqual(f.calls.map(c => c.name), ['auth', 'pharmacy_operator_directory']);
  assert.deepEqual(f.calls[1].args, { p_auth_uid: UID, p_device_id: DEVICE, p_device_proof_hash: PROOF_HASH });
  assert.deepEqual(Object.keys(result.body.operators[0]).sort(), ['branch_id', 'id', 'local_code', 'name', 'role']);
  assert.deepEqual(Object.keys(result.body.branches[0]).sort(), ['code', 'id', 'name']);
  assert.equal(result.headers['set-cookie'], undefined); noSecrets(result.body); noProtocolErrors(f);
});

test('buffer and streamed JSON bodies use the same handler contract', async () => {
  const f = fixture();
  assert.equal((await invoke(f.handler, Buffer.from('{"action":"directory"}'))).status, 200);
  assert.equal((await invoke(f.handler, undefined, { chunks: ['{"action":', '"directory"}'],
    headers: { 'content-type': 'application/json; charset=utf-8', 'sec-fetch-site': undefined } })).status, 200);
  noProtocolErrors(f);
});

test('well-formed wrong device proof and unknown operator/branch get generic denial', async () => {
  const f = fixture();
  assert.equal((await invoke(f.handler, undefined, { headers: {
    'x-pharmacy-device': `${DEVICE}.${randomBytes(32).toString('base64url')}` } })).status, 401);
  assert.equal((await invoke(f.handler, { ...LOGIN, operatorId: randomUUID() })).status, 401);
  assert.equal((await invoke(f.handler, { ...LOGIN, branchId: randomUUID() })).status, 401);
  assert.ok(!f.calls.some(c => c.name === 'pharmacy_finish_pin_attempt')); noProtocolErrors(f);
});

test('login reserves, hashes PIN, commits version, and exposes opaque token only in secure cookie', async () => {
  const f = fixture(); const result = await invoke(f.handler, LOGIN);
  assert.equal(result.status, 200);
  assert.deepEqual(f.calls.map(c => c.name), ['auth', 'pharmacy_reserve_pin_attempt', 'pharmacy_finish_pin_attempt']);
  const [reserve, finish] = f.calls.slice(1).map(c => c.args);
  assert.deepEqual(reserve, { p_auth_uid: UID, p_device_id: DEVICE, p_device_proof_hash: PROOF_HASH,
    p_operator_id: OPERATOR, p_branch_id: BRANCH });
  assert.equal(finish.p_verified, true); assert.equal(finish.p_credential_version, 1);
  const cookie = result.headers['set-cookie']; const token = readSessionCookie(cookie);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/); assert.equal(finish.p_token_hash, await sha256(token));
  for (const flag of ['Path=/api', 'HttpOnly', 'Secure', 'SameSite=Strict', 'Max-Age=900']) assert.ok(cookie.includes(flag));
  assert.ok(cookie.startsWith(`${OPERATOR_COOKIE}=`)); assert.ok(!cookie.includes('Domain='));
  assert.equal(OPERATOR_TTL_SECONDS, 900); assert.equal(result.body.operator.role, 'CAJERO');
  assert.deepEqual(Object.keys(result.body), ['operator']);
  assert.deepEqual(Object.keys(result.body.operator).sort(), ['branch_id', 'expires_at', 'name', 'operator_id', 'role', 'tenant_id']);
  noSecrets(result.body, [token, finish.p_token_hash]); noProtocolErrors(f);
});

test('wrong PIN commits a failed attempt with no token hash and returns no cookie', async () => {
  const f = fixture(); const result = await invoke(f.handler, { ...LOGIN, pin: BAD_PIN });
  assert.equal(result.status, 401); assert.equal(result.headers['set-cookie'], undefined);
  const finish = f.calls.at(-1); assert.equal(finish.name, 'pharmacy_finish_pin_attempt');
  assert.equal(finish.args.p_verified, false); assert.equal(finish.args.p_token_hash, null);
  noSecrets(result.body); noProtocolErrors(f);
});

test('denied/invalid reservations never mint a session', async () => {
  for (const value of [null, {}, { ...PIN_RECORD, attempt_id: 'invalid', credential_version: 1 },
    { ...PIN_RECORD, attempt_id: randomUUID(), credential_version: '1' },
    { ...PIN_RECORD, attempt_id: randomUUID(), credential_version: 0 }]) {
    const f = fixture({ rpc: () => value }); const result = await invoke(f.handler, LOGIN);
    assert.equal(result.status, 401); assert.equal(result.headers['set-cookie'], undefined);
    assert.deepEqual(f.calls.map(c => c.name), ['auth', 'pharmacy_reserve_pin_attempt']); noProtocolErrors(f);
  }
});

test('reset during PBKDF2 rejects stale credential-version commit without cookie', async () => {
  const f = fixture({ resetDuringPin: true }); const result = await invoke(f.handler, LOGIN);
  assert.equal(result.status, 401); assert.equal(result.headers['set-cookie'], undefined);
  assert.equal(f.calls.at(-1).args.p_credential_version, 1); assert.equal(f.state.credentialVersion, 2);
  noProtocolErrors(f);
});

test('session validator rechecks Auth/device/token hash and respects revoked/version denied RPC', async () => {
  const f = fixture(); const login = await f.access.login({ ...CREDENTIALS, ...LOGIN });
  assert.equal((await f.access.validateSession({ ...CREDENTIALS, token: login.token })).operator_id, OPERATOR);
  assert.deepEqual(f.calls.slice(-2).map(c => c.name), ['auth', 'pharmacy_validate_operator_session']);
  assert.equal(f.calls.at(-1).args.p_token_hash, await sha256(login.token));
  await assert.rejects(f.access.validateSession({ ...CREDENTIALS, token: login.token,
    deviceCredential: `${DEVICE}.${randomBytes(32).toString('base64url')}` }), errorStatus(401));
  f.state.credentialVersion++;
  await assert.rejects(f.access.validateSession({ ...CREDENTIALS, token: login.token }), errorStatus(401));
  noProtocolErrors(f);
});

test('logout revokes by hash, clears exact secure cookie, and token replay is rejected', async () => {
  const f = fixture(); const signedIn = await invoke(f.handler, LOGIN);
  const token = readSessionCookie(signedIn.headers['set-cookie']);
  const result = await invoke(f.handler, { action: 'logout' }, { headers: { cookie: `${OPERATOR_COOKIE}=${token}` } });
  assert.equal(result.status, 200); assert.deepEqual(result.body, { ok: true });
  assert.equal(result.headers['set-cookie'], `${OPERATOR_COOKIE}=; Path=/api; HttpOnly; Secure; SameSite=Strict; Max-Age=0`);
  assert.deepEqual(f.calls.slice(-2).map(c => c.name), ['auth', 'pharmacy_revoke_operator_session']);
  assert.equal(f.calls.at(-1).args.p_token_hash, await sha256(token));
  await assert.rejects(f.access.validateSession({ ...CREDENTIALS, token }), errorStatus(401));
  noSecrets(result.body, [token]); noProtocolErrors(f);
});

test('missing malformed and duplicate session cookies cannot select a logout identity', async () => {
  const token = randomBytes(32).toString('base64url');
  assert.equal(readSessionCookie(`unrelated=value; ${OPERATOR_COOKIE}=${token}`), token);
  for (const cookie of ['', 'different=value', `${OPERATOR_COOKIE}=bad`, `${OPERATOR_COOKIE}=${token}; ${OPERATOR_COOKIE}=${token}`,
    'x'.repeat(8193), [`${OPERATOR_COOKIE}=${token}`]]) {
    assert.equal(readSessionCookie(cookie), null);
    const f = fixture(); const result = await invoke(f.handler, { action: 'logout' }, { headers: { cookie } });
    assert.equal(result.status, 401); assert.equal(result.headers['set-cookie'], undefined); assert.equal(f.calls.length, 0);
  }
  assert.throws(() => sessionCookie('bad'), errorStatus(401));
});

test('malformed directory or authority RPC result is denied and never copied to JSON', async () => {
  for (const value of [null, { operators: [], branches: null }, { operators: [{ id: OPERATOR, role: 'ROOT' }], branches: [] }]) {
    const f = fixture({ rpc: () => value }); assert.equal((await invoke(f.handler)).status, 401); noProtocolErrors(f);
  }
  const f = fixture({ rpc: name => name === 'pharmacy_reserve_pin_attempt'
    ? { ...PIN_RECORD, attempt_id: randomUUID(), credential_version: 1 }
    : { ...authority(), role: 'ROOT', pin_hash: PIN_RECORD.pin_hash } });
  const result = await invoke(f.handler, LOGIN);
  assert.equal(result.status, 401); assert.equal(result.headers['set-cookie'], undefined); noSecrets(result.body); noProtocolErrors(f);
});

test('administrative bootstrap requires explicit matching owner and sends only salted PIN hash', async () => {
  const f = fixture(); const payload = { authorization: AUTHORIZATION, expectedOwnerAuthUid: UID,
    tenantName: 'Synthetic tenant', ownerName: 'Synthetic owner', localCode: 'fixture-owner', pin: PIN };
  await assert.rejects(f.access.bootstrapOwner({ ...payload, expectedOwnerAuthUid: undefined }), errorStatus(401));
  await assert.rejects(f.access.bootstrapOwner({ ...payload, expectedOwnerAuthUid: OTHER_UID }), errorStatus(401));
  assert.ok(f.calls.every(c => c.name === 'auth'));
  const result = await f.access.bootstrapOwner(payload);
  assert.deepEqual(result, { tenant_id: TENANT, operator_id: OPERATOR });
  const rpc = f.calls.at(-1); assert.equal(rpc.name, 'pharmacy_bootstrap_owner');
  assert.equal(rpc.args.p_auth_uid, UID); assert.equal(rpc.args.p_pin_iterations, PIN_ITERATIONS);
  assert.equal(await verifyPin(PIN, { pin_salt: rpc.args.p_pin_salt, pin_hash: rpc.args.p_pin_hash, pin_iterations: rpc.args.p_pin_iterations }), true);
  assert.ok(!JSON.stringify(rpc.args).includes(`"${PIN}"`)); noProtocolErrors(f);
});

test('administrative enrollment returns random proof once while service RPC receives only its hash', async () => {
  const f = fixture(); const payload = { authorization: AUTHORIZATION, expectedOwnerAuthUid: UID, label: 'Synthetic terminal' };
  await assert.rejects(f.access.enrollDevice({ ...payload, expectedOwnerAuthUid: OTHER_UID }), errorStatus(401));
  assert.ok(f.calls.every(c => c.name === 'auth'));
  const first = await f.access.enrollDevice(payload); const second = await f.access.enrollDevice(payload);
  assert.notEqual(first.deviceId, second.deviceId); assert.notEqual(first.deviceCredential, second.deviceCredential);
  const proof = second.deviceCredential.split('.')[1]; const rpc = f.calls.at(-1);
  assert.equal(rpc.name, 'pharmacy_enroll_device'); assert.equal(rpc.args.p_device_id, second.deviceId);
  assert.equal(rpc.args.p_proof_hash, await sha256(proof));
  assert.ok(!JSON.stringify(rpc.args).includes(proof)); noProtocolErrors(f);
});
