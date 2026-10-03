import test from 'node:test';
import assert from 'node:assert/strict';

import {
    isCatchUpComplete,
    markCatchUpComplete,
    clearCatchUpComplete,
    runCatchUpPush,
    CATCHUP_DONE_PREFIX,
} from '../src/hooks/cloudSync/catchUpPush.js';

function installLocalStorage() {
    const values = new Map();
    globalThis.localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, String(value)),
        removeItem: key => values.delete(key),
    };
    return values;
}

function installBrowserStubs({ online = true, visible = true } = {}) {
    const nav = { onLine: online };
    try {
        Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true, writable: true });
    } catch { globalThis.navigator = nav; }
    const listeners = {};
    globalThis.document = {
        visibilityState: visible ? 'visible' : 'hidden',
        addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
        removeEventListener: (type, fn) => {
            const arr = listeners[type] || [];
            const i = arr.indexOf(fn);
            if (i >= 0) arr.splice(i, 1);
        },
    };
    globalThis.window = {
        addEventListener: (type, fn) => { (listeners[type] ||= []).push(fn); },
        removeEventListener: (type, fn) => {
            const arr = listeners[type] || [];
            const i = arr.indexOf(fn);
            if (i >= 0) arr.splice(i, 1);
        },
    };
    return {
        fire: (type) => { for (const fn of [...(listeners[type] || [])]) fn(); },
        setVisible: (v) => { globalThis.document.visibilityState = v ? 'visible' : 'hidden'; },
        setOnline: (v) => { globalThis.navigator.onLine = v; },
    };
}

test('catch-up marca completado solo cuando todas las llaves se procesan', async () => {
    installLocalStorage();
    installBrowserStubs();
    const pushed = [];
    const pushFn = async (key, val) => { pushed.push(key); return { status: 'ok' }; };
    const result = await runCatchUpPush({
        userId: 'u1',
        keys: ['a', 'b'],
        readLocal: async (key) => ({ a: [1], b: [2] })[key] ?? null,
        cloudDocIds: new Set(),
        isCurrent: () => true,
        pushFn,
        pushUsersDoc: async () => {},
        spacingMs: 0,
    });
    assert.equal(result.completed, true);
    assert.deepEqual(pushed, ['a', 'b']);
    assert.equal(isCatchUpComplete('u1'), true);
});

test('catch-up NO se marca completado si la pestaña está oculta y expira la espera', async () => {
    installLocalStorage();
    const stubs = installBrowserStubs({ visible: false });
    const pushed = [];
    const pushFn = async (key, val) => { pushed.push(key); return { status: 'ok' }; };
    const result = await runCatchUpPush({
        userId: 'u2',
        keys: ['a'],
        readLocal: async () => [1],
        cloudDocIds: new Set(),
        isCurrent: () => true,
        pushFn,
        pushUsersDoc: async () => {},
        spacingMs: 0,
        waitMs: 50, // espera corta para el test
    });
    assert.equal(result.completed, false);
    assert.equal(result.reason, 'hidden-timeout');
    assert.equal(pushed.length, 0);
    assert.equal(isCatchUpComplete('u2'), false);
    stubs.setVisible(true);
});

test('catch-up espera a que la pestaña sea visible y luego completa', async () => {
    installLocalStorage();
    const stubs = installBrowserStubs({ visible: false });
    const pushed = [];
    const pushFn = async (key, val) => { pushed.push(key); return { status: 'ok' }; };
    const promise = runCatchUpPush({
        userId: 'u3',
        keys: ['a'],
        readLocal: async () => [1],
        cloudDocIds: new Set(),
        isCurrent: () => true,
        pushFn,
        pushUsersDoc: async () => {},
        spacingMs: 0,
        waitMs: 5000,
    });
    // Hacer visible a los 100ms
    setTimeout(() => { stubs.setVisible(true); stubs.fire('visibilitychange'); }, 100);
    const result = await promise;
    assert.equal(result.completed, true);
    assert.deepEqual(pushed, ['a']);
    assert.equal(isCatchUpComplete('u3'), true);
});

test('catch-up continúa con la siguiente llave si una falla (no aborta todo)', async () => {
    installLocalStorage();
    installBrowserStubs();
    const pushed = [];
    const pushFn = async (key, val) => {
        pushed.push(key);
        if (key === 'a') return { status: 'deferred', code: 'SYNC_SEND_FAILED' };
        return { status: 'ok' };
    };
    const result = await runCatchUpPush({
        userId: 'u4',
        keys: ['a', 'b', 'c'],
        readLocal: async () => [1],
        cloudDocIds: new Set(),
        isCurrent: () => true,
        pushFn,
        pushUsersDoc: async () => {},
        spacingMs: 0,
    });
    // Una llave falló → no se marca completado (reintentará), pero b y c sí se intentaron
    assert.equal(result.completed, false);
    assert.deepEqual(pushed, ['a', 'b', 'c']);
    assert.equal(isCatchUpComplete('u4'), false);
});

test('catch-up no sube arrays vacíos si la nube ya tiene la llave', async () => {
    installLocalStorage();
    installBrowserStubs();
    const pushed = [];
    const pushFn = async (key, val) => { pushed.push(key); return { status: 'ok' }; };
    const result = await runCatchUpPush({
        userId: 'u5',
        keys: ['a'],
        readLocal: async () => [],
        cloudDocIds: new Set(['a']),
        isCurrent: () => true,
        pushFn,
        pushUsersDoc: async () => {},
        spacingMs: 0,
    });
    assert.equal(result.completed, true);
    assert.equal(pushed.length, 0);
    assert.equal(result.skipped, 1);
});

test('catch-up aborta si isCurrent() es falso y NO marca completado', async () => {
    installLocalStorage();
    installBrowserStubs();
    let current = true;
    const pushed = [];
    const pushFn = async (key, val) => {
        pushed.push(key);
        if (key === 'a') current = false; // invalidar tras la primera
        return { status: 'ok' };
    };
    const result = await runCatchUpPush({
        userId: 'u6',
        keys: ['a', 'b'],
        readLocal: async () => [1],
        cloudDocIds: new Set(),
        isCurrent: () => current,
        pushFn,
        pushUsersDoc: async () => {},
        spacingMs: 0,
    });
    assert.equal(result.completed, false);
    assert.equal(result.reason, 'superseded');
    assert.deepEqual(pushed, ['a']);
    assert.equal(isCatchUpComplete('u6'), false);
});

test('clearCatchUpComplete permite re-ejecutar tras cambio de cuenta', () => {
    installLocalStorage();
    markCatchUpComplete('u7');
    assert.equal(isCatchUpComplete('u7'), true);
    clearCatchUpComplete('u7');
    assert.equal(isCatchUpComplete('u7'), false);
});

test('la bandera es por cuenta (no se mezclan)', () => {
    const values = installLocalStorage();
    markCatchUpComplete('u8');
    assert.equal(isCatchUpComplete('u8'), true);
    assert.equal(isCatchUpComplete('u9'), false);
    assert.ok(values.get(CATCHUP_DONE_PREFIX + 'u8') === '1');
});
