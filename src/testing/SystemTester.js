// ============================================================
// 🔍 FINANCIAL AUDITOR v5.0 — Auditoría Financiera Determinista
// ============================================================
// Opera sobre los datos REALES del negocio (bodega_*_v1).
// DETERMINISTA: mismos datos → mismo resultado siempre.
// Sin IA, sin aleatorio, sin efectos secundarios.
// ============================================================

import { storageService } from '../utils/storageService';
import { round2, mulR, subR, sumR } from '../utils/dinero';

// ── Test State ──
const state = {
    logs: [],
    suites: [],
    isRunning: false,
    stopped: false,
    startedAt: null,
    finishedAt: null,
    onLog: null,
    onProgress: null,
    onComplete: null,
};

function resetState() {
    state.logs = []; state.suites = []; state.isRunning = false; state.stopped = false;
    state.startedAt = null; state.finishedAt = null;
    state.onLog = null; state.onProgress = null; state.onComplete = null;
}

function initSuites(activeSuites) {
    state.suites = activeSuites.map(s => ({
        id: s.key, name: s.name, status: 'pending',
        startedAt: null, finishedAt: null, error: null
    }));
}

function updateSuiteStatus(id, patch) {
    const s = state.suites.find(x => x.id === id);
    if (s) Object.assign(s, patch);
}

// ── Logging ──
function log(msg, type = 'info') {
    const ts = new Date().toLocaleTimeString('es-VE', { hour12: false });
    const icons = { info: 'ℹ️', success: '✅', error: '❌', warn: '⚠️', section: '━', day: '📅' };
    const icon = icons[type] || 'ℹ️';
    const entry = { time: ts, msg: `${icon} ${msg}`, type, raw: msg };
    state.logs.push(entry);
    state.onLog?.(entry);
    if (type === 'error') console.error(`[AUDIT ERROR] ${msg}`);
}

function section(title) {
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'section');
    log(title, 'section');
    log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'section');
}

// ── Assertions ──
class AssertionError extends Error {
    constructor(message) { super(message); this.name = 'AssertionError'; }
}

function assert(condition, message) {
    if (!condition) throw new AssertionError(message);
}

function assertEqual(actual, expected, message) {
    if (actual !== expected) throw new AssertionError(`${message} (Esperado: ${expected}, Recibido: ${actual})`);
}

function assertClose(actual, expected, message, tolerance = 0.02) {
    const diff = Math.abs(actual - expected);
    if (diff > tolerance) throw new AssertionError(`${message} (Esperado: ~${expected}, Recibido: ${actual}, Diff: ${diff.toFixed(4)})`);
}

const delay = (ms) => new Promise(r => setTimeout(r, ms));

// ════════════════════════════════════════════
// 1. CERTIFICACIÓN DE PRECISIÓN (Motor dinero.js)
// ════════════════════════════════════════════
async function suitePrecisionFinanciera() {
    section('🔬 SUITE: Certificación de Precisión (Motor Financiero)');

    // IEEE 754 guardrail
    assertClose(0.1 + 0.2, 0.30, 'Suma básica de punto flotante debe estar saneada');

    // Pruebas estrictas del wrapper dinero.js
    assertEqual(sumR(0.1, 0.2), 0.30, 'dinero.js sumR: 0.1+0.2 = 0.30');
    assertEqual(subR(0.3, 0.2), 0.10, 'dinero.js subR: 0.3-0.2 = 0.10');
    assertEqual(mulR(1.005, 100), 100.50, 'dinero.js mulR: 1.005×100 = 100.50');
    assertEqual(round2(1.005), 1.01, 'dinero.js round2: 1.005 → 1.01');
    assertEqual(round2(2.005), 2.01, 'dinero.js round2: 2.005 → 2.01');
    assertEqual(sumR(0.1, 0.2, 0.3), 0.60, 'dinero.js sumR triple: 0.1+0.2+0.3 = 0.60');

    // Cadena multiplicación → tasa (simula precio×qty×tasa)
    const precio = 5.99;
    const qty = 3;
    const tasa = 36.50;
    const esperado = round2(round2(precio * qty) * tasa);
    const calculado = mulR(mulR(precio, qty), tasa);
    assertEqual(calculado, esperado, `dinero.js cadena precio×qty×tasa: ${precio}×${qty}×${tasa}`);

    log('Motor financiero (dinero.js) certificado con precisión IEEE 754 corregida.', 'success');
}

