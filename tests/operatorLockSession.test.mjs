import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';
import { setActiveSedeId } from '../src/config/storageScope.js';
import {
  shouldAutoLockForRole,
  autoLockMinutesFor,
  lockoutMsFor,
  parseSedeNombre,
} from '../src/utils/operatorLockPolicy.js';

// Los tests puros de política corren sin fixture: stub mínimo de localStorage
// (el fixture lo reemplaza por uno en memoria y lo restaura al terminar).
if (!globalThis.localStorage) {
  const data = new Map();
  globalThis.localStorage = {
    getItem: k => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: k => data.delete(k),
    clear: () => data.clear(),
  };
}

async function fixture(t) {
  const f = createProcessorFixture(t);
  delete f.mocks['src/hooks/store/useAuthStore.js'];
  const events = [];
  globalThis.__operatorLockEvents = events;
  f.mocks['src/services/auditService.js'] = 'export const logEvent = (...a) => { globalThis.__operatorLockEvents.push(a); };';
  const mod = await loadRealModule('src/hooks/store/useAuthStore.js', f.mocks);
  const auth = mod.useAuthStore;
  auth.setState({
    usuarios: [
      { id: 1, nombre: 'Owner QA', rol: 'DUENO', pin: '908172', pinHashed: false, credentialVersion: 0 },
      { id: 2, nombre: 'Caja QA', rol: 'CAJERO', pin: '7263', pinHashed: false, sedeId: 'central', sinPin: false, credentialVersion: 0 },
      { id: 3, nombre: 'Caja Norte', rol: 'CAJERO', pin: '1234', pinHashed: false, sedeId: 'norte', sinPin: false, credentialVersion: 0 },
    ],
    usuarioActivo: null, operatorSession: null, sessionLocked: null, shift: null, clockInOffer: null,
  });
  t.after(() => { delete globalThis.__operatorLockEvents; });
  return { auth, events };
}
const actions = events => events.map(e => e[1]);

// ─── Ajuste 1: el bloqueo por inactividad SOLO lo tiene el dueño ───
test('auto-lock: solo DUENO con login requerido se bloquea; el cajero nunca', () => {
  assert.equal(shouldAutoLockForRole('DUENO', true), true);
  assert.equal(shouldAutoLockForRole('DUENO', false), false);
  assert.equal(shouldAutoLockForRole('CAJERO', true), false);
  assert.equal(shouldAutoLockForRole('CAJERO', false), false);
  assert.equal(shouldAutoLockForRole('ADMIN', true), false, 'el rol ADMIN no existe');
  assert.equal(shouldAutoLockForRole(undefined, true), false);
});

test('auto-lock: minutos configurables solo para dueño; cajero devuelve null', () => {
  assert.equal(autoLockMinutesFor('CAJERO'), null);
  assert.equal(autoLockMinutesFor('DUENO'), 5, 'por defecto 5');
  localStorage.setItem('admin_auto_lock_minutes', '12');
  assert.equal(autoLockMinutesFor('DUENO'), 12);
  localStorage.setItem('admin_auto_lock_minutes', 'abc');
  assert.equal(autoLockMinutesFor('DUENO'), 5, 'inválido → 5');
  localStorage.setItem('admin_auto_lock_minutes', '0');
  assert.equal(autoLockMinutesFor('DUENO'), 5, 'menor a 1 → 5');
  localStorage.removeItem('admin_auto_lock_minutes');
});

// ─── Lockout anti-fuerza bruta (movido a la política, misma semántica) ───
test('lockoutMsFor: 0 antes de 3 fallos, exponencial 30s→60s→120s, tope 15 min', () => {
  assert.equal(lockoutMsFor(0), 0);
  assert.equal(lockoutMsFor(2), 0);
  assert.equal(lockoutMsFor(3), 30_000);
  assert.equal(lockoutMsFor(4), 60_000);
  assert.equal(lockoutMsFor(5), 120_000);
  assert.equal(lockoutMsFor(50), 15 * 60_000, 'tope 15 min');
});

// ─── Ajuste 2: año siempre visible; "C&Y" en mayúsculas ───
test('parseSedeNombre: separa base y año; normaliza C&y → C&Y', () => {
  assert.deepEqual(parseSedeNombre('C&Y 2025'), { base: 'C&Y', year: '2025' });
  assert.deepEqual(parseSedeNombre('C&Y 2026'), { base: 'C&Y', year: '2026' });
  assert.deepEqual(parseSedeNombre('C&y 2026'), { base: 'C&Y', year: '2026' });
  assert.deepEqual(parseSedeNombre('c&y 2025'), { base: 'C&Y', year: '2025' });
  assert.deepEqual(parseSedeNombre('Farmacia Las 24 Horas'), { base: 'Farmacia Las 24 Horas', year: null });
});

// ─── PIN ligado a la cuenta elegida (patrón JustClick) ───
test('login: el PIN solo abre su propia cuenta; PIN cruzado falla', async t => {
  const { auth } = await fixture(t);
  assert.equal(await auth.getState().login('7263', 2), true);
  assert.equal(auth.getState().usuarioActivo.id, 2);
  auth.getState().logout();
  assert.equal(await auth.getState().login('908172', 2), false, 'PIN del dueño no abre la cuenta del cajero');
  assert.equal(await auth.getState().login('7263', 1), false, 'PIN del cajero no abre la cuenta del dueño');
  assert.equal(auth.getState().usuarioActivo, null);
});

