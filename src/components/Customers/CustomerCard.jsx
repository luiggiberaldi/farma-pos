import { Phone, Trash2, CheckCircle2 } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';

export default function CustomerCard({ customer, bcvRate, tasaCop, copEnabled, onClick, onDelete }) {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl px-4 py-3 border border-slate-100 dark:border-slate-800 shadow-sm transition-all active:scale-[0.98] flex items-center gap-2 relative">
            <div
                onClick={onClick}
                className="flex-1 min-w-0 flex items-center gap-3 cursor-pointer"
            >
                <div className="w-11 h-11 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                    <span className="text-lg font-black text-blue-600 dark:text-blue-400">
                        {customer.name.charAt(0).toUpperCase()}
                    </span>
                </div>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                        <h3 className="font-bold text-slate-800 dark:text-white text-sm truncate">{customer.name}</h3>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                        {customer.documentId && (
                            <p className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                {customer.documentId}
                            </p>
                        )}
                        {customer.phone && (
                            <p className="text-[10px] text-slate-400 flex items-center gap-1">
                                <Phone size={10} /> {customer.phone}
                            </p>
                        )}
                    </div>
                </div>
                <div className="text-right shrink-0 flex flex-col items-end gap-0.5">
                    {customer.deuda > 0 && (
                        <div>
                            <p className="text-sm font-black text-red-500 leading-tight">-${formatUsd(customer.deuda)}</p>
                            {bcvRate > 0 && <p className="text-[10px] font-bold text-red-400/70 leading-tight">-{formatBs(customer.deuda * bcvRate)} Bs</p>}
                            {copEnabled && tasaCop > 0 && <p className="text-[10px] font-bold text-red-400/90">-{(customer.deuda * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>}
                        </div>
                    )}
                    {customer.casheaDeuda > 0 && (
                        <div>
                            <p className="text-sm font-black text-purple-500 leading-tight flex items-center gap-1 justify-end"><CasheaIcon size={11} />${formatUsd(customer.casheaDeuda)}</p>
                            {bcvRate > 0 && <p className="text-[10px] font-bold text-purple-400/70 leading-tight">{formatBs(customer.casheaDeuda * bcvRate)} Bs</p>}
                        </div>
                    )}
                    {!customer.deuda && !customer.casheaDeuda && customer.favor > 0 && (
                        <div>
                            <p className="text-sm font-black text-emerald-500 leading-tight">+${formatUsd(customer.favor)}</p>
                            {bcvRate > 0 && <p className="text-[10px] font-bold text-emerald-400/70 leading-tight">+{formatBs(customer.favor * bcvRate)} Bs</p>}
                            {copEnabled && tasaCop > 0 && <p className="text-[10px] font-bold text-emerald-400/90">+{(customer.favor * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>}
                        </div>
                    )}
                    {!customer.deuda && !customer.casheaDeuda && !customer.favor && (
                        <p className="text-xs font-bold text-slate-400 flex items-center gap-1">
                            <CheckCircle2 size={12} className="text-emerald-400" /> Al día
                        </p>
                    )}
                </div>
            </div>
            {onDelete && (
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                    className="p-2 shrink-0 text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-xl transition-colors active:scale-95 z-10"
                >
                    <Trash2 size={16} />
                </button>
            )}
        </div>
    );
}