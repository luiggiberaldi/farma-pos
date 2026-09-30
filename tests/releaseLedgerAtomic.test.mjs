import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicIndexedDb } from '../src/services/atomicIndexedDb.js';
import { captureStorageContext, getStorageKeyForContext, setActiveAccountId, setActiveSedeId } from '../src/config/storageScope.js';
import { createProcessorFixture, loadRealModule, saleOptions } from './helpers/realModule.mjs';

const require = createRequire(import.meta.url);
let IDBFactory;
try { ({ IDBFactory } = require('fake-indexeddb')); }
catch { ({ IDBFactory } = require(join(homedir(), '.workbuddy-ai/binaries/node/workspace/node_modules/fake-indexeddb'))); }
const SALES = 'bodega_sales_v1', PRODUCTS = 'bodega_products_v1', CUSTOMERS = 'bodega_customers_v1', LOTS = 'farmacia_lotes_v1', QUEUE = 'offline_sales_queue';
const today = '2026-09-15';
const opening = id => ({ id, tipo: 'APERTURA_CAJA', openingUsd: 20, openingBs: 1000, fechaComercial: today, timestamp: `${today}T08:00:00-04:00`, sedeId: 'central' });
const customer = { id: 'customer-atomic', name: 'Synthetic customer', documentId: 'TEST-DOCUMENT', deuda: 0, favor: 0, casheaDeuda: 0 };
const options = extra => saleOptions({ operationId: 'sale-ledger-atomic', businessDate: today, ...extra });
const clone = value => structuredClone(value);

async function fixture(t) {
    const f = createProcessorFixture(t);
    setActiveAccountId('ledger-account'); setActiveSedeId('central');
    const native = { indexedDBFactory: new IDBFactory(), databaseName: 'ledger-qa', storeName: 'data' };
    // Use the production IndexedDB implementation, not a sequential Map transaction.
    f.storage.transaction = (records, planner, context = captureStorageContext()) => atomicIndexedDb(records.map(record => ({
        ...record, key: getStorageKeyForContext(record.key, record.context || context),
    })), state => {
        const plan = planner(state);
        if (f.injectFailure && Object.keys(plan.writes).length) plan.writes.queue = [() => 'uncloneable'];
        return plan;
    }, native);
    f.storage.getItem = (key, fallback = null, context = captureStorageContext()) => atomicIndexedDb([
        { name: 'value', key: getStorageKeyForContext(key, context), fallback },
    ], state => ({ writes: {}, result: state.value }), native);
    f.storage.setItem = (key, value, context = captureStorageContext()) => atomicIndexedDb([
        { name: 'value', key: getStorageKeyForContext(key, context), fallback: null },
    ], () => ({ writes: { value } }), native);
    f.seed = (key, value, context) => f.storage.setItem(key, clone(value), context);
    f.read = (key, context) => f.storage.getItem(key, [], context);
    f.mod = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks, { exportsFrom: [
        'src/utils/voidSaleProcessor.js', 'src/utils/transferenciaService.js', 'src/utils/customerTransactionProcessor.js',
        'src/utils/closureService.js', 'src/utils/reportsProcessor.js', 'src/core/FinancialEngine.js', 'src/utils/productProcessor.js', 'src/utils/localAdminOperations.js', 'src/utils/dinero.js',
    ] });
    await f.seed(PRODUCTS, saleOptions().products); await f.seed(CUSTOMERS, [customer]);
    return f;
}

for (const failCollection of [false, true]) {
    test(`checkout native IDB ${failCollection ? 'aborts every collection on serialization failure' : 'commits sale, stock and outbox together'}`, async t => {
        const f = await fixture(t); f.injectFailure = failCollection;
        if (failCollection) await assert.rejects(f.mod.processSaleTransaction(options()));
        else assert.equal((await f.mod.processSaleTransaction(options())).success, true);
        assert.equal((await f.read(PRODUCTS))[0].stock, failCollection ? 10 : 9);
        assert.equal((await f.read(SALES)).length, failCollection ? 0 : 1);
        assert.equal((await f.read(QUEUE)).length, failCollection ? 0 : 1);
        assert.equal((await f.read('abasto_audit_log_v1')).length, failCollection ? 0 : 1);
    });
}

