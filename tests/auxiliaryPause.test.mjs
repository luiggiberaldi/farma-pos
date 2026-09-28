import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';

test('pausa cloud: auditoria queda local y no avanza cursor de sincronizacion', async t => {
  const f = createProcessorFixture(t);
  delete f.mocks['src/services/auditService.js'];
  f.mocks['src/config/supabaseCloud.js'] = 'export const supabaseCloud = new Proxy({}, { get() { throw new Error("unexpected cloud access"); } });';
  const mod = await loadRealModule('src/services/auditService.js', f.mocks);
  await mod.logEvent('VENTA', 'QA', 'Evento sintetico', f.user);
  assert.equal((await mod.syncAuditToCloud('qa@example.invalid', 'qa-device')).status, 'paused');
  assert.equal((await f.storage.getItem('abasto_audit_log_v1')).length, 1);
  assert.equal(localStorage.getItem('abasto_audit_sync_cursor'), null);
  await assert.rejects(() => mod.getCloudAuditLog(), /pausad/);
});

test('pausa cloud: alertas no se suben ni se marcan como enviadas', async t => {
  const f = createProcessorFixture(t);
  delete f.mocks['src/services/notificationService.js'];
  f.mocks['src/config/supabaseCloud.js'] = 'export const supabaseCloud = new Proxy({}, { get() { throw new Error("unexpected cloud access"); } });';
  const mod = await loadRealModule('src/services/notificationService.js', f.mocks);
  mod.createNotification(mod.NOTIF_TYPES.VENTA_ANULADA, 'QA', 'Solo datos sinteticos');
  const before = mod.getNotifications();
  assert.equal((await mod.syncNotificationsToCloud('qa@example.invalid', 'qa-device')).status, 'paused');
  assert.deepEqual(mod.getNotifications(), before);
  assert.equal(before.length, 1);
  assert.notEqual(before[0].synced, true);
});

test('pausa cloud: inyector hibrido no salta el checkout mediante RPC directo', async t => {
  const f = createProcessorFixture(t);
  f.cloud.rpc = () => { throw new Error('unexpected RPC'); };
  const { injectHybridFlowSales } = await loadRealModule('src/testing/hybridFlowInjector.js', f.mocks);
  const result = await injectHybridFlowSales();
  assert.equal(result.status, 'paused');
  assert.equal(result.successCount, 0);
  assert.equal(result.mode, 'paused');
  assert.equal(f.queued.length, 0);
  assert.equal(f.writes.length, 0);
});