// ─── Lock ≠ Logout ───
test('lock: conserva operador y sesión; solo el que bloqueó desbloquea con su PIN', async t => {
  const { auth } = await fixture(t);
  assert.equal(await auth.getState().login('7263', 2), true);
  assert.equal(auth.getState().lock('manual'), true);
  assert.equal(auth.getState().usuarioActivo.id, 2, 'el operador se conserva');
  assert.ok(auth.getState().operatorSession, 'la sesión se conserva');
  const locked = auth.getState().sessionLocked;
  assert.equal(locked.userId, 2);
  assert.ok(localStorage.getItem('farmapos_session_locked'), 'el bloqueo sobrevive a recarga');
  assert.equal(await auth.getState().unlock('0000'), false, 'PIN incorrecto no desbloquea');
  assert.ok(auth.getState().sessionLocked, 'sigue bloqueado');
  assert.equal(await auth.getState().unlock('7263'), true);
  assert.equal(auth.getState().sessionLocked, null);
  assert.equal(auth.getState().usuarioActivo.id, 2, 'tras desbloquear sigue el mismo operador');
  assert.equal(localStorage.getItem('farmapos_session_locked'), null, 'llave limpiada');
});

test('logout limpia el bloqueo y no deja llave huérfana', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 2);
  auth.getState().lock('manual');
  auth.getState().logout('prueba');
  assert.equal(auth.getState().sessionLocked, null);
  assert.equal(auth.getState().usuarioActivo, null);
  assert.equal(localStorage.getItem('farmapos_session_locked'), null);
});

test('lock sin operador activo es no-op', async t => {
  const { auth } = await fixture(t);
  assert.equal(auth.getState().lock('manual'), false);
  assert.equal(await auth.getState().unlock('1234'), false);
});

// ─── Override del dueño para anulación ───
test('issueApproval acepta VOID_SALE solo con PIN de dueño', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('7263', 2);
  const details = { saleId: 'venta-1', tipo: 'VOID_SALE' };
  const proof = await auth.getState().issueApproval('908172', 1, { action: 'VOID_SALE', details });
  assert.ok(proof, 'el dueño aprueba');
  assert.equal(proof.approver.rol, 'DUENO');
  assert.equal(auth.getState().usuarioActivo.id, 2, 'el cajero conserva su sesión');
  const validated = auth.getState().consumeApproval(proof.id, 'VOID_SALE', details);
  assert.equal(validated.approver.id, 1);
  assert.equal(await auth.getState().issueApproval('7263', 2, { action: 'VOID_SALE', details }), null,
    'el cajero no puede auto-aprobar');
  await assert.rejects(
    auth.getState().issueApproval('908172', 1, { action: 'HACKEAR', details }),
    /inválida/,
  );
});

// ─── Clock-in / clock-out ───
test('clock-in: tras el PIN el cajero recibe la oferta; fichar queda en auditoría', async t => {
  const { auth, events } = await fixture(t);
  await auth.getState().login('7263', 2);
  const offer = auth.getState().clockInOffer;
  assert.deepEqual(offer, { userId: 2, userName: 'Caja QA' });
  assert.equal(auth.getState().clockIn(), true);
  assert.equal(auth.getState().clockInOffer, null);
  assert.ok(auth.getState().shift?.clockInAt, 'turno abierto');
  assert.ok(actions(events).includes('TURNO_INICIADO'), 'fichaje en auditoría');
  // Con turno abierto no se vuelve a ofrecer.
  await auth.getState().login('7263', 2);
  assert.equal(auth.getState().clockInOffer, null);
});

test('clock-out: al cerrar turno se registra la salida en auditoría', async t => {
  const { auth, events } = await fixture(t);
  await auth.getState().login('7263', 2);
  auth.getState().clockIn();
  auth.getState().logout('turno cerrado');
  const fin = events.find(e => e[1] === 'TURNO_FINALIZADO');
  assert.ok(fin, 'salida registrada');
  assert.match(fin[2], /Caja QA fichó salida de turno/);
  assert.equal(auth.getState().shift, null);
});

test('clock-in: el dueño no recibe oferta y no puede fichar', async t => {
  const { auth } = await fixture(t);
  await auth.getState().login('908172', 1);
  assert.equal(auth.getState().clockInOffer, null);
  assert.equal(auth.getState().clockIn(), false);
});

// ─── Lockout integrado con el PIN real ───
test('lockout: 3 fallos bloquean 30s; el PIN correcto revive tras la ventana', async t => {
  const { auth } = await fixture(t);
  setActiveSedeId('central');
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
  assert.equal(await auth.getState().verifyPin('0000', 2), null);
  assert.equal(await auth.getState().verifyPin('0000', 2), null);
  assert.equal(await auth.getState().verifyPin('0000', 2), null);
  assert.equal(await auth.getState().verifyPin('7263', 2), null, 'bloqueado aunque el PIN sea correcto');
  now += 31_000;
  const ok = await auth.getState().verifyPin('7263', 2);
  assert.ok(ok, 'tras la ventana el PIN correcto funciona');
  assert.equal(ok.id, 2);
});