// ════════════════════════════════════════════
// 2. INTEGRIDAD DE LIBROS HISTÓRICOS
// ════════════════════════════════════════════
async function suiteAuditarDataHistorica() {
    section('🕵️ SUITE: Integridad de Libros Históricos');
    const sales = await storageService.getItem('bodega_sales_v1', []);
    if (!sales || sales.length === 0) {
        log('Libro de ventas vacío: No hay historial para auditar.', 'info');
        return;
    }

    let driftCount = 0;

    for (const sale of sales) {
        if (!sale.items || sale.status === 'ANULADA') continue;

        let calculatedUsd = 0;
        for (const item of sale.items) {
            calculatedUsd = sumR(calculatedUsd, mulR(item.priceUsd, item.qty));
        }

        const discountUsd = sale.discountAmountUsd || sale.discount || 0;
        if (discountUsd > 0) calculatedUsd = subR(calculatedUsd, discountUsd);

        if (Math.abs(calculatedUsd - sale.totalUsd) > 0.05) {
            driftCount++;
            log(`[Ticket ${sale.id?.slice(-6) || '?'}] Calculado $${calculatedUsd} vs Registrado $${sale.totalUsd} (diff $${Math.abs(calculatedUsd - sale.totalUsd).toFixed(2)})`, 'warn');
        }
    }

    if (driftCount > 0) {
        log(`${driftCount} ticket(s) con drift aritmético en sus ítems.`, 'error');
        throw new AssertionError(`${driftCount} tickets con anomalías de integridad en sumas`);
    } else {
        log(`${sales.length} tickets auditados. Integridad 100%.`, 'success');
    }
}

// ════════════════════════════════════════════
// 3. INVENTARIO FANTASMA (Stock Negativo)
// ════════════════════════════════════════════
async function suitePatrimonialInventario() {
    section('🛒 SUITE: Auditoría Patrimonial (Inventario Fantasma)');
    const products = await storageService.getItem('bodega_products_v1', []);
    if (!products || !products.length) {
        log('No hay productos para auditar.', 'info');
        return;
    }

    const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
    let ghostItems = 0;
    let totalGhostValueUsd = 0;

    for (const p of products) {
        if (p.stock < 0) {
            ghostItems++;
            totalGhostValueUsd = sumR(totalGhostValueUsd, mulR(Math.abs(p.stock), p.priceUsd || 0));
        }
    }

    if (ghostItems > 0 && !allowNeg) {
        log(`${ghostItems} producto(s) en stock negativo. Valor irreal proyectado: $${totalGhostValueUsd.toFixed(2)}`, 'error');
        throw new AssertionError(`${ghostItems} productos con stock negativo (config: stock negativo NO permitido)`);
    } else if (ghostItems > 0 && allowNeg) {
        log(`${ghostItems} producto(s) en negativo ($${totalGhostValueUsd.toFixed(2)}). Permitido por configuración.`, 'warn');
    } else {
        log(`${products.length} productos auditados. 0 items fantasma.`, 'success');
    }
}