test('two checkout connections cannot sell the last unit twice', async t => {
    const f = await fixture(t); await f.seed(PRODUCTS, [{ ...saleOptions().products[0], stock: 1 }]);
    const results = await Promise.all(['last-unit-one', 'last-unit-two'].map(operationId => f.mod.processSaleTransaction(options({ operationId }))));
    assert.equal(results.filter(result => result.success).length, 1);
    assert.equal((await f.read(PRODUCTS))[0].stock, 0); assert.equal((await f.read(SALES)).length, 1); assert.equal((await f.read(QUEUE)).length, 1);
});

test('simultaneous identical operation IDs return one immutable sale and one outbox entry', async t => {
    const f = await fixture(t);
    const results = await Promise.all([f.mod.processSaleTransaction(options()), f.mod.processSaleTransaction(options())]);
    assert.ok(results.every(result => result.success)); assert.equal(results.filter(result => result.duplicate).length, 1);
    assert.equal(results[0].sale.id, results[1].sale.id); assert.equal((await f.read(PRODUCTS))[0].stock, 9); assert.equal((await f.read(QUEUE)).length, 1);
});

test('operation ID conflict within a sale never writes a second version', async t => {
    const f = await fixture(t); const initial = await f.mod.processSaleTransaction(options()); assert.equal(initial.success, true);
    const changed = options({ payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 20 }], changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 0 } });
    const result = await f.mod.processSaleTransaction(changed); assert.equal(result.success, false); assert.match(result.error, /idempotencia/);
    assert.equal((await f.read(QUEUE)).length, 1); assert.equal((await f.read(PRODUCTS))[0].stock, 9);
});

test('account-global operation IDs cannot be reused in another branch', async t => {
    const f = await fixture(t); assert.equal((await f.mod.processSaleTransaction(options())).success, true);
    setActiveSedeId('norte'); await f.seed(PRODUCTS, saleOptions().products);
    const result = await f.mod.processSaleTransaction(options()); assert.equal(result.success, false); assert.match(result.error, /idempotencia/);
    assert.equal((await f.read(PRODUCTS))[0].stock, 10); assert.equal((await f.read(SALES)).length, 0); assert.equal((await f.read(QUEUE)).length, 1);
});

test('an ID owned by a customer movement cannot become a sale', async t => {
    const f = await fixture(t);
    await f.mod.processCustomerTransaction({ type: 'ABONO', customer, transactionAmount: '10', currencyMode: 'USD', bcvRate: 100, operationId: 'sale-ledger-atomic' });
    const result = await f.mod.processSaleTransaction(options()); assert.equal(result.success, false);
    assert.equal((await f.read(PRODUCTS))[0].stock, 10); assert.equal((await f.read(QUEUE)).length, 1);
});

test('sale fractional unit prices survive snapshot and line-total calculation', async t => {
    const f = await fixture(t); const product = { ...saleOptions().products[0], priceUsd: 0.125, costUsd: 0 };
    await f.seed(PRODUCTS, [product]);
    const result = await f.mod.processSaleTransaction(options({ cart: [{ ...product, qty: 3 }], cartTotalUsd: 0.38, cartSubtotalUsd: 0.38, cartTotalBs: 38,
        payments: [{ methodId: 'efectivo_bs', currency: 'BS', amount: 38 }] }));
    assert.equal(result.success, true, result.error); assert.equal(result.sale.items[0].priceUsd, 0.125); assert.equal(result.sale.totalUsd, 0.38);
});

