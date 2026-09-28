import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { createBusinessGateway, buildOperationArgs, OPERATION_KINDS } from '../src/server/businessGateway.js';
import { createBusinessOperationHandler, config as apiConfig } from '../api/business-operation.js';
import { sha256, OPERATOR_COOKIE, readOperatorConfig } from '../src/server/operatorAccess.js';

// No server is started: Auth and PostgREST are replaced by this synthetic fetch.
const ENV = Object.freeze({ SUPABASE_URL: 'https://supabase.gateway-test.invalid',
  APP_ORIGIN: 'https://app.gateway-test.invalid', SUPABASE_ANON_KEY: 'synthetic-anon-key',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' });
const AUTHORIZATION = 'Bearer synthetic-account-token';
const UID = '10000000-0000-4000-8000-000000000001';
const TENANT = '20000000-0000-4000-8000-000000000001';
const OPERATOR = '30000000-0000-4000-8000-000000000001';
const BRANCH = '40000000-0000-4000-8000-000000000001';
const DEVICE = '50000000-0000-4000-8000-000000000001';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const PROOF = randomBytes(32).toString('base64url');
const DEVICE_CREDENTIAL = `${DEVICE}.${PROOF}`;
const TOKEN = randomBytes(32).toString('base64url');
const OPERATION_ID = 'sale-gateway-0001';
const PAYLOAD_HASH = 'a'.repeat(64);
const authority = () => ({ operator_id: OPERATOR, tenant_id: TENANT, branch_id: BRANCH,
  role: 'CAJERO', name: 'Cajera sintética', expires_at: new Date(Date.now() + 900000).toISOString() });
const sale = (overrides = {}) => ({ kind: 'SALE', operationId: OPERATION_ID, payloadHash: PAYLOAD_HASH,
  businessDate: '2026-09-15', rate: 100,
  items: [{ product_id: PRODUCT, quantity_base: 2, unit_price_usd: 10, line_total_usd: 20 }],
  totalUsd: 20, totalBs: 2000, prescription: null, ...overrides });
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function fixture({ validate = () => authority(), commit = () => ({ sale_id: randomUUID(), status: 'CONFIRMADA' }), commitStatus = 200 } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const auth = url.endsWith('/auth/v1/user');
    const name = auth ? 'auth' : url.split('/').at(-1);
    calls.push({ name, url, init, args: auth ? null : JSON.parse(init.body) });
    if (auth) return response({ id: UID, is_anonymous: false, role: 'authenticated' });
    assert.equal(init.headers.apikey, ENV.SUPABASE_SERVICE_ROLE_KEY);
    assert.equal(init.headers.Authorization, `Bearer ${ENV.SUPABASE_SERVICE_ROLE_KEY}`);
    if (name === 'pharmacy_validate_operator_session') return response(validate());
    if (name.startsWith('pharmacy_commit_')) {
      const value = commit();
      if (value instanceof Error) return response({ message: value.message }, commitStatus);
      return response(value);
    }
    assert.fail(`Unhandled RPC ${name}`);
  };
  return { calls, fetchImpl, handler: createBusinessOperationHandler({ env: ENV, fetchImpl }) };
}

async function invoke(handler, body = sale(), extra = {}) {
  const req = { method: 'POST', headers: { origin: ENV.APP_ORIGIN, 'content-type': 'application/json',
    authorization: AUTHORIZATION, 'x-pharmacy-device': DEVICE_CREDENTIAL,
    cookie: `${OPERATOR_COOKIE}=${TOKEN}`, 'sec-fetch-site': 'same-origin', ...extra.headers }, body };
  if (extra.method) req.method = extra.method;
  if (extra.chunks) { delete req.body; req[Symbol.asyncIterator] = () => Readable.from(extra.chunks)[Symbol.asyncIterator](); }
  const result = { status: null, headers: {}, body: null };
  const res = { setHeader(name, value) { result.headers[name.toLowerCase()] = value; },
    status(code) { result.status = code; return this; }, json(value) { result.body = value; return this; } };
  await handler(req, res);
  assert.equal(result.headers['cache-control'], 'no-store, private');
  assert.equal(result.headers['x-content-type-options'], 'nosniff');
  assert.equal(result.headers['access-control-allow-origin'], undefined);
  return result;
}

const noSecrets = body => {
  const raw = JSON.stringify(body);
  for (const secret of [PROOF, ENV.SUPABASE_SERVICE_ROLE_KEY, AUTHORIZATION, TOKEN]) assert.ok(!raw.includes(secret), secret);
  assert.doesNotMatch(raw, /pin_hash|pin_salt|proof_hash|service_role|postgres/i);
};

test('gateway configuration mirrors the operator contract', () => {
  assert.deepEqual(apiConfig, { api: { bodyParser: false } });
  assert.ok(readOperatorConfig(ENV));
  assert.equal(readOperatorConfig({ ...ENV, SUPABASE_SERVICE_ROLE_KEY: '' }), null);
  assert.deepEqual(Object.keys(OPERATION_KINDS).sort(), ['SALE', 'STOCK', 'VOID']);
});

test('only POST, same-origin, JSON bodies and a session cookie reach the gateway', async () => {
  const f = fixture();
  assert.equal((await invoke(f.handler, sale(), { method: 'GET' })).status, 405);
  for (const origin of [undefined, 'null', 'https://attacker.invalid']) {
    assert.equal((await invoke(f.handler, sale(), { headers: { origin } })).status, 403);
  }
  assert.equal((await invoke(f.handler, sale(), { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  for (const type of [undefined, 'text/plain', 'application/json; charset=latin1']) {
    assert.equal((await invoke(f.handler, sale(), { headers: { 'content-type': type } })).status, 415);
  }
  assert.equal((await invoke(f.handler, sale(), { headers: { cookie: '' } })).status, 401);
  assert.equal((await invoke(f.handler, sale(), { headers: { cookie: `${OPERATOR_COOKIE}=bad` } })).status, 401);
  assert.equal((await invoke(f.handler, sale(), { headers: { 'content-length': '65537' } })).status, 413);
  assert.equal((await invoke(f.handler, sale(), { chunks: [Buffer.alloc(40000), Buffer.alloc(30000)] })).status, 413);
  assert.equal(f.calls.length, 0, 'no upstream call may happen before the guards pass');
});

test('missing configuration denies before any upstream call', async () => {
  const handler = createBusinessOperationHandler({ env: {}, fetchImpl: async () => { throw new Error('unexpected'); } });
  assert.equal((await invoke(handler)).status, 503);
});

test('a confirmed sale returns the stored receipt and forwards the verified scope', async () => {
  const receipt = { sale_id: randomUUID(), operation_id: OPERATION_ID, status: 'CONFIRMADA' };
  const f = fixture({ commit: () => receipt });
  const result = await invoke(f.handler);
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { receipt });
  assert.deepEqual(f.calls.map(call => call.name), ['auth', 'pharmacy_validate_operator_session', 'pharmacy_commit_sale']);
  const commit = f.calls.at(-1);
  assert.equal(commit.args.p_auth_uid, UID);
  assert.equal(commit.args.p_device_id, DEVICE);
  assert.equal(commit.args.p_device_proof_hash, await sha256(PROOF));
  assert.equal(commit.args.p_token_hash, await sha256(TOKEN));
  assert.equal(commit.args.p_operation_id, OPERATION_ID);
  assert.equal(commit.args.p_payload_hash, PAYLOAD_HASH);
  assert.equal(commit.args.p_rate, 100);
  assert.equal(typeof commit.args.p_items, 'string');
  assert.deepEqual(JSON.parse(commit.args.p_items), sale().items);
  assert.equal(commit.args.p_prescription, null);
  noSecrets(result.body);
});

test('an invalid or revoked session is refused before the commit RPC', async () => {
  const f = fixture({ validate: () => null });
  const result = await invoke(f.handler);
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'OPERATOR_SESSION_REQUIRED');
  assert.ok(!f.calls.some(call => call.name.startsWith('pharmacy_commit_')));
  noSecrets(result.body);
});

test('a null commit result is an authorization refusal, never a success', async () => {
  const f = fixture({ commit: () => null });
  const result = await invoke(f.handler);
  assert.equal(result.status, 401);
  assert.equal(result.body.error, 'OPERATION_NOT_AUTHORIZED');
  noSecrets(result.body);
});

test('business rejections become safe permanent codes without leaking upstream text', async () => {
  const cases = { 'Insufficient stock': 'INSUFFICIENT_STOCK', 'Operation id conflict': 'OPERATION_CONFLICT',
    'Prescription evidence required': 'PRESCRIPTION_REQUIRED', 'Unknown or disabled product': 'UNKNOWN_PRODUCT',
    'Sale already reversed': 'ALREADY_REVERSED', 'Sale belongs to another branch': 'WRONG_BRANCH',
    'Stock cannot become negative': 'NEGATIVE_STOCK' };
  for (const [message, code] of Object.entries(cases)) {
    const f = fixture({ commit: () => new Error(message), commitStatus: 400 });
    const result = await invoke(f.handler);
    assert.equal(result.status, 409, message);
    assert.deepEqual(result.body, { error: code }, message);
    noSecrets(result.body);
  }
});

test('an unexpected upstream failure stays retryable and hides internals', async () => {
  for (const message of ['permission denied for function', 'connection terminated unexpectedly', '']) {
    const f = fixture({ commit: () => new Error(message), commitStatus: 400 });
    const result = await invoke(f.handler);
    assert.equal(result.status, 503);
    assert.deepEqual(result.body, { error: 'UNAVAILABLE' });
    noSecrets(result.body);
  }
  const transport = fixture();
  transport.fetchImpl = async (url, init) => {
    if (url.endsWith('/auth/v1/user')) return response({ id: UID, is_anonymous: false, role: 'authenticated' });
    if (url.endsWith('pharmacy_validate_operator_session')) return response(authority());
    throw new Error('synthetic outage with a stack');
  };
  const handler = createBusinessOperationHandler({ env: ENV, fetchImpl: transport.fetchImpl });
  const result = await invoke(handler);
  assert.equal(result.status, 503);
  assert.deepEqual(result.body, { error: 'UNAVAILABLE' });
  noSecrets(result.body);
});

test('malformed operations are rejected before the session is resolved', async () => {
  const invalid = [
    { kind: 'UNKNOWN' }, { kind: 'SALE', operationId: 'short' },
    { ...sale(), payloadHash: 'nothex' }, { ...sale(), businessDate: '15-09-2026' },
    { ...sale(), rate: 0 }, { ...sale(), items: [] }, { ...sale(), items: 'not-array' },
    { ...sale(), kind: 'VOID', saleId: 'not-a-uuid' }, { ...sale(), kind: 'STOCK', productId: PRODUCT, delta: 0, reason: 'ADJUSTMENT' },
    { ...sale(), kind: 'STOCK', productId: PRODUCT, delta: 1, reason: 'SALE' },
    null, [], 'text',
  ];
  for (const body of invalid) {
    const f = fixture();
    const result = await invoke(f.handler, body);
    assert.equal(result.status, 400, JSON.stringify(body));
    assert.deepEqual(result.body, { error: 'INVALID_OPERATION' });
    assert.equal(f.calls.length, 0, JSON.stringify(body));
  }
});

test('void and stock operations map to their own RPC with the right arguments', async () => {
  const saleId = randomUUID();
  const f = fixture({ commit: () => ({ sale_id: saleId, status: 'ANULADA' }) });
  const result = await invoke(f.handler, { kind: 'VOID', operationId: 'void-gateway-01', payloadHash: PAYLOAD_HASH, saleId });
  assert.equal(result.status, 200);
  assert.equal(f.calls.at(-1).name, 'pharmacy_commit_void');
  assert.equal(f.calls.at(-1).args.p_sale_id, saleId);

  const g = fixture({ commit: () => ({ product_id: PRODUCT, delta: 5, quantity: 30, reason: 'ADJUSTMENT' }) });
  const stock = await invoke(g.handler, { kind: 'STOCK', operationId: 'stock-gateway-1', payloadHash: PAYLOAD_HASH,
    productId: PRODUCT, delta: 5, reason: 'ADJUSTMENT' });
  assert.equal(stock.status, 200);
  assert.equal(g.calls.at(-1).name, 'pharmacy_commit_stock_movement');
  assert.equal(g.calls.at(-1).args.p_delta, 5);
  assert.equal(g.calls.at(-1).args.p_reason, 'ADJUSTMENT');
});

test('the argument builder is pure and rejects non-finite or fractional money', () => {
  assert.ok(buildOperationArgs('SALE', sale()));
  assert.equal(buildOperationArgs('SALE', sale({ rate: Number.NaN })), null);
  assert.equal(buildOperationArgs('SALE', sale({ rate: Infinity })), null);
  assert.equal(buildOperationArgs('SALE', sale({ items: Array(201).fill(sale().items[0]) })), null);
  assert.ok(buildOperationArgs('SALE', sale({ prescription: { reference: 'R', prescriber: 'P' } })).p_prescription.includes('R'));
  assert.equal(buildOperationArgs('STOCK', { kind: 'STOCK', operationId: 'stock-gateway-2', payloadHash: PAYLOAD_HASH,
    productId: PRODUCT, delta: 1.5, reason: 'ADJUSTMENT' }).p_delta, 1.5);
  assert.equal(buildOperationArgs('STOCK', { kind: 'STOCK', operationId: 'stock-gateway-3', payloadHash: PAYLOAD_HASH,
    productId: PRODUCT, delta: 1, reason: 'OPENING' }).p_reason, 'OPENING');
  const entry = sale();
  const before = JSON.stringify(entry);
  buildOperationArgs('SALE', entry);
  assert.equal(JSON.stringify(entry), before);
});

test('a buffer body follows the same contract as a streamed body', async () => {
  const f = fixture();
  assert.equal((await invoke(f.handler, Buffer.from(JSON.stringify(sale())))).status, 200);
  const g = fixture();
  assert.equal((await invoke(g.handler, undefined, { chunks: [JSON.stringify(sale())] })).status, 200);
});
