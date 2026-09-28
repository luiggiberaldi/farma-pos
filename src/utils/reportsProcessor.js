import { FinancialEngine } from '../core/FinancialEngine';
import { round2, sumR, mulR } from './dinero';
import { getClosureDate, getClosureRate, getSaleBusinessDate } from './closureLogic';

const SALE_TYPES = ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'];
const STATS_TYPES = [...SALE_TYPES, 'ANULACION_VENTA'];
const CASH_TYPES = [...STATS_TYPES, 'COBRO_DEUDA', 'AJUSTE_CREDITO', 'PAGO_PROVEEDOR'];
const saleType = sale => sale.tipo || 'VENTA';
const isStatsEntry = sale => STATS_TYPES.includes(saleType(sale))
    && !(saleType(sale) === 'ANULACION_VENTA' && sale.originSaleType && !SALE_TYPES.includes(sale.originSaleType));
const isCancelled = sale => sale.status === 'ANULADA' || sale.estado === 'ANULADA' || Boolean(sale.anuladaEn);
// Linked originals remain in the ledger; their signed reversals cancel their amounts.
const isLedgerEntry = sale => !isCancelled(sale) || Boolean(sale.relatedVoidId);
const isCountedSale = sale => SALE_TYPES.includes(saleType(sale)) && !isCancelled(sale) && !sale.relatedVoidId;
const branchOf = entity => entity.sedeId || entity.sede_id || entity.huella?.sedeId || null;
const closureKey = (sedeId, cierreId) => JSON.stringify([sedeId, String(cierreId)]);

function totalsFor(salesForStats) {
    return {
        totalUsd: sumR(salesForStats.map(sale => Number(sale.totalUsd) || 0)),
        totalBs: sumR(salesForStats.map(sale => Number(sale.totalBs) || 0)),
        totalItems: salesForStats.reduce((sum, sale) => sum + (sale.items || []).reduce((items, item) => items + (Number(item.qty) || 0), 0), 0),
        salesCount: salesForStats.filter(isCountedSale).length,
    };
}

export function calculateReportsData(allSales, from, to, bcvRate, products) {
    const inRange = allSales.filter(sale => {
        const date = getSaleBusinessDate(sale);
        return date >= from && date <= to;
    });
    const ledger = inRange.filter(isLedgerEntry);
    const salesForStats = ledger.filter(isStatsEntry);
    const salesForCashFlow = ledger.filter(sale => CASH_TYPES.includes(saleType(sale)));
    const historySales = inRange.filter(sale => sale.tipo !== 'AJUSTE_ENTRADA' && sale.tipo !== 'AJUSTE_SALIDA');
    const profit = FinancialEngine.calculateAggregateProfit(salesForStats, bcvRate, products);
    const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);
    const missingRateSaleIds = salesForStats.filter(sale => !(Number(sale.fechaComercialTasa || sale.rate) > 0)).map(sale => sale.id);

    const productMap = new Map();
    salesForStats.forEach(sale => {
        (sale.items || []).forEach(item => {
            const name = item.name || item.id || 'Product';
            const product = productMap.get(name) || { name, qty: 0, revenue: 0 };
            product.qty += Number(item.qty) || 0;
            product.revenue = round2(product.revenue + mulR(item.priceUsd || 0, item.qty || 0));
            productMap.set(name, product);
        });
    });
    const topProducts = [...productMap.values()].sort((a, b) => b.revenue - a.revenue).slice(0, 8);

    const dayMap = new Map();
    salesForStats.forEach(sale => {
        const date = getSaleBusinessDate(sale);
        const day = dayMap.get(date) || { date, total: 0, count: 0 };
        day.total = round2(day.total + (Number(sale.totalUsd) || 0));
        if (isCountedSale(sale)) day.count++;
        dayMap.set(date, day);
    });
    const salesByDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

    return {
        salesForStats, salesForCashFlow, historySales,
        ...totalsFor(salesForStats), profit, paymentBreakdown, topProducts, salesByDay,
        missingRateSaleIds,
        rateFallbackUsed: missingRateSaleIds.length > 0 && Number(bcvRate) > 0,
    };
}

export function groupSalesByCierreId(allSales, from, to, closures = []) {
    const metadata = Array.isArray(closures) ? closures : [];
    const entities = allSales.filter(sale => {
        const date = getSaleBusinessDate(sale);
        return date >= from && date <= to && sale.cierreId != null;
    });
    const branchesByClosure = new Map();
    allSales.filter(sale => sale.cierreId != null).forEach(sale => {
        const id = String(sale.cierreId);
        if (!branchesByClosure.has(id)) branchesByClosure.set(id, new Set());
        branchesByClosure.get(id).add(branchOf(sale));
    });
    const groups = new Map();
    entities.forEach(entity => {
        const sedeId = branchOf(entity);
        const cId = entity.cierreId;
        const key = closureKey(sedeId, cId);
        if (!groups.has(key)) {
            const candidates = metadata.filter(closure => String(closure.cierreId) === String(cId));
            const exact = candidates.filter(closure => branchOf(closure) === sedeId);
            const legacy = candidates.filter(closure => !branchOf(closure));
            const closureMeta = exact.length === 1 ? exact[0]
                : exact.length === 0 && candidates.length === 1 && legacy.length === 1 && branchesByClosure.get(String(cId)).size === 1 ? legacy[0] : null;
            groups.set(key, {
                cierreId: cId, timestamp: cId, sedeId, groupKey: key,
                businessDate: closureMeta ? getClosureDate(closureMeta, getSaleBusinessDate(entity)) : getSaleBusinessDate(entity),
                closureMeta, apertura: null, sales: [],
            });
        }
        const group = groups.get(key);
        if (entity.tipo === 'APERTURA_CAJA') {
            if (isLedgerEntry(entity)) group.apertura = entity;
        } else {
            group.sales.push(entity);
        }
    });

    return [...groups.values()]
        .filter(group => group.sales.length > 0)
        .map(group => {
            const ledger = group.sales.filter(isLedgerEntry);
            const salesForStats = ledger.filter(isStatsEntry);
            const salesForCashFlow = ledger.filter(sale => CASH_TYPES.includes(saleType(sale)));
            const rateSnapshot = getClosureRate(group.closureMeta, 0);
            return {
                ...group,
                dateObj: group.businessDate ? new Date(`${group.businessDate}T12:00:00`) : new Date(group.cierreId),
                rateSnapshot, rateSnapshotMissing: rateSnapshot <= 0,
                salesForStats, salesForCashFlow,
                ...totalsFor(salesForStats),
                paymentBreakdown: FinancialEngine.calculatePaymentBreakdown(salesForCashFlow),
            };
        })
        .sort((a, b) => Number(b.cierreId) - Number(a.cierreId) || String(a.sedeId || '').localeCompare(String(b.sedeId || '')));
}