test('recorded Bs-only cost is preserved and zero-cost USD does not mask it', async t => {
    const f = await fixture(t); const product = { ...saleOptions().products[0], costUsd: undefined, costBs: 400 };
    await f.seed(PRODUCTS, [product]); const result = await f.mod.processSaleTransaction(options());
    assert.equal(result.success, true, result.error); assert.equal(result.sale.items[0].costUsd, null);
    assert.equal(f.mod.FinancialEngine.calculateSaleProfit(result.sale, 100, []), 600);
});

for (const change of ['price', 'stock', 'expired', 'removed']) {
    test(`persisted ${change} rejection wins over stale caller inventory`, async t => {
        const f = await fixture(t); const product = saleOptions().products[0];
        await f.seed(PRODUCTS, change === 'removed' ? [] : [{ ...product, ...(change === 'price' ? { priceUsd: 12 } : change === 'stock' ? { stock: 0 } : { vencimiento: '2000-01-01' }) }]);
        const result = await f.mod.processSaleTransaction(options()); assert.equal(result.success, false, change);
        assert.deepEqual(await f.read(SALES), []); assert.deepEqual(await f.read(QUEUE), []);
    });
}

test('prescription uses persisted product restrictions and customer evidence', async t => {
    const f = await fixture(t); await f.seed(PRODUCTS, [{ ...saleOptions().products[0], isControlled: true, requiresPrescription: true }]);
    const noEvidence = await f.mod.processSaleTransaction(options()); assert.equal(noEvidence.success, false);
    const result = await f.mod.processSaleTransaction(options({ selectedCustomerId: customer.id, prescription: { reference: 'QA-REF', prescriber: 'Synthetic prescriber', confirmed: true } }));
    assert.equal(result.success, true, result.error); assert.equal((await f.read('farmacia_controlados_v1')).length, 1);
    assert.equal(result.sale.prescription.verifiedBy, f.user.id);
});

async function packageSale(f) {
    const base = saleOptions().products[0];
    const product = { ...base, priceUsd: 10, packagingType: 'lote', unit: 'paquete', stockUnit: 'base', stock: 25, unitsPerPackage: 10, sellByUnit: true, unitPriceUsd: 1, tracksLots: true };
    const lots = [{ id: 'lot-first', productoId: product.id, numeroLote: 'QA-A', cantidad: 11, vencimiento: '2090-01-01' }, { id: 'lot-second', productoId: product.id, numeroLote: 'QA-B', cantidad: 14, vencimiento: '2091-01-01' }];
    await f.seed(PRODUCTS, [product]); await f.seed(LOTS, lots);
    const cart = [{ ...product, qty: 1, _mode: 'package' }, { id: `${product.id}_unit`, _originalId: product.id, priceUsd: 1, qty: 2, _mode: 'unit' }];
    const result = await f.mod.processSaleTransaction(options({ cart, cartTotalUsd: 12, cartSubtotalUsd: 12, cartTotalBs: 1200, selectedCustomerId: customer.id, payments: [{ methodId: 'efectivo_usd', currency: 'USD', amount: 4 }] }));
    assert.equal(result.success, true, result.error); return { ...result, product, lots };
}

test('package and fractional checkout consumes 12 base units and exact FEFO allocations', async t => {
    const f = await fixture(t); const result = await packageSale(f);
    assert.deepEqual(result.sale.items.map(item => item.quantityBase), [10, 2]); assert.equal(result.updatedProducts[0].stock, 13);
    assert.deepEqual(result.sale.lotesConsumidos.map(item => [item.loteId, item.cantidad]), [['lot-first', 11], ['lot-second', 1]]);
});

