import { Users, ChevronDown, ChevronUp } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { formatBs } from '../../utils/calculatorUtils';

export default function PendingDebts({ isAdmin, totalDeudas, bcvRate, showTopDeudas, setShowTopDeudas, triggerHaptic }) {
    if (!isAdmin || totalDeudas.count === 0) return null;
    return (
            <div
                onClick={() => { setShowTopDeudas(!showTopDeudas); triggerHaptic && triggerHaptic(); }}
                className="bg-white rounded-2xl p-4 border border-rose-100 shadow-sm relative overflow-hidden cursor-pointer active:scale-[0.99] transition-all"
            >
                <div className="absolute -right-4 -top-4 w-16 h-16 bg-rose-50 rounded-full blur-2xl" />
                <div className="flex items-center justify-between relative z-10">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-rose-50 rounded-xl flex items-center justify-center">
                            <Users size={20} className="text-rose-500" />
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-rose-400 uppercase tracking-widest">Deudas</p>
                            <p className="text-xl font-black text-rose-600">${totalDeudas.totalUsd.toFixed(2)}</p>
                            {totalDeudas.totalCashea > 0 && (
                                <div className="flex items-center gap-2 mt-0.5">
                                    {totalDeudas.totalFiado > 0 && (
                                        <span className="text-[10px] font-bold text-rose-400">Fiado ${totalDeudas.totalFiado.toFixed(2)}</span>
                                    )}
                                    {totalDeudas.totalFiado > 0 && <span className="text-[10px] text-slate-300">·</span>}
                                    <span className="text-[10px] font-bold text-purple-500 flex items-center gap-0.5">
                                        <CasheaIcon size={9} /> ${totalDeudas.totalCashea.toFixed(2)}
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="text-right flex items-center gap-2">
                        <div>
                            <p className="text-sm font-bold text-slate-500">{totalDeudas.count} {totalDeudas.count === 1 ? 'cliente' : 'clientes'}</p>
                            {bcvRate > 0 && <p className="text-[10px] text-slate-400">{formatBs(totalDeudas.totalUsd * bcvRate)} Bs</p>}
                        </div>
                        {showTopDeudas ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                    </div>
                </div>

                {showTopDeudas && (
                    <div className="mt-4 pt-3 border-t border-slate-100 space-y-2 relative z-10 animate-fade-in text-slate-700">
                        {totalDeudas.top5.map((c, i) => (
                            <div key={c.id} className="flex items-center justify-between py-1.5">
                                <div className="flex items-center gap-2.5 min-w-0">
                                    <span className="text-[10px] font-black text-rose-300 w-4 text-center shrink-0">{i + 1}</span>
                                    <div className="w-7 h-7 rounded-full bg-rose-50 flex items-center justify-center shrink-0">
                                        <span className="text-xs font-black text-rose-500">{c.name.charAt(0).toUpperCase()}</span>
                                    </div>
                                    <p className="text-xs font-bold truncate">{c.name}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    {(c.deuda || 0) > 0 && (c.casheaDeuda || 0) > 0 ? (
                                        <>
                                            <p className="text-sm font-black text-rose-600">${((c.deuda||0)+(c.casheaDeuda||0)).toFixed(2)}</p>
                                            <div className="flex items-center gap-1.5 justify-end mt-0.5">
                                                <span className="text-[9px] font-bold text-rose-400">F ${(c.deuda||0).toFixed(2)}</span>
                                                <span className="text-[9px] text-slate-300">·</span>
                                                <span className="text-[9px] font-bold text-purple-500 flex items-center gap-0.5"><CasheaIcon size={7} />${(c.casheaDeuda||0).toFixed(2)}</span>
                                            </div>
                                        </>
                                    ) : (c.casheaDeuda || 0) > 0 ? (
                                        <>
                                            <p className="text-sm font-black text-purple-600 flex items-center gap-1 justify-end"><CasheaIcon size={12} />${(c.casheaDeuda||0).toFixed(2)}</p>
                                            {bcvRate > 0 && <p className="text-[9px] text-purple-400/60">{formatBs((c.casheaDeuda||0) * bcvRate)} Bs</p>}
                                        </>
                                    ) : (
                                        <>
                                            <p className="text-sm font-black text-rose-600">${(c.deuda || 0).toFixed(2)}</p>
                                            {bcvRate > 0 && <p className="text-[9px] text-rose-400/60">{formatBs((c.deuda || 0) * bcvRate)} Bs</p>}
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
    );
}
