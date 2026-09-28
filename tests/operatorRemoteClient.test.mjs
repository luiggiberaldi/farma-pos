import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRemoteOperatorSession, isValidDeviceCredential, REMOTE_AUTHORITY_KEY, REMOTE_DEVICE_KEY } from '../src/services/operatorRemoteSession.js';
import { sanitizeBackup } from '../src/utils/backupSafety.js';

const UUID = () => randomUUID();
const TENANT = UUID();
const OPERATOR = UUID();
const BRANCH = UUID();
const DEVICE = UUID();
const PROOF = randomBytes(32).toString('base64url');
const CREDENTIAL = `${DEVICE}.${PROOF}`;
const TOKEN = 'synthetic-cloud-access-token';
const PIN = '49382716';
const authority = (overrides = {}) => ({ operator_id: OPERATOR, tenant_id: TENANT, branch_id: BRANCH,
    role: 'CAJERO', name: 'Cajera sintética', expires_at: new Date(Date.now() + 900000).toISOString(), ...overrides });
const directory = () => ({ operators: [
        { id: OPERATOR, local_code: 'fixture-cashier', name: 'Cajera sintética', role: 'CAJERO', branch_id: BRANCH }],
    branches: [{ id: BRANCH, code: 'central', name: 'Central' }] });

function storage() {
    const values = new Map();
    return { values, getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); }, removeItem: key => { values.delete(key); } };
}

function fixture({ credential = CREDENTIAL, token = TOKEN, handler } = {}) {
    const store = storage();
    if (credential) store.setItem(REMOTE_DEVICE_KEY, credential);
    const calls = [];
    const fetchImpl = async (url, init) => {
        calls.push({ url, init, body: JSON.parse(init.body) });
        const reply = handler ? await handler(calls.length, calls.at(-1)) : { status: 200, body: {} };
        return { ok: reply.status >= 200 && reply.status < 300, status: reply.status,
            json: async () => { if (reply.malformed) throw new SyntaxError('invalid'); return reply.body; } };
    };
    const session = createRemoteOperatorSession({ fetchImpl, getAccessToken: async () => token, storage: store });
    return { session, store, calls };
}

test('device credential format is validated before any request', () => {
    for (const value of [CREDENTIAL, `${UUID()}.${randomBytes(32).toString('base64url')}`]) assert.equal(isValidDeviceCredential(value), true);
    for (const value of [undefined, null, '', DEVICE, `${DEVICE}.short`, `not-a-uuid.${PROOF}`,
        `${DEVICE}.${PROOF}.extra`, `${DEVICE}.${'x'.repeat(44)}`, 42, 'x'.repeat(201)]) {
        assert.equal(isValidDeviceCredential(value), false);
    }
});

test('unlinked equipment and missing cloud account never reach the network', async () => {
    const unlinked = fixture({ credential: null });
    assert.equal(unlinked.session.isDeviceLinked(), false);
    assert.equal((await unlinked.session.directory()).code, 'unconfigured');
    assert.equal(unlinked.calls.length, 0);

    const anonymous = fixture({ token: null });
    assert.equal((await anonymous.session.directory()).code, 'no-account');
    assert.equal(anonymous.calls.length, 0);
});

test('directory sends only the bearer and device headers and strips upstream fields', async () => {
    const f = fixture({ handler: () => ({ status: 200, body: { ...directory(), pin_hash: 'a'.repeat(64), extra: 'leak' } }) });
    const result = await f.session.directory();
    assert.equal(result.ok, true);
    assert.deepEqual(result.directory, directory());
    const [{ init, body }] = f.calls;
    assert.equal(init.method, 'POST'); assert.equal(init.credentials, 'include');
    assert.equal(init.cache, 'no-store'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers['Content-Type'], 'application/json');
    assert.equal(init.headers.Authorization, `Bearer ${TOKEN}`);
    assert.equal(init.headers['x-pharmacy-device'], CREDENTIAL);
    assert.deepEqual(body, { action: 'directory' });
    // The device proof belongs only in its own header, never in the body or elsewhere.
    assert.equal(init.headers['x-pharmacy-device'], CREDENTIAL);
    assert.ok(!JSON.stringify(body).includes(PROOF));
    assert.deepEqual(Object.keys(init.headers).sort(), ['Authorization', 'Content-Type', 'x-pharmacy-device']);
});

test('malformed or unknown-role directory is rejected instead of trusted', async () => {
    for (const body of [null, {}, { operators: [], branches: null },
        { operators: [{ ...directory().operators[0], role: 'ROOT' }], branches: [] },
        { operators: [{ ...directory().operators[0], id: 'not-uuid' }], branches: [] }]) {
        const f = fixture({ handler: () => ({ status: 200, body }) });
        assert.equal((await f.session.directory()).code, 'invalid');
    }
});