// ════════════════════════════════════════════
// 4. DEUDA CIRCULAR (Cartera)
// ════════════════════════════════════════════
async function suiteDeudaCircular() {
    section('👥 SUITE: Deuda Circular (Cartera de Clientes)');
    const customers = await storageService.getItem('bodega_customers_v1', []);
    if (!customers || !customers.length) {
        log('No hay clientes para auditar.', 'info');
        return;
    }

    let circularCount = 0;

    for (const c of customers) {
        if (c.deuda > 0 && c.favor > 0) {
            circularCount++;
            log(`[${c.name || c.id?.slice(-6)}] Deuda $${c.deuda} y Favor $${c.favor} simultáneos — cartera sin normalizar.`, 'warn');
        }
    }

    if (circularCount > 0) {
        log(`${circularCount} cliente(s) con deuda circular (deuda y favor simultáneos).`, 'error');
        throw new AssertionError(`${circularCount} clientes con cartera no normalizada`);
    } else {
        log(`${customers.length} clientes auditados. Libros de cartera limpios.`, 'success');
    }
}

// ════════════════════════════════════════════
// 5. VENTAS HUÉRFANAS DE CIERRE
// ════════════════════════════════════════════
async function suiteOverlappingCierre() {
    section('📦 SUITE: Ventas Huérfanas de Cierre (>24h sin sincronizar)');
    const sales = await storageService.getItem('bodega_sales_v1', []);

    if (!sales || !sales.length) {
        log('No hay datos suficientes para cruzar reportes.', 'info');
        return;
    }

    let orphanedCount = 0;
    const now = new Date();

    for (const sale of sales) {
        if (sale.status === 'COMPLETADA') {
            const saleDate = new Date(sale.createdAt || sale.date);
            const hoursOld = (now - saleDate) / (1000 * 60 * 60);
            if (hoursOld > 24 && !sale.syncStatus) {
                orphanedCount++;
            }
        }
    }

    if (orphanedCount > 0) {
        log(`${orphanedCount} venta(s) huérfanas (>24h sin cierre de turno registrado).`, 'error');
        throw new AssertionError(`${orphanedCount} ventas huérfanas sin cierre de turno (>24h)`);
    } else {
        log('Conciliación de turnos OK. Todos los tickets tienen menos de 24h o están cerrados.', 'success');
    }
}

// ════════════════════════════════════════════
// 6. RATE SNEAK (Volatilidad de Tasa)
// ════════════════════════════════════════════
async function suiteRateSneak() {
    section('💱 SUITE: Rate Sneak (Tasa Implícita vs Registrada)');
    const sales = await storageService.getItem('bodega_sales_v1', []);
    if (!sales || !sales.length) {
        log('No hay ventas para auditar.', 'info');
        return;
    }

    let tamperedCount = 0;

    for (const sale of sales) {
        if (sale.status === 'ANULADA' || !sale.totalUsd || !sale.totalBs || !sale.rate) continue;
        const implicitRate = sale.totalBs / sale.totalUsd;
        const diff = Math.abs(implicitRate - sale.rate);

        if (diff > 0.05) {
            log(`[Ticket ${sale.id?.slice(-6) || '?'}] Tasa registrada ${sale.rate}, implícita ${implicitRate.toFixed(2)} (diff ${diff.toFixed(2)})`, 'warn');
            tamperedCount++;
        }
    }

    if (tamperedCount > 0) {
        log(`${tamperedCount} transacción(es) con tasa implícita inconsistente (Rate Sneak).`, 'error');
        throw new AssertionError(`${tamperedCount} transacciones con volatilidad de tasa`);
    } else {
        log('Correlación Bs/USD coherente en todo el historial.', 'success');
    }
}

