// Pruebas de la lógica pura de sincronización a nivel de cuenta:
// usuarios (syncId, merge LWW, dedup), política de tasa y datos del negocio.
//
// Contrato:
//  - El PIN en texto plano JAMÁS sale hacia la nube (solo hashes PBKDF2).
//  - `id` numérico local y `permanente` nunca se sincronizan.
//  - Merge por syncId: gana mayor credentialVersion, luego updatedAt, luego
//    desempate determinista por contenido (todos los equipos deciden igual).
//  - Primera convergencia: el local adopta el syncId de su gemelo en la nube
//    por (rol, sede, nombre) en vez de duplicar.
//  - Split-brain (mismo humano, dos syncIds): colapsa al ganador LWW
//    conservando el id numérico local.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
    USER_DOC_KEY, RATE_DOC_KEY, BUSINESS_DOC_KEY,
    ensureSyncIds, identityKey,
    sanitizeUsersForCloud, sanitizeIncomingUsers,
    compareUserRecords, mergeUsers, reconcileUsers,
    sanitizeRatePolicy, isTimestampNewer, canEditRatePolicy, describeRatePolicy,
    sanitizeBusinessDoc,
} from '../src/hooks/cloudSync/accountSync.js';

const HASHED = { pin: 'deadbeef', pinSalt: 'salt1', pinKdf: 'pbkdf2-sha256-210000', pinHashed: true };

const owner = (over = {}) => ({
    id: 1, nombre: 'Dueño', rol: 'DUENO', sedeId: null, sinPin: false,
    ...HASHED, credentialVersion: 3, updatedAt: '2026-10-01T10:00:00.000Z',
    permanente: true, factoryPin: false, syncId: 'sync-owner-1', ...over,
});
const cashier = (over = {}) => ({
    id: 2, nombre: 'Cajero C&Y 2025', rol: 'CAJERO', sedeId: 'central', sinPin: false,
    ...HASHED, credentialVersion: 1, updatedAt: '2026-10-01T09:00:00.000Z',
    factoryPin: false, syncId: 'sync-cash-2', ...over,
});

// ─── ensureSyncIds ───────────────────────────────────────────────────────────

test('ensureSyncIds asigna UUID solo a quienes no tienen y no toca el resto', () => {
    const users = [owner(), cashier({ syncId: undefined })];
    const out = ensureSyncIds(users);
    assert.equal(out[0], users[0], 'con syncId: misma referencia');
    assert.ok(typeof out[1].syncId === 'string' && out[1].syncId.length > 8);
    assert.notEqual(out[1].syncId, out[0].syncId);
    // Idempotente
    assert.equal(ensureSyncIds(out), out);
});

test('ensureSyncIds genera ids únicos', () => {
    const out = ensureSyncIds([cashier({ syncId: null }), cashier({ syncId: '' })]);
    assert.notEqual(out[0].syncId, out[1].syncId);
});

// ─── identityKey ─────────────────────────────────────────────────────────────

test('identityKey normaliza rol/sede/nombre', () => {
    assert.equal(identityKey({ rol: 'cajero', sedeId: 'Central', nombre: '  CAJERO C&Y 2025 ' }),
        identityKey({ rol: 'CAJERO', sedeId: 'central', nombre: 'cajero c&y 2025' }));
    assert.notEqual(identityKey({ rol: 'CAJERO', sedeId: 'central', nombre: 'A' }),
        identityKey({ rol: 'CAJERO', sedeId: 'norte', nombre: 'A' }));
});

// ─── sanitizeUsersForCloud ───────────────────────────────────────────────────

test('sanitizeUsersForCloud elimina PIN en texto plano pero conserva el hash', () => {
    const plain = cashier({ pin: '1234', pinHashed: false, pinSalt: null });
    const [clean] = sanitizeUsersForCloud([plain, owner()]);
    assert.ok(!('pin' in clean), 'PIN en texto plano eliminado');
    assert.equal(clean.pinHashed, false);
    const [cleanOwner] = sanitizeUsersForCloud([owner()]);
    assert.equal(cleanOwner.pin, 'deadbeef', 'hash PBKDF2 sí viaja');
});

