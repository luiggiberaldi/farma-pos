// Pruebas de la política de tasa a nivel de cuenta (Fase C):
// publish → push inmediato con bypass; apply → LWW por updatedAt;
// poll two-way con fast-lane. Fakes de store, push/pull, localStorage y DOM.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    publishRatePolicy, applyRatePolicyFromCloud, pollRatePolicyOnce,
    readRatePolicyLocal, startAccountDocsFastLane,
} from '../src/hooks/cloudSync/accountDocs.js';
import { RATE_DOC_KEY } from '../src/hooks/cloudSync/accountSync.js';

// ─── Fakes de entorno ────────────────────────────────────────────────────────
const lsData = new Map();
const dispatched = [];
globalThis.localStorage = {
    getItem: k => (lsData.has(k) ? lsData.get(k) : null),
    setItem: (k, v) => lsData.set(k, String(v)),
    removeItem: k => lsData.delete(k),
    clear: () => lsData.clear(),
};
globalThis.window = { dispatchEvent: e => { dispatched.push(e); return true; } };
globalThis.document = { hidden: false, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

function resetEnv() {
    lsData.clear();
    dispatched.length = 0;
    globalThis.document.hidden = false;
    globalThis.navigator.onLine = true;
}
function ownerState() {
    return { usuarioActivo: { id: 1, nombre: 'César', rol: 'DUENO' }, usuarios: [] };
}
function deps(over = {}) {
    return {
        getState: () => ownerState(),
        push: async () => ({ status: 'ok' }),
        pull: async () => null,
        audit: async (...a) => { (deps.auditLog ||= []).push(a); },
        ...over,
    };
}

// ─── publishRatePolicy ───────────────────────────────────────────────────────

test('publishRatePolicy deniega si no es dueño', async () => {
    resetEnv();
    const pushes = [];
    const r = await publishRatePolicy({ mode: 'euro' }, deps({
        getState: () => ({ usuarioActivo: { id: 2, nombre: 'Cajero', rol: 'CAJERO' } }),
        push: async (...a) => { pushes.push(a); return { status: 'ok' }; },
    }));
    assert.equal(r.status, 'denied');
    assert.equal(pushes.length, 0);
    assert.equal(localStorage.getItem('bodega_rate_mode'), null);
});

test('publishRatePolicy publica: local + auditoría + push bypass', async () => {
    resetEnv();
    localStorage.setItem('bodega_rate_mode', 'bcv');
    const pushes = [];
    const audits = [];
    const r = await publishRatePolicy({ mode: 'euro' }, deps({
        push: async (...a) => { pushes.push(a); return { status: 'ok' }; },
        audit: async (...a) => { audits.push(a); },
    }));
    assert.equal(r.status, 'ok');
    assert.equal(localStorage.getItem('bodega_rate_mode'), 'euro');
    assert.equal(localStorage.getItem('bodega_use_auto_rate'), 'true');
    assert.ok(localStorage.getItem('_rate_policy_ts'), 'ts guardado');
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0][0], RATE_DOC_KEY);
    assert.equal(pushes[0][2], true, 'bypass inmediato');
    assert.equal(pushes[0][1].mode, 'euro');
    assert.ok(pushes[0][1].updatedAt, 'payload con updatedAt');
    assert.equal(audits.length, 1);
    assert.equal(audits[0][0], 'TASA');
    assert.equal(audits[0][1], 'TASA_ACTUALIZADA');
    assert.match(audits[0][2], /Dólar BCV.*Euro BCV/, 'describe "de X a Y"');
    assert.match(audits[0][2], /César/, 'autor en la descripción');
});

test('publishRatePolicy modo manual guarda la tasa y limpia en bcv', async () => {
    resetEnv();
    await publishRatePolicy({ mode: 'manual', manualRate: '95.5' }, deps());
    assert.equal(localStorage.getItem('bodega_rate_mode'), 'manual');
    assert.equal(localStorage.getItem('bodega_custom_rate'), '95.5');
    assert.equal(localStorage.getItem('bodega_use_auto_rate'), 'false');
    await publishRatePolicy({ mode: 'bcv' }, deps());
    assert.equal(localStorage.getItem('bodega_rate_mode'), 'bcv');
    assert.equal(localStorage.getItem('bodega_custom_rate'), null, 'manual limpio al volver a bcv');
});

