import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule, saleOptions } from './helpers/realModule.mjs';
import { setActiveSedeId } from '../src/config/storageScope.js';

const SEDES = ['central', 'norte', 'sur'];

for (const sede of SEDES) {
  test(`checkout real ${sede}: exacto, mixto, fiado y vuelto quedan locales y separados`, async t => {
    const f = createProcessorFixture(t);
    setActiveSedeId(sede);
    const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
    const customer = { id: 'customer-qa', name: 'Cliente QA', deuda: 0, saldo_favor: 0 };
    const scenarios = [
      {},
      { payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 5 }, { methodId: 'efectivo_bs', currency: 'BS', amountUsd: 5, amountBs: 500 }] },
      { payments: [{ methodId: 'efectivo_usd', amountUsd: 4 }], customers: [customer], selectedCustomerId: customer.id },
      { payments: [{ methodId: 'efectivo_usd', amountUsd: 20 }], changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 0 } },
      { payments: [{ methodId: 'efectivo_usd', amountUsd: 20 }], changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 1000 } },
      { payments: [{ methodId: 'efectivo_usd', amountUsd: 20 }], changeBreakdown: { changeUsdGiven: 4, changeBsGiven: 600 } },
    ];
    let products = saleOptions().products;
    await f.seed('bodega_products_v1', products);
    await f.seed('bodega_customers_v1', [customer]);
    const results = [];
    for (const scenario of scenarios) {
      const result = await processSaleTransaction(saleOptions({ ...scenario, products }));
      assert.equal(result.success, true, result.error);
      assert.equal(result.sale.huella.sedeId, sede);
      assert.equal(result.sale.status, 'PENDIENTE_SYNC');
      assert.equal(result.syncMode, 'offline');
      products = result.updatedProducts;
      results.push(result);
    }
    assert.equal(products[0].stock, 4);
    assert.equal(results[2].sale.fiadoUsd, 6);
    assert.equal(results[2].updatedCustomers[0].deuda, 6);
    assert.deepEqual(results.slice(3).map(r => [r.sale.changeUsd, r.sale.changeBs]), [[10, 0], [0, 1000], [4, 600]]);
    assert.equal(f.queued.length, scenarios.length);
    assert.equal((await f.storage.getItem('bodega_sales_v1')).length, scenarios.length);
    for (const other of SEDES.filter(s => s !== sede)) {
      setActiveSedeId(other);
      assert.deepEqual(await f.storage.getItem('bodega_sales_v1', []), []);
      assert.deepEqual(await f.storage.getItem('bodega_products_v1', []), []);
    }
  });
}

test('checkout real: entradas invalidas se rechazan antes de cola y persistencia', async t => {
  const f = createProcessorFixture(t);
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
  const product = saleOptions().cart[0];
  const invalid = [
    { cart: [] }, { cart: null }, { payments: [] }, { payments: null }, { payments: [null] },
    { payments: [{ amountUsd: Infinity }] }, { payments: [{ amountUsd: NaN }] }, { payments: [{ amountUsd: -1 }] },
    { cart: [{ ...product, qty: -1 }] }, { cart: [{ ...product, qty: Infinity }] },
    { cart: [{ ...product, priceUsd: NaN }] }, { cartTotalUsd: NaN }, { cartTotalUsd: Infinity },
    { cart: [{ ...product, isControlled: true }] },
    { payments: [{ amountUsd: 20 }], changeBreakdown: undefined },
    { payments: [{ amountUsd: 20 }], changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 1000 } },
  ];
  for (const options of invalid) {
    const result = await processSaleTransaction(saleOptions(options));
    assert.equal(result.success, false, `Expected rejection: ${JSON.stringify(options)}`);
  }
  assert.equal(f.queued.length, 0);
  assert.equal(f.writes.length, 0);
});

test('checkout real: fallo al persistir no devuelve confirmacion de venta', async t => {
  const f = createProcessorFixture(t);
  await f.seed('bodega_products_v1', saleOptions().products);
  f.storage.setItem = async () => { throw new Error('Synthetic storage failure'); };
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);
  await assert.rejects(() => processSaleTransaction(saleOptions()), /Synthetic storage failure/);
  // No outbox entry or partial sale survives an aborted transaction.
  assert.equal(f.queued.length, 0);
  assert.deepEqual(await f.storage.getItem('bodega_sales_v1', []), []);
});
