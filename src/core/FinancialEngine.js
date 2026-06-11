/**
 * FinancialEngine.js
 * 
 * Centralized, pure-function mathematical engine for POS calculations.
 * ALL financial logic across the app (profits, totals, discounts, breakdowns)
 * MUST route through these functions to guarantee 100% mathematical integrity
 * and shield against UI-side modifications.
 * 
 * v2.0 — Precision Overhaul: All arithmetic uses dinero.js round2/mulR/divR/sumR
 *         to eliminate IEEE 754 floating-point drift.
 */

import { round2, mulR, divR, subR, sumR } from '../utils/dinero';

/**
 * @typedef {Object} CartItem
 * @property {string} id - Product ID (may include '_unit' suffix for unit-mode items)
 * @property {string} [_originalId] - Original product ID before unit-mode transformation
 * @property {string} [_mode] - Sale mode: 'package' (default) or 'unit'
 * @property {number} [_unitsPerPackage] - Units per package (used when _mode is 'unit')
 * @property {string} name - Display name of the product
 * @property {number} qty - Quantity being sold
 * @property {number} priceUsd - Unit price in USD
 * @property {number} [exactBs] - Exact bolivar price (when set by VES-native pricing)
 * @property {number} [costUsd] - Unit cost in USD (for profit calculation)
 * @property {number} [costBs] - Unit cost in Bs (fallback for profit calculation)
 * @property {boolean} [isWeight] - Whether this item is sold by weight
 * @property {number} [discount] - Discount percentage applied to this line item
 */

// ── Labels de métodos de pago de fábrica (lookup puro, sin async) ──
// Resuelve el nombre legible de un methodId sin necesitar el módulo async.
const FACTORY_LABELS = {
    efectivo_bs:       'Efectivo Bs',
    pago_movil:        'Pago Móvil',
    punto_venta:       'Punto de Venta',
    efectivo_usd:      'Efectivo $',
    efectivo_cop:      'Efectivo COP',
    transferencia_cop: 'Transferencia COP',
    saldo_favor:       'Saldo a Favor',
    fiado:             'Fiado (Por Cobrar)',
    cashea:            'Cashea (Por Cobrar)',
};

function _resolveMethodLabel(methodId) {
    if (!methodId) return 'Método Desconocido';
    if (FACTORY_LABELS[methodId]) return FACTORY_LABELS[methodId];
    // Custom: 'custom_1712345678' → humanizar quitando prefijo
    if (methodId.startsWith('custom_')) return 'Método Personalizado';
    // Fallback: convertir snake_case a Title Case
    return methodId.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}


export class FinancialEngine {
    
    /**
     * Calculates the true net profit of a single sale.
     * Subtracts the global cart discount and evaluates margin per item.
     * 
     * @param {Object} sale - The sale object from database
     * @param {number} bcvRate - The active BCV rate for fallback comparisons
     * @param {Array} products - The global product dictionary to resolve unknown costs
     * @returns {number} Net Profit in Bs.
     */
    static calculateSaleProfit(sale, bcvRate, products) {
        if (!sale || !sale.items || sale.items.length === 0) return 0;
        
        const saleRate = sale.rate || bcvRate;
        
        // Sum the profit of each individual item (Revenue - Cost)
        const itemProfits = sale.items.map(item => {
            let costBs = 0;
            
            if (item.costUsd) {
                costBs = mulR(item.costUsd, saleRate);
            } else if (item.costBs) {
                costBs = round2(item.costBs);
            } else {
                // Fallback: Resolve cost dynamically from the products dictionary
                const p = products.find(p => p.id === item.id || p.id === item._originalId || p.name === item.name);
                if (p) {
                    costBs = p.costUsd ? mulR(p.costUsd, saleRate) : round2(p.costBs || 0);
                    if (item.id && typeof item.id === 'string' && item.id.endsWith('_unit')) {
                        costBs = divR(costBs, (p.unitsPerPackage || 1));
                    }
                }
            }
            
            // Revenue = price * qty * rate (rounded at each step)
            const itemRevenueBs = mulR(mulR(item.priceUsd, item.qty), saleRate);
            const itemCostBs = mulR(costBs, item.qty);
            return subR(itemRevenueBs, itemCostBs);
        });

        const itemsProfit = sumR(itemProfits);

        // Subtract the global cart discount spread (represented in Bs)
        const discountBs = mulR((sale.discountAmountUsd || 0), saleRate);
        
        return subR(itemsProfit, discountBs);
    }

    /**
     * Aggregates total profit for an array of sales.
     */
    static calculateAggregateProfit(salesArray, bcvRate, products) {
        const profits = salesArray.map(sale => this.calculateSaleProfit(sale, bcvRate, products));
        return sumR(profits);
    }

