// Pruebas de los datos del negocio a nivel de cuenta (Fase D):
// merge por campo con fieldTs + regla "vacío nunca borra";
// publish/apply/poll con fakes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeBusinessDocs, sanitizeBusinessDoc, BUSINESS_DOC_KEY } from '../src/hooks/cloudSync/accountSync.js';
import {
    publishBusinessDoc, applyBusinessFromCloud, pollBusinessOnce, readBusinessLocal,
} from '../src/hooks/cloudSync/accountDocs.js';

// ─── Fakes de entorno ────────────────────────────────────────────────────────
const lsData = new Map();
globalThis.localStorage = {
    getItem: k => (lsData.has(k) ? lsData.get(k) : null),
    setItem: (k, v) => lsData.set(k, String(v)),
    removeItem: k => lsData.delete(k),
    clear: () => lsData.clear(),
};
globalThis.document = { hidden: false, visibilityState: 'visible', addEventListener() {}, removeEventListener() {} };
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true, writable: true });

function resetEnv() {
    lsData.clear();
    globalThis.document.hidden = false;
    globalThis.navigator.onLine = true;
}
function ownerState() {
    return { usuarioActivo: { id: 1, nombre: 'César', rol: 'DUENO' }, usuarios: [] };
}
const deps = (over = {}) => ({
    getState: () => ownerState(),
    push: async () => ({ status: 'ok' }),
    pull: async () => null,
    audit: async () => {},
    ...over,
});
const T1 = '2026-10-01T10:00:00.000Z';
const T2 = '2026-10-01T12:00:00.000Z';

// ─── mergeBusinessDocs (puro) ────────────────────────────────────────────────

test('merge: vacío entrante nunca borra local no-vacío', () => {
    const local = { name: 'C&Y 2025', phone: '04121234567', fieldTs: {} };
    const cloud = { name: '', phone: '', fieldTs: { name: T2, phone: T2 } };
    const { doc, changed } = mergeBusinessDocs(local, cloud);
    assert.equal(doc.name, 'C&Y 2025');
    assert.equal(doc.phone, '04121234567');
    assert.equal(changed, false);
});

test('merge: fieldTs más nuevo gana por campo', () => {
    const local = { name: 'Viejo', phone: '111', fieldTs: { name: T1, phone: T2 } };
    const cloud = { name: 'Nuevo', phone: '999', fieldTs: { name: T2, phone: T1 } };
    const { doc, changed } = mergeBusinessDocs(local, cloud);
    assert.equal(changed, true);
    assert.equal(doc.name, 'Nuevo', 'name: nube más nueva');
    assert.equal(doc.phone, '111', 'phone: local más nuevo se conserva');
});

test('merge: sin timestamps el entrante no-vacío se adopta (docs legados)', () => {
    const { doc, changed } = mergeBusinessDocs(
        { name: 'A', fieldTs: {} },
        { name: 'B', fieldTs: {} });
    assert.equal(changed, true);
    assert.equal(doc.name, 'B');
});

test('merge: cashea_enabled por fieldTs; sin ts se adopta si difiere', () => {
    let r = mergeBusinessDocs(
        { cashea_enabled: true, fieldTs: { cashea_enabled: T2 } },
        { cashea_enabled: false, fieldTs: { cashea_enabled: T1 } });
    assert.equal(r.doc.cashea_enabled, true, 'toggle viejo no apaga');
    assert.equal(r.changed, false);
    r = mergeBusinessDocs(
        { cashea_enabled: false, fieldTs: { cashea_enabled: T1 } },
        { cashea_enabled: true, fieldTs: { cashea_enabled: T2 } });
    assert.equal(r.doc.cashea_enabled, true, 'toggle nuevo sí se propaga');
    assert.equal(r.changed, true);
    r = mergeBusinessDocs({ cashea_enabled: false }, { cashea_enabled: true });
    assert.equal(r.doc.cashea_enabled, true, 'sin timestamps: se adopta');
});

