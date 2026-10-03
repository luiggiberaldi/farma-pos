// Regresión: quitarPin debe sobrevivir reinicios y pushes concurrentes.
// Dos bugs reales encontrados en la Fase 2a:
//  1. El persist `merge` del store corría `normalizeUsers` en CADA arranque,
//     y la migración v4 (cajeros sin PIN heredados → 0000) revertía el
//     quitarPin intencional en cada reinicio. Fix: `normalizeUsersOnBoot`
//     (aprovisiona sin migraciones de una sola vez).
//  2. `pushUsersDoc` leía el estado, esperaba el hash PBKDF2 y hacía
//     setState con el snapshot viejo: dos pushes solapados revertían cambios
//     concurrentes (quitarPin/cambiarPin/merge). Fix: aplicar los hashes
//     sobre el estado fresco, solo donde el PIN siga siendo el mismo texto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadRealModule } from './helpers/realModule.mjs';
import { pushUsersDoc } from '../src/hooks/cloudSync/accountDocs.js';
import {
    normalizeUsers, normalizeUsersOnBoot, migrateOwnerPinToFactory,
} from '../src/config/userProvisioning.js';

const HASHED = { pin: 'aabbcc', pinSalt: 's1', pinKdf: 'pbkdf2', pinHashed: true };

// ─── 1. normalizeUsersOnBoot ───────────────────────────────────────────────
test('normalizeUsersOnBoot: un quitarPin intencional sobrevive', () => {
    const users = [
        { id: 1, nombre: 'Dueño', rol: 'DUENO', sedeId: null, ...HASHED, permanente: true },
        { id: 7, syncId: 's-7', nombre: 'Cajero Sin Pin', rol: 'CAJERO', sedeId: 'central',
          pin: null, pinHashed: false, sinPin: true, credentialVersion: 3 },
    ];
    const out = normalizeUsersOnBoot(users);
    const c = out.find(u => u.id === 7);
    assert.equal(c.sinPin, true, 'sinPin intencional intacto');
    assert.equal(c.pin, null, 'sin PIN de fábrica reinyectado');
    assert.equal(c.credentialVersion, 3, 'sin bumps espurios');
});

test('normalizeUsersOnBoot: sigue aprovisionando dueño y cajeros por sede', () => {
    const out = normalizeUsersOnBoot([]);
    assert.ok(out.some(u => Number(u.id) === 1 && u.rol === 'DUENO'), 'dueño asegurado');
    for (const sede of ['central', 'norte', 'sur']) {
        const c = out.find(u => u.rol === 'CAJERO' && u.sedeId === sede);
        assert.ok(c, `cajero de fábrica para ${sede}`);
        assert.equal(c.pin, '0000', 'PIN de fábrica en texto plano (lo endurece pushUsersDoc)');
    }
});

test('normalizeUsers (una sola vez): migrar pinless heredado a 0000 sigue vigente', () => {
    // La migración v4 existe para estados viejos; el paso versionado `migrate`
    // (fromVersion < 3) la aplica una vez. Este test documenta la intención.
    const legacy = [
        { id: 1, nombre: 'Dueño', rol: 'DUENO', sedeId: null, pin: '000000', pinHashed: false, permanente: true },
        { id: 2, nombre: 'Cajero Viejo', rol: 'CAJERO', sedeId: 'central', pin: null, sinPin: true },
    ];
    const out = migrateOwnerPinToFactory(legacy);
    const c = out.find(u => u.id === 2);
    assert.equal(c.pin, '0000', 'pinless heredado → PIN de fábrica');
    assert.equal(c.sinPin, false);
    // Y normalizeUsers completo la incluye (estado inicial / migrate versionado).
    const full = normalizeUsers(legacy);
    assert.equal(full.find(u => u.id === 2).pin, '0000');
});

// ─── 2. pushUsersDoc concurrente no revierte cambios ────────────────────────
function makeStore(usuarios) {
    const state = { usuarios: usuarios.map(u => ({ ...u })) };
    return {
        state,
        getState: () => state,
        setState: partial => Object.assign(state, partial),
    };
}

