import { useState } from 'react';
import { Package, Calculator, ChevronDown } from 'lucide-react';
import { BODEGA_CATEGORIES, CATEGORY_ICONS } from '../../config/categories';

const PAGE_SIZE = 30;

export default function CategoryBar({
    selectedCategory,
    setSelectedCategory,
    filteredByCategory,
    addToCart,
    triggerHaptic,
    searchTerm = '',
    onOpenCustomAmount,
    products = [],
}) {
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const [lastCategory, setLastCategory] = useState(selectedCategory);

    // Reset pagination cuando cambia la categoria (ajuste en render, sin effect)
    if (lastCategory !== selectedCategory) {
        setLastCategory(selectedCategory);
        setVisibleCount(PAGE_SIZE);
    }

    const visibleProducts = filteredByCategory.slice(0, visibleCount);
    const hasMore = filteredByCategory.length > visibleCount;
    const allowNegativeStock = localStorage.getItem('allow_negative_stock') === 'true';

    return (
        <div className={`relative ${searchTerm.length === 0 ? 'lg:flex-1 lg:overflow-hidden lg:flex lg:flex-col lg:min-h-0' : ''}`}>
            {/* Category Chips Container with Mask */}
            <div className="relative horizontal-scroll-mask">
                <div className="shrink-0 flex gap-1.5 overflow-x-auto pb-2 pt-1 pl-1 pr-12 scrollbar-hide">
                    {/* Monto Libre Button */}
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); onOpenCustomAmount && onOpenCustomAmount(); }}
                    className="shrink-0 flex items-center gap-1.5 min-h-[44px] px-4 py-2 rounded-full text-[11px] font-black transition-all active:scale-95 bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 hover:bg-blue-100 shadow-sm"
                >
                    <Calculator size={14} />
                    Monto Libre
                </button>

                {/* Divider */}
                <div className="w-px h-6 bg-slate-200 dark:bg-slate-700 my-auto mx-0.5 rounded-full shrink-0" />

                {/* Only show categories that have at least one product */}
                {BODEGA_CATEGORIES.filter(cat => cat.id === 'todos' || products.some(p => p.category === cat.id)).map(cat => {
                    const isActive = selectedCategory === cat.id;
                    const CatIcon = CATEGORY_ICONS[cat.id];
                    return (
                        <button
                            key={cat.id}
                            onClick={() => { triggerHaptic && triggerHaptic(); setSelectedCategory(isActive && cat.id !== 'todos' ? 'todos' : cat.id); }}
                            className={`shrink-0 flex items-center gap-1 min-h-[44px] px-4 py-2 rounded-full text-[11px] font-bold transition-all active:scale-95 ${isActive
                                ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                                : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-800 hover:border-emerald-300'
                                }`}
                        >
                            {CatIcon && <CatIcon size={12} />}
                            {cat.label}
                        </button>
                    );
                })}
                </div>
            </div>

            {/* Product Grid */}
            {searchTerm.length === 0 && (
                <div className="flex-1 overflow-y-auto min-h-0 pb-2">
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-2">
                        {visibleProducts.map(p => {
                            const isOut = (p.stock ?? 0) <= 0;
                            const isDisabled = isOut && !allowNegativeStock;
                            const CatIcon = CATEGORY_ICONS[p.category] || Package;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => addToCart(p)}
                                    disabled={isDisabled}
                                    className={`bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-2 flex flex-col items-center text-center transition-all active:scale-95 hover:border-emerald-300 hover:shadow-sm ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''
                                        }`}
                                >
                                    <div className="w-10 h-10 rounded-lg bg-slate-50 dark:bg-slate-800 flex items-center justify-center mb-1.5 overflow-hidden">
                                        {p.image
                                            ? <img src={p.image} className="w-full h-full object-contain" alt={p.name} />
                                            : <CatIcon size={18} className="text-slate-400" />
                                        }
                                    </div>
                                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 leading-tight line-clamp-2 mb-1">{p.name}</p>
                                    <p className="text-[11px] font-black text-emerald-600 dark:text-emerald-400">${p.priceUsd?.toFixed(2)}</p>
                                    <p className="text-[9px] text-slate-400 font-medium">{isOut ? 'Agotado' : `${p.stock ?? 0} disp.`}</p>
                                </button>
                            );
                        })}
                    </div>

                    {/* Load More button */}
                    {hasMore && (
                        <div className="flex justify-center mt-3">
                            <button
                                onClick={() => { triggerHaptic && triggerHaptic(); setVisibleCount(prev => prev + PAGE_SIZE); }}
                                className="flex items-center gap-1.5 min-h-[44px] px-5 py-2.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:border-emerald-400 hover:text-emerald-600 transition-all active:scale-95 shadow-sm"
                            >
                                <ChevronDown size={14} />
                                Cargar Mas ({filteredByCategory.length - visibleCount} restantes)
                            </button>
                        </div>
                    )}

                    {filteredByCategory.length === 0 && (
                        <div className="text-center py-10">
                            <Package size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                            <p className="text-xs text-slate-400 font-medium">Sin productos en esta categoria</p>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
