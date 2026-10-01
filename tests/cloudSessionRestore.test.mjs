// Pruebas deterministas de la restauración resiliente de la sesión cloud.
// Contrato (bug 2026-10-01: la sesión se cerraba sola en los equipos):
//  - El cierre de sesión es por equipo: CLOUD_SIGNOUT_SCOPE debe ser 'local'
//    (el default 'global' de auth-js revocaba los refresh tokens de TODOS los
//    equipos de la cuenta).
//  - El respaldo del refresh token se guarda en SIGNED_IN/TOKEN_REFRESHED y se
//    restaura al arrancar.
//  - Un fallo transitorio de refresh NO borra la sesión respaldada (reintenta).
//  - Solo un fallo de autenticación confirmado (invalid_grant, etc.) invalida
//    el respaldo. El logout explícito lo borra (clearSessionBackup).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    SESSION_BACKUP_KEY,
    CLOUD_SIGNOUT_SCOPE,
    saveSessionBackup,
    readSessionBackup,
    clearSessionBackup,
    isConfirmedAuthFailure,
    restoreSessionWithRetry,
} from '../src/services/cloudSessionRestore.js';

function fakeStorage() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
    };
}

const SESSION = {
    access_token: 'access-123',
    refresh_token: 'refresh-abc',
    user: { id: 'user-1' },
};

test('CLOUD_SIGNOUT_SCOPE es local: el cierre nunca revoca otros equipos', () => {
    // Regresión 2026-10-01: signOut() sin scope usaba 'global' y mataba la
    // sesión de todos los equipos que comparten la cuenta del dueño.
    assert.equal(CLOUD_SIGNOUT_SCOPE, 'local');
});

test('respaldo: guarda y lee el refresh token con el user id', () => {
    const storage = fakeStorage();
    assert.equal(saveSessionBackup(storage, SESSION), true);
    const backup = readSessionBackup(storage);
    assert.equal(backup.refresh_token, 'refresh-abc');
    assert.equal(backup.user_id, 'user-1');
    assert.ok(typeof backup.saved_at === 'number');
});

test('respaldo: no guarda sesiones sin refresh_token ni sin user', () => {
    const storage = fakeStorage();
    assert.equal(saveSessionBackup(storage, { user: { id: 'u' } }), false);
    assert.equal(saveSessionBackup(storage, { refresh_token: 'r' }), false);
    assert.equal(saveSessionBackup(storage, null), false);
    assert.equal(readSessionBackup(storage), null);
});

test('respaldo: JSON corrupto se lee como null (no rompe el arranque)', () => {
    const storage = fakeStorage();
    storage.setItem(SESSION_BACKUP_KEY, '{corrupto');
    assert.equal(readSessionBackup(storage), null);
});

test('respaldo: clearSessionBackup lo elimina (logout explícito)', () => {
    const storage = fakeStorage();
    saveSessionBackup(storage, SESSION);
    clearSessionBackup(storage);
    assert.equal(readSessionBackup(storage), null);
    assert.equal(storage.getItem(SESSION_BACKUP_KEY), null);
});

test('isConfirmedAuthFailure: invalid_grant y familia confirman muerte', () => {
    assert.equal(isConfirmedAuthFailure({ code: 'invalid_grant', message: 'Invalid Refresh Token' }), true);
    assert.equal(isConfirmedAuthFailure({ message: 'refresh_token_not_found' }), true);
    assert.equal(isConfirmedAuthFailure({ error_code: 'session_not_found' }), true);
    assert.equal(isConfirmedAuthFailure('token_revoked'), true);
});

test('isConfirmedAuthFailure: red caída y 5xx NO confirman (transitorios)', () => {
    assert.equal(isConfirmedAuthFailure(new TypeError('fetch failed')), false);
    assert.equal(isConfirmedAuthFailure({ message: 'Network request failed' }), false);
    assert.equal(isConfirmedAuthFailure({ status: 503, message: 'Service unavailable' }), false);
    assert.equal(isConfirmedAuthFailure({ status: 429, message: 'Too many requests' }), false);
    assert.equal(isConfirmedAuthFailure(null), false);
    assert.equal(isConfirmedAuthFailure(undefined), false);
});

test('restore: éxito al primer intento devuelve la sesión', async () => {
    const fresh = { ...SESSION, access_token: 'nuevo' };
    let calls = 0;
    const auth = { refreshSession: async () => { calls++; return { data: { session: fresh }, error: null }; } };
    const result = await restoreSessionWithRetry(auth, { refresh_token: 'refresh-abc' });
    assert.equal(result.status, 'restored');
    assert.equal(result.session.access_token, 'nuevo');
    assert.equal(calls, 1);
});

test('restore: fallo transitorio reintenta y NO invalida (luego tiene éxito)', async () => {
    const sleeps = [];
    let calls = 0;
    const auth = {
        refreshSession: async () => {
            calls++;
            if (calls === 1) throw new TypeError('fetch failed');
            return { data: { session: SESSION }, error: null };
        },
    };
    const result = await restoreSessionWithRetry(auth, { refresh_token: 'r' }, {
        sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
    });
    assert.equal(result.status, 'restored');
    assert.equal(calls, 2);
    assert.deepEqual(sleeps, [600]);
});

test('restore: fallo confirmado (invalid_grant) no reintenta → invalid', async () => {
    let calls = 0;
    const auth = {
        refreshSession: async () => {
            calls++;
            return { data: { session: null }, error: { code: 'invalid_grant', message: 'Invalid Refresh Token' } };
        },
    };
    const result = await restoreSessionWithRetry(auth, { refresh_token: 'muerto' });
    assert.equal(result.status, 'invalid');
    assert.equal(calls, 1);
});

test('restore: transitorio persistente agota intentos → unreachable (respaldo intacto)', async () => {
    const sleeps = [];
    let calls = 0;
    const auth = {
        refreshSession: async () => { calls++; throw new TypeError('fetch failed'); },
    };
    const storage = fakeStorage();
    saveSessionBackup(storage, SESSION);
    const result = await restoreSessionWithRetry(auth, readSessionBackup(storage), {
        maxAttempts: 3,
        sleep: (ms) => { sleeps.push(ms); return Promise.resolve(); },
    });
    assert.equal(result.status, 'unreachable');
    assert.equal(calls, 3);
    assert.deepEqual(sleeps, [600, 1800]);
    // La función jamás borra el respaldo: el llamador decide (aquí sigue intacto).
    assert.equal(readSessionBackup(storage).refresh_token, 'refresh-abc');
});

test('restore: respuesta sin sesión y sin error cuenta como transitoria', async () => {
    let calls = 0;
    const auth = { refreshSession: async () => { calls++; return { data: {}, error: null }; } };
    const result = await restoreSessionWithRetry(auth, { refresh_token: 'r' }, {
        maxAttempts: 2,
        sleep: () => Promise.resolve(),
    });
    assert.equal(result.status, 'unreachable');
    assert.equal(calls, 2);
});