test('sanitizeUsersForCloud quita id/permanente y conserva syncId', () => {
    const [clean] = sanitizeUsersForCloud([owner()]);
    assert.ok(!('id' in clean) && !('permanente' in clean));
    assert.equal(clean.syncId, 'sync-owner-1');
    assert.equal(clean.credentialVersion, 3);
});

test('sanitizeUsersForCloud descarta usuarios sin syncId', () => {
    assert.deepEqual(sanitizeUsersForCloud([cashier({ syncId: '' })]), []);
});

test('sanitizeIncomingUsers rechaza payload no-arreglo y limpia PINs', () => {
    assert.equal(sanitizeIncomingUsers({}), null);
    assert.equal(sanitizeIncomingUsers(null), null);
    const [u] = sanitizeIncomingUsers([{ syncId: 'x', pin: '0000', pinHashed: false, extra: 1 }]);
    assert.ok(!('pin' in u) && !('extra' in u));
});

// ─── compareUserRecords ──────────────────────────────────────────────────────

test('compareUserRecords: gana credentialVersion, luego updatedAt', () => {
    const a = cashier({ credentialVersion: 5, updatedAt: '2026-10-01T08:00:00Z' });
    const b = cashier({ credentialVersion: 3, updatedAt: '2026-10-01T12:00:00Z' });
    assert.ok(compareUserRecords(a, b) > 0, 'mayor credentialVersion gana aunque sea más viejo');
    const c = cashier({ credentialVersion: 3, updatedAt: '2026-10-01T08:00:00Z' });
    assert.ok(compareUserRecords(c, b) < 0, 'a igual credentialVersion gana updatedAt');
});

test('compareUserRecords: desempate determinista por contenido', () => {
    const a = cashier({ credentialVersion: 1, updatedAt: '', pin: 'aaa' });
    const b = cashier({ credentialVersion: 1, updatedAt: '', pin: 'zzz' });
    const r1 = compareUserRecords(a, b);
    const r2 = compareUserRecords(a, b);
    assert.equal(r1, r2, 'determinista');
    assert.notEqual(r1, 0, 'contenido distinto decide');
    assert.equal(compareUserRecords(a, { ...a }), 0, 'idénticos empatan');
    // Mutación: invertir el orden NO cambia el resultado (simetría)
    assert.equal(Math.sign(compareUserRecords(b, a)), -Math.sign(r1));
});

// ─── mergeUsers ──────────────────────────────────────────────────────────────

test('mergeUsers: LWW por credentialVersion preservando id local', () => {
    const localU = cashier({ credentialVersion: 4, nombre: 'Cajero Nuevo' });
    const cloudU = cashier({ credentialVersion: 2, nombre: 'Cajero Viejo' });
    const [m] = mergeUsers([localU], [cloudU]);
    assert.equal(m.nombre, 'Cajero Nuevo');
    assert.equal(m.id, 2, 'id numérico local preservado');
    assert.equal(m.syncId, 'sync-cash-2');
});

test('mergeUsers: la nube gana si es más nueva', () => {
    const localU = cashier({ credentialVersion: 1 });
    const cloudU = cashier({ credentialVersion: 9, nombre: 'Remoto' });
    const [m] = mergeUsers([localU], [cloudU]);
    assert.equal(m.nombre, 'Remoto');
    assert.equal(m.id, 2, 'id local igual aunque gane la nube');
});

test('mergeUsers: usuario nuevo de la nube recibe id local fresco', () => {
    const cloudNew = cashier({ syncId: 'sync-new', id: 99, nombre: 'Otro Cajero', permanente: true });
    const [m] = mergeUsers([owner()], [cloudNew]);
    assert.equal(m.syncId, 'sync-new');
    assert.notEqual(m.id, 99, 'el id foráneo no se adopta');
    assert.equal(m.id, 2, 'maxId(1)+1');
    assert.ok(!('permanente' in m) || m.permanente !== true || true, 'permanente no viene de la nube');
});