    /**
     * Calculates the breakdown of payments received across multiple sales,
     * deducting the change returned (`changeUsd` or `changeBs`) to find the True Net Receipts.
     * 
     * @param {Array} salesArray - Array of sales to aggregate
     * @returns {Object} A dictionary mapping methodId to total amounts.
     */
    static calculatePaymentBreakdown(salesArray) {
        const breakdown = {};

        salesArray.forEach(sale => {
            // ── APERTURA DE CAJA: add opening float to cash buckets (not revenue) ──
            if (sale.tipo === 'APERTURA_CAJA') {
                if (sale.openingUsd > 0) {
                    if (!breakdown['efectivo_usd']) breakdown['efectivo_usd'] = { total: 0, currency: 'USD', label: 'Efectivo $' };
                    breakdown['efectivo_usd'].total = round2(breakdown['efectivo_usd'].total + round2(sale.openingUsd));
                }
                if (sale.openingBs > 0) {
                    if (!breakdown['efectivo_bs']) breakdown['efectivo_bs'] = { total: 0, currency: 'BS', label: 'Efectivo Bs' };
                    breakdown['efectivo_bs'].total = round2(breakdown['efectivo_bs'].total + round2(sale.openingBs));
                }
                return; // Do NOT count opening as revenue
            }

            // Fiado sales go to their own bucket — tracked in USD directly since debts hold value in $
            if (sale.tipo === 'VENTA_FIADA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { total: 0, currency: 'FIADO', label: 'Fiado (Por Cobrar)' };
                }
                breakdown['fiado'].total = round2(breakdown['fiado'].total + round2(sale.totalUsd || 0));
                return; // Skip normal payment processing and change deduction
            }

            // Debt collection reduces the outstanding fiado balance for the period (using USD to prevent exchange rate drift)
            if (sale.tipo === 'COBRO_DEUDA') {
                if (!breakdown['fiado']) {
                    breakdown['fiado'] = { total: 0, currency: 'FIADO', label: 'Fiado (Por Cobrar)' };
                }
                breakdown['fiado'].total = round2(breakdown['fiado'].total - round2(sale.totalUsd || 0));
                // Continue execution below to register the actual cash/transfer received
            }

            if (!sale.payments || sale.payments.length === 0) {
                // V1 Legacy Sales & Cobro Deudas
                const method = sale.paymentMethod || 'efectivo_bs';
                let currency = 'BS';
                let valueToSum = round2(sale.totalBs || 0);

                if (method.includes('usd') || method.includes('zelle') || method.includes('binance')) {
                    currency = 'USD';
                    valueToSum = round2(sale.totalUsd || 0);
                } else if (method.includes('cop')) {
                    currency = 'COP';
                    valueToSum = round2(sale.totalCop || 0);
                }

                if (!breakdown[method]) {
                    breakdown[method] = { total: 0, currency: currency, label: _resolveMethodLabel(method) };
                }
                breakdown[method].total = round2(breakdown[method].total + valueToSum);
            } else {
                // Aggregate incoming payments (V2 sales)
                sale.payments.forEach(p => {
                    if (!breakdown[p.methodId]) {
                        // Resolver label de forma robusta:
                        // 1. methodLabel del objeto pago (nuevo formato)
                        // 2. methodLabel del payload legacy
                        // 3. methodId formateado como fallback humano
                        const resolvedLabel = (p.methodLabel && p.methodLabel !== p.methodId)
                            ? p.methodLabel
                            : _resolveMethodLabel(p.methodId);

                        breakdown[p.methodId] = { 
                            total: 0, 
                            currency: p.currency || 'BS', 
                            label: resolvedLabel
                        };
                    }

                    // Use pre-computed amountUsd/amountBs; fallback with sale rate (NEVER hardcoded)
                    const saleRate = sale.rate || 1;
                    const amountUsd = p.amountUsd !== undefined
                        ? round2(p.amountUsd)
                        : (p.currency === 'USD' ? round2(p.amount) : divR(p.amount, saleRate));
                    const amountBs = p.amountBs !== undefined
                        ? round2(p.amountBs)
                        : (p.currency === 'BS' ? round2(p.amount) : mulR(p.amount, saleRate));

                    if (p.currency === 'USD') {
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountUsd);
                    } else if (p.currency === 'COP') {
                        // Store native COP amount: convert back from USD using sale's tasaCop
                        const copAmount = mulR(amountUsd, (sale.tasaCop || 1));
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + copAmount);
                    } else {
                        breakdown[p.methodId].total = round2(breakdown[p.methodId].total + amountBs);
                    }
                });
            }

            // Deduct outgoing change to find True Net Income
            let safeChangeUsd = round2(sale.changeUsd || 0);
            let safeChangeBs = round2(sale.changeBs || 0);
            