// ════════════════════════════════════════════
// 7. MARGEN NEGATIVO (Venta a Pérdida)
// ════════════════════════════════════════════
async function suiteMargenNegativo() {
    section('💸 SUITE: Margen Negativo (Productos Vendiendo a Pérdida)');
    const products = await storageService.getItem('bodega_products_v1', []);
    if (!products || !products.length) {
        log('No hay productos para auditar.', 'info');
        return;
    }

    // Tasa de referencia: custom_rate o última tasa implícita de ventas
    const rawRate = parseFloat(localStorage.getItem('bodega_custom_rate') || '0');
    if (!rawRate || rawRate <= 0) {
        log('No hay tasa configurada — no se puede calcular margen en Bs. Configura una tasa primero.', 'warn');
        return;
    }

    let negativeMarginCount = 0;
    let totalLossUsd = 0;

    for (const p of products) {
        const priceUsd = p.priceUsd || 0;
        if (priceUsd <= 0) continue; // Sin precio → no hay venta posible

        // Costo en USD: usar costUsd directo si existe, o derivar de costBs / tasa
        let costUsd = 0;
        if (p.costUsd && p.costUsd > 0) {
            costUsd = p.costUsd;
        } else if (p.costBs && p.costBs > 0) {
            costUsd = round2(p.costBs / rawRate);
        } else {
            continue; // Sin costo registrado → no se puede auditar
        }

        if (costUsd > 0 && priceUsd < costUsd) {
            negativeMarginCount++;
            const lossUsd = round2(costUsd - priceUsd);
            totalLossUsd = sumR(totalLossUsd, lossUsd);
            log(`[${p.name || p.id?.slice(-6)}] Precio $${priceUsd} < Costo $${costUsd} → Pérdida unitaria $${lossUsd}`, 'warn');
        }
    }

    if (negativeMarginCount > 0) {
        log(`${negativeMarginCount} producto(s) con margen negativo. Pérdida potencial acumulada: $${totalLossUsd.toFixed(2)} por unidad.`, 'error');
        throw new AssertionError(`${negativeMarginCount} productos vendiendo por debajo de su costo (pérdida potencial: $${totalLossUsd.toFixed(2)})`);
    } else {
        log(`${products.filter(p => (p.priceUsd || 0) > 0).length} productos con precio auditados. Todos con margen positivo.`, 'success');
    }
}

// ════════════════════════════════════════════
// 8. PAGOS INCONSISTENTES (Cuadre de Caja)
// ════════════════════════════════════════════
async function suitePagosInconsistentes() {
    section('🧾 SUITE: Pagos Inconsistentes (Cuadre de Caja)');
    const sales = await storageService.getItem('bodega_sales_v1', []);
    if (!sales || !sales.length) {
        log('No hay ventas para auditar.', 'info');
        return;
    }

    let inconsistentCount = 0;

    for (const sale of sales) {
        if (sale.status === 'ANULADA' || !sale.payments || !sale.payments.length) continue;
        if (!sale.totalUsd) continue;

        // Suma de pagos en USD (cada pago tiene amountUsd o se deriva de amount/rate)
        let sumPaidUsd = 0;
        for (const pmt of sale.payments) {
            if (pmt.currency === 'USD' || pmt.methodId?.includes('usd') || pmt.methodId === 'cashea') {
                sumPaidUsd = sumR(sumPaidUsd, pmt.amountUsd || pmt.amount || 0);
            } else if (pmt.amountUsd) {
                sumPaidUsd = sumR(sumPaidUsd, pmt.amountUsd);
            } else if (pmt.amount && sale.rate) {
                sumPaidUsd = sumR(sumPaidUsd, round2(pmt.amount / sale.rate));
            }
        }

        // Para VENTA_CASHEA no hay vuelto (ya validado en suiteCashea)
        const changeUsd = sale.tipo === 'VENTA_CASHEA'
            ? 0
            : sumR(sale.changeUsd || 0, sale.rate ? round2((sale.changeBs || 0) / sale.rate) : 0);
        const netPaidUsd = subR(sumPaidUsd, changeUsd);

        // Tolerancia de $0.05 por redondeos de cambio en Bs
        if (Math.abs(netPaidUsd - sale.totalUsd) > 0.05) {
            inconsistentCount++;
            log(`[Ticket ${sale.id?.slice(-6) || '?'}] Cobrado neto $${netPaidUsd} vs Total $${sale.totalUsd} (diff $${Math.abs(netPaidUsd - sale.totalUsd).toFixed(2)})`, 'warn');
        }
    }

    if (inconsistentCount > 0) {
        log(`${inconsistentCount} venta(s) con cuadre de pagos inconsistente.`, 'error');
        throw new AssertionError(`${inconsistentCount} ventas donde pagos ≠ total (posible descuadre de caja)`);
    } else {
        const auditedCount = sales.filter(s => s.status !== 'ANULADA' && s.payments?.length && s.totalUsd).length;
        log(`${auditedCount} ventas con pagos auditadas. Cuadre de caja perfecto.`, 'success');
    }
}

