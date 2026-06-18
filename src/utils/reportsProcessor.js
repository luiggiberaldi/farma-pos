import { FinancialEngine } from '../core/FinancialEngine';
import { getLocalISODate } from './dateHelpers';

export function calculateReportsData(allSales, from, to, bcvRate, products) {
    // Ventas de Mercancía (para Totales, Profit, Top Productos)
    const salesForStats = allSales.filter(s => {
        if (s.status === 'ANULADA') return false;
        if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA' && s.tipo !== 'ANULACION_VENTA') return false;
        if (!s.timestamp || isNaN(new Date(s.timestamp).getTime())) return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    // Flujo de Dinero (para Desglose de Pagos, incluye pagos de deudas)
    const salesForCashFlow = allSales.filter(s => {
        if (s.status === 'ANULADA') return false;
        if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA' && s.tipo !== 'COBRO_DEUDA' && s.tipo !== 'PAGO_PROVEEDOR' && s.tipo !== 'ANULACION_VENTA') return false;
        if (!s.timestamp || isNaN(new Date(s.timestamp).getTime())) return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    const historySales = allSales.filter(s => {
        if (s.tipo === 'AJUSTE_ENTRADA' || s.tipo === 'AJUSTE_SALIDA') return false;
        if (!s.timestamp || isNaN(new Date(s.timestamp).getTime())) return false;
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to;
    });

    const totalUsd = salesForStats.reduce((s, sale) => s + (sale.totalUsd || 0), 0);
    const totalBs = salesForStats.reduce((s, sale) => s + (sale.totalBs || 0), 0);
    const totalItems = salesForStats.reduce((s, sale) => s + (sale.items ? sale.items.reduce((is, i) => is + i.qty, 0) : 0), 0);
    const profit = FinancialEngine.calculateAggregateProfit(salesForStats, bcvRate, products);
    const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);

    // Top productos
    const productMap = {};
    salesForStats.forEach(s => {
        s.items?.forEach(item => {
            if (!productMap[item.name]) productMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
            productMap[item.name].qty += item.qty;
            productMap[item.name].revenue += item.priceUsd * item.qty;
        });
    });
    const topProducts = Object.values(productMap).sort((a, b) => b.revenue - a.revenue).slice(0, 8);

    // Ventas por día para mini gráfica
    const map = {};
    salesForStats.forEach(s => {
        const day = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : getLocalISODate(new Date());
        if (!map[day]) map[day] = { date: day, total: 0, count: 0 };
        map[day].total += s.totalUsd || 0;
        map[day].count++;
    });
    const salesByDay = Object.values(map).sort((a, b) => a.date.localeCompare(b.date));

    return {
        salesForStats,
        salesForCashFlow,
        historySales,
        totalUsd,
        totalBs,
        totalItems,
        profit,
        paymentBreakdown,
        topProducts,
        salesByDay
    };
}

export function groupSalesByCierreId(allSales, from, to) {
    // 1. Encontrar ventas/aperturas que caen en el rango y tienen cierreId
    const entitiesInDateRange = allSales.filter(s => {
        const dateStr = getLocalISODate(new Date(s.timestamp));
        return dateStr >= from && dateStr <= to && s.cierreId;
    });

    // 2. Agrupar por cierreId
    const cMap = {};
    entitiesInDateRange.forEach(entity => {
        const cId = entity.cierreId;
        if (!cMap[cId]) {
            cMap[cId] = {
                cierreId: cId,
                timestamp: cId,
                apertura: null,
                sales: [],
            };
        }
        if (entity.tipo === 'APERTURA_CAJA') {
            cMap[cId].apertura = entity;
        } else {
            cMap[cId].sales.push(entity);
        }
    });

    // 3. Calcular resumen y ordenar desc
    const result = Object.values(cMap)
        .filter(c => c.sales.length > 0)
        .map(c => {
            const dateObj = new Date(c.cierreId);

            // Filtrar para métricas generales (stats) y flujo de caja (cashflow)
            const salesForStats = c.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA' || s.tipo === 'ANULACION_VENTA');
            const salesForCashFlow = c.sales.filter(s => s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA' || s.tipo === 'COBRO_DEUDA' || s.tipo === 'PAGO_PROVEEDOR' || s.tipo === 'ANULACION_VENTA');

            const totalUsd = salesForStats.reduce((acc, s) => acc + (s.totalUsd || 0), 0);
            const totalBs = salesForStats.reduce((acc, s) => acc + (s.totalBs || 0), 0);
            const totalItems = salesForStats.reduce((acc, s) => acc + (s.items ? s.items.reduce((is, it) => is + it.qty, 0) : 0), 0);
            
            // Reconstruir desglose de pago de esta caja
            const paymentBreakdown = FinancialEngine.calculatePaymentBreakdown(salesForCashFlow);

            return {
                ...c,
                dateObj,
                salesForStats,
                salesForCashFlow,
                totalUsd,
                totalBs,
                totalItems,
                paymentBreakdown,
                // Total de operaciones del cierre (excluye APERTURA_CAJA, ya separada)
                salesCount: c.sales.length,
            };
        })
        .sort((a, b) => b.cierreId - a.cierreId);

    return result;
}
