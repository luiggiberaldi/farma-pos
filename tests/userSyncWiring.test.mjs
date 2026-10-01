// Cableado real de Fase B: una mutación del store de auth dispara
// pushCloudSync('bodega_users_v1', …) con bypass. Usa el store real con
// useCloudSync mockeado (import estático → el mock resuelve).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRealModule } from './helpers/realModule.mjs';

// Stub mínimo de localStorage (el persist del store lo necesita).
if (!globalThis.localStorage) {
  const data = new Map();
  globalThis.localStorage = {
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear(),
  };
}

const pushes = [];
const stubs = {
    'src/hooks/useCloudSync.js': `
        export const pushCloudSync = (...args) => {
            globalThis.__userSyncPushes.push(args);
            return Promise.resolve({ status: 'ok' });
        };
        export const sanitizeForPush = (k, v) => v;
    `,
};

test('agregarUsuario dispara push de bodega_users_v1 con bypass', async (t) => {
    globalThis.__userSyncPushes = pushes;
    pushes.length = 0;
    const { useAuthStore } = await loadRealModule('src/hooks/store/useAuthStore.js', stubs, t);
    const auth = useAuthStore;
    auth.setState({
        usuarios: [
            { id: 1, nombre: 'Dueño', rol: 'DUENO', pin: null, sinPin: true, pinHashed: false, credentialVersion: 1 },
        ],
        usuarioActivo: { id: 1, nombre: 'Dueño', rol: 'DUENO' },
    });
    const before = pushes.length;
    await auth.getState().agregarUsuario('Cajero Sync', 'CAJERO', null, 'central');
    // pushUsersSoon es async (void …): dar un tick.
    await new Promise(r => setTimeout(r, 50));
    assert.ok(pushes.length > before, 'se llamó a pushCloudSync');
    const last = pushes[pushes.length - 1];
    assert.equal(last[0], 'bodega_users_v1');
    assert.equal(last[2], true, 'bypass inmediato');
    assert.ok(Array.isArray(last[1]), 'payload es arreglo');
    const added = last[1].find(u => u.nombre === 'Cajero Sync');
    assert.ok(added, 'el usuario nuevo viaja en el payload');
    assert.ok(added.syncId, 'con syncId');
    assert.ok(!('id' in added), 'sin id numérico local');
});

test('eliminarUsuario también propaga el push', async (t) => {
    globalThis.__userSyncPushes = pushes;
    pushes.length = 0;
    const { useAuthStore } = await loadRealModule('src/hooks/store/useAuthStore.js', stubs, t);
    const auth = useAuthStore;
    auth.setState({
        usuarios: [
            { id: 1, nombre: 'Dueño', rol: 'DUENO', pin: null, sinPin: true, pinHashed: false, credentialVersion: 1 },
            { id: 2, nombre: 'Cajero Sync', rol: 'CAJERO', sedeId: 'central', pin: null, sinPin: true, pinHashed: false, credentialVersion: 0 },
        ],
        usuarioActivo: { id: 1, nombre: 'Dueño', rol: 'DUENO' },
    });
    const target = auth.getState().usuarios.find(u => u.rol === 'CAJERO' && !u.permanente);
    assert.ok(target, 'hay un cajero eliminable');
    auth.getState().eliminarUsuario(target.id);
    await new Promise(r => setTimeout(r, 50));
    assert.ok(pushes.length > 0, 'se llamó a pushCloudSync');
    assert.equal(pushes[pushes.length - 1][0], 'bodega_users_v1');
});