// ════════════════════════════════════════════
// 9. IDs DUPLICADOS
// ════════════════════════════════════════════
async function suiteIdsDuplicados() {
    section('🪪 SUITE: IDs Duplicados (Integridad de Registros)');

    const [products, sales, customers] = await Promise.all([
        storageService.getItem('bodega_products_v1', []),
        storageService.getItem('bodega_sales_v1', []),
        storageService.getItem('bodega_customers_v1', []),
    ]);

    let totalDuplicates = 0;

    const checkDuplicates = (items, label, keyFn = i => i.id) => {
        if (!items?.length) return 0;
        const seen = new Map();
        let dups = 0;
        for (const item of items) {
            const key = keyFn(item);
            if (!key) continue;
            if (seen.has(key)) {
                dups++;
                log(`[${label}] ID duplicado: "${key}"`, 'warn');
            } else {
                seen.set(key, true);
            }
        }
        return dups;
    };

    totalDuplicates += checkDuplicates(products, 'Productos');
    totalDuplicates += checkDuplicates(sales, 'Ventas');
    totalDuplicates += checkDuplicates(customers, 'Clientes');

    // También detectar nombres duplicados en productos (mismo producto ingresado dos veces)
    const nameDups = checkDuplicates(products, 'Productos (nombre)', p => p.name?.trim().toLowerCase());
    if (nameDups > 0) {
        log(`${nameDups} producto(s) con nombre duplicado — posibles entradas dobles en catálogo.`, 'warn');
    }
    totalDuplicates += nameDups;

    if (totalDuplicates > 0) {
        log(`${totalDuplicates} duplicado(s) encontrados en registros.`, 'error');
        throw new AssertionError(`${totalDuplicates} registros con IDs o nombres duplicados`);
    } else {
        log('Integridad referencial OK. Sin IDs ni nombres duplicados.', 'success');
    }
}