for (const branch of ['central', 'norte', 'sur']) {
    test(`final ${branch} sale and reversal preserve the other two branches`, async t => {
        const f = await fixture(t);
        const otherBranches = ['central', 'norte', 'sur'].filter(id => id !== branch);
        const context = sedeId => ({ accountId: 'ledger-account', sedeId });
        for (const other of otherBranches) {
            await f.seed(PRODUCTS, [{ ...saleOptions().products[0], stock: 77 }], context(other));
        }
        setActiveSedeId(branch);
        // El cliente debe existir en la sede activa (ahora los clientes son por sede)
        await f.seed(CUSTOMERS, [customer], context(branch));
        const sold = await packageSale(f);
        assert.equal(sold.sale.sedeId, branch);
        assert.equal(sold.sale.huella.sedeId, branch);
        assert.equal((await f.read(PRODUCTS))[0].stock, 13);
        const reversed = await f.mod.processVoidSale(sold.sale);
        assert.equal(reversed.reversal.sedeId, branch);
        assert.equal((await f.read(PRODUCTS))[0].stock, 25);
        assert.deepEqual((await f.read(LOTS)).map(lot => lot.cantidad), [11, 14]);
        for (const other of otherBranches) {
            assert.equal((await f.read(PRODUCTS, context(other)))[0].stock, 77);
            assert.deepEqual(await f.read(SALES, context(other)), []);
        }
        assert.equal((await f.read(QUEUE)).length, 2);
    });
}

test('two native void requests restore stock and exact lots only once after a partial collection', async t => {
    const f = await fixture(t); const sold = await packageSale(f);
    await f.mod.processCustomerTransaction({ type: 'ABONO', customer, transactionAmount: '3', currencyMode: 'USD', bcvRate: 100, operationId: 'collected-once' });
    const results = await Promise.all([f.mod.processVoidSale(sold.sale), f.mod.processVoidSale(sold.sale)]);
    assert.equal(results.filter(result => result.duplicate).length, 1);
    assert.equal((await f.read(PRODUCTS))[0].stock, 25); assert.deepEqual((await f.read(LOTS)).map(lot => lot.cantidad), [11, 14]);
    const current = (await f.read(CUSTOMERS))[0]; assert.equal(current.deuda, 0); assert.equal(current.favor, 3);
    const rows = await f.read(SALES); assert.equal(rows.filter(row => row.tipo === 'ANULACION_VENTA').length, 1);
    const report = f.mod.calculateReportsData(rows, '2000-01-01', '2099-01-01', 100, []);
    assert.equal(report.totalUsd, 0); assert.equal(report.profit, 0); assert.equal(report.salesCount, 0);
    assert.equal((await f.read(QUEUE)).length, 3);
});

for (const corruption of ['quantity', 'lots', 'product', 'lot-expiry', 'sum']) {
    test(`void rejects ${corruption} trace inconsistency without any partial restore`, async t => {
        const f = await fixture(t); const result = await packageSale(f); const rows = await f.read(SALES);
        if (corruption === 'quantity') delete rows[0].items[0].quantityBase;
        if (corruption === 'lots') rows[0].lotesConsumidos = [];
        if (corruption === 'product') rows[0].lotesConsumidos[0].productoId = 'wrong-product';
        if (corruption === 'lot-expiry') rows[0].lotesConsumidos[0].vencimiento = '2095-01-01';
        if (corruption === 'sum') rows[0].lotesConsumidos[0].cantidad = 10;
        await f.seed(SALES, rows); const before = await Promise.all([f.read(PRODUCTS), f.read(LOTS), f.read(CUSTOMERS), f.read(QUEUE)]);
        await assert.rejects(f.mod.processVoidSale(result.sale), /conciliaci|inválid/);
        assert.deepEqual(await Promise.all([f.read(PRODUCTS), f.read(LOTS), f.read(CUSTOMERS), f.read(QUEUE)]), before);
    });
}

test('void serialization abort preserves original ledger and balances', async t => {
    const f = await fixture(t); const result = await packageSale(f); const before = await Promise.all([f.read(SALES), f.read(PRODUCTS), f.read(LOTS), f.read(CUSTOMERS), f.read(QUEUE)]);
    f.injectFailure = true; await assert.rejects(f.mod.processVoidSale(result.sale)); f.injectFailure = false;
    assert.deepEqual(await Promise.all([f.read(SALES), f.read(PRODUCTS), f.read(LOTS), f.read(CUSTOMERS), f.read(QUEUE)]), before);
});