test('publishRatePolicy no pushea si no hubo cambio', async () => {
    resetEnv();
    const pushes = [];
    const mk = () => deps({ push: async (...a) => { pushes.push(a); return { status: 'ok' }; } });
    assert.equal((await publishRatePolicy({ mode: 'euro' }, mk())).status, 'ok');
    const r = await publishRatePolicy({ mode: 'euro' }, mk());
    assert.equal(r.status, 'unchanged');
    assert.equal(pushes.length, 1, 'solo el primer cambio pusheó');
});

test('publishRatePolicy marca pendiente si el push falla (offline)', async () => {
    resetEnv();
    const r = await publishRatePolicy({ mode: 'euro' }, deps({
        push: async () => { throw new Error('offline'); },
    }));
    assert.equal(r.status, 'ok', 'lo local igual se aplica');
    assert.equal(localStorage.getItem('_rate_policy_pending'), '1');
    assert.equal(localStorage.getItem('bodega_rate_mode'), 'euro');
});

test('publishRatePolicy rechaza modo inválido', async () => {
    resetEnv();
    const r = await publishRatePolicy({ mode: 'bitcoin' }, deps());
    assert.equal(r.status, 'invalid');
});

// ─── applyRatePolicyFromCloud ────────────────────────────────────────────────

test('applyRatePolicyFromCloud aplica si la nube es más nueva', async () => {
    resetEnv();
    localStorage.setItem('bodega_rate_mode', 'bcv');
    localStorage.setItem('_rate_policy_ts', '2026-10-01T10:00:00.000Z');
    const ok = await applyRatePolicyFromCloud(
        { mode: 'manual', manualRate: '97', updatedAt: '2026-10-01T12:00:00.000Z', updatedByName: 'César' },
        '2026-10-01T12:00:00.000Z');
    assert.equal(ok, true);
    assert.equal(localStorage.getItem('bodega_rate_mode'), 'manual');
    assert.equal(localStorage.getItem('bodega_custom_rate'), '97');
    assert.equal(localStorage.getItem('_rate_policy_ts'), '2026-10-01T12:00:00.000Z');
});

test('applyRatePolicyFromCloud ignora si la nube es más vieja o igual', async () => {
    resetEnv();
    localStorage.setItem('bodega_rate_mode', 'euro');
    localStorage.setItem('_rate_policy_ts', '2026-10-01T12:00:00.000Z');
    assert.equal(await applyRatePolicyFromCloud(
        { mode: 'bcv', updatedAt: '2026-10-01T10:00:00.000Z' }, '2026-10-01T10:00:00.000Z'), false);
    assert.equal(await applyRatePolicyFromCloud(
        { mode: 'bcv', updatedAt: '2026-10-01T12:00:00.000Z' }, '2026-10-01T12:00:00.000Z'), false);
    assert.equal(localStorage.getItem('bodega_rate_mode'), 'euro', 'sin cambios');
});

test('applyRatePolicyFromCloud ignora payload inválido', async () => {
    resetEnv();
    assert.equal(await applyRatePolicyFromCloud(null, ''), false);
    assert.equal(await applyRatePolicyFromCloud({ mode: 'nope' }, ''), false);
});

test('applyRatePolicyFromCloud avisa con eventos sintéticos (nunca use_auto_rate)', async () => {
    resetEnv();
    await applyRatePolicyFromCloud({ mode: 'euro', updatedAt: '2026-10-01T12:00:00.000Z' }, '2026-10-01T12:00:00.000Z');
    const keys = dispatched.map(e => e.key);
    assert.ok(keys.includes('bodega_rate_mode'), 'avisa rate_mode');
    assert.ok(!keys.includes('bodega_use_auto_rate'), 'JAMÁS avisa use_auto_rate (mapearía euro→bcv)');
});

