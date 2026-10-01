import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';
import { setActiveSedeId, captureStorageContext } from '../src/config/storageScope.js';
import { canUsePinlessAccess, isPinlessOptedIn } from '../src/utils/operatorSession.js';

// Stub mínimo de localStorage (el fixture lo reemplaza por uno en memoria).
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
  globalThis.__pinlessEvents = [];
  f.mocks['src/services/auditService.js'] = 'export const logEvent = (...a) => { globalThis.__pinlessEvents.push(a); };';
  const mod = await loadRealModule('src/hooks/store/useAuthStore.js', f.mocks);
  const auth = mod.useAuthStore;
  setActiveSedeId('central');
  auth.setState({
    usuarios: [
      { id: 1, nombre: 'Owner QA', rol: 'DUENO', pin: '908172', pinHashed: false, credentialVersion: 0 },
      { id: 2, nombre: 'Caja QA', rol: 'CAJERO', pin: '7263', pinHashed: false, sedeId: 'central', sinPin: false, credentialVersion: 0 },
    ],
    usuarioActivo: null, operatorSession: null, sessionLocked: null, shift: null,
    clockInOffer: null, requireLogin: false, lastAuthError: null,
  });
  // El dueño opera: quitarPin/agregarUsuario exigen rol DUENO activo.
  auth.setState({ usuarioActivo: auth.getState().usuarios[0] });
  t.after(() => { delete globalThis.__pinlessEvents; });
  return { auth };
}

// ─── Regresión: quitar el PIN activa el acceso sin PIN en este equipo ───
test('quitarPin: activa el opt-in sin PIN en este equipo', async t => {
  const { auth } = await fixture(t);
  assert.equal(isPinlessOptedIn(2), false, 'precondición: opt-in apagado');
  await auth.getState().quitarPin(2);
  const u = auth.getState().usuarios.find(x => x.id === 2);
  assert.equal(u.sinPin, true);
  assert.equal(u.pin, null);
  assert.equal(isPinlessOptedIn(2), true, 'quitarPin debe activar el opt-in en este equipo');
  assert.equal(canUsePinlessAccess(u, captureStorageContext(), false), true);
});

test('quitarPin: el cajero entra sin PIN justo después', async t => {
  const { auth } = await fixture(t);
  await auth.getState().quitarPin(2);
  auth.setState({ usuarioActivo: null });
  const ok = await auth.getState().login('', 2);
  assert.equal(ok, true, 'el login sin PIN debe funcionar tras quitar el PIN');
  assert.equal(auth.getState().usuarioActivo?.id, 2);
  assert.equal(auth.getState().lastAuthError, null);
});

test('agregarUsuario sin PIN: activa el opt-in en este equipo', async t => {
  const { auth } = await fixture(t);
  await auth.getState().agregarUsuario('Caja Nueva', 'CAJERO', '', 'central');
  const u = auth.getState().usuarios.find(x => x.nombre === 'Caja Nueva');
  assert.ok(u, 'usuario creado');
  assert.equal(u.sinPin, true);
  assert.equal(isPinlessOptedIn(u.id), true, 'crear sin PIN debe activar el opt-in en este equipo');
  assert.equal(canUsePinlessAccess(u, captureStorageContext(), false), true);
});

// ─── El mensaje de error ahora dice qué hacer (caso borde: opt-in revocado) ───
test('login: cajero sin PIN y sin opt-in recibe mensaje accionable', async t => {
  const { auth } = await fixture(t);
  await auth.getState().quitarPin(2);
  // Simula revocación posterior del opt-in (ícono de huella apagado a mano).
  const { setPinlessOptIn } = await import('../src/utils/operatorSession.js');
  setPinlessOptIn(2, captureStorageContext(), false);
  auth.setState({ usuarioActivo: null });
  const ok = await auth.getState().login('', 2);
  assert.equal(ok, false);
  assert.match(auth.getState().lastAuthError || '', /huella/, 'el error debe mencionar el ícono de huella');
});
