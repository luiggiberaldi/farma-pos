import test from 'node:test';
import assert from 'node:assert/strict';
import { autoEnrollDevice } from '../src/services/autoEnrollDevice.js';
import { registerToast } from '../src/components/toastState.js';

function fakeSession({ linked = false, enrollResult = { ok: true }, enrollThrows = false } = {}) {
    const calls = [];
    return {
        calls,
        isDeviceLinked: () => linked,
        enrollDevice: async label => {
            calls.push(label);
            if (enrollThrows) throw new Error('red caída');
            return enrollResult;
        },
    };
}

test('autoEnrollDevice matricula y avisa solo en login con equipo sin vincular', async () => {
    const toasts = [];
    const unregister = registerToast((message, type) => toasts.push({ message, type }));
    try {
        const session = fakeSession();
        const result = await autoEnrollDevice(session);
        assert.deepEqual(result, { ok: true });
        assert.equal(session.calls.length, 1);
        assert.match(session.calls[0], /.+ · .+ · \w+ \d{4}$/);
        assert.deepEqual(toasts, [{ message: 'Equipo vinculado', type: 'success' }]);
    } finally { unregister(); }
});

test('autoEnrollDevice no hace nada si el equipo ya esta vinculado', async () => {
    const toasts = [];
    const unregister = registerToast((message, type) => toasts.push({ message, type }));
    try {
        const session = fakeSession({ linked: true });
        assert.deepEqual(await autoEnrollDevice(session), { ok: true, already: true });
        assert.equal(session.calls.length, 0);
        assert.deepEqual(toasts, []);
    } finally { unregister(); }
});

test('autoEnrollDevice avisa del tope y nunca bloquea el login', async () => {
    const toasts = [];
    const unregister = registerToast((message, type) => toasts.push({ message, type }));
    try {
        const limited = fakeSession({ enrollResult: { ok: false, code: 'device_limit', message: 'x' } });
        const result = await autoEnrollDevice(limited);
        assert.equal(result.code, 'device_limit');
        assert.equal(toasts.length, 1);
        assert.equal(toasts[0].type, 'warning');
        assert.match(toasts[0].message, /Límite de 6 equipos/);

        const broken = fakeSession({ enrollThrows: true });
        assert.deepEqual(await autoEnrollDevice(broken), { ok: false, code: 'unavailable' });
    } finally { unregister(); }
});