test('pushUsersDoc solapado: no revierte un quitarPin concurrente', async () => {
    const target = {
        id: 2, syncId: 's-target', nombre: 'Cajero', rol: 'CAJERO', sedeId: 'central',
        pin: '1234', pinHashed: false, sinPin: false, credentialVersion: 0,
    };
    // Varios usuarios en texto plano alargan la ventana del hash (PBKDF2 real).
    const others = [3, 4, 5].map(i => ({
        id: i, syncId: `s-${i}`, nombre: `Otro ${i}`, rol: 'CAJERO', sedeId: 'central',
        pin: '0000', pinHashed: false, sinPin: false, credentialVersion: 0,
    }));
    const store = makeStore([target, ...others]);
    const pushed = [];
    const push = async (key, value, bypass) => { pushed.push({ key, value, bypass }); return { status: 'ok' }; };
    const deps = { getState: store.getState, setState: store.setState, push };

    const p1 = pushUsersDoc(deps); // empieza a hashear (ventana ~4×PBKDF2)
    await new Promise(r => setTimeout(r, 20)); // p1 ya leyó el estado y espera hashes
    // Mutación concurrente: quitarPin (como lo haría el store real).
    store.setState({ usuarios: store.getState().usuarios.map(u =>
        u.syncId === 's-target'
            ? { ...u, pin: null, pinHashed: false, pinSalt: null, sinPin: true, credentialVersion: 1 }
            : u) });
    await p1;

    const after = store.getState().usuarios.find(u => u.syncId === 's-target');
    assert.equal(after.sinPin, true, 'el quitarPin concurrente sobrevive');
    assert.equal(after.pin, null, 'no se restaura el PIN viejo');
    assert.equal(after.credentialVersion, 1, 'sin bumps espurios');
    for (const o of others) {
        const ou = store.getState().usuarios.find(u => u.syncId === o.syncId);
        assert.equal(ou.pinHashed, true, `${o.nombre} igual se endureció`);
        assert.notEqual(ou.pin, '0000');
    }
    // Lo subido tampoco trae el PIN revertido.
    const up = pushed.at(-1).value.find(u => u.syncId === 's-target');
    assert.equal(up.sinPin, true);
    assert.ok(!('pin' in up) || up.pin == null, 'la nube no recibe el PIN viejo');
});

// ─── 3. Store real: quitarPin sobrevive un reinicio ─────────────────────────
test('store real: quitarPin sobrevive rehydrate (nuevo bundle, mismo localStorage)', async t => {
    // localStorage propio que sobrevive entre bundles (simula el navegador).
    const data = new Map();
    const persistentLS = {
        getItem: k => data.get(k) ?? null,
        setItem: (k, v) => { data.set(k, String(v)); },
        removeItem: k => { data.delete(k); },
        clear: () => { data.clear(); },
    };
    const prevLS = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const prevSS = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
    const prevWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const prevNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: persistentLS });
    Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: persistentLS });
    Object.defineProperty(globalThis, 'window', { configurable: true,
        value: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, location: { hostname: 'x' } } });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
    t.after(() => {
        for (const [k, d] of [['localStorage', prevLS], ['sessionStorage', prevSS], ['window', prevWindow], ['navigator', prevNav]]) {
            if (d) Object.defineProperty(globalThis, k, d); else delete globalThis[k];
        }
    });

    const mocks = {
        'src/utils/storageService.js': 'export const storageService = { getItem: async () => null, setItem: async () => {} };',
        'src/services/auditService.js': 'export const logEvent = () => {};',
        'src/services/PrinterSerial.js': 'export const PrinterSerial = { isConnected: () => false };',
        'src/services/notificationService.js': 'export const createNotification = () => {}; export const NOTIF_TYPES = {};',
    };
    const boot = async () => {
        const mod = await loadRealModule('src/hooks/store/useAuthStore.js', mocks);
        await mod.useAuthStore.persist.rehydrate();
        return mod.useAuthStore;
    };

    const { generatePinSalt, hashPinPbkdf2 } = await import('../src/utils/pinCrypto.js');
    const salt = await generatePinSalt();
    persistentLS.setItem('abasto-auth-storage', JSON.stringify({ state: {
        usuarios: [{ id: 1, syncId: randomUUID(), nombre: 'Dueño', rol: 'DUENO', sedeId: null,
            pin: await hashPinPbkdf2('000000', salt), pinSalt: salt, pinKdf: 'pbkdf2',
            pinHashed: true, sinPin: false, credentialVersion: 0 }],
        requireLogin: false, adminEmail: '',
    }, version: 4 }));

    const s1 = await boot();
    assert.equal(await s1.getState().login('000000', 1), true);
    await s1.getState().agregarUsuario('Cajero R', 'CAJERO', '', 'central');
    // Esperar a que el pushUsersDoc de agregarUsuario termine (no solapar).
    await new Promise(r => setTimeout(r, 1500));
    const c1 = s1.getState().usuarios.find(u => u.nombre === 'Cajero R');
    assert.equal(c1.sinPin, true, 'de fábrica el cajero no lleva PIN');
    // El dueño lo activa con PIN y luego se lo quita: el quitarPin debe sobrevivir.
    await s1.getState().cambiarPin(c1.id, '1234');
    await new Promise(r => setTimeout(r, 1500));
    await s1.getState().quitarPin(c1.id);
    await new Promise(r => setTimeout(r, 1500));

    const s2 = await boot(); // "reinicio"
    const c2 = s2.getState().usuarios.find(u => u.nombre === 'Cajero R');
    assert.ok(c2, 'el cajero existe tras el reinicio');
    assert.equal(c2.sinPin, true, 'sinPin sobrevive el reinicio');
    assert.ok(!c2.pin, 'sin PIN de fábrica reinyectado');
});
