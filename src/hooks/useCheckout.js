import { showToast } from '../components/Toast';
import { processSaleTransaction } from '../utils/checkoutProcessor';
import { getSaleBusinessDate } from '../utils/closureLogic';
import { getLocalISODate } from '../utils/dateHelpers';
import { hasValidSalePrice } from '../utils/productPrice.js';
import { isStorageContextActive } from '../config/storageScope.js';

export function useCheckout(deps) {
    const {
        checkoutInFlight, setIsProcessingSale, triggerHaptic,
        cartTotalUsd, cartTotalBs, effectiveRate, cart, cartSubtotalUsd,
        playCheckout, playError, setCart, setCartSelectedIndex,
        setCustomers, setSalesData, setSelectedCustomerId,
        setShowCheckout, setShowConfetti, setShowReceipt, setOverpayAlert,
        selectedCustomerId, discountData, usuarioActivo, bcvRate,
        customers, products, storageService, tasaCop, copEnabled,
        useAutoRate, rateMode, storageContext, todayAperturaData,
        checkpointCheckout, adoptCommittedProducts, notifyLowStock, operationId,
    } = deps;

const handleCheckout = async (payments, changeBreakdown, prescription = null, skipOverpayCheck = false) => {
    if (checkoutInFlight.current) return;
    setIsProcessingSale(true);
    triggerHaptic && triggerHaptic();

    // ── Guardarraíl: ningún item del carrito puede cobrarse en $0 ────
    // (Segunda capa; la primera está en addToCart. El precio principal es USD.)
    const sinPrecio = (cart || []).filter(item => !hasValidSalePrice(item));
    if (sinPrecio.length > 0) {
        setIsProcessingSale(false);
        playError();
        const nombres = sinPrecio.slice(0, 3).map(i => i.name).join(', ');
        showToast(`No se puede cobrar: ${nombres}${sinPrecio.length > 3 ? ` (+${sinPrecio.length - 3} más)` : ''} no tienen precio válido.`, 'error');
        return;
    }

    // ── Overpayment sanity check (3 layers) ──────────────────────────
    if (!skipOverpayCheck && cartTotalUsd > 0.5) {
        const totalPaidUsd = payments.reduce((sum, p) => sum + (p.amountUsd || 0), 0);
        const ratio = totalPaidUsd / cartTotalUsd;
        const diff = totalPaidUsd - cartTotalUsd;

        let alertMsg = null;

        // Capa 1: confusión de moneda Bs → USD
        // El cajero ingresó bolívares en un campo de dólares
        if (!alertMsg && effectiveRate > 1) {
            const usdPayments = payments.filter(p => {
                const label = (p.label || p.method || '').toLowerCase();
                return label.includes('dólar') || label.includes('dolar') || label.includes('usd') || label === 'efectivo';
            });
            for (const p of usdPayments) {
                const rawAmount = p.amountUsd || 0;
                const asUsd = rawAmount / effectiveRate;
                if (Math.abs(asUsd - cartTotalUsd) / cartTotalUsd < 0.10) {
                    const totalBsExpected = (cartTotalUsd * effectiveRate).toFixed(2);
                    alertMsg = `¿Ingresaste bolívares en el campo de dólares?\n\nMonto ingresado: $${rawAmount.toFixed(2)}\nTotal real en Bs: Bs ${totalBsExpected}\n\nSi pagó en bolívares, el total correcto es Bs ${totalBsExpected}.`;
                    break;
                }
            }
        }

        // Capa 2: umbral proporcional por tamaño de venta
        if (!alertMsg) {
            let triggerRatio = null;
            let triggerDiff = null;
            if      (cartTotalUsd <= 10)  { triggerRatio = 4;   triggerDiff = 15;  }
            else if (cartTotalUsd <= 50)  { triggerRatio = 3;   triggerDiff = 30;  }
            else if (cartTotalUsd <= 200) { triggerRatio = 2;   triggerDiff = 50;  }
            else                          { triggerRatio = 1.5; triggerDiff = 100; }

            if (ratio > triggerRatio && diff > triggerDiff) {
                alertMsg = `Monto alto detectado.\n\nPagado: $${totalPaidUsd.toFixed(2)} (${ratio.toFixed(1)}× el total)\nTotal venta: $${cartTotalUsd.toFixed(2)}\n\n¿Estás seguro?`;
            }
        }

        // Capa 3: número redondo sospechoso (termina en 000 o 500) y supera 3× el total
        if (!alertMsg && ratio > 3) {
            const rounded = Math.round(totalPaidUsd);
            if (rounded % 500 === 0 || rounded % 1000 === 0) {
                alertMsg = `El monto parece un número redondeado por error.\n\nIngresado: $${totalPaidUsd.toFixed(2)}\nTotal venta: $${cartTotalUsd.toFixed(2)}\n\n¿Estás seguro?`;
            }
        }

        if (alertMsg) {
            setIsProcessingSale(false);
            setOverpayAlert({ payments, changeBreakdown, prescription, message: alertMsg });
            return;
        }
    }

    const opts = {
        cart, cartTotalUsd, cartTotalBs, cartSubtotalUsd, payments, changeBreakdown,
        selectedCustomerId, customers, products, effectiveRate, tasaCop, copEnabled,
        discountData, useAutoRate, rateMode, storageContext, operationId, prescription,
        cashSessionId: todayAperturaData?.id,
        businessDate: getSaleBusinessDate(todayAperturaData, getLocalISODate(new Date()))
    };

    let result;
    checkoutInFlight.current = true;
    try {
        opts.operationId = checkpointCheckout();
        result = await processSaleTransaction(opts);
    } catch (error) {
        console.error('[Checkout] No se pudo confirmar la venta local:', error);
        showToast('No se pudo confirmar el guardado. Revisa el historial y la cola antes de reintentar.', 'error');
        playError();
        return;
    } finally {
        checkoutInFlight.current = false;
        setIsProcessingSale(false);
    }

    if (!result.success) {
        console.error('Abortando venta:', result.error);
        showToast(result.error, result.error.includes('No se pueden') ? 'warning' : 'error');
        playError();
        setIsProcessingSale(false);
        return;
    }

    // Do not publish an old request into a remounted branch view.
    if (!isStorageContextActive(storageContext)) return;
    try { storageService.assertActive(); } catch { return; }
    adoptCommittedProducts(result.updatedProducts);

    if (result.updatedCustomers) {
        setCustomers(result.updatedCustomers);
    }

    setSalesData(prev => [result.sale, ...prev.filter(sale => sale.id !== result.sale.id)]);
    setShowReceipt(result.sale);
    try { playCheckout(); notifyLowStock(result.updatedProducts); } catch { /* Receipt already committed. */ }
    setShowConfetti(true);
    try { setCart([]); } catch { showToast('Venta guardada. No se pudo vaciar el borrador; su identificador evita duplicarla al reintentar.', 'warning'); }
    setShowCheckout(false);
    setSelectedCustomerId('');
    setCartSelectedIndex(-1);
    setIsProcessingSale(false);
};
    return handleCheckout;
}
