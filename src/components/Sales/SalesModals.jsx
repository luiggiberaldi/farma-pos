import { useEffect } from 'react';
import CheckoutModal from './CheckoutModal';
import ReceiptModal from './ReceiptModal';
import CustomAmountModal from './CustomAmountModal';
import DiscountModal from './DiscountModal';
import KeyboardHelpModal from './KeyboardHelpModal';
import AperturaCajaModal from '../Dashboard/AperturaCajaModal';
import { useConfirm } from '../../hooks/confirmState';
import Confetti from '../Confetti';
import { buildReceiptWhatsAppUrl } from './ReceiptShareHelper';

export default function SalesModals(props) {
    const {
        showCheckout, setShowCheckout, cartSubtotalUsd, cartSubtotalBs,
        cartTotalUsd, cartTotalBs, discountData, effectiveRate,
        customers, selectedCustomerId, setSelectedCustomerId,
        paymentMethods, handleCheckout, handleCreateCustomer,
        isProcessingSale, cart, products, triggerHaptic,
        copEnabled, tasaCop, useAutoRate, currentFloat,
        showReceipt, setShowReceipt,
        showCustomAmountModal, setShowCustomAmountModal, handleAddCustomAmount,
        showClearCartConfirm, setShowClearCartConfirm, setCart, setDiscount,
        setCartSelectedIndex, overpayAlert, setOverpayAlert,
        showDiscountModal, setShowDiscountModal, discount,
        showConfetti, setShowConfetti, showKeyboardHelp, setShowKeyboardHelp,
        isAperturaOpen, setIsAperturaOpen, handleSaveApertura,
    } = props;
    const confirm = useConfirm();
    // Los confirms de vaciar cesta y sobrepago usan el provider único de
    // confirmación (auditoría de modales 2026-10-01): el estado booleano del
    // padre dispara el diálogo promise-based una sola vez.
    useEffect(() => {
        if (!showClearCartConfirm) return;
        let cancelled = false;
        (async () => {
            const ok = await confirm({
                title: '¿Vaciar toda la cesta?',
                message: 'Todos los productos serán eliminados de la cesta actual. Esta acción no se puede deshacer.',
                confirmText: 'Sí, vaciar',
                variant: 'cart',
            });
            if (cancelled) return;
            setShowClearCartConfirm(false);
            if (ok) { setCart([]); setDiscount({ type: 'percentage', value: 0 }); setCartSelectedIndex(-1); }
        })();
        return () => { cancelled = true; };
    }, [showClearCartConfirm]);
    useEffect(() => {
        if (!overpayAlert) return;
        const pending = overpayAlert;
        let cancelled = false;
        (async () => {
            const ok = await confirm({
                title: 'Revisar monto',
                message: pending.message || '',
                confirmText: 'Sí, continuar',
                cancelText: 'Corregir',
                variant: 'warning',
            });
            if (cancelled) return;
            setOverpayAlert(null);
            if (ok) handleCheckout(pending.payments, pending.changeBreakdown, pending.prescription, true);
        })();
        return () => { cancelled = true; };
    }, [overpayAlert]);
    const requiresPrescription = cart.some(item => { const p = products.find(product => product.id === (item.productId || item._originalId || item.id)); return p?.requiresPrescription || p?.isControlled; });
    return (
        <>
    {/* Checkout Modal */}
    {showCheckout && (
        <CheckoutModal
            onClose={() => { setShowCheckout(false); setSelectedCustomerId(''); }}
            cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
            cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} 
            discountData={discountData} effectiveRate={effectiveRate}
            customers={customers} selectedCustomerId={selectedCustomerId} setSelectedCustomerId={setSelectedCustomerId}
            paymentMethods={paymentMethods}
            onConfirmSale={handleCheckout} onCreateCustomer={handleCreateCustomer}
            isProcessingSale={isProcessingSale}
            requiresPrescription={cart.some(item => { const p = products.find(product => product.id === (item.productId || item._originalId || item.id)); return p?.requiresPrescription || p?.isControlled; })}
            triggerHaptic={triggerHaptic}
            copEnabled={copEnabled}
            tasaCop={tasaCop}
            useAutoRate={useAutoRate}
            currentFloatUsd={currentFloat.usd}
            currentFloatBs={currentFloat.bs}
        />
    )}

    {/* Receipt Modal */}
    <ReceiptModal
        receipt={showReceipt}
        onClose={() => { setShowReceipt(null); setSelectedCustomerId(''); }}
        onShareWhatsApp={(r) => { window.open(buildReceiptWhatsAppUrl(r, effectiveRate), '_blank'); }}
        currentRate={effectiveRate}
    />

    {/* Custom Amount Modal */}
    {showCustomAmountModal && (
        <CustomAmountModal
            onClose={() => setShowCustomAmountModal(false)}
            onConfirm={handleAddCustomAmount}
            effectiveRate={effectiveRate}
            triggerHaptic={triggerHaptic}
        />
    )}

    {/* Discount Modal */}
    {showDiscountModal && (
        <DiscountModal
            currentDiscount={discount}
            cart={cart}
            onApply={(newDiscount) => {
                setDiscount(newDiscount);
                setShowDiscountModal(false);
            }}
            onClose={() => setShowDiscountModal(false)}
            cartSubtotalUsd={cartSubtotalUsd}
            effectiveRate={effectiveRate}
            tasaCop={tasaCop}
            copEnabled={copEnabled}
        />
    )}

    {/* Confetti */}
    {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

    {/* Keyboard Shortcuts Help Modal (Desktop Only) */}
    <KeyboardHelpModal 
        isOpen={showKeyboardHelp} 
        onClose={() => setShowKeyboardHelp(false)} 
    />

    {/* Apertura Caja Modal */}
    <AperturaCajaModal
        isOpen={isAperturaOpen}
        onClose={() => setIsAperturaOpen(false)}
        onConfirm={handleSaveApertura}
    />
        </>
    );
}