// ════════════════════════════════════════════
// 10. AUDITORÍA CASHEA
// ════════════════════════════════════════════
async function suiteCashea() {
    section('⚡ SUITE: Auditoría Cashea (Integridad de Ventas Financiadas)');
    const [sales, customers] = await Promise.all([
        storageService.getItem('bodega_sales_v1', []),
        storageService.getItem('bodega_customers_v1', []),
    ]);

    const casheaSales = sales.filter(s => s.tipo === 'VENTA_CASHEA' && s.status !== 'ANULADA');

    if (casheaSales.length === 0) {
        log('No hay ventas Cashea registradas. Suite omitida.', 'info');
        return;
    }

    log(`Auditando ${casheaSales.length} venta(s) Cashea...`, 'info');
    let errors = 0;

    for (const sale of casheaSales) {
        const id = sale.id?.slice(-6) || '?';

        // 1. Debe tener casheaUsd > 0
        if (!sale.casheaUsd || sale.casheaUsd <= 0) {
            log(`[${id}] VENTA_CASHEA sin casheaUsd registrado.`, 'error');
            errors++;
        }

        // 2. Debe tener un pago con methodId 'cashea' en el array
        const casheaPmt = sale.payments?.find(p => p.methodId === 'cashea');
        if (!casheaPmt) {
            log(`[${id}] Falta pago methodId='cashea' en payments[].`, 'error');
            errors++;
            continue;
        }

        // 3. El amountUsd del pago cashea debe coincidir con casheaUsd
        if (Math.abs((casheaPmt.amountUsd || 0) - (sale.casheaUsd || 0)) > 0.02) {
            log(`[${id}] casheaUsd=$${sale.casheaUsd} vs payments.cashea=$${casheaPmt.amountUsd} — descuadre.`, 'error');
            errors++;
        }

        // 4. La suma de TODOS los pagos (cliente + cashea) debe igualar totalUsd
        const sumPagos = sumR(...(sale.payments || []).map(p => p.amountUsd || 0));
        const diff = Math.abs(sumPagos - sale.totalUsd);
        if (diff > 0.05) {
            log(`[${id}] Suma pagos $${sumPagos} ≠ totalUsd $${sale.totalUsd} (diff $${diff.toFixed(2)}).`, 'error');
            errors++;
        }

        // 5. casheaUsd debe estar en rango válido (1% - 99% del total)
        const pct = sale.casheaUsd / sale.totalUsd;
        if (pct <= 0.01 || pct >= 0.99) {
            log(`[${id}] casheaUsd=${(pct*100).toFixed(0)}% del total — fuera del rango válido (1%-99%).`, 'warn');
        }

        // 6. No debe tener changeUsd ni changeBs (Cashea no genera vuelto)
        if ((sale.changeUsd || 0) > 0.01 || (sale.changeBs || 0) > 0.01) {
            log(`[${id}] VENTA_CASHEA con vuelto registrado — changeUsd=$${sale.changeUsd}, changeBs=$${sale.changeBs}. Inconsistente.`, 'error');
            errors++;
        }

        // 7. Debe tener customerId (Cashea requiere cliente)
        if (!sale.customerId) {
            log(`[${id}] VENTA_CASHEA sin customerId — Cashea requiere cliente vinculado.`, 'error');
            errors++;
        }
    }

    // 8. Cruzar casheaDeuda del cliente con suma de ventas Cashea pendientes
    const casheaDeudaPorCliente = {};
    for (const sale of casheaSales) {
        if (sale.customerId) {
            casheaDeudaPorCliente[sale.customerId] = sumR(
                casheaDeudaPorCliente[sale.customerId] || 0,
                sale.casheaUsd || 0
            );
        }
    }

    for (const customer of customers) {
        const registradaUsd = casheaDeudaPorCliente[customer.id] || 0;
        const storedDeuda = customer.casheaDeuda || 0;
        if (registradaUsd > 0 && Math.abs(storedDeuda - registradaUsd) > 0.10) {
            log(`[Cliente: ${customer.name}] casheaDeuda=$${storedDeuda} vs suma ventas Cashea=$${registradaUsd.toFixed(2)} — posible desincronía.`, 'warn');
        }
    }

    if (errors > 0) {
        log(`${errors} error(es) en ventas Cashea.`, 'error');
        throw new AssertionError(`${errors} ventas Cashea con inconsistencias de integridad`);
    } else {
        log(`${casheaSales.length} ventas Cashea auditadas. Integridad 100%.`, 'success');
    }
}


const SUITES = [
    { key: 'precision_financiera',   name: '🔬 Motor: Certificación de Precisión',            fn: suitePrecisionFinanciera,   fast: true },
    { key: 'auditoria_historica',    name: '🕵️ Histórico: Integridad de Libros',               fn: suiteAuditarDataHistorica,  fast: true },
    { key: 'auditoria_patrimonial',  name: '🛒 Inventario: Auditoría Patrimonial',             fn: suitePatrimonialInventario, fast: true },
    { key: 'auditoria_cartera',      name: '👥 Clientes: Deuda Circular',                      fn: suiteDeudaCircular,         fast: true },
    { key: 'auditoria_cierre',       name: '📦 Finanzas: Ventas Huérfanas de Cierre',          fn: suiteOverlappingCierre,     fast: true },
    { key: 'auditoria_tasas',        name: '💱 Operaciones: Rate Sneak',                       fn: suiteRateSneak,             fast: true },
    { key: 'margen_negativo',        name: '💸 Catálogo: Margen Negativo (Venta a Pérdida)',   fn: suiteMargenNegativo,        fast: true },
    { key: 'pagos_inconsistentes',   name: '🧾 Caja: Pagos Inconsistentes',                    fn: suitePagosInconsistentes,   fast: true },
    { key: 'ids_duplicados',         name: '🪪 Registros: IDs y Nombres Duplicados',           fn: suiteIdsDuplicados,         fast: true },
    { key: 'auditoria_cashea',       name: '⚡ Cashea: Integridad de Ventas Financiadas',       fn: suiteCashea,                fast: true },
];

