import React from 'react';
import { ShoppingCart, Plus, Minus, X, CheckCircle, Package, Trash2, DollarSign, Percent } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';

export default function CartPanel({
    cart,
    effectiveRate,
    cartSubtotalUsd,
    cartSubtotalBs,
    cartTotalUsd,
    cartTotalBs,
    cartItemCount,
    discountData,
    onOpenDiscount,
    updateQty,
    removeFromCart,
    onCheckout,
    onClearCart,
    triggerHaptic,
    cartSelectedIndex,
    copEnabled,
    tasaCop
}) {
    const [editingQtyId, setEditingQtyId] = React.useState(null);
    const [tempQty, setTempQty] = React.useState('');
    const inputRef = React.useRef(null);

    const handleQtyClick = (item) => {
        setEditingQtyId(item.id);
        setTempQty(item.qty.toString());
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const submitCustomQty = (item) => {
        setEditingQtyId(null);
        let parsed = parseFloat(tempQty.replace(',', '.'));
        if (isNaN(parsed) || parsed <= 0) return; // Ignore invalid values
        
        // Calculate difference and call updateQty (+ delta)
        const diff = parsed - item.qty;
        if (diff !== 0) {
            updateQty(item.id, diff);
        }
    };

    return (
        <div className="md:flex-1 md:min-h-0 flex flex-col bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">

            {/* Header */}
            <div className="shrink-0 px-4 pb-2 pt-3 sm:py-3 lg:py-2 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-950/50 rounded-t-2xl sm:rounded-t-3xl">
                <span className="text-[10px] sm:text-xs font-black text-slate-400 uppercase tracking-wider">Cesta de Compra</span>
                <div className="flex items-center gap-3">
                    {cart.length > 0 && (
                        <button onClick={onClearCart} aria-label="Vaciar carrito" className="text-[10px] sm:text-xs font-bold text-red-500 hover:text-red-700 flex items-center gap-1 transition-colors bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg">
                            <Trash2 size={12} /> Vaciar
                        </button>
                    )}
                    <span className="text-xs font-bold text-slate-500 bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded-full">{cartItemCount} items</span>
                </div>
            </div>

            {/* Cart Items — scrollable area with touch support */}
            <div
                className="md:flex-1 md:min-h-0 md:overflow-y-auto overscroll-contain p-2 sm:p-3"
                style={{ WebkitOverflowScrolling: 'touch' }}
            >
                {cart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 p-6 lg:p-3 text-center h-full">
                        <ShoppingCart size={48} className="mb-4 lg:mb-2 opacity-50 sm:w-[72px] sm:h-[72px] lg:w-[40px] lg:h-[40px]" strokeWidth={1} />
                        <p className="text-sm sm:text-base lg:text-sm font-bold text-slate-400">Cesta vacía</p>
                        <p className="text-xs text-slate-500 mt-1">Busca un producto para empezar a vender.</p>
                    </div>
                ) : (
                    <div className="space-y-2 lg:space-y-1">
                        {cart.map((item, idx) => {
                            const qtyDisplay = item.isWeight ? `${item.qty.toFixed(3)} Kg` : item.qty;
                            const isCustomProduct = item.id.toString().startsWith('custom_') || item.name === 'Venta Libre';
                            const isEditing = editingQtyId === item.id;
                            const isSelected = cartSelectedIndex === idx;

                            return (
                                <div key={item.id} className={`group bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl lg:rounded-xl p-2 pr-6 sm:p-3 sm:pr-10 lg:p-1.5 lg:pr-9 border flex items-center justify-between gap-2 lg:gap-1.5 transition-colors relative ${
                                    isSelected
                                        ? 'border-emerald-500 ring-2 ring-emerald-500/20 dark:border-emerald-400 dark:ring-emerald-400/20'
                                        : 'border-slate-100 dark:border-slate-800/80 hover:border-emerald-200 dark:hover:border-emerald-800'
                                }`}>
                                    <div className="flex items-center gap-2 sm:gap-3 lg:gap-2 flex-1 min-w-0">
                                        <div className={`w-10 h-10 sm:w-12 sm:h-12 lg:w-8 lg:h-8 rounded-lg sm:rounded-xl lg:rounded-lg flex items-center justify-center shrink-0 overflow-hidden ${isCustomProduct ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600' : 'bg-slate-50 dark:bg-slate-950'}`}>
                                            {item.image ? (
                                                <img src={item.image} className="w-full h-full object-contain mix-blend-multiply dark:mix-blend-normal" />
                                            ) : isCustomProduct ? (
                                                <DollarSign size={20} className="sm:w-[22px] sm:h-[22px] lg:w-[16px] lg:h-[16px]" />
                                            ) : (
                                                <Package size={16} className="text-slate-300 sm:w-[18px] sm:h-[18px] lg:w-[14px] lg:h-[14px]" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 pr-1">
                                            <p className="text-xs sm:text-sm lg:text-[11px] font-bold text-slate-800 dark:text-slate-100 leading-tight mb-0.5 sm:mb-1 lg:mb-0 truncate">{item.name}</p>
                                            <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                                                <p className="text-[10px] sm:text-[11px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1 sm:px-1.5 rounded">${item.priceUsd.toFixed(2)}</p>
                                                <p className="text-[10px] sm:text-[11px] font-medium text-slate-400">
                                                    {item.exactBs != null ? formatBs(item.exactBs) : formatBs(item.priceUsd * effectiveRate)} Bs
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end shrink-0 gap-1.5 sm:gap-2 lg:gap-1">
                                        <p className="text-sm sm:text-base lg:text-xs font-black text-slate-800 dark:text-white">${(item.priceUsd * item.qty).toFixed(2)}</p>
                                        <div className="flex items-center bg-slate-50 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-100 dark:border-slate-700">
                                            <button onClick={() => updateQty(item.id, item.isWeight ? -0.1 : -1)} className="w-7 sm:w-8 lg:w-6 h-7 sm:h-8 lg:h-6 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors rounded-l-md active:bg-slate-200 dark:active:bg-slate-700"><Minus size={14} className="lg:w-[12px] lg:h-[12px]" strokeWidth={3} /></button>
                                            
                                            {isEditing ? (
                                                <input
                                                    ref={inputRef}
                                                    type="number"
                                                    value={tempQty}
                                                    onChange={e => setTempQty(e.target.value)}
                                                    onBlur={() => submitCustomQty(item)}
                                                    onKeyDown={e => { if (e.key === 'Enter') submitCustomQty(item) }}
                                                    className="w-12 sm:w-16 h-7 sm:h-8 text-center font-black text-slate-700 bg-white dark:bg-slate-900 dark:text-white border border-emerald-500 rounded text-xs outline-none"
                                                    step={item.isWeight ? "0.01" : "1"}
                                                />
                                            ) : (
                                                <span 
                                                    onClick={() => handleQtyClick(item)} 
                                                    className="w-10 sm:w-12 text-center font-black text-slate-700 dark:text-white text-[11px] sm:text-xs cursor-pointer hover:text-emerald-500 transition-colors"
                                                >
                                                    {qtyDisplay}
                                                </span>
                                            )}

                                            <button onClick={() => updateQty(item.id, item.isWeight ? 0.1 : 1)} className="w-7 sm:w-8 lg:w-6 h-7 sm:h-8 lg:h-6 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors rounded-r-md active:bg-slate-200 dark:active:bg-slate-700"><Plus size={14} className="lg:w-[12px] lg:h-[12px]" strokeWidth={3} /></button>
                                        </div>
                                    </div>
                                    <button onClick={() => removeFromCart(item.id)} className="absolute -top-1 -right-1 sm:top-2 sm:right-2 lg:top-1.5 lg:right-1.5 p-1.5 bg-red-50 dark:bg-red-900/40 text-red-500 sm:bg-transparent sm:text-slate-300 sm:hover:text-red-500 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity rounded-full sm:rounded-lg">
                                        <X size={12} className="sm:w-[14px] sm:h-[14px]" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer — shrink-0, always visible at bottom of flex container */}
            <div className="shrink-0 p-3 sm:p-4 lg:p-2 lg:px-3 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-b-2xl sm:rounded-b-3xl space-y-2 sm:space-y-3 lg:space-y-1">

                {/* Botón de Descuento */}
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); onOpenDiscount(); }}
                    disabled={cart.length === 0}
                    className={`w-full py-2 sm:py-2.5 lg:py-1.5 px-3 sm:px-4 rounded-xl lg:rounded-lg flex items-center justify-between transition-all outline-none focus:ring-2 focus:ring-emerald-500/50 ${discountData?.active ? 'bg-amber-100/80 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                >
                    <div className="flex items-center gap-2">
                        <Percent size={16} className={`lg:w-[14px] lg:h-[14px] ${discountData?.active ? 'text-amber-600 dark:text-amber-500' : ''}`} />
                        <span className="text-[13px] sm:text-sm lg:text-xs font-bold">
                            {discountData?.active ? 'Descuento Aplicado' : 'Añadir Descuento'}
                        </span>
                    </div>
                    {discountData?.active && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] sm:text-xs font-bold bg-amber-200 dark:bg-amber-800/80 px-2 py-0.5 rounded-md">
                                {discountData.type === 'percentage' ? `${discountData.value}%` : 'Fijo'}
                            </span>
                            <span className="font-black text-sm lg:text-xs">-${discountData.amountUsd.toFixed(2)}</span>
                        </div>
                    )}
                </button>

                {/* Total area */}
                <div className="flex justify-between items-end px-1 sm:px-0 lg:pt-0 pt-1">
                    <div className="flex flex-col">
                        <span className="text-[10px] sm:text-xs font-bold text-slate-500 uppercase tracking-widest hidden sm:inline">Total Venta</span>
                        {discountData?.active && (
                            <div className="flex flex-col mt-0.5 fade-in slide-in-from-left-2 animate-in duration-300">
                                <span className="text-[11px] sm:text-xs font-bold text-slate-400 line-through decoration-red-400/70">
                                    Subtotal: ${cartSubtotalUsd.toFixed(2)}
                                </span>
                            </div>
                        )}
                        {/* Bs inline at lg */}
                        <span className="hidden lg:inline text-[11px] font-bold text-emerald-600 dark:text-emerald-400">{formatBs(cartTotalBs)} Bs</span>
                        {copEnabled && (
                            <span className="hidden lg:inline text-[11px] font-bold text-amber-600 dark:text-amber-400">{(cartTotalUsd * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</span>
                        )}
                    </div>
                    <div className="text-right flex items-center gap-3 sm:block w-full sm:w-auto justify-between">
                        <div className="flex flex-col items-start sm:items-end">
                            <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-500 tracking-widest uppercase sm:hidden">Total (Ref)</span>
                            <span className="text-[11px] font-bold text-slate-500 sm:hidden">{formatBs(cartTotalBs)} Bs</span>
                        </div>
                        <p className={`text-2xl sm:text-3xl lg:text-xl font-black leading-none tracking-tight transition-colors ${discountData?.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-800 dark:text-white'}`}>
                            ${cartTotalUsd.toFixed(2)}
                        </p>
                    </div>
                </div>

                {/* Bolívares box — hidden at lg (shown inline above) */}
                <div className="hidden sm:flex lg:hidden justify-between items-center px-4 py-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 rounded-xl">
                    <span className="text-[11px] font-black text-emerald-600 dark:text-emerald-500 tracking-widest uppercase">Bolívares</span>
                    <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">{formatBs(cartTotalBs)} Bs</span>
                </div>

                {/* COP box — hidden at lg (shown inline above) */}
                {copEnabled && (
                    <div className="hidden sm:flex lg:hidden justify-between items-center px-4 py-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/50 rounded-xl">
                        <span className="text-[11px] font-black text-amber-600 dark:text-amber-500 tracking-widest uppercase">Pesos (COP)</span>
                        <span className="text-xl font-black text-amber-600 dark:text-amber-400">{(cartTotalUsd * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                    </div>
                )}

                <button
                    disabled={cart.length === 0}
                    onClick={onCheckout}
                    className="w-full relative group disabled:opacity-50 disabled:cursor-not-allowed">
                    <div className="absolute inset-0 bg-emerald-500 rounded-xl sm:rounded-2xl lg:rounded-xl shadow-emerald-500/30 shadow-lg blur-[2px] opacity-70 group-active:opacity-100 group-hover:blur-[4px] transition-all"></div>
                    <div className="relative w-full py-3 sm:py-4 lg:py-2.5 bg-emerald-500 text-white font-black text-sm sm:text-lg lg:text-sm rounded-xl sm:rounded-2xl lg:rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 tracking-wide">
                        <CheckCircle size={18} className="sm:w-[22px] sm:h-[22px] lg:w-[16px] lg:h-[16px] opacity-80" />
                        PROCESAR COBRO
                    </div>
                </button>
            </div>
        </div>
    );
}
