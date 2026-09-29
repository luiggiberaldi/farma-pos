import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUsers } from '../src/config/userProvisioning.js';
import { getVisibleSedes } from '../src/config/sedes.js';
import { canSeeConsolidatedReports } from '../src/config/permissionsFarmacia.js';
import { getActiveSedeId, setActiveSedeId, setActiveAccountId } from '../src/config/storageScope.js';
import { installMemoryBrowser, loadRealModule } from './helpers/realModule.mjs';

async function authFixture(t) {
  installMemoryBrowser(t);
  const mod = await loadRealModule('src/hooks/store/useAuthStore.js', {
    'src/services/auditService.js': 'export const logEvent = async () => {};',
    'src/hooks/useCloudSync.js': 'export const pushCloudSync = async () => ({ status: "paused" });',
  });
  const store = mod.useAuthStore;
  store.setState({ usuarioActivo: null, usuarios: [
    { id: 1, nombre: 'Dueño QA', rol: 'DUENO', sedeId: null, pin: '908172', pinHashed: false, permanente: true },
    { id: 2, nombre: 'Admin QA', rol: 'ADMIN', sedeId: 'norte', pin: '817263', pinHashed: false },
    { id: 3, nombre: 'Caja QA', rol: 'CAJERO', sedeId: 'central', pin: '7263', pinHashed: false, sinPin: false },
  ] });
  setActiveSedeId('central');
  return { store, ...mod };
}

test('F07: normalizar no borra ni muta el PIN configurado del cajero', () => {
  const users = [{ id: 3, nombre: 'Caja QA', rol: 'CAJERO', sedeId: 'central', pin: '7263', pinHashed: false, sinPin: false }];
  const before = structuredClone(users);
  const normalized = normalizeUsers(users).find(u => u.id === 3);
  assert.equal(normalized.pin, '7263');
  assert.equal(normalized.sinPin, false);
  assert.deepEqual(users, before);
});

test('F07: asignar PIN desactiva acceso sin PIN y sobrevive normalizacion', async t => {
  const { store } = await authFixture(t);
  store.setState({ usuarioActivo: { id: 1, nombre: 'Dueño QA', rol: 'DUENO' }, usuarios: [{ id: 3, rol: 'CAJERO', sedeId: 'central', pin: '', sinPin: true }] });
  await store.getState().cambiarPin(3, '6291');
  const user = normalizeUsers(store.getState().usuarios).find(u => u.id === 3);
  assert.equal(user.sinPin, false);
  assert.equal(user.pinHashed, true);
  assert.notEqual(user.pin, '');
});

test('F05: login real no acepta cajero de otra sede ni cambia el namespace', async t => {
  const { store } = await authFixture(t);
  setActiveSedeId('sur');
  assert.equal(await store.getState().login('7263', 3), false);
  assert.equal(store.getState().usuarioActivo, null);
  assert.equal(getActiveSedeId(), 'sur');
});

test('F05: logout durante login pendiente no permite recrear la sesion', async t => {
  const { store } = await authFixture(t);
  const pending = store.getState().login('908172', 1);
  store.getState().logout();
  assert.equal(await pending, false);
  assert.equal(store.getState().usuarioActivo, null);
  assert.equal(localStorage.getItem('abasto-device-session'), null);
});

test('F08: las credenciales cloud no persisten la contraseña', async t => {
  const { store } = await authFixture(t);
  store.getState().setAdminCredentials('qa@example.invalid', 'synthetic-do-not-persist');
  assert.ok(!JSON.stringify(store.getState()).includes('synthetic-do-not-persist'));
  assert.ok(!localStorage.getItem('abasto-auth-storage').includes('synthetic-do-not-persist'));
});

test('F09: administrador conserva sede elegida y rol al iniciar por PIN', async t => {
  const { store } = await authFixture(t);
  setActiveSedeId('sur');
  assert.equal(await store.getState().login('817263', 2), true);
  assert.equal(store.getState().usuarioActivo.rol, 'ADMIN');
  assert.equal(getActiveSedeId(), 'sur');
});

test('F09: dueño y administrador pueden consultar las tres sedes y consolidado', () => {
  for (const rol of ['DUENO', 'ADMIN']) {
    assert.equal(canSeeConsolidatedReports({ rol }), true);
    assert.deepEqual(getVisibleSedes({ rol, sedeId: 'norte' }).map(s => s.id), ['central', 'norte', 'sur']);
  }
  assert.deepEqual(getVisibleSedes(null), []);
  assert.deepEqual(getVisibleSedes({ rol: 'CAJERO', sedeId: 'norte' }).map(s => s.id), ['norte']);
});

test('F05: cuenta cloud exige PIN aun para cajero sin PIN heredado', async t => {
  const { store } = await authFixture(t);
  setActiveAccountId('synthetic-account');
  store.setState({ usuarios: [{ id: 3, rol: 'CAJERO', sedeId: 'central', pin: '', sinPin: true }] });
  assert.equal(await store.getState().login('', 3), false);
  assert.equal(store.getState().usuarioActivo, null);
});

for (const mutation of ['pin', 'role', 'delete']) {
  test(`login pendiente no restaura credenciales tras cambio de ${mutation}`, async t => {
    const { store } = await authFixture(t);
    assert.equal(await store.getState().login('908172', 1), true);
    // A3: el KDF real es PBKDF2 (deriveBits); también se intercepta digest por
    // si el registro verificado usa el formato legado.
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    const deriveBits = crypto.subtle.deriveBits.bind(crypto.subtle);
    let release, entered;
    const suspended = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    let delayed = false;
    const gateKdf = async (orig, args) => {
      if (!delayed) { delayed = true; entered(); await gate; }
      return orig(...args);
    };
    t.mock.method(crypto.subtle, 'digest', async (...args) => gateKdf(digest, args));
    t.mock.method(crypto.subtle, 'deriveBits', async (...args) => gateKdf(deriveBits, args));
    const pending = store.getState().login('817263', 2);
    await suspended;
    if (mutation === 'pin') await store.getState().cambiarPin(2, '192837');
    if (mutation === 'role') store.getState().editarUsuario(2, { rol: 'CAJERO', sedeId: 'norte' });
    if (mutation === 'delete') assert.equal(store.getState().eliminarUsuario(2), true);
    const afterMutation = JSON.stringify(store.getState().usuarios);
    release();
    assert.equal(await pending, false);
    assert.equal(JSON.stringify(store.getState().usuarios), afterMutation);
    assert.equal(store.getState().usuarioActivo.id, 1);
    assert.equal(JSON.parse(localStorage.getItem('abasto-device-session')).user.id, 1);
  });
}

test('sesión persistida exige booleano real para pinVerified', async t => {
  const { store } = await authFixture(t);
  await store.getState().login('908172', 1);
  const saved = JSON.parse(localStorage.getItem('abasto-device-session'));
  localStorage.setItem('abasto-device-session', JSON.stringify({ ...saved, pinVerified: 'false' }));
  await store.persist.rehydrate();
  assert.equal(store.getState().usuarioActivo, null);
});
