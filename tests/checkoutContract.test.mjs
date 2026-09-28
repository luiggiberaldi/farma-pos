import test from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/checkout.js';
import worker from '../src/worker.js';
import { guardLegacyCheckout, readSupabaseServerConfig } from '../src/server/checkoutGate.js';
import { createProcessorFixture, loadRealModule, saleOptions } from './helpers/realModule.mjs';

const env = { SUPABASE_URL: 'https://qa.invalid', SUPABASE_ANON_KEY: 'synthetic-anon' };
const payload = () => ({ total: 10, cart: [{ id: 'qa-product', qty: 1, priceUsd: 10 }], payments: [{ methodId: 'cash', amountUsd: 10 }], fiadoUsd: 0 });
const invoke = async (adapter, { method = 'POST', body = payload(), authorization = 'Bearer synthetic-token' } = {}) => {
  if (adapter === 'worker') {
    const request = new Request('https://app.qa.invalid/api/checkout', { method, headers: authorization ? { Authorization: authorization, 'Content-Type': 'application/json' } : {}, ...(!['GET', 'OPTIONS'].includes(method) ? { body: JSON.stringify(body) } : {}) });
    const response = await worker.fetch(request, env);
    return { status: response.status, body: response.status === 204 ? null : await response.json() };
  }
  const response = { statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; return this; }, end() {} };
  await handler({ method, body, headers: { authorization } }, response);
  return { status: response.statusCode, body: response.body };
};

for (const adapter of ['vercel', 'worker']) {
  test(`contrato ${adapter}: deniega anonimo, rol no verificable y entradas invalidas sin escrituras`, async t => {
    const oldFetch = globalThis.fetch;
    const keys = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_KEY'];
    const previous = keys.map(key => [key, process.env[key]]);
    for (const key of keys) delete process.env[key];
    Object.assign(process.env, env);
    t.after(() => { globalThis.fetch = oldFetch; for (const [key, value] of previous) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
    const calls = [];
    globalThis.fetch = async (url, options) => { calls.push([String(url), options.method]); return Response.json({ id: 'synthetic-account' }); };
    for (const auth of [undefined, '', 'Basic abc', 'Bearer']) {
      const result = await invoke(adapter, { authorization: auth || '' });
      assert.equal(result.status, 401);
    }
    assert.equal(calls.length, 0);
    assert.equal((await invoke(adapter, { method: 'GET' })).status, 405);
    assert.equal((await invoke(adapter, { method: 'OPTIONS' })).status, 204);
    for (const body of [null, [], {}, { ...payload(), total: -1 }, { ...payload(), cart: [] },
      { ...payload(), cart: [{ id: 'p', qty: -1, priceUsd: 10 }] }, { ...payload(), payments: [null] },
      { ...payload(), fiadoUsd: 11 }]) {
      const result = await invoke(adapter, { body });
      assert.equal(result.status, 422);
    }
    assert.equal(calls.length, 0);
    const forged = await invoke(adapter, { body: { ...payload(), rol: 'DUENO', sedeId: 'sur', operatorId: 1, account_id: 'other-tenant' } });
    assert.equal(forged.status, 403);
    assert.equal(forged.body.code, 'OPERATOR_AUTH_REQUIRED');
    assert.equal(forged.body.retryable, false);
    assert.deepEqual(calls, [['https://qa.invalid/auth/v1/user', 'GET']]);
    globalThis.fetch = async () => Response.json({ error: 'bad token' }, { status: 401 });
    assert.equal((await invoke(adapter)).status, 401);
    globalThis.fetch = async () => { throw new TypeError('synthetic network failure'); };
    assert.equal((await invoke(adapter)).status, 503);
  });
}

test('gate: configuracion ausente o insegura falla cerrado y nunca fabrica una venta', async () => {
  for (const invalid of [{}, { SUPABASE_URL: 'https://qa.invalid' }, { ...env, SUPABASE_URL: 'http://remote.invalid' }, { ...env, SUPABASE_URL: 'https://user:pass@qa.invalid' }]) {
    assert.equal(readSupabaseServerConfig(invalid), null);
    const result = await guardLegacyCheckout({ authorization: 'Bearer synthetic', payload: payload(), env: invalid, fetchImpl: () => { throw new Error('unexpected request'); } });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'CHECKOUT_NOT_CONFIGURED');
  }
});

for (const status of [401, 403, 409, 422, 500, 503]) {
  test(`checkout real HTTP ${status}: cero cola, cero stock, sin confirmacion offline`, async t => {
    const f = createProcessorFixture(t);
    f.mocks['src/config/operationSafety.js'] = 'export const REMOTE_OPERATIONS_PAUSED = false;';
    globalThis.fetch = async (_url, options) => {
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
      return Response.json({ error: 'Synthetic rejection' }, { status });
    };
    const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
    assert.equal((await processSaleTransaction(saleOptions())).success, false);
    assert.equal(f.writes.length, 0);
    assert.equal(f.queued.length, 0);
  });
}

test('checkout real: JSON invalido, rechazo de negocio o falta de ID no confirman una venta', async t => {
  const f = createProcessorFixture(t);
  f.mocks['src/config/operationSafety.js'] = 'export const REMOTE_OPERATIONS_PAUSED = false;';
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
  for (const response of [new Response('<html>unavailable</html>'), Response.json({ success: false }), Response.json({ success: true }), Response.json({ error: 'stock_conflict' })]) {
    globalThis.fetch = async () => response;
    assert.equal((await processSaleTransaction(saleOptions())).success, false);
  }
  assert.equal(f.writes.length, 0);
  assert.equal(f.queued.length, 0);
});

test('checkout real: activar solo la bandera remota falla cerrado incluso sin sesión o con red perdida', async t => {
  const f = createProcessorFixture(t);
  f.mocks['src/config/operationSafety.js'] = 'export const REMOTE_OPERATIONS_PAUSED = false;';
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
  let calls = 0;
  f.cloud.auth.getSession = async () => { calls++; return { data: { session: null } }; };
  globalThis.fetch = async () => { calls++; throw new TypeError('synthetic transport loss'); };
  const result = await processSaleTransaction(saleOptions());
  assert.equal(result.success, false);
  assert.equal(result.code, 'REMOTE_RELEASE_REQUIRES_REVIEW');
  assert.equal(calls, 0);
  assert.equal(f.queued.length, 0);
  assert.equal(f.writes.length, 0);
});

test('checkout real: una respuesta remota sintética no habilita el contrato legado', async t => {
  const f = createProcessorFixture(t);
  f.mocks['src/config/operationSafety.js'] = 'export const REMOTE_OPERATIONS_PAUSED = false;';
  let calls = 0;
  globalThis.fetch = async () => { calls++; return Response.json({ success: true, sale_id: 'synthetic-confirmed-sale' }); };
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
  const result = await processSaleTransaction(saleOptions());
  assert.equal(result.success, false);
  assert.equal(result.code, 'REMOTE_RELEASE_REQUIRES_REVIEW');
  assert.equal(result.sale, undefined);
  assert.equal(calls, 0);
  assert.equal(f.queued.length, 0);
  assert.equal(f.writes.length, 0);
});