test('merge: payload inválido no cambia nada', () => {
    const local = { name: 'C&Y', fieldTs: {} };
    const { doc, changed } = mergeBusinessDocs(local, null);
    assert.equal(changed, false);
    assert.equal(doc.name, 'C&Y');
});

test('sanitizeBusinessDoc preserva fieldTs y cashea como booleano', () => {
    const s = sanitizeBusinessDoc({ name: 'X', cashea_enabled: 1, fieldTs: { name: T1, hack: T2 } });
    assert.equal(s.cashea_enabled, false, '1 no es true estricto');
    assert.equal(s.fieldTs.name, T1);
    assert.equal(s.fieldTs.hack, undefined, 'solo campos conocidos');
});

// ─── publishBusinessDoc ──────────────────────────────────────────────────────

test('publishBusinessDoc deniega si no es dueño', async () => {
    resetEnv();
    const pushes = [];
    const r = await publishBusinessDoc({ name: 'X' }, deps({
        getState: () => ({ usuarioActivo: { id: 2, rol: 'CAJERO' } }),
        push: async (...a) => { pushes.push(a); return { status: 'ok' }; },
    }));
    assert.equal(r.status, 'denied');
    assert.equal(pushes.length, 0);
});

test('publishBusinessDoc publica: local + fieldTs + push bypass + auditoría', async () => {
    resetEnv();
    localStorage.setItem('business_name', 'Viejo');
    localStorage.setItem('business_phone', '04121234567');
    const pushes = [];
    const audits = [];
    const r = await publishBusinessDoc({ name: 'C&Y 2025' }, deps({
        push: async (...a) => { pushes.push(a); return { status: 'ok' }; },
        audit: async (...a) => { audits.push(a); },
    }));
    assert.equal(r.status, 'ok');
    assert.equal(localStorage.getItem('business_name'), 'C&Y 2025');
    assert.equal(localStorage.getItem('business_phone'), '04121234567', 'no tocó otros campos');
    const snap = JSON.parse(localStorage.getItem('_business_local'));
    assert.ok(snap.fieldTs.name, 'fieldTs marcado para name');
    assert.equal(snap.fieldTs.phone || '', '', 'phone sin fieldTs (no se tocó)');
    assert.equal(pushes.length, 1);
    assert.equal(pushes[0][0], BUSINESS_DOC_KEY);
    assert.equal(pushes[0][2], true);
    assert.equal(pushes[0][1].name, 'C&Y 2025');
    assert.equal(pushes[0][1].updatedByName, 'César');
    assert.equal(audits.length, 1);
    assert.deepEqual(audits[0].slice(0, 2), ['NEGOCIO', 'DATOS_NEGOCIO_ACTUALIZADOS']);
});

test('publishBusinessDoc sin campos no hace nada', async () => {
    resetEnv();
    const pushes = [];
    const r = await publishBusinessDoc({}, deps({ push: async (...a) => { pushes.push(a); return { status: 'ok' }; } }));
    assert.equal(r.status, 'unchanged');
    assert.equal(pushes.length, 0);
});

test('publishBusinessDoc marca pendiente si el push falla', async () => {
    resetEnv();
    const r = await publishBusinessDoc({ cashea_enabled: true }, deps({
        push: async () => { throw new Error('offline'); },
    }));
    assert.equal(r.status, 'ok');
    assert.equal(localStorage.getItem('cashea_enabled'), 'true', 'lo local igual se aplica');
    assert.equal(localStorage.getItem('_business_pending'), '1');
});

// ─── applyBusinessFromCloud ──────────────────────────────────────────────────