// ════════════════════════════════════════════
// EXPORTS API
// ════════════════════════════════════════════

export const SystemTester = {
    getSuites: () => [...SUITES],

    getState: () => ({
        logs: [...state.logs],
        suites: [...state.suites],
        isRunning: state.isRunning,
        stopped: state.stopped,
        startedAt: state.startedAt,
        finishedAt: state.finishedAt,
    }),

    stop: () => {
        state.stopped = true;
        log('⛔ Auditoría detenida por el usuario.', 'warn');
    },

    async runAll({ onLog, onProgress, onComplete, fastMode = false } = {}) {
        resetState();
        const targetSuites = fastMode ? SUITES.filter(s => s.fast) : SUITES;
        initSuites(targetSuites);

        state.isRunning = true;
        state.startedAt = Date.now();
        state.onLog = onLog || null;
        state.onProgress = onProgress || null;

        log(`🚀 Auditor Financiero v5.0 — ${targetSuites.length} suites`, 'info');

        let passed = 0;
        let failed = 0;

        for (let i = 0; i < targetSuites.length; i++) {
            const suiteConfig = targetSuites[i];

            if (state.stopped) {
                log('⛔ Auditoría abortada por el usuario.', 'warn');
                updateSuiteStatus(suiteConfig.key, { status: 'skipped' });
                continue;
            }

            onProgress?.({ name: suiteConfig.name, current: i + 1, total: targetSuites.length });
            updateSuiteStatus(suiteConfig.key, { status: 'running', startedAt: Date.now() });

            try {
                await suiteConfig.fn();
                updateSuiteStatus(suiteConfig.key, { status: 'passed', finishedAt: Date.now() });
                passed++;
            } catch (err) {
                log(`Suite fallida: ${suiteConfig.name} — ${err.message}`, 'error');
                updateSuiteStatus(suiteConfig.key, { status: 'failed', finishedAt: Date.now(), error: err.message });
                failed++;
            }

            await delay(20);
        }

        state.finishedAt = Date.now();
        const elapsedSec = ((state.finishedAt - state.startedAt) / 1000).toFixed(1);

        section('📊 RESULTADO FINAL');
        log(`✅ ${passed} aprobadas | ❌ ${failed} fallidas | ⏱️ ${elapsedSec}s`, passed > 0 && failed === 0 ? 'success' : failed > 0 ? 'error' : 'info');

        state.isRunning = false;

        const finalSummary = this.getState();
        onComplete?.(finalSummary);
        return finalSummary;
    },

    async runSuite(suiteId, { onLog } = {}) {
        resetState();
        const suiteConfig = SUITES.find(s => s.key === suiteId);

        if (!suiteConfig) {
            log(`Suite "${suiteId}" no encontrada`, 'error');
            return null;
        }

        initSuites([suiteConfig]);
        state.isRunning = true;
        state.startedAt = Date.now();
        state.onLog = onLog || null;

        updateSuiteStatus(suiteConfig.key, { status: 'running', startedAt: Date.now() });

        try {
            await suiteConfig.fn();
            updateSuiteStatus(suiteConfig.key, { status: 'passed', finishedAt: Date.now() });
            log(`${suiteConfig.name} ✓`, 'success');
        } catch (err) {
            log(`Error en ${suiteConfig.name}: ${err.message}`, 'error');
            updateSuiteStatus(suiteConfig.key, { status: 'failed', finishedAt: Date.now(), error: err.message });
        }

        state.finishedAt = Date.now();
        state.isRunning = false;

        return this.getState();
    },
};
