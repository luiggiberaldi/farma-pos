import { Smartphone, Lock } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { formatBs } from '../../utils/calculatorUtils';
import { round2, mulR } from '../../utils/dinero';

export default function CheckoutCasheaSection(props) {
    const {
        casheaEnabled, useAutoRate, casheaMeetsMinimum, casheaMinAmount,
        selectedCustomer, casheaActive, setCasheaActive,
        CASHEA_PERCENTS, casheaPercent, setCasheaPercent,
        cartTotalUsd, casheaAmountUsd, effectiveRate, triggerHaptic,
    } = props;
    return (
        <>
    {/* -- SECCION CASHEA -- */}
    {casheaEnabled && (
        !useAutoRate ? (
            <div className="mx-3 mb-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-3 flex items-center gap-3 opacity-60">
                <CasheaIcon size={28} />
                <div>
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Lock size={11} /> Cashea no disponible</p>
                    <p className="text-[10px] text-slate-400">Requiere tasa BCV automática</p>
                </div>
            </div>
        ) : !casheaMeetsMinimum ? (
            <div className="mx-3 mb-3 rounded-2xl border border-dashed border-purple-200 dark:border-purple-800/40 p-3 flex items-center gap-3 opacity-60">
                <CasheaIcon size={28} />
                <div>
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Cashea</p>
                    <p className="text-[10px] text-slate-400">Mínimo ${casheaMinAmount.toFixed(2)} para activar Cashea</p>
                </div>
            </div>
        ) : !selectedCustomer ? (
            <div className="mx-3 mb-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-3 flex items-center gap-3">
                <CasheaIcon size={28} />
                <div>
                    <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Cashea</p>
                    <p className="text-[10px] text-slate-400">Selecciona un cliente para usar Cashea</p>
                </div>
            </div>
        ) : (
        <div className={`mx-3 mb-3 rounded-2xl border transition-all ${casheaActive
            ? 'bg-purple-50/80 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/60'
            : 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800'}`}>
            {/* Header toggle */}
            <button
                onClick={() => { setCasheaActive(v => !v); triggerHaptic?.(); }}
                className="w-full flex items-center justify-between p-3"
            >
                <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${casheaActive ? 'text-purple-700 dark:text-purple-300' : 'text-slate-400 dark:text-slate-500'}`}>
                    <span className={`p-1 rounded-lg ${casheaActive ? 'bg-purple-100 dark:bg-purple-900/50' : 'bg-slate-100 dark:bg-slate-800'}`}>
                        <Smartphone size={12} className={casheaActive ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400'} />
                    </span>
                    Cashea
                </h3>
                <div className={`w-9 h-5 rounded-full transition-colors relative ${casheaActive ? 'bg-purple-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                    <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${casheaActive ? 'left-4' : 'left-0.5'}`} />
                </div>
            </button>

            {casheaActive && (
                <div className="px-3 pb-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                    {/* % selector */}
                    <div>
                        <p className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-widest mb-1.5">% Pago Inicial (Cliente paga hoy)</p>
                        <div className="flex flex-wrap gap-1.5">
                            {CASHEA_PERCENTS.map(p => (
                                <button
                                    key={p}
                                    onClick={() => { setCasheaPercent(p); triggerHaptic?.(); }}
                                    className={`min-h-[44px] px-3 py-2 rounded-lg text-xs font-black transition-all active:scale-95 ${casheaPercent === p
                                        ? 'bg-purple-500 text-white shadow-md shadow-purple-500/30'
                                        : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200'}`}
                                >
                                    {p}%
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Desglose */}
                    <div className="bg-white dark:bg-slate-900 rounded-xl border border-purple-200 dark:border-purple-800/50 divide-y divide-purple-100 dark:divide-purple-900/50">
                        <div className="flex items-center justify-between px-3 py-2">
                            <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Cliente paga ahora:</span>
                            <div className="text-right">
                                <span className="text-sm font-black text-slate-800 dark:text-white block">
                                    ${round2(cartTotalUsd - casheaAmountUsd).toFixed(2)}
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">
                                    {formatBs(mulR(round2(cartTotalUsd - casheaAmountUsd), effectiveRate))} Bs
                                </span>
                            </div>
                        </div>
                        <div className="flex items-center justify-between px-3 py-2 bg-purple-50/50 dark:bg-purple-900/10">
                            <span className="text-xs font-bold text-purple-600 dark:text-purple-400">Cashea financia ({100 - casheaPercent}%):</span>
                            <div className="text-right">
                                <span className="text-sm font-black text-purple-700 dark:text-purple-300 block">
                                    ${casheaAmountUsd.toFixed(2)}
                                </span>
                                <span className="text-[10px] font-bold text-purple-400">
                                    {formatBs(mulR(casheaAmountUsd, effectiveRate))} Bs
                                </span>
                            </div>
                        </div>
                    </div>

                    <p className="text-[10px] text-purple-500 dark:text-purple-400 font-medium leading-relaxed flex items-center gap-1.5">
                        <CasheaIcon size={14} /> La venta queda completada. Los ${casheaAmountUsd.toFixed(2)} de Cashea se registran como cuenta por cobrar.
                    </p>
                </div>
            )}
        </div>
        )
    )}
        </>
    );
}