// ─── pollRatePolicyOnce ──────────────────────────────────────────────────────

test('pollRatePolicyOnce respeta guards: oculta, offline y sin sesión', async () => {
    resetEnv();
    let pulls = 0;
    const d = () => deps({ pull: async () => { pulls++; return null; } });
    globalThis.document.hidden = true;
    assert.equal((await pollRatePolicyOnce(d())).status, 'skipped');
    globalThis.document.hidden = false;
    globalThis.navigator.onLine = false;
    assert.equal((await pollRatePolicyOnce(d())).status, 'skipped');
    globalThis.navigator.onLine = true;
    assert.equal((await pollRatePolicyOnce(deps({ getState: () => ({ usuarioActivo: null }), pull: async () => { pulls++; return null; } }))).status, 'skipped');
    assert.equal(pulls, 0, 'ningún pull con guards activos');
});

test('pollRatePolicyOnce aplica lo más nuevo de la nube', async () => {
    resetEnv();
    localStorage.setItem('bodega_rate_mode', 'bcv');
    localStorage.setItem('_rate_policy_ts', '2026-10-01T10:00:00.000Z');
    const r = await pollRatePolicyOnce(deps({
        pull: async () => ({ payload: { mode: 'euro', updatedAt: '2026-10-01T12:00:00.000Z' }, updatedAt: '2026-10-01T12:00:00.000Z' }),
    }));
    assert.equal(r.status, 'applied');
    assert.equal(localStorage.getItem('bodega_rate_mode'), 'euro');
});

test('pollRatePolicyOnce reintenta el pendiente cuando vuelve la red', async () => {
    resetEnv();
    await publishRatePolicy({ mode: 'euro' }, deps({ push: async () => { throw new Error('offline'); } }));
    assert.equal(localStorage.getItem('_rate_policy_pending'), '1');
    const pushes = [];
    const r = await pollRatePolicyOnce(deps({
        pull: async () => null,
        push: async (...a) => { pushes.push(a); return { status: 'ok' }; },
    }));
    assert.equal(r.status, 'republished');
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0][1].mode, 'euro');
    assert.equal(localStorage.getItem('_rate_policy_pending'), null, 'pendiente limpio');
});

test('pollRatePolicyOnce in-sync no toca nada', async () => {
    resetEnv();
    localStorage.setItem('bodega_rate_mode', 'bcv');
    localStorage.setItem('_rate_policy_ts', '2026-10-01T12:00:00.000Z');
    let pulls = 0;
    const r = await pollRatePolicyOnce(deps({
        pull: async () => { pulls++; return { payload: { mode: 'bcv', updatedAt: '2026-10-01T10:00:00.000Z' }, updatedAt: '2026-10-01T10:00:00.000Z' }; },
    }));
    assert.equal(r.status, 'in-sync');
    assert.equal(pulls, 1);
});

// ─── startRatePolicyFastLane ─────────────────────────────────────────────────

test('startAccountDocsFastLane hace tick inmediato y se detiene', async () => {
    resetEnv();
    let pulls = 0;
    const stop = startAccountDocsFastLane(deps({ pull: async () => { pulls++; return null; } }));
    await new Promise(r => setTimeout(r, 50));
    assert.ok(pulls >= 1, 'tick inmediato al arrancar');
    stop();
    const after = pulls;
    await new Promise(r => setTimeout(r, 50));
    assert.equal(pulls, after, 'detenido: no más ticks');
});

// ─── readRatePolicyLocal ─────────────────────────────────────────────────────

test('readRatePolicyLocal lee el estado efectivo', async () => {
    resetEnv();
    assert.equal(readRatePolicyLocal().mode, 'bcv', 'default');
    localStorage.setItem('bodega_rate_mode', 'manual');
    localStorage.setItem('bodega_custom_rate', '99');
    const p = readRatePolicyLocal();
    assert.equal(p.mode, 'manual');
    assert.equal(p.manualRate, '99');
});
