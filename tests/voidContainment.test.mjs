import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';
import { captureStorageContext, setActiveAccountId, setActiveSedeId } from '../src/config/storageScope.js';

const sale = () => ({ id: 'qa-central', tipo: 'VENTA', status: 'PENDIENTE_SYNC', saleNumber: 1, totalUsd: 10, totalBs: 1000, rate: 100, huella: { sedeId: 'central' }, items: [{ id: 'p', qty: 1 }], payments: [{ methodId: 'efectivo_usd', amountUsd: 10 }] });

for (const user of [null, { id: 2, nombre: 'Caja QA', rol: 'CAJERO', sedeId: 'central' }]) {
  test(`anulacion real: sin permiso ${user?.rol || 'sin sesion'} no escribe`, async t => {
    const f = createProcessorFixture(t);
    f.user = user;
    await f.seed('bodega_sales_v1', [sale()]);
    const { processVoidSale } = await loadRealModule('src/utils/voidSaleProcessor.js', f.mocks);
    await assert.rejects(() => processVoidSale(sale(), [], []), /permiso/);
    assert.equal(f.writes.length, 0);
  });
}

test('anulacion real: origen desconocido y venta ausente se rechazan antes de escribir', async t => {
  const f = createProcessorFixture(t);
  const { processVoidSale } = await loadRealModule('src/utils/voidSaleProcessor.js', f.mocks);
  await assert.rejects(() => processVoidSale({ ...sale(), huella: null }), /sede/);
  await assert.rejects(() => processVoidSale(sale()), /encontr/);
  assert.equal(f.writes.length, 0);
});

test('anulacion real: segunda solicitud con copia antigua no duplica stock ni movimiento', async t => {
  const f = createProcessorFixture(t);
  const original = sale();
  await f.seed('bodega_sales_v1', [original]);
  await f.seed('bodega_products_v1', [{ id: 'p', stock: 9 }]);
  const { processVoidSale } = await loadRealModule('src/utils/voidSaleProcessor.js', f.mocks);
  const first = await processVoidSale(original, [], []);
  assert.equal(first.updatedProducts[0].stock, 10);
  const before = f.writes.length;
  const duplicate = await processVoidSale(original, [], []);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.reversal.id, first.reversal.id);
  assert.equal(f.writes.length, before);
  assert.equal((await f.storage.getItem('bodega_products_v1'))[0].stock, 10);
  assert.equal((await f.storage.getItem('bodega_sales_v1')).filter(s => s.tipo === 'ANULACION_VENTA').length, 1);
});

for (const dimension of ['sede', 'cuenta', 'operador']) {
  test(`anulacion real: cambio de ${dimension} durante lectura aborta sin escritura`, async t => {
    const f = createProcessorFixture(t);
    await f.seed('bodega_sales_v1', [sale()]);
    const get = f.storage.getItem;
    f.storage.getItem = async (...args) => {
      const value = await get(...args);
      if (dimension === 'sede') setActiveSedeId('norte');
      if (dimension === 'cuenta') setActiveAccountId('other-qa');
      if (dimension === 'operador') f.user = { ...f.user, id: 99 };
      return value;
    };
    const { processVoidSale } = await loadRealModule('src/utils/voidSaleProcessor.js', f.mocks);
    await assert.rejects(() => processVoidSale(sale()), /cambi/);
    assert.equal(f.writes.length, 0);
  });
}

test('anulacion real: el contexto fijado nunca escribe otra sede si cambia durante el guardado', async t => {
  const f = createProcessorFixture(t);
  await f.seed('bodega_sales_v1', [sale()]);
  await f.seed('bodega_products_v1', [{ id: 'p', stock: 9 }]);
  const put = f.storage.setItem;
  f.storage.setItem = async (...args) => {
    await put(...args);
    if (args[0] === 'bodega_sales_v1') setActiveSedeId('norte');
  };
  const { processVoidSale } = await loadRealModule('src/utils/voidSaleProcessor.js', f.mocks);
  const committed = await processVoidSale(sale());
  assert.equal(committed.updatedProducts[0].stock, 10);
  assert.equal(committed.updatedSales.filter(item => item.tipo === 'ANULACION_VENTA').length, 1);
  assert.ok(f.writes.every(w => !w.scopedKey.includes('sede:norte:')));
  assert.deepEqual(await f.storage.getItem('bodega_sales_v1', []), []);
  // Local multi-key atomicity and cross-tab concurrent voids remain phase 3/5.
});
