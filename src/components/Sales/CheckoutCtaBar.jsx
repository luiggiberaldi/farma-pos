import { Receipt, Check, ArrowLeftRight, AlertTriangle, Lock, Users } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { BsIcon } from '../CurrencyIcons';
import { formatBs } from '../../utils/calculatorUtils';
import { divR, subR, mulR } from '../../utils/dinero';

export default function CheckoutCtaBar(props) {
    const {
        isPaid, changeBs, changeUsd, remainingUsd, remainingBs,
        copEnabled, tasaCop, effectiveRate,
        changeCheck, changeUsdGiven, changeBsGiven, selectChange,
        currentFloatUsd, currentFloatBs,
        isProcessingSale, prescriptionReady,
        casheaActive, casheaConfirmReady, selectedCustomerId,
        payMode, triggerHaptic, handleConfirm, setConfirmFiar,
    } = props;
    return (
    <div className="shrink-0 px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-3 lg:flex lg:items-stretch lg:gap-4 lg:space-y-0">
        {/* -- BANNER VUELTO / RESTANTE -- */}
        <div className={`p-3 rounded-xl border-2 transition-all lg:flex-1 ${isPaid
            ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
            : 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800'
            }`}>
            <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isPaid ? 'text-emerald-500' : 'text-orange-500'}`}>
                {isPaid ? 'Vuelto' : 'Resta por Cobrar'}
            </p>
            <div className="flex items-end justify-between">
                <div className="flex flex-col">
                    <span className={`text-2xl font-black ${isPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}`}>
                        ${isPaid ? changeUsd.toFixed(2) : remainingUsd.toFixed(2)}
                    </span>
                </div>
                <div className="flex flex-col text-right">
                    <span className={`text-sm font-bold ${isPaid ? 'text-emerald-500' : 'text-orange-500'}`}>
                        Bs {formatBs(isPaid ? changeBs : remainingBs)}
                    </span>
                    {copEnabled && (
                        <span className={`text-sm font-bold ${isPaid ? 'text-emerald-500' : 'text-orange-500'}`}>
                            COP {isPaid ? mulR(changeUsd, tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : mulR(remainingUsd, tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                    )}
                </div>
            </div>

            {/* DESGLOSE DE VUELTO — solo visible cuando hay vuelto */}
            {isPaid && changeBs > 0 && (
                <div className="mt-2.5 pt-2.5 border-t border-emerald-200 dark:border-emerald-800 space-y-2">
                    <p className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                        <ArrowLeftRight size={10} />
                        Desglosar vuelto
                    </p>
                    {!changeCheck.valid && (
                        <p role="alert" className="text-xs font-bold text-amber-800 dark:text-amber-200">
                            {changeCheck.error}
                        </p>
                    )}

                    {/* Fila: input USD + input Bs */}
                    <div className="flex items-center gap-2">
                        {/* Input USD */}
                        <div className="relative flex-1">
                            <input
                                type="number"
                                inputMode="decimal"
                                placeholder="0.00"
                                aria-label="Vuelto entregado en USD"
                                min="0"
                                step="0.01"
                                value={changeUsdGiven}
                                onChange={e => {
                                    const v = e.target.value;
                                    const usd = Math.min(Math.max(0, parseFloat(v) || 0), changeUsd);
                                    selectChange(v, Math.max(0, subR(changeBs, mulR(usd, effectiveRate))).toFixed(2));
                                }}
                                className="w-full py-3 px-3 pr-12 rounded-lg border-2 border-emerald-200 dark:border-emerald-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1 py-0.5 rounded">USD</span>
                        </div>

                        <span className="text-slate-400 font-black text-xs shrink-0">+</span>

                        {/* Input Bs */}
                        <div className="relative flex-1">
                            <input
                                type="number"
                                inputMode="decimal"
                                placeholder="0.00"
                                aria-label="Vuelto entregado en Bs"
                                min="0"
                                step="0.01"
                                value={changeBsGiven}
                                onChange={e => {
                                    const v = e.target.value;
                                    const bs = Math.min(Math.max(0, parseFloat(v) || 0), changeBs);
                                    selectChange(Math.max(0, divR(subR(changeBs, bs), effectiveRate)).toFixed(2), v);
                                }}
                                className="w-full py-3 px-3 pr-10 rounded-lg border-2 border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30"
                            />
                            <span className="absolute right-2 top-1/2 -translate-y-1/2"><BsIcon size={20} /></span>
                        </div>
                    </div>

                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                // "Todo $": usar floor para no exceder el vuelto en Bs por redondeo.
                                // El remanente (centavos de Bs) va en Bs para que la validación cuadre exacto.
                                const usd = Math.floor(changeUsd * 100) / 100;
                                const remainderBs = Math.max(0, Math.round((changeBs - usd * effectiveRate) * 100) / 100);
                                selectChange(usd.toFixed(2), remainderBs.toFixed(2));
                            }}
                            className="flex-1 min-h-[44px] py-2.5 rounded-lg text-[10px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 active:scale-95 transition-all border border-emerald-200 dark:border-emerald-800"
                        >
                            Todo $
                        </button>
                        <button
                            onClick={() => selectChange('0', changeBs.toFixed(2))}
                            disabled={!Number.isFinite(effectiveRate) || effectiveRate <= 0}
                            className="flex-1 min-h-[44px] py-2.5 rounded-lg text-[10px] font-black bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 active:scale-95 transition-all border border-blue-200 dark:border-blue-800"
                        >
                            Todo Bs
                        </button>
                    </div>

                    {/* FLOAT WARNINGS */}
                    {(parseFloat(changeUsdGiven) > currentFloatUsd + 0.05 || parseFloat(changeBsGiven) > currentFloatBs + 1) && (
                        <div className="mt-1.5 p-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 flex items-start gap-1">
                            <AlertTriangle size={10} className="text-orange-500 shrink-0 mt-0.5" />
                            <div className="flex-1">
                                <p className="text-[9px] font-bold text-orange-600 dark:text-orange-400 leading-tight">
                                    Vuelto excede el fondo de caja.
                                </p>
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>

        <button
            onClick={() => {
                if (isPaid) {
                    triggerHaptic && triggerHaptic();
                    handleConfirm();
                } else if (casheaActive && casheaConfirmReady && selectedCustomerId) {
                    triggerHaptic && triggerHaptic();
                    setConfirmFiar(true);
                } else if (payMode === 'fiado' && selectedCustomerId && casheaConfirmReady) {
                    triggerHaptic && triggerHaptic();
                    setConfirmFiar(true);
                }
            }}
            disabled={isProcessingSale || !changeCheck.valid || !prescriptionReady
                ? true
                : isPaid
                    ? false
                    : casheaActive
                        ? (!selectedCustomerId || !casheaConfirmReady)
                        : payMode === 'fiado'
                            ? (!selectedCustomerId || !casheaConfirmReady)
                            : true}
            className={`w-full py-3.5 font-black text-base rounded-2xl shadow-lg transition-all tracking-wide flex items-center justify-center gap-2 lg:w-80 lg:shrink-0 ${isProcessingSale
                ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 shadow-none cursor-not-allowed opacity-70'
                : isPaid
                ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25 active:scale-[0.98] text-white'
                : casheaActive
                    ? casheaConfirmReady
                        ? 'bg-purple-500 hover:bg-purple-600 shadow-purple-500/25 active:scale-[0.98] text-white'
                        : 'bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 shadow-none cursor-not-allowed'
                    : payMode === 'fiado' && selectedCustomerId
                        ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/25 active:scale-[0.98] text-white'
                        : 'bg-slate-300 dark:bg-slate-800 text-slate-500 shadow-none cursor-not-allowed'
                }`}
        >
            {isProcessingSale ? (
                <><Receipt size={18} className="animate-pulse" /> PROCESANDO...</>
            ) : isPaid ? (
                <><Check size={18} /> CONFIRMAR VENTA</>
            ) : casheaActive ? (
                casheaConfirmReady
                    ? <><CasheaIcon size={18} /> REGISTRAR CON CASHEA · PAGA AHORA ${remainingUsd.toFixed(2)}</>
                    : <><Lock size={16} /> CASHEA — INGRESA ${remainingUsd.toFixed(2)} DEL CLIENTE</>
            ) : payMode === 'fiado' ? (
                selectedCustomerId
                    ? <><Users size={18} /> FIAR RESTANTE (${remainingUsd.toFixed(2)})</>
                    : <><Users size={18} /> SELECCIONA CLIENTE PARA FIAR</>
            ) : (
                <><Receipt size={18} /> INGRESA LOS PAGOS</>
            )}
        </button>
    </div>
    );
}
