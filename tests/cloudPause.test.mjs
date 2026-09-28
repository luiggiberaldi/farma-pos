import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';
import { getScopedStorageKey, getStorageKeyForContext, captureStorageContext, setActiveSedeId, setActiveAccountId } from '../src/config/storageScope.js';

function fakeIDB(t) {
  const f = createProcessorFixture(t);
  const id = '__idb_' + randomUUID();
  const records = new Map();
  const writes = [];
  const io = { config() {}, async getItem(key) { return structuredClone(records.get(key) ?? null); }, async setItem(key, value) { records.set(key, structuredClone(value)); writes.push(key); return value; }, async removeItem(key) { records.delete(key); } };
  globalThis[id] = io;
  t.after(() => delete globalThis[id]);
  f.mocks.localforage = `export default globalThis[${JSON.stringify(id)}];`;
  f.mocks['src/config/supabaseCloud.js'] = 'export const supabaseCloud = new Proxy({}, { get() { throw new Error("unexpected cloud access"); } });';
  return { f, io, records, writes };
}

test('pausa cloud: cola real conserva pendientes y fallidos sin intentos, red ni borrado', async t => {
  const { f, records, writes } = fakeIDB(t);
  delete f.mocks['src/services/offlineQueueService.js'];
  setActiveAccountId('synthetic-account');
  const key = getScopedStorageKey('offline_sales_queue', 'synthetic-account');
  const queue = [{ id: 'pending', queue_id: 'pending', sync_status: 'pending', attempts: 2 }, { id: 'failed', queue_id: 'failed', sync_status: 'failed', attempts: 10 }];
  records.set(key, structuredClone(queue));
  const { offlineQueueService } = await loadRealModule('src/services/offlineQueueService.js', f.mocks);
  for (const action of ['syncPendingSales', 'retryFailed', 'dismissFailed']) {
    assert.equal((await offlineQueueService[action]()).status, 'paused');
    assert.deepEqual(records.get(key), queue);
  }
  assert.equal(writes.length, 0);
  assert.deepEqual(await offlineQueueService.getCounts(), { pending: 1, failed: 1, synced: 0 });
  await offlineQueueService.addSaleToQueue({ total: 10, cart: [], payments: [] });
  assert.equal(records.get(key).length, 3);
  assert.deepEqual(records.get(key).slice(0, 2), queue);
});

test('pausa cloud: push, flush y broadcasts retornan pausa antes de acceder a Supabase', async t => {
  const { f } = fakeIDB(t);
  const mod = await loadRealModule('src/hooks/useCloudSync.js', f.mocks);
  for (const action of [() => mod.pushCloudSync('bodega_products_v1', [{ id: 'p' }], true), () => mod.flushPendingPushes(), () => mod.broadcastFactoryReset('qa'), () => mod.broadcastForceReload('qa')]) {
    assert.equal((await action()).status, 'paused');
  }
});

test('pausa cloud: backup manual no lee ni escribe datasets remotos', async t => {
  const { f } = fakeIDB(t);
  const { exportCloudBackup } = await loadRealModule('src/hooks/useAutoBackup.js', f.mocks);
  assert.equal(await exportCloudBackup('synthetic-device'), false);
});

test('almacenamiento real: fallo en ambos soportes propaga error en vez de confirmar', async t => {
  const errorLog = t.mock.method(console, 'error', () => {});
  const { f, io } = fakeIDB(t);
  delete f.mocks['src/utils/storageService.js'];
  io.setItem = async () => { throw new Error('synthetic IDB failure'); };
  localStorage.setItem = () => { throw new Error('synthetic quota failure'); };
  const { storageService } = await loadRealModule('src/utils/storageService.js', f.mocks);
  await assert.rejects(() => storageService.setItem('bodega_sales_v1', []), /No se pudieron guardar/);
  assert.equal(errorLog.mock.callCount(), 2);
});

test('almacenamiento real: lectura fallback permanece en la sede capturada antes del await', async t => {
  t.mock.method(console, 'error', () => {});
  const { f, io } = fakeIDB(t);
  delete f.mocks['src/utils/storageService.js'];
  localStorage.setItem(getScopedStorageKey('bodega_sales_v1'), JSON.stringify([{ id: 'central' }]));
  setActiveSedeId('norte');
  localStorage.setItem(getScopedStorageKey('bodega_sales_v1'), JSON.stringify([{ id: 'north' }]));
  setActiveSedeId('central');
  io.getItem = async () => { setActiveSedeId('norte'); throw new Error('synthetic IDB failure'); };
  const { storageService } = await loadRealModule('src/utils/storageService.js', f.mocks);
  assert.deepEqual(await storageService.getItem('bodega_sales_v1', []), [{ id: 'central' }]);
});

test('almacenamiento real: lectura fallback atrasada nunca sobrescribe un commit nuevo', async t => {
  const { f, io, records, writes } = fakeIDB(t);
  delete f.mocks['src/utils/storageService.js'];
  const key = getScopedStorageKey('bodega_sales_v1');
  const old = [{ id: 'old-fallback' }], current = [{ id: 'committed-after-read' }];
  localStorage.setItem(key, JSON.stringify(old));
  let releaseRead;
  io.getItem = () => new Promise(resolve => { releaseRead = resolve; });
  const { storageService } = await loadRealModule('src/utils/storageService.js', f.mocks);
  const pending = storageService.getItem('bodega_sales_v1', []);
  assert.equal(typeof releaseRead, 'function');
  records.set(key, structuredClone(current));
  releaseRead(null);
  assert.deepEqual(await pending, old, 'the suspended caller can observe its old read but cannot persist it');
  assert.deepEqual(records.get(key), current);
  assert.equal(writes.length, 0);
  assert.equal(localStorage.getItem(key), JSON.stringify(old), 'recovery source is retained until an explicit commit');
});

test('almacenamiento real: fallback legible permanece intacto hasta guardar explicitamente', async t => {
  const { f, records, writes } = fakeIDB(t);
  delete f.mocks['src/utils/storageService.js'];
  const key = getScopedStorageKey('bodega_products_v1');
  const original = [{ id: 'preserved', stock: 4 }];
  localStorage.setItem(key, JSON.stringify(original));
  const { storageService } = await loadRealModule('src/utils/storageService.js', f.mocks);
  assert.deepEqual(await storageService.getItem('bodega_products_v1'), original);
  assert.equal(records.has(key), false); assert.equal(writes.length, 0);
  await storageService.setItem('bodega_products_v1', [{ id: 'preserved', stock: 3 }]);
  assert.equal(localStorage.getItem(key), null);
  assert.deepEqual(records.get(key), [{ id: 'preserved', stock: 3 }]);
});

test('almacenamiento real: claves de datos y timestamp respetan contexto explicito', async t => {
  const { f, records } = fakeIDB(t);
  delete f.mocks['src/utils/storageService.js'];
  const context = captureStorageContext();
  setActiveSedeId('norte');
  const { storageService } = await loadRealModule('src/utils/storageService.js', f.mocks);
  await storageService.setItem('bodega_sales_v1', [{ id: 'central' }], context);
  assert.deepEqual(records.get(getStorageKeyForContext('bodega_sales_v1', context)), [{ id: 'central' }]);
  assert.equal(records.has(getScopedStorageKey('bodega_sales_v1')), false);
  assert.ok(localStorage.getItem(getStorageKeyForContext('_sync_local_ts_bodega_sales_v1', context)));
  assert.equal(localStorage.getItem(getScopedStorageKey('_sync_local_ts_bodega_sales_v1')), null);
});