test('Cashea settled elsewhere requires reconciliation rather than silently clipping its reversal', async t => {
    const f = await fixture(t); const result = await f.mod.processSaleTransaction(options({ selectedCustomerId: customer.id,
        payments: [{ methodId: 'cashea', currency: 'USD', amount: 10 }] }));
    assert.equal(result.success, true); await f.seed(CUSTOMERS, [{ ...customer, casheaDeuda: 0 }]);
    await assert.rejects(f.mod.processVoidSale(result.sale), /Cashea/);
    assert.equal((await f.read(PRODUCTS))[0].stock, 9); assert.equal((await f.read(SALES)).length, 1);
});

async function sentTransfer(f) {
    const product = { ...saleOptions().products[0], tracksLots: true };
    await f.seed(PRODUCTS, [product]); await f.seed(LOTS, [{ id: 'transfer-lot', productoId: product.id, cantidad: 10, numeroLote: 'T-QA', vencimiento: '2090-01-01' }]);
    const result = await f.mod.enviarTransferencia({ operationId: 'transfer-native-01', destinoId: 'norte', items: [{ productoId: product.id, cantidad: 3 }] });
    return { ...result, product };
}

test('receive and stale cancellation serialize to exactly one branch stock outcome, preserving destination prices', async t => {
    const f = await fixture(t); const sent = await sentTransfer(f);
    setActiveSedeId('norte'); await f.seed(PRODUCTS, [{ ...sent.product, stock: 1, priceUsd: 17 }]);
    const received = await f.mod.recibirTransferencia({ transferencia: sent.transferencia });
    const duplicate = await f.mod.recibirTransferencia({ transferencia: sent.transferencia }); assert.equal(duplicate.duplicate, true);
    assert.equal(received.updatedProducts[0].stock, 4); assert.equal(received.updatedProducts[0].priceUsd, 17);
    assert.equal((await f.read(LOTS))[0].cantidad, 3);
    setActiveSedeId('central'); await assert.rejects(f.mod.cancelarTransferencia({ transferencia: sent.transferencia }), /procesada/);
    assert.equal((await f.read(PRODUCTS))[0].stock, 7); assert.equal((await f.read(LOTS))[0].cantidad, 7);
});

test('receive never invents missing destination catalogue or prices', async t => {
    const f = await fixture(t); const sent = await sentTransfer(f); setActiveSedeId('norte');
    await assert.rejects(f.mod.recibirTransferencia({ transferencia: sent.transferencia }), /producto|precios/);
    assert.deepEqual(await f.read(PRODUCTS), []); assert.equal((await f.read('farmacia_transferencias_v1'))[0].estado, 'ENVIADA');
});

test('cancellation and repeated cancellation restore exact origin stock once', async t => {
    const f = await fixture(t); const sent = await sentTransfer(f);
    await f.mod.cancelarTransferencia({ transferencia: sent.transferencia });
    assert.equal((await f.mod.cancelarTransferencia({ transferencia: sent.transferencia })).duplicate, true);
    assert.equal((await f.read(PRODUCTS))[0].stock, 10); assert.equal((await f.read(LOTS))[0].cantidad, 10);
    assert.equal((await f.read(QUEUE)).length, 2);
});

test('transfer send retry with same ID never subtracts stock again', async t => {
    const f = await fixture(t); const sent = await sentTransfer(f);
    const again = await f.mod.enviarTransferencia({ operationId: sent.transferencia.id, destinoId: 'norte', items: [{ productoId: sent.product.id, cantidad: 3 }] });
    assert.equal(again.duplicate, true); assert.equal((await f.read(PRODUCTS))[0].stock, 7); assert.equal((await f.read(QUEUE)).length, 1);
});