test('apply: toggle de Cashea remoto no borra el teléfono local', async () => {
    resetEnv();
    // Equipo local: teléfono configurado, Cashea apagado, sin fieldTs.
    localStorage.setItem('business_phone', '04121234567');
    localStorage.setItem('cashea_enabled', 'false');
    // La nube trae el toggle (con fieldTs nuevo) pero sin teléfono.
    const ok = await applyBusinessFromCloud({
        name: '', address: '', phone: '', instagram: '',
        cashea_enabled: true, updatedAt: T2,
        fieldTs: { cashea_enabled: T2 },
    }, T2);
    assert.equal(ok, true);
    assert.equal(localStorage.getItem('cashea_enabled'), 'true', 'toggle aplicado');
    assert.equal(localStorage.getItem('business_phone'), '04121234567', 'teléfono intacto');
});

test('apply: nombre más nuevo por fieldTs se adopta', async () => {
    resetEnv();
    localStorage.setItem('business_name', 'Viejo');
    localStorage.setItem('_business_local', JSON.stringify(sanitizeBusinessDoc({ fieldTs: { name: T1 } })));
    const ok = await applyBusinessFromCloud({
        name: 'Nuevo', updatedAt: T2, fieldTs: { name: T2 },
    }, T2);
    assert.equal(ok, true);
    assert.equal(localStorage.getItem('business_name'), 'Nuevo');
});

test('apply: sin cambios de contenido solo converge el timestamp', async () => {
    resetEnv();
    localStorage.setItem('business_name', 'C&Y');
    assert.equal(await applyBusinessFromCloud({ name: 'C&Y', updatedAt: T1 }, T1), true);
    assert.equal(localStorage.getItem('business_name'), 'C&Y');
    assert.equal(localStorage.getItem('_business_ts'), T1, 'el ts converge');
    // Segunda aplicación con el mismo ts: ya no hay nada que hacer.
    assert.equal(await applyBusinessFromCloud({ name: 'C&Y', updatedAt: T1 }, T1), false);
    assert.equal(await applyBusinessFromCloud(null, ''), false);
});

// ─── pollBusinessOnce ────────────────────────────────────────────────────────

test('pollBusinessOnce respeta guards y aplica lo nuevo', async () => {
    resetEnv();
    localStorage.setItem('business_name', 'Viejo');
    localStorage.setItem('_business_ts', T1);
    let pulls = 0;
    const d = () => deps({ pull: async () => { pulls++; return null; } });
    globalThis.document.hidden = true;
    assert.equal((await pollBusinessOnce(d())).status, 'skipped');
    globalThis.document.hidden = false;
    assert.equal((await pollBusinessOnce(d())).status, 'in-sync');
    const r = await pollBusinessOnce(deps({
        pull: async () => ({ payload: { name: 'Nuevo', updatedAt: T2, fieldTs: { name: T2 } }, updatedAt: T2 }),
    }));
    assert.equal(r.status, 'applied');
    assert.equal(localStorage.getItem('business_name'), 'Nuevo');
    assert.ok(pulls >= 1);
});

test('pollBusinessOnce reintenta el pendiente', async () => {
    resetEnv();
    await publishBusinessDoc({ name: 'C&Y 2025' }, deps({ push: async () => { throw new Error('x'); } }));
    assert.equal(localStorage.getItem('_business_pending'), '1');
    const pushes = [];
    const r = await pollBusinessOnce(deps({
        pull: async () => null,
        push: async (...a) => { pushes.push(a); return { status: 'ok' }; },
    }));
    assert.equal(r.status, 'republished');
    assert.equal(pushes[0][1].name, 'C&Y 2025');
    assert.equal(localStorage.getItem('_business_pending'), null);
});

// ─── readBusinessLocal ───────────────────────────────────────────────────────

test('readBusinessLocal lee el estado efectivo', async () => {
    resetEnv();
    localStorage.setItem('business_name', 'C&Y 2025');
    localStorage.setItem('cashea_enabled', 'true');
    const b = readBusinessLocal();
    assert.equal(b.name, 'C&Y 2025');
    assert.equal(b.cashea_enabled, true);
    assert.equal(b.phone, '');
});
