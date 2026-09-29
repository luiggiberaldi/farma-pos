import { useMemo } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { calculateReportsData } from '../utils/reportsProcessor.js';
import { getLocalISODate } from '../utils/dateHelpers';
import { getCashSessionMovements, getOpenCashSession, getSaleBusinessDate } from '../utils/closureLogic';

/**
 * Derivaciones de datos del Dashboard (memos extraídos de DashboardView).
 * Sin cambios de comportamiento: mismo cálculo, misma memoización.
 */
export function useDashboardData({ sales, products, customers, bcvRate, selectedChartDate }) {
    const today = getLocalISODate();

    const activeCashSession = useMemo(() => getOpenCashSession(sales), [sales]);
    const operatingDate = activeCashSession?.businessDate || today;
    const pendingSessionMovements = useMemo(() => {
        if (activeCashSession) return getCashSessionMovements(sales, activeCashSession);
        return sales.filter(s => {
            if (s.cajaCerrada === true || s.cierreId) return false;
            return getSaleBusinessDate(s) === operatingDate;
        });
    }, [sales, activeCashSession, operatingDate]);

    const todaySales = useMemo(() =>
        pendingSessionMovements.filter(s => {
            if ((s.status === 'ANULADA' || s.estado === 'ANULADA' || s.anuladaEn) && !s.relatedVoidId) return false;
            return s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA' || s.tipo === 'ANULACION_VENTA';
        }),
        [pendingSessionMovements]
    );

    // Movimientos reales de caja para el cuadre (Ventas + Abonos + Egresos + Apertura)
    const todayCashFlow = useMemo(() =>
        pendingSessionMovements.filter(s => {
            if ((s.status === 'ANULADA' || s.estado === 'ANULADA' || s.anuladaEn) && !s.relatedVoidId) return false;
            return s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA' || s.tipo === 'COBRO_DEUDA' || s.tipo === 'PAGO_PROVEEDOR' || s.tipo === 'APERTURA_CAJA' || s.tipo === 'ANULACION_VENTA';
        }),
        [pendingSessionMovements]
    );

    // Detect the active opening, even when it was created before midnight.
    const todayApertura = activeCashSession?.apertura || null;
    const todayTotalBs = useMemo(() => todaySales.reduce((sum, s) => sum + (s.totalBs || 0), 0), [todaySales]);
    const todayTotalUsd = useMemo(() => todaySales.reduce((sum, s) => sum + (s.totalUsd || 0), 0), [todaySales]);
    const todayItemsSold = useMemo(() => todaySales.reduce((sum, s) => sum + (s.items ? s.items.reduce((is, i) => is + i.qty, 0) : 0), 0), [todaySales]);

    // Egresos del día (pagos a proveedores)
    const todayExpenses = useMemo(() => {
        return sales.filter(s => {
            if (s.tipo !== 'PAGO_PROVEEDOR') return false;
            return pendingSessionMovements.includes(s);
        });
    }, [pendingSessionMovements]);
    const todayExpensesUsd = useMemo(() => todayExpenses.reduce((sum, s) => sum + Math.abs(s.totalUsd || 0), 0), [todayExpenses]);

    const todayProfit = useMemo(() =>
        FinancialEngine.calculateAggregateProfit(todaySales, bcvRate, products),
        [todaySales, bcvRate, products]
    );

    // Últimas ventas (por defecto las últimas 7, o las del día seleccionado en la gráfica)
    const recentSales = useMemo(() => {
        // Excluir apertura de caja, pagos a proveedores y otros registros internos del historial visible
        const VISIBLE_TIPOS = ['VENTA', 'VENTA_FIADA', 'COBRO_DEUDA', 'ANULACION_VENTA'];
        if (selectedChartDate) {
            return sales.filter(s => {
                if (!VISIBLE_TIPOS.includes(s.tipo)) return false;
                return getSaleBusinessDate(s) === selectedChartDate;
            });
        }
        return sales.filter(s => VISIBLE_TIPOS.includes(s.tipo)).slice(0, 7);
    }, [sales, selectedChartDate]);

    // Datos últimos 7 días (para gráfica)
    const weekData = useMemo(() => Array.from({ length: 7 }, (_, i) => {
        const d = new Date();
        d.setDate(d.getDate() - (6 - i));
        const dateStr = getLocalISODate(d);
        const report = calculateReportsData(sales, dateStr, dateStr, bcvRate, products);
        return { date: dateStr, total: report.totalUsd, count: report.salesCount };
    }), [sales]);

    // Productos bajo stock
    const lowStockProducts = useMemo(() =>
        products.filter(p => (p.stock ?? 0) <= (p.lowStockAlert ?? 5))
            .sort((a, b) => (a.stock ?? 0) - (b.stock ?? 0)).slice(0, 6),
        [products]
    );

    // Deudas pendientes totales
    const totalDeudas = useMemo(() => {
        const deudores = customers.filter(c => (c.deuda || 0) > 0.01 || (c.casheaDeuda || 0) > 0.01);
        const totalFiado = deudores.reduce((sum, c) => sum + (c.deuda || 0), 0);
        const totalCashea = deudores.reduce((sum, c) => sum + (c.casheaDeuda || 0), 0);
        const totalUsd = totalFiado + totalCashea;
        return {
            count: deudores.length,
            totalUsd,
            totalFiado,
            totalCashea,
            top5: [...deudores].sort((a, b) => ((b.deuda||0)+(b.casheaDeuda||0)) - ((a.deuda||0)+(a.casheaDeuda||0))).slice(0, 5)
        };
    }, [customers]);


    // Top productos vendidos (todas las ventas netas)
    const topProducts = useMemo(() => {
        const productSalesMap = {};
        calculateReportsData(sales, '0000-01-01', '9999-12-31', bcvRate, products).salesForStats.forEach(s => {
            if (s.items) {
                s.items.forEach(item => {
                    if (!productSalesMap[item.name]) productSalesMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                    productSalesMap[item.name].qty += item.qty;
                    productSalesMap[item.name].revenue += item.priceUsd * item.qty;
                });
            }
        });
        return Object.values(productSalesMap).sort((a, b) => b.qty - a.qty).slice(0, 5);
    }, [sales]);

    // Payment method breakdown (today)
    const paymentBreakdown = useMemo(() => {
        return FinancialEngine.calculatePaymentBreakdown(todayCashFlow);
    }, [todayCashFlow]);

    // Top productos vendidos HOY (para cierre del día)
    const todayTopProducts = useMemo(() => {
        const todayProductMap = {};
        todaySales.forEach(s => {
            if (s.items) {
                s.items.forEach(item => {
                    if (!todayProductMap[item.name]) todayProductMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                    todayProductMap[item.name].qty += item.qty;
                    todayProductMap[item.name].revenue += item.priceUsd * item.qty;
                });
            }
        });
        return Object.values(todayProductMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
    }, [todaySales]);

    return {
        today, activeCashSession, operatingDate, pendingSessionMovements,
        todaySales, todayCashFlow, todayApertura, todayTotalBs, todayTotalUsd,
        todayItemsSold, todayExpenses, todayExpensesUsd, todayProfit,
        recentSales, weekData, lowStockProducts, totalDeudas, topProducts,
        paymentBreakdown, todayTopProducts,
    };
}
