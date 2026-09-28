import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';
import { getActiveSedeId, setActiveSedeId, getScopedStorageKey } from '../src/config/storageScope.js';

async function fixture(t) {
  const f = createProcessorFixture(t);
  delete f.mocks['src/hooks/store/useAuthStore.js'];
  const mod = await loadRealModule('src/hooks/store/useSedeStore.js', f.mocks, {
    exportsFrom: ['src/hooks/store/useAuthStore.js', 'src/services/localOperationGuard.js'],
  });
  mod.useAuthStore.setState({ usuarioActivo: null, usuarios: [
    { id: 1, nombre: 'Dueño QA', rol: 'DUENO', pin: '918273', pinHashed: false },
    { id: 2, nombre: 'Admin QA', rol: 'ADMIN', pin: '827364', pinHashed: false, sedeId: 'central' },
    { id: 3, nombre: 'Caja QA', rol: 'CAJERO', pin: '7364', pinHashed: false, sedeId: 'central' },
  ] });
  return { ...mod, f };
}

for (const [id, pin, role] of [[1, '918273', 'DUENO']]) {
  test(`cambiar sede con PIN de ${role} conserva identidad y deja huella`, async t => {
    const { useAuthStore: auth, useSedeStore: sede, f } = await fixture(t);
    assert.equal(await auth.getState().login(pin, id), true);
    const before = structuredClone(auth.getState().usuarioActivo);
    assert.equal(await sede.getState().setSedeActiva('norte', { pin, approverId: id }), true);
    assert.equal(sede.getState().sedeActivaId, 'norte');
    assert.equal(getActiveSedeId(), 'norte');
    assert.deepEqual(auth.getState().usuarioActivo, before);
    assert.equal(auth.getState().operatorSession.sedeId, 'norte');
    const movement = (await f.storage.getItem('farmacia_sede_movimientos_v1', [], { accountId: '', sedeId: 'central' }))[0];
    assert.equal(movement.sedeAnterior, 'central');
    assert.equal(movement.sedeNueva, 'norte');
    assert.equal(movement.aprobador.id, 1);
    assert.ok(movement.huella.correlativo);
    assert.equal(movement.huella.sedeId, 'central');
    assert.ok(Number.isFinite(movement.huella.ts));
  });
}

test('cambiar sede rechaza admin y PIN incorrecto: solo autoriza el Dueño', async t => {
  const { useSedeStore: sede, f } = await fixture(t);
  await assert.rejects(() => sede.getState().setSedeActiva('norte', { pin: '827364', approverId: 2 }), /Solo el PIN del Dueño/);
  assert.equal(await sede.getState().setSedeActiva('norte', { pin: '111111', approverId: 1 }), false);
  assert.equal(getActiveSedeId(), 'central');
  assert.equal(f.writes.length, 0);
});

test('un cajero no cambia sede incluso presentando PIN administrativo', async t => {
  const { useAuthStore: auth, useSedeStore: sede, f } = await fixture(t);
  await auth.getState().login('7364', 3);
  await assert.rejects(() => sede.getState().setSedeActiva('norte', { pin: '918273', approverId: 1 }), /cajero/);
  assert.equal(getActiveSedeId(), 'central');
  assert.equal(f.writes.length, 0);
});

test('selector bloqueado cambia sede con aprobación pero no inicia sesión de aprobador', async t => {
  const { useAuthStore: auth, useSedeStore: sede } = await fixture(t);
  assert.equal(await sede.getState().setSedeActiva('sur', { pin: '918273', approverId: 1 }), true);
  assert.equal(auth.getState().usuarioActivo, null);
  assert.equal(localStorage.getItem('abasto-device-session'), null);
  assert.equal(getActiveSedeId(), 'sur');
});

test('carrito, borrador o guardado pendiente bloquean cambiar sede sin efectos', async t => {
  const { useSedeStore: sede, registerContextBlocker, beginLocalOperation, f } = await fixture(t);
  const options = { pin: '918273', approverId: 1 };
  const unregister = registerContextBlocker(() => 'Cesta pendiente');
  await assert.rejects(() => sede.getState().setSedeActiva('norte', options), /Cesta/);
  unregister();
  const release = beginLocalOperation('QA_WRITE');
  await assert.rejects(() => sede.getState().setSedeActiva('norte', options), /operación/);
  release();
  localStorage.setItem(getScopedStorageKey('bodega_pending_cart_v2'), JSON.stringify({ version: 2, items: [{ id: 'p' }] }));
  await assert.rejects(() => sede.getState().setSedeActiva('norte', options), /cesta/);
  assert.equal(f.writes.length, 0);
  assert.equal(getActiveSedeId(), 'central');
});

test('la sede canónica prevalece al iniciar y no se deriva de una identidad ajena', async t => {
  const { useSedeStore: sede } = await fixture(t);
  setActiveSedeId('sur');
  assert.equal(sede.getState().syncWithUser(null), 'sur');
  assert.equal(sede.getState().syncWithUser({ rol: 'CAJERO', sedeId: 'norte' }), 'sur');
  assert.equal(getActiveSedeId(), 'sur');
});
