import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRealModule } from './helpers/realModule.mjs';

const { FinancialEngine, calculateReportsData, groupSalesByCierreId } = await loadRealModule('src/utils/reportsProcessor.js', {}, {
    exportsFrom: ['src/core/FinancialEngine.js'],
});
const day = '2026-09-14';
const payment = (methodId, currency, amount, amountUsd = amount) => ({ methodId, currency, amount, amountUsd });
const sale = overrides => ({
    id: 'sale-1', schemaVersion: 3, tipo: 'VENTA', fechaComercial: day, sedeId: 'central',
    totalUsd: 10, totalBs: 1000, rate: 100, discountAmountUsd: 0, fiadoUsd: 0, casheaUsd: 0,
    items: [{ id: 'item-1', name: 'Synthetic item', qty: 1, priceUsd: 10, costUsd: 2 }],
    payments: [payment('efectivo_usd', 'USD', 10)], changeUsd: 0, changeBs: 0,
    ...overrides,
});
const reverse = original => ({
    ...original, id: 'void-1', tipo: 'ANULACION_VENTA', originSaleId: original.id,
    relatedVoidId: undefined, status: 'COMPLETADA', estado: undefined, anuladaEn: undefined,
    totalUsd: -original.totalUsd, totalBs: -original.totalBs,
    discountAmountUsd: -original.discountAmountUsd, fiadoUsd: -original.fiadoUsd, casheaUsd: -original.casheaUsd,
    changeUsd: -original.changeUsd, changeBs: -original.changeBs,
    items: original.items.map(item => ({ ...item, qty: -item.qty })),
    payments: original.payments.map(p => ({ ...p, amount: -p.amount, amountUsd: -p.amountUsd, ...(p.amountBs != null && { amountBs: -p.amountBs }) })),
});

test('partial credit reports cash 4 plus debt 6, not debt 10', () => {
    const result = FinancialEngine.calculatePaymentBreakdown([sale({ tipo: 'VENTA_FIADA', fiadoUsd: 6, payments: [payment('efectivo_usd', 'USD', 4)] })]);
    assert.equal(result.efectivo_usd.total, 4);
    assert.equal(result.fiado.total, 6);
});

test('legacy partial credit derives remaining debt after physical payments', () => {
    const result = FinancialEngine.calculatePaymentBreakdown([sale({ schemaVersion: 2, tipo: 'VENTA_FIADA', fiadoUsd: undefined, payments: [payment('pago_movil', 'BS', 400, 4)] })]);
    assert.equal(result.pago_movil.total, 400);
    assert.equal(result.fiado.total, 6);
});

test('fully financed and explicitly empty modern payments never invent cash', () => {
    for (const overrides of [
        { tipo: 'VENTA_FIADA', fiadoUsd: 10 },
        { tipo: 'VENTA_CASHEA', casheaUsd: 10 },
        { schemaVersion: 2, tipo: 'VENTA_FIADA', fiadoUsd: undefined },
        {},
    ]) {
        const result = FinancialEngine.calculatePaymentBreakdown([sale({ ...overrides, payments: [] })]);
        assert.equal(result.efectivo_bs, undefined);
        assert.equal(result.efectivo_usd, undefined);
    }
});

test('explicit financing fields do not double count virtual payment entries', () => {
    const result = FinancialEngine.calculatePaymentBreakdown([sale({
        fiadoUsd: 2, casheaUsd: 3,
        payments: [payment('efectivo_usd', 'USD', 5), payment('fiado', 'USD', 2), payment('cashea', 'USD', 3)],
    })]);
    assert.equal(result.fiado.total, 2);
    assert.equal(result.cashea.total, 3);
    assert.equal(result.efectivo_usd.total, 5);
});

test('native currency amounts survive rounded USD equivalents and corrected rates', () => {
    const result = FinancialEngine.calculatePaymentBreakdown([sale({
        tasaCop: 4000, fechaComercialTasa: 110,
        payments: [payment('transferencia_cop', 'COP', 10101, 2.53), { ...payment('pago_movil', 'BS', 401.25, 4.01), amountBs: 401 }],
    })]);
    assert.equal(result.transferencia_cop.total, 10101);
    assert.equal(result.transferencia_cop.currency, 'COP');
    assert.equal(result.pago_movil.total, 401.25);
});

test('bank receipts are never redistributed to cover physical change', () => {
    const original = sale({ payments: [payment('pago_movil', 'BS', 2000, 20)], changeUsd: 10 });
    const result = FinancialEngine.calculatePaymentBreakdown([original]);
    assert.equal(result.pago_movil.total, 2000);
    assert.equal(result.vuelto_usd.total, 10);
    assert.equal(result.vuelto_usd.isChange, true);
    assert.equal(result.efectivo_usd, undefined);
    assert.deepEqual(FinancialEngine.calculatePaymentBreakdown([original, reverse(original)]), {});
});

test('signed credit and discounted reversals cancel payments, debt, profit and items', () => {
    const original = sale({
        tipo: 'VENTA_FIADA', totalUsd: 8, totalBs: 800, discountAmountUsd: 2, fiadoUsd: 4,
        payments: [payment('efectivo_usd', 'USD', 4)], relatedVoidId: 'void-1', status: 'ANULADA',
    });
    const result = calculateReportsData([original, reverse(original)], day, day, 900, []);
    assert.equal(result.totalUsd, 0);
    assert.equal(result.totalBs, 0);
    assert.equal(result.profit, 0);
    assert.equal(result.totalItems, 0);
    assert.equal(result.salesCount, 0);
    assert.equal(result.salesForStats.length, 2);
    assert.deepEqual(result.paymentBreakdown, {});
    assert.deepEqual(result.salesByDay, [{ date: day, total: 0, count: 0 }]);
    assert.equal(result.topProducts[0].qty, 0);
    assert.equal(result.topProducts[0].revenue, 0);
});

