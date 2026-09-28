import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBackup } from '../src/utils/backupSafety.js';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';
import { captureStorageContext, getStorageKeyForContext } from '../src/config/storageScope.js';

test('F08: sanitización recursiva elimina contraseña y sesiones sin mutar respaldo original', () => {
  const source = { data: { idb: { bodega_products_v1: [{ id: 'p', name: 'Producto' }] }, ls: {
    'abasto-auth-storage': JSON.stringify({ version: 3, state: { adminPassword: 'synthetic-secret', usuarios: [{ id: 3, pin: 'synthetic-pin-hash' }], usuarioActivo: { id: 1, rol: 'DUENO' } } }),
    'abasto-device-session': 'fake-session', listo_pos_active_account_id: 'other-account', farmacia_active_sede_id: 'norte',
    'farmacia-sede-storage': '{"sedeActivaId":"norte"}', 'sb-qa-auth-token': 'fake-token',
  } }, access_token: 'access-secret', nested: JSON.stringify({ refresh_token: 'refresh-secret' }) };
  const before = structuredClone(source);
  const clean = sanitizeBackup(source);
  const encoded = JSON.stringify(clean);
  for (const secret of ['synthetic-secret', 'fake-session', 'other-account', 'access-secret', 'refresh-secret', 'fake-token']) assert.ok(!encoded.includes(secret), secret);
  assert.equal(JSON.parse(clean.data.ls['abasto-auth-storage']).state.usuarios[0].pin, 'synthetic-pin-hash');
  assert.deepEqual(clean.data.idb.bodega_products_v1, [{ id: 'p', name: 'Producto' }]);
  assert.deepEqual(source, before);
});

test('F08: auth serializado inválido no se exporta como texto sin revisar', () => {
  assert.throws(() => sanitizeBackup({ 'abasto-auth-storage': '{"adminPassword":"truncated"' }), /inválida/);
});

test('respaldo real de sede excluye credenciales e incluye evidencia de cola y borrador', async t => {
  const f = createProcessorFixture(t);
  await f.seed('bodega_products_v1', [{ id: 'p', stock: 10 }]);
  const context = captureStorageContext();
  await f.storage.setItem('offline_sales_queue', [{ id: 'queued', sync_status: 'pending' }], { ...context, accountId: 'local' });
  localStorage.setItem('abasto-auth-storage', '{"state":{"adminPassword":"synthetic-secret"}}');
  localStorage.setItem('abasto-device-session', '{"id":1}');
  localStorage.setItem(getStorageKeyForContext('bodega_pending_cart_v2', context), '{"version":2,"items":[]}');
  const { collectBranchBackup } = await loadRealModule('src/services/dataBackupService.js', f.mocks);
  const backup = await collectBranchBackup();
  assert.equal(backup.context.sedeId, 'central');
  assert.equal(backup.recovery.accountOutbox[0].id, 'queued');
  assert.ok(backup.recovery.branchDraft);
  assert.ok(!JSON.stringify(backup).includes('synthetic-secret'));
  assert.ok(!('abasto-device-session' in backup.data.ls));
});

test('un respaldo sin origen válido se rechaza y no muta ningún dato', async t => {
  const f = createProcessorFixture(t);
  const { validateBranchBackup, restoreBranchBackup } = await loadRealModule('src/services/dataBackupService.js', f.mocks);
  assert.throws(() => validateBranchBackup({ version: '2.0', data: { idb: {} } }), /cuenta y sede/);
  const valid = { version: '3.0', context: captureStorageContext(), data: { idb: { bodega_sales_v1: [] }, ls: {} } };
  assert.throws(() => validateBranchBackup({ ...valid, context: { ...valid.context, sedeId: 'norte' } }), /cuenta y sede/);
  assert.throws(() => validateBranchBackup({ ...valid, data: { idb: { 'account:other:sede:central:bodega_products_v1': [] } } }), /no autorizadas/);
  // The origin guards still stop the restore before any write.
  await assert.rejects(() => restoreBranchBackup({ ...valid, context: { ...valid.context, sedeId: 'norte' } }), /cuenta y sede/);
  assert.equal(f.writes.length, 0);
});

test('un respaldo de esta sede sí restaura, y sigue excluyendo credenciales', async t => {
  const f = createProcessorFixture(t);
  const { restoreBranchBackup } = await loadRealModule('src/services/dataBackupService.js', f.mocks);
  const backup = { version: '3.0', timestamp: '2026-09-15T10:00:00.000Z', context: captureStorageContext(),
    data: { idb: { bodega_sales_v1: [{ id: 'sale-1' }] }, ls: { business_name: 'Farmacia QA' } },
    recovery: { accountOutbox: [], branchDraft: null, note: 'QA' } };
  const result = await restoreBranchBackup(backup);
  assert.equal(result.collections, 1);
  assert.deepEqual(await f.storage.getItem('bodega_sales_v1', []), [{ id: 'sale-1' }]);
  assert.equal(localStorage.getItem('business_name'), 'Farmacia QA');
  assert.equal(localStorage.getItem('abasto-device-session'), null);
  assert.equal(JSON.stringify([...f.records.entries()]).includes('synthetic-secret'), false);
});

test('recargar configuración heredada limpia adminPassword pero no restaura operador inyectado', async t => {
  const f = createProcessorFixture(t);
  delete f.mocks['src/hooks/store/useAuthStore.js'];
  localStorage.setItem('abasto-auth-storage', JSON.stringify({ version: 3, state: { adminPassword: 'synthetic-secret', usuarioActivo: { id: 1, rol: 'DUENO' }, usuarios: [{ id: 1, rol: 'DUENO', pin: '987654', pinHashed: false }] } }));
  const { useAuthStore } = await loadRealModule('src/hooks/store/useAuthStore.js', f.mocks);
  assert.equal(useAuthStore.getState().usuarioActivo, null);
  assert.ok(!JSON.stringify(useAuthStore.getState()).includes('synthetic-secret'));
  assert.ok(!localStorage.getItem('abasto-auth-storage').includes('synthetic-secret'));
  assert.equal(useAuthStore.getState().usuarios.find(u => u.id === 1).pin, '987654');
});