test('replaying an old cash close after same-day reopening never closes the new shift', async t => {
    const f = await fixture(t); await f.seed(SALES, [opening('opening-one')]);
    const request = { fechaComercial: today, tasaBcv: 100, cashSessionId: 'opening-one', reconData: { declaredUsd: 20 } };
    const closed = await f.mod.commitNormalClosure(request);
    await f.seed(SALES, [...closed.updatedSales, opening('opening-two')]);
    const replay = await f.mod.commitNormalClosure(request); assert.equal(replay.duplicate, true);
    assert.equal(replay.closure.operationId, closed.closure.operationId); assert.equal((await f.read(SALES)).find(row => row.id === 'opening-two').cajaCerrada, undefined);
    await assert.rejects(f.mod.commitNormalClosure({ ...request, reconData: { declaredUsd: 25 } }), /otro conteo/);
    assert.equal((await f.read('bodega_cierres_v1')).length, 1); assert.equal((await f.read(QUEUE)).length, 1);
});

test('close requires exact shift and leaves every collection unchanged on storage failure', async t => {
    const f = await fixture(t); await f.seed(SALES, [opening('opening-one')]);
    await assert.rejects(f.mod.commitNormalClosure({ fechaComercial: today, tasaBcv: 100, cashSessionId: 'opening-absent' }), /caja cambió/);
    f.injectFailure = true; await assert.rejects(f.mod.commitNormalClosure({ fechaComercial: today, tasaBcv: 100, cashSessionId: 'opening-one' })); f.injectFailure = false;
    assert.equal((await f.read(SALES))[0].cajaCerrada, undefined); assert.deepEqual(await f.read('bodega_cierres_v1'), []); assert.deepEqual(await f.read(QUEUE), []);
});

test('rounding is symmetric for half-cent reversals', async t => {
    const f = await fixture(t);
    for (const value of [0.005, 1.005, 2.675, 0.375]) assert.equal(f.mod.round2(value) + f.mod.round2(-value), 0);
    assert.equal(f.mod.round2(-1.005), -1.01);
});

test('fractional-price sale plus reversal cancels profit exactly', async t => {
    const f = await fixture(t); const product = { ...saleOptions().products[0], priceUsd: 0.125, costUsd: 0 };
    await f.seed(PRODUCTS, [product]);
    const sold = await f.mod.processSaleTransaction(options({ cart: [{ ...product, priceUsd: 0.125, qty: 3 }], cartTotalUsd: 0.38, cartSubtotalUsd: 0.38, cartTotalBs: 38,
        payments: [{ methodId: 'efectivo_bs', currency: 'BS', amount: 38 }] }));
    assert.equal(sold.success, true, sold.error); await f.mod.processVoidSale(sold.sale);
    const report = f.mod.calculateReportsData(await f.read(SALES), '2000-01-01', '2099-01-01', 100, []);
    assert.equal(report.profit, 0); assert.equal(report.totalUsd, 0);
});

test('admin supplier invoice and outgoing payment persist debt, native tender, audit and queue together', async t => {
    const f = await fixture(t); await f.seed('bodega_suppliers_v1', [{ id: 'supplier-qa', name: 'Synthetic supplier', deuda: 5 }]);
    const invoice = { id: 'invoice-qa', supplierId: 'supplier-qa', amountUsd: 10 };
    const result = await f.mod.processLocalAdminOperation('SUPPLIER_INVOICE', { invoice, operationId: 'supplier-invoice-qa' });
    assert.equal(result.suppliers[0].deuda, 15); assert.equal(result.invoices.length, 1);
    const request = { supplierId: 'supplier-qa', payment: { methodId: 'efectivo_bs', currency: 'BS', amount: 500 }, rate: 100, operationId: 'supplier-payment-qa' };
    const paid = await f.mod.processLocalAdminOperation('SUPPLIER_PAYMENT', request);
    assert.equal(paid.suppliers[0].deuda, 10); assert.equal(paid.record.payments[0].amount, -500); assert.equal(paid.record.totalUsd, -5);
    assert.equal((await f.mod.processLocalAdminOperation('SUPPLIER_PAYMENT', request)).duplicate, true);
    assert.equal((await f.read(QUEUE)).length, 2);
});

