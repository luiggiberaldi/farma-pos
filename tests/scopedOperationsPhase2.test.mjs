import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule, saleOptions } from './helpers/realModule.mjs';
import { setActiveSedeId, setActiveAccountId, captureStorageContext } from '../src/config/storageScope.js';

test('F04: repositorio de vista no escribe en nueva sede tras await', async t => {
  const f = createProcessorFixture(t);
  const { bindStorageContext } = await loadRealModule('src/utils/scopedStorage.js', f.mocks);
  const repo = bindStorageContext();
  setActiveSedeId('norte');
  assert.throws(() => repo.setItem('bodega_products_v1', []), /sede cambió/);
  assert.equal(f.writes.length, 0);
});

test('F04: vista anterior no escribe después de cambiar operador en misma sede', async t => {
  const f = createProcessorFixture(t);
  const { bindStorageContext } = await loadRealModule('src/utils/scopedStorage.js', f.mocks);
  const repo = bindStorageContext();
  f.user = { ...f.user, id: 2 };
  assert.throws(() => repo.setItem('bodega_sales_v1', []), /sesión/);
  assert.equal(f.writes.length, 0);
});

test('F04: volver a la misma sede no reactiva callbacks de una vista anterior', async t => {
  const f = createProcessorFixture(t);
  delete f.mocks['src/hooks/store/useAuthStore.js'];
  const mod = await loadRealModule('src/utils/scopedStorage.js', f.mocks, {
    exportsFrom: ['src/hooks/store/useAuthStore.js', 'src/hooks/store/useSedeStore.js'],
  });
  mod.useAuthStore.setState({ usuarioActivo: null, operatorSession: null, usuarios: [
    { id: 1, nombre: 'Owner QA', rol: 'DUENO', pin: '918273', pinHashed: false },
  ] });
  assert.equal(await mod.useAuthStore.getState().login('918273', 1), true);
  const originalSession = mod.useAuthStore.getState().operatorSession.sessionId;
  const oldRepo = mod.bindStorageContext();
  assert.equal(await mod.useSedeStore.getState().setSedeActiva('norte', { pin: '918273', approverId: 1 }), true);
  assert.equal(await mod.useSedeStore.getState().setSedeActiva('central', { pin: '918273', approverId: 1 }), true);
  assert.notEqual(mod.useAuthStore.getState().operatorSession.sessionId, originalSession);
  const before = f.writes.length;
  assert.throws(() => oldRepo.setItem('bodega_products_v1', []), /sesión/);
  assert.equal(f.writes.length, before);
});

test('checkout no escribe otra cuenta si cambia durante guardar venta', async t => {
  const f = createProcessorFixture(t);
  await f.seed('bodega_products_v1', saleOptions().products);
  const context = captureStorageContext();
  const put = f.storage.setItem;
  f.storage.setItem = async (...args) => { await put(...args); if (args[0] === 'bodega_sales_v1') setActiveAccountId('other-account'); };
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
  const result = await processSaleTransaction(saleOptions());
  assert.equal(result.success, true, result.error);
  assert.ok(f.writes.every(write => !write.scopedKey.startsWith('account:other-account')));
  assert.deepEqual(await f.storage.getItem('bodega_sales_v1', []), []);
  assert.equal((await f.storage.getItem('bodega_sales_v1', [], context)).length, 1);
  assert.equal((await f.storage.getItem('bodega_products_v1', [], context))[0].stock, 9);
  assert.equal(f.queued.length, 1);
});

test('cierre normal opera contexto capturado y se rechaza al cambiar sesión durante lectura', async t => {
  const f = createProcessorFixture(t);
  const get = f.storage.getItem;
  f.storage.getItem = async (...args) => { const data = await get(...args); setActiveSedeId('norte'); return data; };
  const { commitNormalClosure } = await loadRealModule('src/utils/closureService.js', f.mocks);
  await assert.rejects(() => commitNormalClosure({ fechaComercial: '2026-09-13', tasaBcv: 100 }), /sede cambió/);
  assert.equal(f.writes.length, 0);
});

test('cierre no confía en operador administrador enviado por caller sin sesión', async t => {
  const f = createProcessorFixture(t);
  f.user = null;
  const { commitNormalClosure } = await loadRealModule('src/utils/closureService.js', f.mocks);
  await assert.rejects(() => commitNormalClosure({ fechaComercial: '2026-09-13', tasaBcv: 100, operator: { id: 1, rol: 'DUENO' } }), /permiso/);
  assert.equal(f.writes.length, 0);
});

test('restauración histórica se bloquea antes de afectar sede o datos', async t => {
  const f = createProcessorFixture(t);
  const mod = await loadRealModule('src/utils/closureService.js', f.mocks);
  await assert.rejects(() => mod.rollbackClosureCorrection(), /pausada/);
  await assert.rejects(() => mod.finalizeHistoricalBatchInOpenSession(), /pausada/);
  assert.equal(f.writes.length, 0);
});

test('bloqueo de cambio de sede impide nuevas operaciones hasta liberar', async t => {
  const f = createProcessorFixture(t);
  const mod = await loadRealModule('src/services/localOperationGuard.js', f.mocks);
  const release = mod.beginLocalOperation('CHANGE_SEDE', captureStorageContext());
  assert.throws(() => mod.beginLocalOperation('CHECKOUT'), /cambio de sede/);
  assert.throws(() => mod.assertContextChangeAllowed(), /operación/);
  release();
  assert.equal(mod.getContextChangeBlockReason(), null);
});
