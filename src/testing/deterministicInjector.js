// ============================================================
// INYECTOR DETERMINISTA v3.0 — Audit Mode
// Semilla fija = mismas ventas SIEMPRE
// ============================================================

import { storageService } from '../utils/storageService';
import { FinancialEngine } from '../core/FinancialEngine';
import { round2, sumR, mulR, subR } from '../utils/dinero';

// ── Mulberry32 PRNG: misma semilla → misma secuencia ──
function createSeededRandom(seed) {
    let s = seed | 0;
    return () => {
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// ── CONSTANTES FIJAS ──
const SEED = 12345;
const FIXED_RATE = 36.50;
const TOTAL_SALES = 102;

// 10 productos con precio Y costo conocido (para verificar ganancia)
const FIXED_PRODUCTS = [
    { id: 'det-01', name: 'Harina PAN 1kg',       priceUsd: 1.10, costUsd: 0.75, stock: 500 },
    { id: 'det-02', name: 'Arroz Mary 1kg',        priceUsd: 0.95, costUsd: 0.60, stock: 300 },
    { id: 'det-03', name: 'Aceite Mazeite 1L',     priceUsd: 2.80, costUsd: 2.10, stock: 200 },
    { id: 'det-04', name: 'Azucar Montalban 1kg',  priceUsd: 1.25, costUsd: 0.85, stock: 250 },
    { id: 'det-05', name: 'Pasta Capri 500g',      priceUsd: 0.75, costUsd: 0.50, stock: 400 },
    { id: 'det-06', name: 'Leche Completa 1L',     priceUsd: 1.50, costUsd: 1.10, stock: 180 },
    { id: 'det-07', name: 'Huevos Carton 30u',     priceUsd: 3.50, priceUsd: 3.50, costUsd: 2.80, stock: 100 },
    { id: 'det-08', name: 'Queso Llanero 1kg',     priceUsd: 4.00, priceUsd: 4.00, costUsd: 3.20, stock: 80  },
    { id: 'det-09', name: 'Cafe Madrid 500g',      priceUsd: 3.20, priceUsd: 3.20, costUsd: 2.50, stock: 150 },
    { id: 'det-10', name: 'Jabon Las Llaves 3u',   priceUsd: 1.80, priceUsd: 1.80, costUsd: 1.20, stock: 220 },
];

// 3 clientes fijos para ventas fiadas + 1 para Cashea
const FIXED_CUSTOMERS = [
    { id: 'det-cli-01', name: 'Maria Garcia',    phone: '0412-1111111', deuda: 0, casheaDeuda: 0, favor: 0 },
    { id: 'det-cli-02', name: 'Jose Rodriguez',  phone: '0414-2222222', deuda: 0, casheaDeuda: 0, favor: 0 },
    { id: 'det-cli-03', name: 'Ana Martinez',    phone: '0424-3333333', deuda: 0, casheaDeuda: 0, favor: 0 },
    { id: 'det-cli-04', name: 'Luis Perez',      phone: '0416-4444444', deuda: 0, casheaDeuda: 0, favor: 0, casheaLevel: 3 },
];

// Curva de trafico diario (picos a 12pm y 6pm)
const HOURS_CURVE = [
    ...Array(5).fill(8),
    ...Array(10).fill(9),
    ...Array(15).fill(10),
    ...Array(18).fill(11),
    ...Array(20).fill(12),
    ...Array(10).fill(13),
    ...Array(5).fill(14),
    ...Array(8).fill(15),
    ...Array(12).fill(16),
    ...Array(18).fill(17),
    ...Array(25).fill(18),
    ...Array(15).fill(19),
    ...Array(5).fill(20),
];

/**
 * Genera e inyecta 102 ventas deterministas.
 * Cada ejecucion produce exactamente los mismos datos.
 * Limpia datos det_* anteriores antes de inyectar (idempotente).
 */
export async function injectDeterministicSales() {
    if (!window.confirm(
        'Inyectar 102 ventas DETERMINISTAS?\n\n' +
        '- Semilla: 12345 (mismos datos siempre)\n' +
        '- Tasa fija: 36.50 Bs/$\n' +
        '- 10 productos de prueba (con costo)\n' +
        '- 3 clientes fijos\n' +
        '- Limpia datos det_* anteriores\n\n' +
        'Los datos reales NO se tocan.'
    )) return;

    const rand = createSeededRandom(SEED);
    const currentRate = FIXED_RATE;
    const todayStr = new Date().toISOString().split('T')[0];

    // Copias frescas para mutar durante la generacion
    const products = FIXED_PRODUCTS.map(p => ({ ...p }));
    const customers = FIXED_CUSTOMERS.map(c => ({ ...c }));

    const testSales = [];

    // ── Apertura de caja ──
    testSales.push({
        id: 'det_apertura_001',
        tipo: 'APERTURA_CAJA',
        openingUsd: 100,
        openingBs: round2(100 * currentRate),
        timestamp: `${todayStr}T08:00:00.000Z`,
        cajaCerrada: false,
    });

    // ── Generar 102 ventas ──
    for (let i = 0; i < TOTAL_SALES; i++) {
        const hRand = HOURS_CURVE[Math.floor(rand() * HOURS_CURVE.length)];
        const minRand = Math.floor(rand() * 60);
        const secRand = Math.floor(rand() * 60);
        const fTime = `${todayStr}T${String(hRand).padStart(2, '0')}:${String(minRand).padStart(2, '0')}:${String(secRand).padStart(2, '0')}.000Z`;

        // 1-4 items aleatorios (seeded)
        const itemC = Math.floor(rand() * 4) + 1;
        const items = [];
        let subtotalUsd = 0;

        for (let j = 0; j < itemC; j++) {
            const p = products[Math.floor(rand() * products.length)];
            const q = Math.floor(rand() * 3) + 1;
            items.push({ id: p.id, name: p.name, qty: q, priceUsd: p.priceUsd });
            subtotalUsd = sumR(subtotalUsd, mulR(p.priceUsd, q));
            p.stock = p.stock - q;
        }

        // 5% chance descuento 10%
        let discountUsd = 0;
        if (rand() < 0.05 && subtotalUsd > 1) {
            discountUsd = round2(subtotalUsd * 0.10);
        }

        const payableUsd = subR(subtotalUsd, discountUsd);
        const totalBs = round2(payableUsd * currentRate);

        // Tipo de venta (seeded)
        const rType = rand();
        let payments = [];
        let changeUsd = 0;
        let changeBs = 0;
        let fiadoUsd = 0;
        let customerId = null;
        let customerName = 'Consumidor Final';
        let tipoVenta = 'VENTA';
        let statusVenta = 'COMPLETADA';

        if (rType < 0.05) {
            // ~5% anuladas
            statusVenta = 'ANULADA';
            payments = [];
            for (const it of items) {
                const p = products.find(x => x.id === it.id);
                if (p) p.stock += it.qty;
            }
        } else if (rType < 0.13) {
            // ~8% Cashea (cliente paga 40%, Cashea financia 60%)
            tipoVenta = 'VENTA_CASHEA';
            const casheaPct = 0.60;
            const casheaUsd = round2(payableUsd * casheaPct);
            const clienteUsd = round2(payableUsd - casheaUsd);
            const c = customers[3]; // Luis Perez — tiene casheaLevel
            customerId = c.id;
            customerName = c.name;
            c.casheaDeuda = sumR(c.casheaDeuda || 0, casheaUsd);
            payments = [
                { methodId: 'pago_movil', amount: round2(clienteUsd * currentRate), amountUsd: clienteUsd, amountBs: round2(clienteUsd * currentRate), currency: 'BS', methodLabel: 'Pago Móvil' },
                { methodId: 'cashea', amount: casheaUsd, amountUsd: casheaUsd, amountBs: round2(casheaUsd * currentRate), currency: 'USD', methodLabel: 'Cashea' },
            ];
            fiadoUsd = 0;
        } else if (rType < 0.23) {
            // ~10% fiadas
            tipoVenta = 'VENTA_FIADA';
            fiadoUsd = payableUsd;
            const c = customers[Math.floor(rand() * 3)]; // solo primeros 3 para fiado
            customerId = c.id;
            customerName = c.name;
            c.deuda = sumR(c.deuda || 0, fiadoUsd);
        } else if (rType < 0.35) {
            // ~20% efectivo USD con vuelto
            const bill = payableUsd < 15 ? 20 : (payableUsd < 45 ? 50 : 100);
            payments = [{ methodId: 'efectivo_usd', amount: bill, amountUsd: bill, currency: 'USD', methodLabel: 'Efectivo $' }];
            changeUsd = subR(bill, payableUsd);
            changeBs = 0;
        } else if (rType < 0.55) {
            // ~20% pago mixto
            const halfUsd = round2(payableUsd / 2);
            const remainingUsd = subR(payableUsd, halfUsd);
            payments = [
                { methodId: 'efectivo_usd', amount: halfUsd, amountUsd: halfUsd, currency: 'USD', methodLabel: 'Efectivo $' },
                { methodId: 'pago_movil', amount: round2(remainingUsd * currentRate), amountUsd: remainingUsd, currency: 'BS', methodLabel: 'Pago Movil' },
            ];
        } else {
            // ~45% pago movil total
            payments = [{ methodId: 'pago_movil', amount: totalBs, amountUsd: payableUsd, currency: 'BS', methodLabel: 'Pago Movil' }];
        }

        testSales.push({
            id: `det_v3_${String(i).padStart(3, '0')}`,
            timestamp: fTime,
            items,
            cartSubtotalUsd: subtotalUsd,
            discountAmountUsd: discountUsd,
            discountValue: discountUsd > 0 ? 10 : 0,
            discountType: discountUsd > 0 ? 'PERCENT' : null,
            totalUsd: payableUsd,
            totalBs,
            rate: currentRate,
            tipo: tipoVenta,
            status: statusVenta,
            changeUsd,
            changeBs,
            fiadoUsd,
            casheaUsd: tipoVenta === 'VENTA_CASHEA' ? payments.find(p => p.methodId === 'cashea')?.amountUsd || 0 : 0,
            payments,
            customerId,
            customerName,
            sellerName: 'Simulador v3.0 Determinista',
            saleNumber: 99000 + i,
        });
    }

    // ── Persistencia idempotente ──
    try {
        // Limpiar datos det_* anteriores
        const existingSales = await storageService.getItem('bodega_sales_v1', []);
        const cleanSales = existingSales.filter(s => !String(s.id).startsWith('det_'));

        const existingProducts = await storageService.getItem('bodega_products_v1', []);
        const cleanProducts = existingProducts.filter(p => !String(p.id).startsWith('det-'));

        const existingCustomers = await storageService.getItem('bodega_customers_v1', []);
        const cleanCustomers = existingCustomers.filter(c => !String(c.id).startsWith('det-'));

        // Inyectar datos frescos
        await storageService.setItem('bodega_sales_v1', [...cleanSales, ...testSales]);
        await storageService.setItem('bodega_products_v1', [...cleanProducts, ...products]);
        await storageService.setItem('bodega_customers_v1', [...cleanCustomers, ...customers]);

        // ── Resumen de verificacion ──
        const netSales = testSales.filter(s => s.status !== 'ANULADA' && (s.tipo === 'VENTA' || s.tipo === 'VENTA_FIADA' || s.tipo === 'VENTA_CASHEA'));
        const voidedCount = testSales.filter(s => s.status === 'ANULADA').length;
        const fiadoSales = netSales.filter(s => s.tipo === 'VENTA_FIADA');
        const casheaSales = netSales.filter(s => s.tipo === 'VENTA_CASHEA');
        const normalSales = netSales.filter(s => s.tipo === 'VENTA');

        const netTotalUsd = round2(netSales.reduce((s, v) => s + (v.totalUsd || 0), 0));
        const netTotalBs = round2(netSales.reduce((s, v) => s + (v.totalBs || 0), 0));
        const netItems = netSales.reduce((s, v) => s + v.items.reduce((is, it) => is + it.qty, 0), 0);
        const fiadoTotalUsd = round2(fiadoSales.reduce((s, v) => s + (v.totalUsd || 0), 0));
        const casheaTotalUsd = round2(casheaSales.reduce((s, v) => s + (v.casheaUsd || 0), 0));
        const discountTotalUsd = round2(netSales.reduce((s, v) => s + (v.discountAmountUsd || 0), 0));

        let profitBs = 0;
        try {
            profitBs = FinancialEngine.calculateAggregateProfit(netSales, currentRate, products);
        } catch (e) { /* falla silenciosa */ }
        const profitUsd = currentRate > 0 ? round2(profitBs / currentRate) : 0;

        let breakdownText = '';
        try {
            const bd = FinancialEngine.calculatePaymentBreakdown(testSales.filter(s => s.status !== 'ANULADA'));
            Object.entries(bd).forEach(([, data]) => {
                const label = data.label || 'Otro';
                if (data.currency === 'USD' || data.currency === 'FIADO') {
                    breakdownText += `  ${label}: $${data.total.toFixed(2)}\n`;
                } else {
                    breakdownText += `  ${label}: Bs ${data.total.toLocaleString('es-VE', { minimumFractionDigits: 2 })}\n`;
                }
            });
        } catch (e) { breakdownText = '  (error calculando desglose)\n'; }

        const fmtBs = (v) => v.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        alert(
            `TESTER DETERMINISTA v3.0 completado.\n` +
            `Semilla: ${SEED} | Tasa: ${currentRate} Bs/$\n` +
            `(Mismos datos en cada ejecucion)\n` +
            `\n── RESUMEN ──\n` +
            `Ventas normales: ${normalSales.length}\n` +
            `Ventas fiadas: ${fiadoSales.length}\n` +
            `Ventas Cashea: ${casheaSales.length} (Por cobrar a Cashea: $${casheaTotalUsd.toFixed(2)})\n` +
            `Anuladas: ${voidedCount}\n` +
            `Articulos vendidos: ${netItems}\n` +
            `Descuentos: $${discountTotalUsd.toFixed(2)}\n` +
            `Ingresos brutos: $${netTotalUsd.toFixed(2)} / Bs ${fmtBs(netTotalBs)}\n` +
            `Ganancia estimada: $${profitUsd.toFixed(2)} / Bs ${fmtBs(profitBs)}\n` +
            `Fiado total: $${fiadoTotalUsd.toFixed(2)}\n` +
            `\n── PAGOS ──\n` +
            breakdownText +
            `\n── INVENTARIO INYECTADO ──\n` +
            `10 productos det-01 a det-10 (con costo conocido)`
        );
        setTimeout(() => window.location.reload(), 100);
    } catch (e) {
        console.error(e);
        alert('Error en inyeccion determinista: ' + e.message);
    }
}