test('recorded zero cost does not fall back to the current product cost', () => {
    for (const cost of [{ costUsd: 0 }, { costUsd: undefined, costBs: 0 }]) {
        const original = sale({ items: [{ id: 'item-1', name: 'Synthetic item', priceUsd: 10, qty: 1, ...cost }] });
        assert.equal(FinancialEngine.calculateSaleProfit(original, 100, [{ id: 'item-1', costUsd: 9 }]), 1000);
        assert.equal(FinancialEngine.calculateAggregateProfit([original, reverse(original)], 100, [{ id: 'item-1', costUsd: 9 }]), 0);
    }
});

test('a collection reduces actual debt only and its signed reversal restores it', () => {
    const collection = sale({ tipo: 'COBRO_DEUDA', totalUsd: 7, totalBs: 700, fiadoCollectedUsd: 5, creditAddedUsd: 2, payments: [payment('efectivo_usd', 'USD', 7)], items: [] });
    const result = FinancialEngine.calculatePaymentBreakdown([collection]);
    assert.equal(result.fiado.total, -5);
    assert.equal(result.efectivo_usd.total, 7);
    const reversal = { ...reverse(collection), originSaleType: 'COBRO_DEUDA', fiadoCollectedUsd: -5, creditAddedUsd: -2 };
    assert.deepEqual(FinancialEngine.calculatePaymentBreakdown([collection, reversal]), {});
    const report = calculateReportsData([collection, reversal], day, day, 100, []);
    assert.equal(report.totalUsd, 0);
    assert.equal(report.salesCount, 0);
    assert.equal(report.salesForCashFlow.length, 2);
});

test('valid sale count excludes cancellations, reversals and non-sale movements', () => {
    const original = sale({ relatedVoidId: 'void-1', status: 'ANULADA' });
    const rows = [original, reverse(original), sale({ id: 'valid' }), sale({ id: 'cancelled', estado: 'ANULADA' }), sale({ id: 'collection', tipo: 'COBRO_DEUDA', items: [] })];
    const result = calculateReportsData(rows, day, day, 100, []);
    assert.equal(result.salesCount, 1);
    assert.equal(result.totalUsd, 10);
    assert.equal(result.salesByDay[0].count, 1);
    assert.equal(result.salesForCashFlow.length, 4);
});

test('cross-day reversals retain signed revenue without creating another sale', () => {
    const original = sale({ relatedVoidId: 'void-1', status: 'ANULADA' });
    const reversal = { ...reverse(original), fechaComercial: '2026-09-15' };
    const result = calculateReportsData([original, reversal], day, '2026-09-15', 100, []);
    assert.deepEqual(result.salesByDay, [{ date: day, total: 10, count: 0 }, { date: '2026-09-15', total: -10, count: 0 }]);
});

test('closures sharing a timestamp stay isolated by branch and metadata', () => {
    const rows = [sale({ cierreId: 123 }), sale({ id: 'north', sedeId: 'norte', cierreId: 123, totalUsd: 20 })];
    const closures = [{ cierreId: 123, sedeId: 'central', tasaBcv: 100 }, { cierreId: 123, sedeId: 'norte', tasaBcv: 200 }];
    const result = groupSalesByCierreId(rows, day, day, closures);
    assert.equal(result.length, 2);
    assert.notEqual(result[0].groupKey, result[1].groupKey);
    assert.equal(result.find(c => c.sedeId === 'central').totalUsd, 10);
    assert.equal(result.find(c => c.sedeId === 'norte').rateSnapshot, 200);
    const ambiguous = groupSalesByCierreId(rows, day, day, [{ cierreId: 123, tasaBcv: 999 }]);
    assert.ok(ambiguous.every(c => c.closureMeta === null && c.rateSnapshot === 0));
});

test('closure summaries apply the same signed filters and count as date reports', () => {
    const original = sale({ cierreId: 123, relatedVoidId: 'void-1', status: 'ANULADA' });
    const rows = [original, reverse(original), sale({ id: 'valid', cierreId: 123 }), sale({ id: 'cancelled', cierreId: 123, status: 'ANULADA' })];
    const [result] = groupSalesByCierreId(rows, day, day);
    const report = calculateReportsData(rows, day, day, 100, []);
    assert.equal(result.totalUsd, report.totalUsd);
    assert.equal(result.totalItems, report.totalItems);
    assert.equal(result.salesCount, report.salesCount);
    assert.deepEqual(result.paymentBreakdown, report.paymentBreakdown);
});

test('missing historical rates are flagged rather than represented as snapshots', () => {
    const original = sale({ rate: undefined, cierreId: 123 });
    const report = calculateReportsData([original], day, day, 100, []);
    assert.equal(report.rateFallbackUsed, true);
    assert.deepEqual(report.missingRateSaleIds, [original.id]);
    const [closure] = groupSalesByCierreId([original], day, day);
    assert.equal(closure.rateSnapshot, 0);
    assert.equal(closure.rateSnapshotMissing, true);
});

test('buildCartTotals retains its public checkout API and precision', () => {
    assert.deepEqual(FinancialEngine.buildCartTotals([{ priceUsd: 0.1, qty: 3 }], { type: 'fixed', value: 0.1 }, 100, 4000), {
        subtotalUsd: 0.3, subtotalBs: 30, discountAmountUsd: 0.1, discountAmountBs: 10, totalUsd: 0.2, totalBs: 20, totalCop: 800,
    });
});
