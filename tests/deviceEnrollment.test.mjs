import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRemoteOperatorSession, REMOTE_DEVICE_KEY } from '../src/services/operatorRemoteSession.js';
import { deviceLabel } from '../src/utils/deviceLabel.js';

const UUID = () => randomUUID();
const PROOF = () => randomBytes(32).toString('base64url');
const CREDENTIAL = () => `${UUID()}.${PROOF()}`;
const TOKEN = 'synthetic-cloud-access-token';

function storage() {
    const values = new Map();
    return { values, getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); }, removeItem: key => { values.delete(key); } };
}

function fixture({ credential = null, token = TOKEN, handler } = {}) {
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

test('deviceLabel genera etiqueta legible y acotada', () => {
    const fixed = new Date('2026-10-01T12:00:00');
    // Sin navigator (node): valores por defecto.
    assert.match(deviceLabel(fixed), /^Navegador · Equipo · \w+ 2026$/);
    assert.ok(deviceLabel(fixed).length <= 120);
    const hadNavigator = 'navigator' in globalThis;
    const realNavigator = hadNavigator ? globalThis.navigator : undefined;
    const setNavigator = value => Object.defineProperty(globalThis, 'navigator', { value, configurable: true, writable: true });
    try {
        setNavigator({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36' });
        assert.match(deviceLabel(fixed), /^Chrome · Windows · \w+ 2026$/);
        setNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36' });
        assert.match(deviceLabel(fixed), /^Chrome · Android · \w+ 2026$/);
    } finally {
        if (hadNavigator) setNavigator(realNavigator); else delete globalThis.navigator;
    }
});

test('enrollDevice matricula, guarda el secreto y no envia secreto previo', async () => {
    const credential = CREDENTIAL();
    const { session, store, calls } = fixture({ handler: () => ({ status: 200, body: { deviceCredential: credential } }) });
    const result = await session.enrollDevice('Chrome · Windows · oct 2026');
    assert.deepEqual(result, { ok: true });
    assert.equal(session.isDeviceLinked(), true);
    assert.equal(store.getItem(REMOTE_DEVICE_KEY), credential);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].body, { action: 'enroll-device', label: 'Chrome · Windows · oct 2026' });
    assert.ok(!('x-pharmacy-device' in calls[0].init.headers));
    assert.equal(calls[0].init.headers.Authorization, `Bearer ${TOKEN}`);
});

test('enrollDevice no re-matricula si ya hay secreto ni sale a red', async () => {
    const { session, calls } = fixture({ credential: CREDENTIAL() });
    assert.deepEqual(await session.enrollDevice('Otro'), { ok: true, already: true });
    assert.equal(calls.length, 0);
});

test('enrollDevice traduce el tope a device_limit y rechaza etiquetas malas', async () => {
    const limited = fixture({ handler: () => ({ status: 409, body: { error: 'device_limit' } }) });
    const result = await limited.session.enrollDevice('Etiqueta');
    assert.equal(result.ok, false);
    assert.equal(result.code, 'device_limit');
    assert.equal(limited.session.isDeviceLinked(), false);

    const denied = fixture({ handler: () => ({ status: 409, body: { error: 'other' } }) });
    assert.equal((await denied.session.enrollDevice('Etiqueta')).code, 'denied');

    const malformed = fixture({ handler: () => ({ status: 200, body: { deviceCredential: 'no-valido' } }) });
    assert.equal((await malformed.session.enrollDevice('Etiqueta')).code, 'invalid');
    assert.equal(malformed.session.isDeviceLinked(), false);

    const bad = fixture();
    for (const label of ['', '   ', 'x'.repeat(121), 42, null]) {
        assert.equal((await bad.session.enrollDevice(label)).code, 'invalid');
    }
    assert.equal(bad.calls.length, 0);

    const anonymous = fixture({ token: null });
    assert.equal((await anonymous.session.enrollDevice('Etiqueta')).code, 'no-account');
    assert.equal(anonymous.calls.length, 0);
});

test('listDevices filtra y valida sin filtrar secretos', async () => {
    const devices = [
        { id: UUID(), label: 'Laptop', enabled: true, created_at: '2026-10-01T00:00:00Z' },
        { id: UUID(), label: 'Teléfono', enabled: false, created_at: '2026-10-01T00:00:00Z' },
        { id: 'mal', label: 'Malo', enabled: true, created_at: 'x' },
    ];
    const { session, calls } = fixture({ credential: CREDENTIAL(),
        handler: () => ({ status: 200, body: devices }) });
    const result = await session.listDevices();
    assert.equal(result.ok, true);
    assert.equal(result.devices.length, 2);
    assert.ok(result.devices.every(d => !('proof_hash' in d)));
    assert.equal(calls[0].body.action, 'list-devices');

    const bad = fixture({ credential: CREDENTIAL(), handler: () => ({ status: 200, body: { nope: 1 } }) });
    assert.equal((await bad.session.listDevices()).code, 'invalid');

    const unlinked = fixture();
    assert.equal((await unlinked.session.listDevices()).code, 'unconfigured');
    assert.equal(unlinked.calls.length, 0);
});

test('revokeDevice desvincula localmente si es el equipo actual', async () => {
    const credential = CREDENTIAL();
    const deviceId = credential.split('.')[0];
    const { session, calls } = fixture({ credential, handler: () => ({ status: 200, body: { device_id: deviceId, enabled: false } }) });
    assert.deepEqual(await session.revokeDevice(deviceId), { ok: true });
    assert.equal(session.isDeviceLinked(), false);
    assert.deepEqual(calls[0].body, { action: 'revoke-device', deviceId });

    const other = fixture({ credential, handler: () => ({ status: 200, body: { device_id: UUID(), enabled: false } }) });
    assert.deepEqual(await other.session.revokeDevice(UUID()), { ok: true });
    assert.equal(other.session.isDeviceLinked(), true);

    const bad = fixture({ credential });
    assert.equal((await bad.session.revokeDevice('nope')).code, 'invalid');
    assert.equal(bad.calls.length, 0);
});
