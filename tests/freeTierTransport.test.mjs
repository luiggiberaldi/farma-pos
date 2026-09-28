import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { createSupabaseFreeFetch } from '../src/services/supabaseFreeTransport.js';
import { assertSupabaseBrowserKey } from '../src/config/supabasePublicKey.js';
import { inspectSyncPayload, fingerprintSyncPayload, SUPABASE_FREE_PROFILE } from '../src/config/supabaseFreeTier.js';
import { installMemoryBrowser } from './helpers/realModule.mjs';

const origin = 'https://free-qa.supabase.invalid';
const limit = SUPABASE_FREE_PROFILE.payloadMaxBytes;
const token = role => ['eyJhbGciOiJIUzI1NiJ9', Buffer.from(JSON.stringify({ role })).toString('base64url'), 'synthetic'].join('.');

for (const key of ['', undefined, 'sb_publishable_synthetic_only', token('anon')]) {
  test(`browser config accepts ${key ? key.startsWith('sb_') ? 'publishable' : 'anon' : 'empty'} public configuration`, () => {
    assert.doesNotThrow(() => assertSupabaseBrowserKey(key));
  });
}
for (const key of ['sb_secret_synthetic_only', token('service_role'), token('authenticated'), token('postgres'), 'personal-access-token', 'wrong.jwt.format']) {
  test(`browser config rejects privileged/invalid key ${String(key).slice(0, 12)}`, () => {
    assert.throws(() => assertSupabaseBrowserKey(key), error => {
      assert.ok(!error.message.includes(key));
      return true;
    });
  });
}

test('Free profile measures UTF-8 and rejects oversize instead of truncating', () => {
  assert.equal(inspectSyncPayload('ñ').bytes, 2);
  assert.equal(inspectSyncPayload('a'.repeat(limit)).allowed, true);
  assert.equal(inspectSyncPayload('ñ'.repeat(limit / 2 + 1)).allowed, false);
  assert.equal(inspectSyncPayload('a'.repeat(SUPABASE_FREE_PROFILE.payloadWarningBytes)).warning, true);
  assert.throws(() => inspectSyncPayload(undefined), /serializable/);
  assert.equal(SUPABASE_FREE_PROFILE.realtimeEnabled, false);
  assert.equal(SUPABASE_FREE_PROFILE.heavyDebounceMs, 1800000);
});

test('complete fingerprint detects same-length edits outside old sampled slices', async () => {
  const a = 'a'.repeat(1200);
  const b = a.slice(0, 300) + 'b' + a.slice(301);
  assert.notEqual(await fingerprintSyncPayload(a), await fingerprintSyncPayload(b));
  assert.equal(await fingerprintSyncPayload(a), await fingerprintSyncPayload(a));
});

for (const path of ['/rest/v1/sync_documents', '/storage/v1/object/test', '/functions/v1/test', '/other']) {
  test(`paused SDK transport blocks ${path} before network`, async t => {
    installMemoryBrowser(t);
    let requests = 0;
    const events = [];
    const send = createSupabaseFreeFetch({ fetchImpl: async () => { requests++; throw new Error('must not send'); }, record: (...args) => events.push(args) });
    const response = await send(origin + path, { method: 'POST', body: JSON.stringify({ confidential: 'qa-only' }) });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'REMOTE_OPERATIONS_PAUSED');
    assert.equal(requests, 0);
    assert.equal(events.length, 1);
    assert.equal(events[0][1], 'blocked');
    assert.ok(!JSON.stringify(events).includes('qa-only'));
  });
}

test('Auth works during operational pause, returns unconsumed response, stores only counters', async t => {
  installMemoryBrowser(t);
  const response = new Response(JSON.stringify({ user: { id: 'qa' } }), { headers: { 'Content-Length': '20', 'X-QA': 'yes' } });
  const init = { method: 'POST', body: JSON.stringify({ email: 'qa@example.invalid', password: 'test-secret' }) };
  let passed;
  const events = [];
  const send = createSupabaseFreeFetch({ fetchImpl: async (...args) => { passed = args; return response; }, record: (...args) => events.push(args) });
  assert.equal(await send(origin + '/auth/v1/token?grant_type=password', init), response);
  assert.equal(response.bodyUsed, false);
  assert.equal(passed[1], init);
  assert.equal(response.headers.get('X-QA'), 'yes');
  assert.ok(events.some(event => event[1] === 'downloadBytes' && event[2] === 20));
  assert.ok(!JSON.stringify(events).includes('test-secret'));
});