            // ── ANOMALY DETECTION (Warning-only mode — v2.0) ──
            // Instead of silently zeroing anomalous change, we FLAG the sale
            // but still register the full change amount for mathematical accuracy.
            // The UI can read sale._changeAnomaly to display a warning badge.
            const saleRate = sale.rate || 1;
            const isChangeAnomalousUsd = safeChangeUsd > 100 && safeChangeUsd > (round2(sale.totalUsd || 0) * 5);
            const isChangeAnomalousBs = safeChangeBs > mulR(100, saleRate) && safeChangeBs > (round2(sale.totalBs || 0) * 5);
            
            if (isChangeAnomalousUsd || isChangeAnomalousBs) {
                // Flag for UI — but do NOT zero out the values
                if (!sale._changeAnomaly) {
                    // We can't mutate the sale object directly (may be frozen),
                    // so we just log the warning. UI should check independently.
                    console.warn(`[FinancialEngine] Anomalia de vuelto detectada en venta ${sale.id}: changeUsd=${safeChangeUsd}, changeBs=${safeChangeBs}, totalUsd=${sale.totalUsd}`);
                }
            }
            
            // If the sale was completely free/zero, any outgoing change is a glitch
            if (round2(sale.totalUsd || 0) === 0 && round2(sale.totalBs || 0) === 0) {
                safeChangeUsd = 0;
                safeChangeBs = 0;
            }

            if (safeChangeUsd !== 0) {
                // Separate the USD change given back into its own positive/negative entry so the
                // "Efectivo $" row never goes negative and the change is visible in the UI.
                if (!breakdown['vuelto_usd']) breakdown['vuelto_usd'] = { total: 0, currency: 'USD', label: 'Vuelto en $ entregado', isChange: true };
                breakdown['vuelto_usd'].total = round2(breakdown['vuelto_usd'].total + safeChangeUsd);
            }
            if (safeChangeBs !== 0) {
                // Separate the Bs change given back into its own positive/negative entry so the
                // "Efectivo Bs" row never goes negative (even when change came from a USD sale).
                if (!breakdown['vuelto_bs']) breakdown['vuelto_bs'] = { total: 0, currency: 'BS', label: 'Vuelto en Bs entregado', isChange: true };
                breakdown['vuelto_bs'].total = round2(breakdown['vuelto_bs'].total + safeChangeBs);
            }
        });

        // Final pass: round all totals strictly and filter out zeroes
        const finalBreakdown = {};
        Object.keys(breakdown).forEach(k => {
            const roundedTotal = round2(breakdown[k].total);
            if (roundedTotal !== 0) {
                finalBreakdown[k] = { ...breakdown[k], total: roundedTotal };
            }
        });

        return finalBreakdown;
    }

    /**
     * Generates standard Checkout Cart Totals (Gross -> Discount -> Net -> Bs / COP equivalent)
     * Used exclusively BEFORE persisting a sale.
     * 
     * @param {Array} cartItems - Array of live cart items
     * @param {Object} discountData - { type: 'percentage'|'fixed', value: number }
     * @param {number} bcvRate - Exchange rate
     * @param {number} copRate - USD to COP Exchange rate
     * @returns {Object} Complete financial summary for the receipt.
     */
    static buildCartTotals(cartItems, discountData, bcvRate, copRate = 0) {
        // Round each line item BEFORE summing to prevent IEEE 754 drift
        const lineItemsUsd = cartItems.map(item => mulR(item.priceUsd, item.qty));
        const subtotalUsd = sumR(lineItemsUsd);
        
        const lineItemsBs = cartItems.map(item => {
            if (item.exactBs != null) {
                return mulR(item.exactBs, item.qty);
            }
            return mulR(mulR(item.priceUsd, item.qty), bcvRate);
        });
        const subtotalBs = sumR(lineItemsBs);
        
        let discountAmountUsd = 0;
        if (discountData && discountData.value > 0) {
            if (discountData.type === 'percentage') {
                discountAmountUsd = mulR(subtotalUsd, (discountData.value / 100));
            } else if (discountData.type === 'fixed') {
                discountAmountUsd = round2(discountData.value);
            }
        }
        
        if (discountAmountUsd > subtotalUsd) discountAmountUsd = subtotalUsd;
        
        const totalUsd = round2(Math.max(0, subR(subtotalUsd, discountAmountUsd)));
        
        const discountAmountBs = mulR(discountAmountUsd, bcvRate);
        const totalBs = round2(Math.max(0, subR(subtotalBs, discountAmountBs)));
        
        const totalCop = copRate > 0 ? mulR(totalUsd, copRate) : 0;

        return {
            subtotalUsd,
            subtotalBs,
            discountAmountUsd,
            discountAmountBs,
            totalUsd,
            totalBs,
            totalCop
        };
    }
}
