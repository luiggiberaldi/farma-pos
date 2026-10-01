import { ShoppingCart, X } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import CartPanel from './CartPanel';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

export default function MobileCartSheet(props) {
    const {
        cart, cartItemCount, cartTotalUsd, cartTotalBs,
        isCartSheetOpen, setIsCartSheetOpen,
        showCheckout, showReceipt,
        cartSubtotalUsd, cartSubtotalBs, effectiveRate, discountData,
        setShowDiscountModal, updateQty, removeFromCart,
        setShowCheckout, setShowClearCartConfirm,
        triggerHaptic, cartSelectedIndex, copEnabled, tasaCop,
    } = props;
    useEscapeToClose(() => setIsCartSheetOpen(false), isCartSheetOpen && !showCheckout && !showReceipt);
    return (
    <div className="md:hidden">
        {/* Floating Action Button */}
        {cart.length > 0 && !isCartSheetOpen && !showCheckout && !showReceipt && (
            <button 
                onClick={() => { triggerHaptic && triggerHaptic(); setIsCartSheetOpen(true); }}
                className="fixed bottom-[max(5rem,env(safe-area-inset-bottom)+4.5rem)] left-4 right-4 bg-emerald-500 hover:bg-emerald-600 text-white p-4 rounded-2xl shadow-xl shadow-emerald-500/30 flex items-center justify-between z-40 active:scale-95 transition-all animate-in slide-in-from-bottom"
            >
                <div className="flex items-center gap-3">
                    <div className="bg-white/20 p-2 rounded-xl">
                        <ShoppingCart size={20} />
                    </div>
                    <div className="text-left">
                        <div className="text-xs font-bold text-emerald-100 uppercase tracking-wider">Ver Cesta</div>
                        <div className="font-black leading-none">{cartItemCount} artículo{cartItemCount !== 1 && 's'}</div>
                    </div>
                </div>
                <div className="text-right">
                    <div className="text-2xl font-black leading-none">${cartTotalUsd.toFixed(2)}</div>
                    <div className="text-xs font-bold text-emerald-100 mt-1">Bs {formatBs(cartTotalBs)}</div>
                </div>
            </button>
        )}

        {/* Bottom Sheet Overlay */}
        {isCartSheetOpen && !showCheckout && !showReceipt && (
            <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 pb-[max(0px,env(safe-area-inset-bottom))]"
                 onClick={() => setIsCartSheetOpen(false)}>
                <div role="dialog" aria-modal="true" aria-label="Cesta actual" className="bg-slate-50 dark:bg-slate-950 w-full rounded-t-3xl shadow-2xl flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-full duration-300"
                     onClick={e => e.stopPropagation()}>
                    <div className="shrink-0 flex justify-center min-h-[44px] items-center cursor-pointer" onClick={() => setIsCartSheetOpen(false)}>
                        <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full" />
                    </div>
                    <div className="shrink-0 px-4 pb-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                        <h3 className="font-black text-slate-800 dark:text-white text-lg flex items-center gap-2">
                            <ShoppingCart size={20} className="text-emerald-500" /> Cesta Actual
                        </h3>
                        <button onClick={() => setIsCartSheetOpen(false)} className="modal-close -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                    <div className="flex-1 overflow-y-auto">
                        <CartPanel
                            cart={cart} effectiveRate={effectiveRate}
                            cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
                            cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} cartItemCount={cartItemCount}
                            discountData={discountData} onOpenDiscount={() => setIsCartSheetOpen(false) || setShowDiscountModal(true)}
                            updateQty={updateQty} removeFromCart={removeFromCart}
                            onCheckout={() => { triggerHaptic && triggerHaptic(); setShowCheckout(true); setIsCartSheetOpen(false); }}
                            onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                            triggerHaptic={triggerHaptic}
                            cartSelectedIndex={cartSelectedIndex}
                            copEnabled={copEnabled}
                            tasaCop={tasaCop}
                        />
                    </div>
                </div>
            </div>
        )}
    </div>
    );
}