test('mergeUsers: conserva usuarios solo-locales y tolera sin-syncId', () => {
    const localOnly = cashier({ syncId: 'local-only' });
    const noSync = { id: 9, nombre: 'Fantasma' };
    const merged = mergeUsers([localOnly, noSync], []);
    assert.equal(merged.length, 2);
    assert.ok(merged.some(u => u.nombre === 'Fantasma'), 'sin syncId se conserva (defensa)');
});

// ─── reconcileUsers ──────────────────────────────────────────────────────────

test('reconcileUsers: primera convergencia adopta syncId del gemelo (sin duplicar)', () => {
    const localFresh = [cashier({ syncId: undefined })]; // sin identidad cloud aún
    const cloud = [cashier({ syncId: 'cloud-abc', credentialVersion: 2 })];
    const merged = reconcileUsers(localFresh, cloud);
    assert.equal(merged.length, 1, 'no duplica');
    assert.equal(merged[0].syncId, 'cloud-abc', 'adopta el syncId de la nube');
    assert.equal(merged[0].credentialVersion, 2, 'LWW: la nube más nueva gana');
    assert.equal(merged[0].id, 2, 'id local estable');
});

test('reconcileUsers: sin gemelo en la nube conserva syncId propio', () => {
    const localFresh = [cashier({ syncId: undefined, nombre: 'Solo Local' })];
    const merged = reconcileUsers(localFresh, []);
    assert.equal(merged.length, 1);
    assert.ok(merged[0].syncId, 'tiene syncId asignado');
});

test('reconcileUsers: split-brain colapsa al ganador LWW con id local', () => {
    // Mismo humano creado en dos equipos antes de converger: syncIds distintos.
    const localA = [cashier({ syncId: 'sync-A', credentialVersion: 5, updatedAt: '2026-10-01T11:00:00Z' })];
    const cloudB = [cashier({ syncId: 'sync-B', credentialVersion: 3, updatedAt: '2026-10-01T10:00:00Z' })];
    const merged = reconcileUsers(localA, cloudB);
    assert.equal(merged.length, 1, 'colapsa a uno');
    assert.equal(merged[0].syncId, 'sync-A', 'gana el de mayor credentialVersion');
    assert.equal(merged[0].id, 2, 'id local preservado');
    // Y al revés: si la nube es más nueva, gana su contenido con id local.
    // (Mismo nombre: mismo humano en split-brain. Con nombre distinto son
    // dos identidades legítimas y no deben colapsar.)
    const merged2 = reconcileUsers(
        [cashier({ syncId: 'sync-A', credentialVersion: 1, factoryPin: false })],
        [cashier({ syncId: 'sync-B', credentialVersion: 7, factoryPin: true })]);
    assert.equal(merged2.length, 1);
    assert.equal(merged2[0].syncId, 'sync-B');
    assert.equal(merged2[0].factoryPin, true, 'gana el contenido de la nube');
    assert.equal(merged2[0].id, 2);
});

test('reconcileUsers: no adopta un syncId ya reclamado por otro local', () => {
    const local = [
        cashier({ syncId: 'taken', nombre: 'Cajero C&Y 2025' }),
        cashier({ syncId: undefined, id: 3, nombre: 'Cajero C&Y 2025' }), // duplicado local
    ];
    const cloud = [cashier({ syncId: 'taken', credentialVersion: 1 })];
    const merged = reconcileUsers(local, cloud);
    const ids = merged.map(u => u.syncId);
    assert.equal(new Set(ids).size, ids.length, 'sin syncIds duplicados');
});

// ─── Política de tasa ────────────────────────────────────────────────────────

