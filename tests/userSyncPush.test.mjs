// Pruebas de la orquestación del documento de usuarios (accountDocs):
// - pushUsersDoc endurece PINs en texto plano ANTES de subir (hash PBKDF2,
//   sin tocar credentialVersion) y nunca sube un PIN legible.
// - applyUsersFromCloud reconcilia y propaga la convergencia.
// - sanitizeAuthEnvelopeForCloud limpia el espejo de backup.
//
// Se inyectan fakes de store y push: accountDocs no importa el store ni el
// motor de sync (grafo acíclico), así que no necesita harness pesado.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    pushUsersDoc, applyUsersFromCloud, sanitizeAuthEnvelopeForCloud,
} from '../src/hooks/cloudSync/accountDocs.js';
import { sanitizeUsersForCloud } from '../src/hooks/cloudSync/accountSync.js';

const HASHED = { pin: 'aabbcc', pinSalt: 's1', pinKdf: 'pbkdf2', pinHashed: true };

function makeStore(usuarios) {
    const state = { usuarios: usuarios.map(u => ({ ...u })) };
    return {
        state,
        getState: () => state,
        setState: partial => Object.assign(state, partial),
    };
}
function makePush(log) {
    return async (key, value, bypass) => {
        log.push({ key, value, bypass });
        return { status: 'ok' };
    };
}

// ─── pushUsersDoc ────────────────────────────────────────────────────────────

test('pushUsersDoc sube usuarios saneados con la llave y bypass correctos', async () => {
    const store = makeStore([{ id: 1, nombre: 'Dueño', rol: 'DUENO', syncId: 's1', ...HASHED, credentialVersion: 2 }]);
    const log = [];
    await pushUsersDoc({ getState: store.getState, setState: store.setState, push: makePush(log) });
    assert.equal(log.length, 1);
    assert.equal(log[0].key, 'bodega_users_v1');
    assert.equal(log[0].bypass, true);
    assert.deepEqual(log[0].value, sanitizeUsersForCloud(store.state.usuarios));
    const [u] = log[0].value;
    assert.ok(!('id' in u), 'sin id numérico local');
});

test('pushUsersDoc hashea PINs en texto plano en el store ANTES de subir', async () => {
    const store = makeStore([{
        id: 2, nombre: 'Cajero', rol: 'CAJERO', sedeId: 'central',
        pin: '1234', pinHashed: false, sinPin: false, credentialVersion: 1, syncId: 's2',
    }]);
    const log = [];
    await pushUsersDoc({ getState: store.getState, setState: store.setState, push: makePush(log) });
    const [local] = store.state.usuarios;
    assert.equal(local.pinHashed, true, 'store local endurecido');
    assert.equal(local.pinKdf, 'pbkdf2');
    assert.notEqual(local.pin, '1234', 'el hash reemplaza al texto plano');
    assert.equal(local.credentialVersion, 1, 'credentialVersion intacto (no cierra sesión)');
    const [up] = log[0].value;
    assert.equal(up.pinHashed, true);
    assert.ok(up.pin && up.pin !== '1234', 'la nube recibe hash, jamás texto plano');
});

test('pushUsersDoc asigna syncId a quien no tenga antes de subir', async () => {
    const store = makeStore([{ id: 3, nombre: 'Nuevo', rol: 'CAJERO', sedeId: 'norte', ...HASHED }]);
    const log = [];
    await pushUsersDoc({ getState: store.getState, setState: store.setState, push: makePush(log) });
    assert.ok(store.state.usuarios[0].syncId, 'syncId asignado en el store');
    assert.equal(log[0].value[0].syncId, store.state.usuarios[0].syncId);
});

test('pushUsersDoc es best-effort: no lanza si el push falla', async () => {
    const store = makeStore([]);
    const res = await pushUsersDoc({
        getState: store.getState, setState: store.setState,
        push: async () => { throw new Error('red caída'); },
    });
    assert.equal(res, undefined);
});

// ─── applyUsersFromCloud ─────────────────────────────────────────────────────