test('login stores only the authority and never the PIN or the token', async () => {
    const issued = authority();
    const f = fixture({ handler: () => ({ status: 200, body: { operator: issued } }) });
    const result = await f.session.login({ operatorId: OPERATOR, branchId: BRANCH, pin: PIN });
    assert.equal(result.ok, true);
    assert.deepEqual(result.authority, issued);
    assert.deepEqual(f.session.getAuthority(), issued);
    assert.deepEqual(f.calls[0].body, { action: 'login', operatorId: OPERATOR, branchId: BRANCH, pin: PIN });
    const storedAuthority = f.store.getItem(REMOTE_AUTHORITY_KEY);
    const raw = JSON.stringify([...f.store.values.entries()]);
    assert.ok(!raw.includes(PIN)); assert.ok(!raw.includes(TOKEN));
    // The device credential is legitimately stored; the authority must not embed it.
    assert.ok(!storedAuthority.includes(PROOF));
    assert.equal(storedAuthority, JSON.stringify(issued));
    assert.equal(f.store.values.has(REMOTE_DEVICE_KEY), true);
});

test('weak local-style input is rejected before any request', async () => {
    const f = fixture();
    for (const input of [{ operatorId: OPERATOR, branchId: BRANCH, pin: '1234' },
        { operatorId: OPERATOR, branchId: BRANCH, pin: '123456' },
        { operatorId: 'not-uuid', branchId: BRANCH, pin: PIN },
        { operatorId: OPERATOR, branchId: null, pin: PIN }]) {
        assert.equal((await f.session.login(input)).code, 'invalid');
    }
    assert.equal(f.calls.length, 0);
});

test('denial, unavailability and malformed replies never mint a local authority', async () => {
    for (const [reply, code] of [[{ status: 401, body: {} }, 'denied'], [{ status: 400, body: {} }, 'denied'],
        [{ status: 403, body: {} }, 'denied'], [{ status: 503, body: {} }, 'unavailable'],
        [{ status: 404, body: {} }, 'unavailable'], [{ status: 200, body: {}, malformed: true }, 'unavailable']]) {
        const f = fixture({ handler: () => reply });
        assert.equal((await f.session.login({ operatorId: OPERATOR, branchId: BRANCH, pin: PIN })).code, code);
        assert.equal(f.session.getAuthority(), null);
        assert.equal(f.store.values.has(REMOTE_AUTHORITY_KEY), false);
    }
    const transport = fixture({ handler: () => { throw new Error('synthetic network failure'); } });
    assert.equal((await transport.session.directory()).code, 'unavailable');
    assert.equal(transport.session.getAuthority(), null);
});

test('a malformed authority payload is rejected even on a 200 response', async () => {
    for (const operator of [null, { ...authority(), role: 'ROOT' }, { ...authority(), tenant_id: 'x' },
        { ...authority(), expires_at: 'not-a-date' }, { ...authority(), name: '' }]) {
        const f = fixture({ handler: () => ({ status: 200, body: { operator } }) });
        assert.equal((await f.session.login({ operatorId: OPERATOR, branchId: BRANCH, pin: PIN })).code, 'invalid');
        assert.equal(f.session.getAuthority(), null);
    }
});

test('an expired authority is never returned, even if it is still stored', async () => {
    const stale = authority({ expires_at: new Date(Date.now() - 1000).toISOString() });
    const expired = fixture({ handler: () => ({ status: 200, body: { operator: stale } }) });
    assert.equal((await expired.session.login({ operatorId: OPERATOR, branchId: BRANCH, pin: PIN })).ok, true);
    assert.equal(expired.session.getAuthority(), null);
    const live = fixture({ handler: () => ({ status: 200, body: { operator: authority() } }) });
    await live.session.login({ operatorId: OPERATOR, branchId: BRANCH, pin: PIN });
    assert.ok(live.session.getAuthority());
});

test('replacing the device credential invalidates an authority from another terminal', async () => {
    const f = fixture({ handler: () => ({ status: 200, body: { operator: authority() } }) });
    await f.session.login({ operatorId: OPERATOR, branchId: BRANCH, pin: PIN });
    assert.ok(f.session.getAuthority());
    assert.equal(f.session.setDeviceCredential(`${UUID()}.${randomBytes(32).toString('base64url')}`), true);
    assert.equal(f.session.getAuthority(), null);
    assert.equal(f.session.setDeviceCredential('garbage'), false);
    assert.equal(f.session.setDeviceCredential(null), true);
    assert.equal(f.session.isDeviceLinked(), false);
});

test('logout clears the local authority even when the server is unreachable', async () => {
    const f = fixture({ handler: (call) => (call === 1 ? { status: 200, body: { operator: authority() } } : { status: 503, body: {} }) });
    await f.session.login({ operatorId: OPERATOR, branchId: BRANCH, pin: PIN });
    assert.ok(f.session.getAuthority());
    const result = await f.session.logout();
    assert.equal(result.ok, true);
    assert.equal(f.session.getAuthority(), null);
    assert.equal(f.store.values.has(REMOTE_AUTHORITY_KEY), false);
    assert.deepEqual(f.calls.at(-1).body, { action: 'logout' });
});

test('remote verification does not lift the business pause and is not exported in backups', async () => {
    const f = fixture();
    assert.equal(f.session.paused(), true);
    const sanitized = sanitizeBackup({ [REMOTE_AUTHORITY_KEY]: JSON.stringify(authority()),
        [REMOTE_DEVICE_KEY]: CREDENTIAL, 'bodega_products_v1': [{ id: 'p' }] });
    assert.equal(Object.hasOwn(sanitized, REMOTE_AUTHORITY_KEY), false);
    assert.equal(Object.hasOwn(sanitized, REMOTE_DEVICE_KEY), false);
    assert.deepEqual(sanitized.bodega_products_v1, [{ id: 'p' }]);
});