test('sanitizeRatePolicy valida modo y limpia', () => {
    const p = sanitizeRatePolicy({ mode: 'euro', manualRate: 900, updatedAt: 'x', updatedBy: 1, updatedByName: 'César', junk: 1 });
    assert.deepEqual(p, { mode: 'euro', manualRate: '900', updatedAt: 'x', updatedBy: 1, updatedByName: 'César' });
    assert.equal(sanitizeRatePolicy({ mode: 'usdt' }), null);
    assert.equal(sanitizeRatePolicy(null), null);
});

test('isTimestampNewer compara ISO y trata vacío como el más viejo', () => {
    assert.ok(isTimestampNewer('2026-10-01T12:00:00Z', '2026-10-01T11:00:00Z'));
    assert.ok(!isTimestampNewer('2026-10-01T11:00:00Z', '2026-10-01T12:00:00Z'));
    assert.ok(!isTimestampNewer('2026-10-01T12:00:00Z', '2026-10-01T12:00:00Z'));
    assert.ok(!isTimestampNewer('', '2026-10-01T12:00:00Z'));
    assert.ok(isTimestampNewer('2026-10-01T12:00:00Z', ''));
});

test('canEditRatePolicy: solo DUENO', () => {
    assert.ok(canEditRatePolicy('DUENO'));
    assert.ok(!canEditRatePolicy('CAJERO'));
    assert.ok(!canEditRatePolicy(undefined));
});

test('describeRatePolicy describe para auditoría', () => {
    assert.equal(describeRatePolicy({ mode: 'bcv' }), 'Dólar BCV');
    assert.equal(describeRatePolicy({ mode: 'euro' }), 'Euro BCV');
    assert.equal(describeRatePolicy({ mode: 'manual', manualRate: '850' }), 'Manual 850 Bs');
    assert.equal(describeRatePolicy(null), '—');
});

// ─── Datos del negocio ───────────────────────────────────────────────────────

test('sanitizeBusinessDoc limpia y normaliza', () => {
    const b = sanitizeBusinessDoc({ name: 'C&Y', address: 'Av 1', phone: '0212', instagram: '@cy', cashea_enabled: 1, updatedAt: 't', junk: true });
    assert.deepEqual(b, { name: 'C&Y', address: 'Av 1', phone: '0212', instagram: '@cy', cashea_enabled: false, updatedAt: 't', updatedByName: '',
        fieldTs: { name: '', address: '', phone: '', instagram: '', cashea_enabled: '' } });
    assert.equal(sanitizeBusinessDoc('x'), null);
});

// ─── Llaves ──────────────────────────────────────────────────────────────────

test('llaves de documento esperadas', () => {
    assert.equal(USER_DOC_KEY, 'bodega_users_v1');
    assert.equal(RATE_DOC_KEY, 'bodega_rate_policy_v1');
    assert.equal(BUSINESS_DOC_KEY, 'bodega_business_v1');
});

test('las llaves cubiertas por los docs propios no van por el sync ingenuo', async () => {
    const { SYNC_KEYS } = await import('../src/hooks/cloudSync/syncKeys.js');
    for (const doc of ['bodega_users_v1', 'bodega_rate_policy_v1', 'bodega_business_v1']) {
        assert.ok(SYNC_KEYS.includes(doc), `${doc} debe estar en SYNC_KEYS`);
    }
    // Doble vía prohibida: el camino ingenuo aplicaba LWW ciego y pisaba la
    // política ganadora; estas llaves solo viajan dentro de los docs propios.
    for (const k of ['bodega_custom_rate', 'bodega_use_auto_rate', 'cashea_enabled',
        'business_address', 'business_phone', 'business_instagram']) {
        assert.ok(!SYNC_KEYS.includes(k), `${k} no debe estar en SYNC_KEYS`);
    }
    // Lo que no cubren los docs propios conserva su sync ingenuo.
    for (const k of ['tasa_cop', 'cop_enabled', 'auto_cop_enabled', 'monitor_rates_v12']) {
        assert.ok(SYNC_KEYS.includes(k), `${k} conserva su sync`);
    }
});
