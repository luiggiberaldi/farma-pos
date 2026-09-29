import CheckoutModal from './CheckoutModal';
import ReceiptModal from './ReceiptModal';
import CustomAmountModal from './CustomAmountModal';
import DiscountModal from './DiscountModal';
import KeyboardHelpModal from './KeyboardHelpModal';
import AperturaCajaModal from '../Dashboard/AperturaCajaModal';
import ConfirmModal from '../ConfirmModal';
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

    {/* Clear Cart Confirm */}
    <ConfirmModal
        isOpen={showClearCartConfirm}
        onClose={() => setShowClearCartConfirm(false)}
        onConfirm={() => { setCart([]); setDiscount({ type: 'percentage', value: 0 }); setShowClearCartConfirm(false); setCartSelectedIndex(-1); }}
        title="¿Vaciar toda la cesta?"
        message="Todos los productos serán eliminados de la cesta actual. Esta acción no se puede deshacer."
        confirmText="Sí, vaciar"
        variant="cart"
    />

    {/* Overpayment sanity-check (B6: ConfirmModal en vez de window.confirm) */}
    <ConfirmModal
        isOpen={!!overpayAlert}
        onClose={() => setOverpayAlert(null)}
        onConfirm={() => {
            const pending = overpayAlert;
            setOverpayAlert(null);
            if (pending) handleCheckout(pending.payments, pending.changeBreakdown, pending.prescription, true);
        }}
        title="Revisar monto"
        message={overpayAlert?.message || ''}
        confirmText="Sí, continuar"
        cancelText="Corregir"
        variant="warning"
    />

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
