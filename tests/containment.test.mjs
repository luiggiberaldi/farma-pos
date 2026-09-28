import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule, saleOptions } from './helpers/realModule.mjs';

const requestBody = () => ({ total: 10, cart: [{ id: '11111111-1111-4111-8111-111111111111', qty: 1, priceUsd: 10 }], payments: [{ amountUsd: 10, methodId: 'efectivo_usd' }], fiadoUsd: 0 });
const mockResponse = () => ({ statusCode: 200, body: null, setHeader() {}, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });

test('F01: Vercel rechaza POST anonimo antes de escribir con service_role', async t => {
  const oldKey = process.env.SUPABASE_SERVICE_KEY;
  const oldUrl = process.env.VITE_SUPABASE_URL;
  const oldFetch = globalThis.fetch;
  t.after(() => { if (oldKey === undefined) delete process.env.SUPABASE_SERVICE_KEY; else process.env.SUPABASE_SERVICE_KEY = oldKey; if (oldUrl === undefined) delete process.env.VITE_SUPABASE_URL; else process.env.VITE_SUPABASE_URL = oldUrl; globalThis.fetch = oldFetch; });
  process.env.SUPABASE_SERVICE_KEY = 'synthetic-key'; process.env.VITE_SUPABASE_URL = 'https://qa.invalid';
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return Response.json({ success: true, sale_id: 'qa-sale' }); };
  const { default: handler } = await import('../api/checkout.js');
  const res = mockResponse(); await handler({ method: 'POST', headers: {}, body: requestBody() }, res);
  assert.equal(res.statusCode, 401); assert.equal(calls.length, 0);
});

test('F01: Worker rechaza POST anonimo antes de escribir con service_role', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  const calls = []; globalThis.fetch = async (url, opts) => { calls.push({ url, opts }); return Response.json({ success: true, sale_id: 'qa-sale' }); };
  const { default: worker } = await import('../src/worker.js');
  const response = await worker.fetch(new Request('https://app.qa.invalid/api/checkout', { method: 'POST', body: JSON.stringify(requestBody()), headers: { 'Content-Type': 'application/json' } }), { SUPABASE_URL: 'https://qa.invalid', SUPABASE_SERVICE_KEY: 'synthetic-key' });
  assert.equal(response.status, 401); assert.equal(calls.length, 0);
});

test('F01: JWT de cuenta valido no prueba rol/sede de operador; endpoint queda cerrado', async t => {
  const old = globalThis.fetch; t.after(() => { globalThis.fetch = old; });
  const calls = []; globalThis.fetch = async (url, options) => { calls.push({ url: String(url), method: options?.method || 'GET' }); return Response.json(String(url).endsWith('/auth/v1/user') ? { id: 'account-qa' } : { success: true, sale_id: 'qa-sale' }); };
  const { default: worker } = await import('../src/worker.js');
  const response = await worker.fetch(new Request('https://app.qa.invalid/api/checkout', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer synthetic-token' }, body: JSON.stringify({ ...requestBody(), rol: 'DUENO', sedeId: 'central' }) }), { SUPABASE_URL: 'https://qa.invalid', SUPABASE_SERVICE_KEY: 'synthetic-key' });
  assert.equal(response.status, 403);
  assert.ok(calls.every(c => c.method === 'GET' && c.url === 'https://qa.invalid/auth/v1/user'));
});

test('F14: procesador real rechaza vuelto doble antes de tocar cola o stock', async t => {
  const f = createProcessorFixture(t);
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks, { dev: true });
  const r = await processSaleTransaction(saleOptions({ payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 20 }], changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 1000 } }));
  assert.equal(r.success, false); assert.equal(f.queued.length, 0); assert.equal(f.writes.length, 0);
});

test('F03: venta de otra sede se rechaza aunque caller entregue su historial', async t => {
  const f = createProcessorFixture(t);
  const central = { id: 'central-sale', tipo: 'VENTA', totalUsd: 10, huella: { sedeId: 'central' }, items: [], payments: [] };
  const north = { ...central, id: 'north-sale', huella: { sedeId: 'norte' } };
  await f.seed('bodega_sales_v1', [central]);
  const { processVoidSale } = await loadRealModule('src/utils/voidSaleProcessor.js', f.mocks);
  await assert.rejects(() => processVoidSale(north, [north], []), /sede/i);
  assert.equal(f.writes.length, 0);
  assert.deepEqual(await f.storage.getItem('bodega_sales_v1'), [central]);
});

test('F03: anulacion usa la venta y productos persistidos, no listas de otra consulta', async t => {
  const f = createProcessorFixture(t);
  const sale = { id: 'central-sale', tipo: 'VENTA', totalUsd: 10, status: 'COMPLETADA', huella: { sedeId: 'central' }, items: [{ id: 'p', qty: 1 }], payments: [] };
  const extra = { ...sale, id: 'other-central-sale', items: [] };
  await f.seed('bodega_sales_v1', [sale, extra]); await f.seed('bodega_products_v1', [{ id: 'p', stock: 9 }]);
  const { processVoidSale } = await loadRealModule('src/utils/voidSaleProcessor.js', f.mocks);
  const r = await processVoidSale({ ...sale, totalUsd: 999 }, [sale], [{ id: 'p', stock: 999 }]);
  assert.ok(r.updatedSales.some(x => x.id === extra.id)); assert.equal(r.updatedSales[0].totalUsd, -10); assert.equal(r.updatedProducts[0].stock, 10);
});

test('F22: rechazo HTTP no puede convertirse en venta offline confirmada', async t => {
  const f = createProcessorFixture(t);
  // Test-only adapter override exercises the transport path while release containment stays on.
  f.mocks['src/config/operationSafety.js'] = 'export const REMOTE_OPERATIONS_PAUSED = false; export const CLOUD_PAUSE_MESSAGE = "test";';
  globalThis.fetch = async () => Response.json({ error: 'Forbidden' }, { status: 403 });
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
  const r = await processSaleTransaction(saleOptions());
  assert.equal(r.success, false); assert.equal(f.queued.length, 0); assert.equal(f.writes.length, 0);
});

test('F02: push cloud legado queda pausado sin crear timers ni escribir', async t => {
  const f = createProcessorFixture(t);
  f.mocks['src/config/supabaseCloud.js'] = 'export const supabaseCloud = { auth: { getSession: async () => { throw new Error("unexpected cloud read"); } } };';
  const { pushCloudSync } = await loadRealModule('src/hooks/useCloudSync.js', f.mocks);
  const result = await pushCloudSync('bodega_products_v1', [{ id: 'p', stock: 10 }], true);
  assert.equal(result?.status, 'paused');
});

test('F02: exportar un backup legado no puede repoblar documentos cloud sin sede', async t => {
  const f = createProcessorFixture(t);
  f.mocks['src/config/supabaseCloud.js'] = 'export const supabaseCloud = { from: () => { throw new Error("unexpected cloud write"); } };';
  const { uploadBackupToCloud } = await loadRealModule('src/hooks/useCloudAuthLogic.js', f.mocks);
  await assert.rejects(() => uploadBackupToCloud('qa@example.invalid', { data: { idb: { bodega_products_v1: [{ id: 'p' }] } } }), /pausad/i);
});