test('applyUsersFromCloud reconcilia, actualiza el store y propaga', async () => {
    const store = makeStore([
        { id: 1, nombre: 'Dueño', rol: 'DUENO', syncId: 's1', ...HASHED, credentialVersion: 1, updatedAt: '2026-10-01T08:00:00Z', permanente: true },
    ]);
    const log = [];
    const deps = { getState: store.getState, setState: store.setState, push: makePush(log) };
    const cloud = [
        { syncId: 's1', nombre: 'César', rol: 'DUENO', sedeId: null, sinPin: false, ...HASHED, credentialVersion: 5, updatedAt: '2026-10-01T12:00:00Z' },
        { syncId: 's9', nombre: 'Cajero Norte', rol: 'CAJERO', sedeId: 'norte', sinPin: true, pinHashed: false, credentialVersion: 0, updatedAt: '2026-10-01T11:00:00Z' },
    ];
    const changed = await applyUsersFromCloud(cloud, deps);
    assert.equal(changed, true);
    assert.equal(store.state.usuarios.length, 2);
    const owner = store.state.usuarios.find(u => u.syncId === 's1');
    assert.equal(owner.nombre, 'César', 'LWW: la nube más nueva gana');
    assert.equal(owner.id, 1, 'id local preservado');
    assert.equal(owner.permanente, true, 'permanente preservado');
    const cashier = store.state.usuarios.find(u => u.syncId === 's9');
    assert.ok(cashier.id > 1, 'usuario nuevo de la nube recibe id local');
    assert.equal(log.length, 1, 'propaga la convergencia con un push');
    assert.equal(log[0].key, 'bodega_users_v1');
});

test('applyUsersFromCloud no toca nada si ya está convergido', async () => {
    const users = [{ id: 1, nombre: 'Dueño', rol: 'DUENO', syncId: 's1', ...HASHED, credentialVersion: 1 }];
    const store = makeStore(users);
    const log = [];
    const changed = await applyUsersFromCloud(
        sanitizeUsersForCloud(users),
        { getState: store.getState, setState: store.setState, push: makePush(log) });
    assert.equal(changed, false);
    assert.equal(log.length, 0, 'sin push redundante');
});

test('applyUsersFromCloud ignora payload inválido', async () => {
    const store = makeStore([]);
    const log = [];
    assert.equal(await applyUsersFromCloud(null, { getState: store.getState, setState: store.setState, push: makePush(log) }), false);
    assert.equal(await applyUsersFromCloud({ x: 1 }, { getState: store.getState, setState: store.setState, push: makePush(log) }), false);
    assert.equal(log.length, 0);
});

test('applyUsersFromCloud adopta syncId del gemelo en primera convergencia', async () => {
    // Local sin syncId + nube con el mismo humano → un solo usuario.
    const store = makeStore([
        { id: 2, nombre: 'Cajero C&Y 2025', rol: 'CAJERO', sedeId: 'central', pin: null, sinPin: true, pinHashed: false, credentialVersion: 0 },
    ]);
    const log = [];
    const changed = await applyUsersFromCloud(
        [{ syncId: 'cloud-1', nombre: 'Cajero C&Y 2025', rol: 'CAJERO', sedeId: 'central', pin: null, sinPin: true, pinHashed: false, credentialVersion: 0 }],
        { getState: store.getState, setState: store.setState, push: makePush(log) });
    assert.equal(changed, true);
    assert.equal(store.state.usuarios.length, 1, 'no duplica');
    assert.equal(store.state.usuarios[0].syncId, 'cloud-1', 'adopta el syncId de la nube');
    assert.equal(store.state.usuarios[0].id, 2, 'id local estable');
});

// ─── sanitizeAuthEnvelopeForCloud ────────────────────────────────────────────

test('sanitizeAuthEnvelopeForCloud elimina PINs en texto plano del backup', () => {
    const raw = JSON.stringify({ state: { usuarios: [
        { id: 1, nombre: 'Dueño', pin: '000000', pinHashed: false },
        { id: 2, nombre: 'Cajero', ...HASHED },
    ], requireLogin: true }, version: 4 });
    const clean = JSON.parse(sanitizeAuthEnvelopeForCloud(raw));
    assert.ok(!('pin' in clean.state.usuarios[0]), 'PIN en texto plano fuera del backup');
    assert.equal(clean.state.usuarios[1].pin, 'aabbcc', 'hash conservado');
    assert.equal(clean.state.requireLogin, true, 'resto intacto');
});

test('sanitizeAuthEnvelopeForCloud es passthrough si no es parseable', () => {
    assert.equal(sanitizeAuthEnvelopeForCloud('no-json'), 'no-json');
    assert.equal(sanitizeAuthEnvelopeForCloud(''), '');
});