test('supplier storage failure and overpayment never change debt or ledger', async t => {
    const f = await fixture(t); await f.seed('bodega_suppliers_v1', [{ id: 'supplier-qa', name: 'Synthetic supplier', deuda: 5 }]);
    const request = { supplierId: 'supplier-qa', payment: { methodId: 'efectivo_usd', currency: 'USD', amount: 10 }, rate: 100 };
    await assert.rejects(f.mod.processLocalAdminOperation('SUPPLIER_PAYMENT', request), /deuda/);
    f.injectFailure = true;
    await assert.rejects(f.mod.processLocalAdminOperation('SUPPLIER_PAYMENT', { ...request, payment: { ...request.payment, amount: 2 } })); f.injectFailure = false;
    assert.equal((await f.read('bodega_suppliers_v1'))[0].deuda, 5); assert.deepEqual(await f.read(SALES), []); assert.deepEqual(await f.read(QUEUE), []);
});

test('lot registration assigns existing stock and lot adjustment changes aggregate stock atomically', async t => {
    const f = await fixture(t); const productId = saleOptions().products[0].id;
    const lot = await f.mod.processLocalAdminOperation('ADD_LOT', { productId, quantity: 10, number: 'BATCH-QA', expiry: '2090-01-01', operationId: 'lot-registered-qa' });
    assert.equal(lot.products[0].stock, 10); assert.equal(lot.lots[0].cantidad, 10);
    await assert.rejects(f.mod.processLocalAdminOperation('ADJUST_STOCK', { productId, delta: -1 }), /lote/);
    const adjusted = await f.mod.processLocalAdminOperation('SET_LOT', { productId, lotId: lot.lots[0].id, quantity: 8, expectedQuantity: 10 });
    assert.equal(adjusted.products[0].stock, 8); assert.equal(adjusted.lots[0].cantidad, 8); assert.equal(adjusted.sales[0].delta, -2);
    await assert.rejects(f.mod.processLocalAdminOperation('SET_LOT', { productId, lotId: lot.lots[0].id, quantity: 6, expectedQuantity: 10 }), /cambió/);
});

test('manual reconciliation is signed evidence, not a fabricated sale or cash receipt', async t => {
    const f = await fixture(t); await f.seed(CUSTOMERS, [{ ...customer, deuda: 5 }]);
    const result = await f.mod.processLocalAdminOperation('CUSTOMER_ADJUSTMENT', { customerId: customer.id, action: 'TO_CASHEA', expectedBalances: [5, 0, 0] });
    assert.equal(result.customers[0].deuda, 0); assert.equal(result.customers[0].casheaDeuda, 5); assert.equal(result.record.tipo, 'AJUSTE_CREDITO');
    const report = f.mod.calculateReportsData(await f.read(SALES), '2000-01-01', '2099-01-01', 100, []);
    assert.equal(report.salesCount, 0); assert.equal(report.totalUsd, 0); assert.deepEqual(report.paymentBreakdown, {});
});

test('customer collection replays once and remains separate from sales revenue', async t => {
    const f = await fixture(t); await f.seed(CUSTOMERS, [{ ...customer, deuda: 5 }]);
    const request = { type: 'ABONO', customer, transactionAmount: '7', currencyMode: 'USD', bcvRate: 100, operationId: 'collection-one' };
    const first = await f.mod.processCustomerTransaction(request); const again = await f.mod.processCustomerTransaction(request);
    assert.equal(again.duplicate, true); assert.equal(first.updatedCustomer.deuda, 0); assert.equal(first.updatedCustomer.favor, 2);
    assert.equal(first.movement.fiadoCollectedUsd, 5); assert.equal(first.movement.creditAddedUsd, 2);
    assert.equal(f.mod.calculateReportsData(await f.read(SALES), '2000-01-01', '2099-01-01', 100, []).salesCount, 0);
    assert.equal((await f.read(QUEUE)).length, 1);
});