test('Auth is not broken by metric storage failure', async () => {
  let called = 0;
  const send = createSupabaseFreeFetch({ fetchImpl: async () => { called++; return new Response('{}'); }, record() { throw new Error('quota'); } });
  assert.equal((await send(origin + '/auth/v1/user')).status, 200);
  assert.equal(called, 1);
});

for (const status of [401, 403, 409, 422, 429, 500]) {
  test(`transport preserves HTTP ${status} and never retries`, async () => {
    let requests = 0;
    const response = new Response('{"error":"qa"}', { status });
    const send = createSupabaseFreeFetch({ isPaused: () => false, fetchImpl: async () => { requests++; return response; }, record() {} });
    assert.equal(await send(origin + '/rest/v1/test'), response);
    assert.equal(requests, 1);
    assert.deepEqual(await response.json(), { error: 'qa' });
  });
}

for (const [name, body] of [
  ['string', 'ñ'.repeat(limit / 2 + 1)],
  ['blob', new Blob([new Uint8Array(limit + 1)])],
  ['buffer', new Uint8Array(limit + 1)],
  ['urlencoded', new URLSearchParams({ data: 'a'.repeat(limit) })],
]) {
  test(`unpaused synthetic transport enforces 1 MiB for ${name}`, async () => {
    let called = 0;
    const send = createSupabaseFreeFetch({ isPaused: () => false, fetchImpl: async () => { called++; return new Response('{}'); }, record() {} });
    const response = await send(origin + '/rest/v1/test', { method: 'POST', body });
    assert.equal(response.status, 413);
    assert.equal(called, 0);
  });
}

test('multipart upload includes encoded form overhead in the local cap', async () => {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(limit)]), 'qa.bin');
  let called = 0;
  const send = createSupabaseFreeFetch({ isPaused: () => false, fetchImpl: async () => { called++; return new Response('{}'); }, record() {} });
  assert.equal((await send(origin + '/storage/v1/object/test', { method: 'POST', body: form })).status, 413);
  assert.equal(called, 0);
});

test('request inspection does not consume the request body before fetch', async () => {
  const request = new Request(origin + '/rest/v1/test', { method: 'POST', body: '{"test":"ñ"}' });
  const send = createSupabaseFreeFetch({ isPaused: () => false, fetchImpl: async input => {
    assert.equal(input, request);
    assert.equal(await input.text(), '{"test":"ñ"}');
    return new Response('{}');
  }, record() {} });
  assert.equal((await send(request)).status, 200);
});

test('streaming init bodies cannot bypass the non-Auth size guard', async () => {
  let called = 0;
  const body = new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); } });
  const send = createSupabaseFreeFetch({ isPaused: () => false, fetchImpl: async () => { called++; return new Response('{}'); }, record() {} });
  assert.equal((await send(origin + '/rest/v1/test', { method: 'POST', body })).status, 415);
  assert.equal(called, 0);
});

test('unknown response length is reported, not guessed from merged data', async () => {
  const events = [];
  const send = createSupabaseFreeFetch({ fetchImpl: async () => new Response('{}'), record: (...args) => events.push(args) });
  await send(origin + '/auth/v1/user');
  assert.ok(events.some(event => event[1] === 'unknownResponseSize'));
  assert.equal(events.some(event => event[1] === 'downloadBytes'), false);
});

test('real Supabase SDK preserves Auth and propagates paused REST errors without a remote call', async () => {
  const requests = [];
  const fetch = createSupabaseFreeFetch({ fetchImpl: async (url, options) => {
    requests.push({ url: String(url), method: options?.method });
    return new Response(JSON.stringify({ id: 'sdk-user-qa', email: 'qa@example.invalid' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }, record() {} });
  const client = createClient(origin, 'sb_publishable_synthetic_only', {
    global: { fetch }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const rest = await client.from('sync_documents').select('doc_id');
  assert.equal(rest.status, 503);
  assert.equal(rest.error.code, 'REMOTE_OPERATIONS_PAUSED');
  assert.equal(rest.data, null);
  assert.equal(requests.length, 0);
  const user = await client.auth.getUser('synthetic-auth-token');
  assert.equal(user.error, null);
  assert.equal(user.data.user.id, 'sdk-user-qa');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].url.endsWith('/auth/v1/user'));
  await client.removeAllChannels();
});

test('network error is propagated with one attempt', async () => {
  const failure = new TypeError('synthetic disconnected');
  let called = 0;
  const send = createSupabaseFreeFetch({ fetchImpl: async () => { called++; throw failure; }, record() {} });
  await assert.rejects(() => send(origin + '/auth/v1/user'), error => error === failure);
  assert.equal(called, 1);
});
