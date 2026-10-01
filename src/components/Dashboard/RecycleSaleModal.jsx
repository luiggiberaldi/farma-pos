import { Recycle } from 'lucide-react';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

export default function RecycleSaleModal({ recycleOffer, onClose, onRecycle }) {
    useEscapeToClose(onClose, !!recycleOffer);
    if (!recycleOffer) return null;
    return (
    <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={onClose}
    >
        <div
            role="dialog" aria-modal="true" aria-label="Reciclar venta"
            className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-[24px] shadow-xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-6 text-center">
                <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 bg-[#0B8D63]/10 text-[#0B8D63] rounded-full flex items-center justify-center">
                        <Recycle size={28} />
                    </div>
                </div>
                <h3 className="text-xl font-black text-slate-800 dark:text-white mb-2">
                    ¿Reciclar Venta?
                </h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
                    ¿Quieres copiar los productos de esta venta anulada a tu caja actual?
                </p>
                <div className="text-left bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 rounded-xl p-3 mb-2">
                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-1">Productos a reciclar</p>
                    <div className="space-y-1.5 max-h-32 overflow-y-auto scrollbar-hide pr-1">
                        {recycleOffer.items?.slice(0, 5).map((item, i) => (
                            <div key={i} className="flex justify-between text-xs bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2 rounded-lg items-center">
                                <span className="font-bold text-slate-700 dark:text-slate-200 truncate pr-2 mr-2">{item.qty}{item.isWeight ? 'kg' : 'u'} {item.name}</span>
                                <span className="text-slate-500 dark:text-slate-400 font-medium shrink-0">${(item.priceUsd * item.qty).toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                    {recycleOffer.items?.length > 5 && (
                        <p className="text-[10px] text-slate-400 dark:text-slate-500 text-center font-bold mt-2">+{recycleOffer.items.length - 5} productos más...</p>
                    )}
                </div>
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-3">
                <button
                    onClick={onClose}
                    className="flex-1 py-3 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl active:scale-[0.98] transition-all"
                >
                    No, gracias
                </button>
                <button
                    onClick={onRecycle}
                    className="flex-1 py-3 bg-[#0B8D63] hover:bg-[#0AA577] text-white font-bold rounded-xl active:scale-[0.98] transition-all flex justify-center items-center gap-2 shadow-md shadow-[#0B8D63]/20"
                >
                    <Recycle size={16} /> Reciclar
                </button>
            </div>
        </div>
    </div>
    );
}
