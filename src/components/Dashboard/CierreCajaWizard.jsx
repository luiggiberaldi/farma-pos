import React, { useState } from 'react';
import { X, ChevronRight, DollarSign, Wallet, CheckCircle2, AlertTriangle, TrendingUp, ShoppingBag, Package, ArrowRight, Coins, EyeOff } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { formatBs } from '../../utils/calculatorUtils';
import { getPaymentLabel, getPaymentIcon, toTitleCase } from '../../config/paymentMethods';

export default function CierreCajaWizard({
    isOpen,
    onClose,
    onConfirm,
    // Data from DashboardView
    todaySales = [],
    todayTotalUsd = 0,
    todayTotalBs = 0,
    todayProfit = 0,
    todayItemsSold = 0,
    todayExpensesUsd = 0,
    paymentBreakdown = {},
    todayTopProducts = [],
    bcvRate = 1,
    copEnabled = false,
    tasaCop = 0,
    blindClose = false,
}) {
    const [step, setStep] = useState(1);
    const [actualUsd, setActualUsd] = useState('');
    const [actualBs, setActualBs] = useState('');
    const [actualCop, setActualCop] = useState('');

    const activeSalesCount = todaySales.filter(s => !s.relatedVoidId && s.tipo !== 'ANULACION_VENTA').length;
    const voidSalesCount = todaySales.filter(s => s.tipo === 'ANULACION_VENTA').length;

    if (!isOpen) return null;

    const expectedUsd = (paymentBreakdown['efectivo_usd']?.total || 0) - (paymentBreakdown['vuelto_usd']?.total || 0);
    const expectedBs = paymentBreakdown['efectivo_bs']?.total || 0;
    const expectedCop = paymentBreakdown['efectivo_cop']?.total || 0;

    const declaredUsd = parseFloat(actualUsd) || 0;
    const declaredBs = parseFloat(actualBs) || 0;
    const declaredCop = parseFloat(actualCop) || 0;
    const diffUsd = declaredUsd - expectedUsd;
    const diffBs = declaredBs - expectedBs;
    const diffCop = declaredCop - expectedCop;

    // Check if there were any COP transactions today
    const hasCopTransactions = copEnabled && (
        expectedCop > 0 ||
        Object.keys(paymentBreakdown).some(k => paymentBreakdown[k].currency === 'COP')
    );

    // Cashea receivable today
    const casheaTotal = paymentBreakdown['cashea']?.total || 0;

    // Total COP del dia (sum of all COP-currency payments)
    const todayTotalCop = copEnabled && tasaCop > 0 ? todayTotalUsd * tasaCop : 0;

    // Semaforo
    const absDiffUsd = Math.abs(diffUsd);
    const getSemaforo = () => {
        if (absDiffUsd <= 0.50) return { color: 'emerald', label: 'Caja cuadrada', icon: CheckCircle2, bg: 'bg-emerald-500' };
        if (absDiffUsd <= 5.00) return { color: 'amber', label: 'Diferencia menor', icon: AlertTriangle, bg: 'bg-amber-500' };
        return { color: 'red', label: 'Discrepancia significativa', icon: AlertTriangle, bg: 'bg-red-500' };
    };

    const handleConfirm = () => {
        onConfirm({ declaredUsd, declaredBs, declaredCop, diffUsd, diffBs, diffCop });
        setStep(1);
        setActualUsd('');
        setActualBs('');
        setActualCop('');
    };

    const handleClose = () => {
        setStep(1);
        setActualUsd('');
        setActualBs('');
        setActualCop('');
        onClose();
    };

    // Excluir entradas negativas del desglose visual: el -fiado aparece cuando un COBRO_DEUDA
    // cancela una VENTA_FIADA de otro turno. El dinero ya aparece en el método de pago real.
    const paymentEntries = Object.entries(paymentBreakdown).filter(([, data]) => data.total > 0);

    // Helper: format COP display  
    const fmtCop = (v) => v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    // Helper: determine currency label for payment breakdown display
    const getCurrencyDisplay = (methodId, data) => {
        if (data.currency === 'COP') return `${fmtCop(data.total)} COP`;
        if (data.currency === 'BS' || methodId.includes('_bs') || methodId === 'pago_movil') return `${formatBs(data.total)} Bs`;
        return `$${data.total.toFixed(2)}`;
    };

    return (
        <div className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-md flex items-end sm:items-center justify-center animate-in fade-in duration-200" onClick={handleClose}>
            <div
                className="bg-white dark:bg-slate-900 w-full sm:max-w-md sm:rounded-3xl rounded-t-3xl max-h-[85vh] sm:max-h-[88vh] flex flex-col shadow-2xl border-t border-slate-200 dark:border-slate-700 animate-in slide-in-from-bottom duration-300"
                onClick={e => e.stopPropagation()}
            >
                {/* Progress Bar */}
                <div className="shrink-0 px-4 sm:px-6 pt-3 sm:pt-5 pb-2 sm:pb-3">
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h2 className="text-lg font-black text-slate-800 dark:text-white">Cierre de Caja</h2>
                            {blindClose && (
                                <div className="flex items-center gap-1 mt-0.5">
                                    <EyeOff size={11} className="text-amber-500" />
                                    <span className="text-[10px] font-bold text-amber-500 uppercase tracking-wide">Cierre ciego</span>
                                </div>
                            )}
                        </div>
                        <button onClick={handleClose} className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                            <X size={18} />
                        </button>
                    </div>
                    {blindClose ? (
                        <>
                            <div className="flex gap-2">
                                {[1, 2].map(s => (
                                    <div key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${s <= step ? 'bg-amber-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                                ))}
                            </div>
                            <div className="flex justify-between mt-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= 1 ? 'text-amber-500' : 'text-slate-400'}`}>Conteo</span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= 2 ? 'text-amber-500' : 'text-slate-400'}`}>Confirmar</span>
                            </div>
                        </>
                    ) : (
                        <>
                            <div className="flex gap-2">
                                {[1, 2, 3].map(s => (
                                    <div key={s} className={`h-1.5 flex-1 rounded-full transition-all duration-500 ${s <= step ? 'bg-indigo-500' : 'bg-slate-200 dark:bg-slate-700'}`} />
                                ))}
                            </div>
                            <div className="flex justify-between mt-2">
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= 1 ? 'text-indigo-500' : 'text-slate-400'}`}>Resumen</span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= 2 ? 'text-indigo-500' : 'text-slate-400'}`}>Conteo</span>
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${step >= 3 ? 'text-indigo-500' : 'text-slate-400'}`}>Resultado</span>
                            </div>
                        </>
                    )}
                </div>

                {/* Content */}
                <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 pb-4 sm:pb-6 scrollbar-hide" style={{ WebkitOverflowScrolling: 'touch' }}>

                    {/* ═══ STEP 1: Resumen del Dia (solo admin) ═══ */}
                    {step === 1 && !blindClose && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-right-4 duration-300">
                            {/* Totales principales */}
                            <div className="bg-gradient-to-br from-indigo-500 to-indigo-700 rounded-2xl p-5 text-white relative overflow-hidden">
                                <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
                                <p className="text-xs font-bold text-indigo-200 uppercase tracking-widest mb-1">Ingresos brutos del dia</p>
                                <p className="text-3xl font-black">${todayTotalUsd.toFixed(2)}</p>
                                <p className="text-sm font-bold text-indigo-200 mt-0.5">{formatBs(todayTotalBs)} Bs</p>
                                {hasCopTransactions && todayTotalCop > 0 && (
                                    <p className="text-sm font-bold text-amber-300 mt-0.5">{fmtCop(todayTotalCop)} COP</p>
                                )}
                                <div className="flex items-center flex-wrap gap-4 mt-3 pt-3 border-t border-white/20">
                                    <div className="flex items-center gap-1.5">
                                        <ShoppingBag size={14} className="text-indigo-200" />
                                        <span className="text-sm font-bold">{activeSalesCount} {activeSalesCount === 1 ? 'venta' : 'ventas'}</span>
                                    </div>
                                    {voidSalesCount > 0 && (
                                        <div className="flex items-center gap-1.5 bg-red-500/20 px-2 py-0.5 rounded-lg border border-red-500/30">
                                            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                                            <span className="text-[11px] font-bold text-red-200">{voidSalesCount} {voidSalesCount === 1 ? 'anulación' : 'anulaciones'}</span>
                                        </div>
                                    )}
                                    <div className="flex items-center gap-1.5">
                                        <Package size={14} className="text-indigo-200" />
                                        <span className="text-sm font-bold">{todayItemsSold} items</span>
                                    </div>
                                </div>
                            </div>

                            {/* Ganancia + Egresos */}
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 rounded-xl p-3">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <TrendingUp size={14} className="text-emerald-500" />
                                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 uppercase">Ganancia</span>
                                    </div>
                                    <p className={`text-lg font-black ${todayProfit >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500'}`}>
                                        {todayProfit >= 0 ? '+' : ''}${bcvRate > 0 ? (todayProfit / bcvRate).toFixed(2) : '0.00'}
                                    </p>
                                    <p className="text-[11px] font-bold text-emerald-500/70">{formatBs(todayProfit)} Bs</p>
                                </div>
                                <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800/30 rounded-xl p-3">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <Package size={14} className="text-orange-500" />
                                        <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 uppercase">Egresos</span>
                                    </div>
                                    <p className="text-lg font-black text-orange-600 dark:text-orange-400">
                                        -${todayExpensesUsd.toFixed(2)}
                                    </p>
                                    <p className="text-[11px] font-bold text-orange-500/70">-{formatBs(todayExpensesUsd * bcvRate)} Bs</p>
                                </div>
                            </div>

                            {/* Cashea Receivable */}
                            {casheaTotal > 0 && (
                                <div className="bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/30 rounded-xl p-3">
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <div className="flex items-center gap-1.5 mb-1">
                                                <CasheaIcon size={18} />
                                                <span className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase">Por Cobrar a Cashea</span>
                                            </div>
                                            <p className="text-lg font-black text-purple-700 dark:text-purple-300">${casheaTotal.toFixed(2)}</p>
                                            <p className="text-[11px] font-bold text-purple-500/70">{formatBs(casheaTotal * bcvRate)} Bs</p>
                                        </div>
                                        <div className="text-right">
                                            <p className="text-[9px] font-bold text-purple-500 uppercase tracking-wide">Cuenta por cobrar</p>
                                            <p className="text-[9px] text-purple-400 mt-0.5">Financiado por Cashea hoy</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* Desglose por metodo de pago */}
                            {paymentEntries.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 pl-1">Desglose por metodo</h4>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50 divide-y divide-slate-100 dark:divide-slate-700/50">
                                        {paymentEntries.map(([methodId, data]) => {
                                            const IconComp = getPaymentIcon(methodId);
                                            return (
                                                <div key={methodId} className="flex items-center justify-between px-4 py-3">
                                                    <div className="flex items-center gap-2.5">
                                                        <div className="w-8 h-8 bg-white dark:bg-slate-700 rounded-lg flex items-center justify-center shadow-sm">
                                                            {IconComp ? <IconComp size={16} className="text-slate-600 dark:text-slate-300" /> : <DollarSign size={16} className="text-slate-600 dark:text-slate-300" />}
                                                        </div>
                                                        <span className="text-sm font-bold text-slate-700 dark:text-slate-200">{toTitleCase(getPaymentLabel(methodId, data.label))}</span>
                                                    </div>
                                                    <span className="text-sm font-black text-slate-800 dark:text-white font-mono">
                                                        {getCurrencyDisplay(methodId, data)}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* Top productos */}
                            {todayTopProducts.length > 0 && (
                                <div>
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 pl-1">Mas vendidos hoy</h4>
                                    <div className="space-y-1.5">
                                        {todayTopProducts.slice(0, 5).map((p, i) => (
                                            <div key={i} className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2 border border-slate-100 dark:border-slate-700/50">
                                                <div className="flex items-center gap-2">
                                                    <span className="w-5 h-5 bg-indigo-100 dark:bg-indigo-900/30 rounded-md flex items-center justify-center text-[10px] font-black text-indigo-500">{i + 1}</span>
                                                    <span className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate max-w-[160px]">{p.name}</span>
                                                </div>
                                                <span className="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-700 px-2 py-0.5 rounded-md">{p.qty} uds</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* CTA */}
                            <button
                                onClick={() => setStep(2)}
                                className="w-full py-4 bg-indigo-500 hover:bg-indigo-600 text-white font-bold rounded-2xl shadow-lg shadow-indigo-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2 text-sm"
                            >
                                Continuar al Conteo <ArrowRight size={18} />
                            </button>
                        </div>
                    )}

                    {/* ═══ STEP 2 (normal) / STEP 1 (blind): Conteo Fisico ═══ */}
                    {((step === 2 && !blindClose) || (step === 1 && blindClose)) && (
                        <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                            <div className="text-center py-2">
                                <div className={`w-16 h-16 ${blindClose ? 'bg-amber-50 dark:bg-amber-900/20' : 'bg-indigo-50 dark:bg-indigo-900/20'} rounded-2xl flex items-center justify-center mx-auto mb-3`}>
                                    {blindClose ? <EyeOff size={32} className="text-amber-500" /> : <Wallet size={32} className="text-indigo-500" />}
                                </div>
                                <h3 className="text-lg font-black text-slate-800 dark:text-white">Conteo Físico</h3>
                                <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-relaxed max-w-[280px] mx-auto">
                                    {blindClose
                                        ? 'Cuenta el efectivo que tienes en la gaveta e ingresa los montos'
                                        : 'Cuenta el efectivo físico que tienes en la gaveta en este momento'}
                                </p>
                            </div>

                            {/* USD Input */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1.5 block">Efectivo en dólares (USD)</label>
                                <div className="relative flex items-center">
                                    <DollarSign size={18} className="absolute left-4 text-slate-400" />
                                    <input
                                        type="number"
                                        step="any"
                                        inputMode="decimal"
                                        value={actualUsd}
                                        onChange={e => setActualUsd(e.target.value)}
                                        placeholder="0.00"
                                        autoFocus
                                        className={`w-full bg-slate-50 dark:bg-slate-950 border-2 ${blindClose ? 'border-amber-200 dark:border-amber-800/50 focus:border-amber-500 focus:ring-amber-500/10' : 'border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/10'} rounded-2xl py-4 pl-12 pr-4 text-xl text-slate-800 dark:text-white font-black outline-none focus:ring-4 transition-all font-mono`}
                                    />
                                </div>
                                {!blindClose && (
                                    <p className="text-[11px] text-slate-400 mt-1.5 pl-1">
                                        Sistema espera: <span className="font-bold text-indigo-500">${expectedUsd.toFixed(2)}</span>
                                    </p>
                                )}
                            </div>

                            {/* Bs Input */}
                            <div>
                                <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1.5 block">Efectivo en bolívares (Bs)</label>
                                <div className="relative flex items-center">
                                    <span className="absolute left-4 font-bold text-slate-400 text-sm">Bs</span>
                                    <input
                                        type="number"
                                        step="any"
                                        inputMode="decimal"
                                        value={actualBs}
                                        onChange={e => setActualBs(e.target.value)}
                                        placeholder="0.00"
                                        className={`w-full bg-slate-50 dark:bg-slate-950 border-2 ${blindClose ? 'border-amber-200 dark:border-amber-800/50 focus:border-amber-500 focus:ring-amber-500/10' : 'border-slate-200 dark:border-slate-700 focus:border-indigo-500 focus:ring-indigo-500/10'} rounded-2xl py-4 pl-12 pr-4 text-xl text-slate-800 dark:text-white font-black outline-none focus:ring-4 transition-all font-mono`}
                                    />
                                </div>
                                {!blindClose && (
                                    <p className="text-[11px] mt-1.5 pl-1">
                                        {
                                            expectedBs < 0
                                                ? <span className="font-bold text-amber-500">⚠ La gaveta usó Bs {formatBs(Math.abs(expectedBs))} extra para dar cambio</span>
                                                : <span className="text-slate-400">Sistema espera: <span className="font-bold text-indigo-500">{formatBs(expectedBs)} Bs</span></span>
                                        }
                                    </p>
                                )}
                            </div>

                            {/* COP Input — only visible if COP transactions exist */}
                            {hasCopTransactions && (
                                <div>
                                    <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1.5 block">Efectivo en pesos (COP)</label>
                                    <div className="relative flex items-center">
                                        <Coins size={18} className="absolute left-4 text-amber-500" />
                                        <input
                                            type="number"
                                            step="any"
                                            inputMode="decimal"
                                            value={actualCop}
                                            onChange={e => setActualCop(e.target.value)}
                                            placeholder="0.00"
                                            className="w-full bg-slate-50 dark:bg-slate-950 border-2 border-amber-200 dark:border-amber-800/50 rounded-2xl py-4 pl-12 pr-4 text-xl text-slate-800 dark:text-white font-black outline-none focus:border-amber-500 focus:ring-4 focus:ring-amber-500/10 transition-all font-mono"
                                        />
                                    </div>
                                    {!blindClose && (
                                        <p className="text-[11px] text-slate-400 mt-1.5 pl-1">
                                            Sistema espera: <span className="font-bold text-amber-500">{fmtCop(expectedCop)} COP</span>
                                        </p>
                                    )}
                                </div>
                            )}

                            {/* Actions */}
                            <div className="flex gap-3 pt-2">
                                {!blindClose && (
                                    <button onClick={() => setStep(1)} className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
                                        Atrás
                                    </button>
                                )}
                                <button
                                    onClick={() => setStep(blindClose ? 2 : 3)}
                                    className={`flex-1 py-3.5 text-sm font-bold text-white ${blindClose ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' : 'bg-indigo-500 hover:bg-indigo-600 shadow-indigo-500/20'} rounded-xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2`}
                                >
                                    Continuar <ArrowRight size={16} />
                                </button>
                            </div>
                        </div>
                    )}

                    {/* ═══ STEP 3 (normal) / STEP 2 (blind): Resultado ═══ */}
                    {((step === 3 && !blindClose) || (step === 2 && blindClose)) && (() => {
                        if (blindClose) {
                            return (
                                <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                                    <div className="bg-amber-500 rounded-2xl p-5 text-white text-center relative overflow-hidden">
                                        <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
                                        <EyeOff size={40} className="mx-auto mb-2" />
                                        <h3 className="text-xl font-black">Confirmar Cierre</h3>
                                        <p className="text-sm font-medium text-white/80 mt-1">Los montos quedarán registrados para revisión del administrador</p>
                                    </div>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50 overflow-hidden">
                                        <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-700/50 flex justify-between">
                                            <span className="text-sm font-bold text-slate-600 dark:text-slate-300">USD declarado</span>
                                            <span className="text-sm font-black font-mono text-slate-800 dark:text-white">${declaredUsd.toFixed(2)}</span>
                                        </div>
                                        <div className={`px-4 py-3 ${hasCopTransactions ? 'border-b border-slate-100 dark:border-slate-700/50' : ''} flex justify-between`}>
                                            <span className="text-sm font-bold text-slate-600 dark:text-slate-300">Bs declarado</span>
                                            <span className="text-sm font-black font-mono text-slate-800 dark:text-white">{formatBs(declaredBs)} Bs</span>
                                        </div>
                                        {hasCopTransactions && (
                                            <div className="px-4 py-3 flex justify-between">
                                                <span className="text-sm font-bold text-amber-600 dark:text-amber-400">COP declarado</span>
                                                <span className="text-sm font-black font-mono text-slate-800 dark:text-white">{fmtCop(declaredCop)} COP</span>
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex gap-3 pt-2">
                                        <button onClick={() => setStep(1)} className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
                                            Revisar
                                        </button>
                                        <button
                                            onClick={handleConfirm}
                                            className="flex-1 py-3.5 text-sm font-bold text-white bg-amber-500 hover:bg-amber-600 rounded-xl shadow-lg shadow-amber-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                        >
                                            <CheckCircle2 size={18} /> Confirmar Cierre
                                        </button>
                                    </div>
                                </div>
                            );
                        }
                        const sem = getSemaforo();
                        const SemIcon = sem.icon;
                        return (
                            <div className="space-y-5 animate-in fade-in slide-in-from-right-4 duration-300">
                                {/* Semaforo */}
                                <div className={`${sem.bg} rounded-2xl p-5 text-white text-center relative overflow-hidden`}>
                                    <div className="absolute -right-6 -top-6 w-24 h-24 bg-white/10 rounded-full blur-2xl" />
                                    <SemIcon size={40} className="mx-auto mb-2" />
                                    <h3 className="text-xl font-black">{sem.label}</h3>
                                    <p className="text-sm font-medium text-white/80 mt-1">
                                        Diferencia: {diffUsd >= 0 ? '+' : ''}{diffUsd.toFixed(2)} USD
                                    </p>
                                </div>

                                {/* Tabla comparativa */}
                                <div>
                                    <h4 className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2 pl-1">Comparativa</h4>
                                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50 overflow-hidden">
                                        {/* Header */}
                                        <div className="grid grid-cols-3 gap-0 px-4 py-2.5 bg-slate-100 dark:bg-slate-700/50">
                                            <span className="text-[10px] font-bold text-slate-500 uppercase"></span>
                                            <span className="text-[10px] font-bold text-slate-500 uppercase text-center">Esperado</span>
                                            <span className="text-[10px] font-bold text-slate-500 uppercase text-center">Declarado</span>
                                        </div>
                                        {/* USD Row */}
                                        <div className="grid grid-cols-3 gap-0 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
                                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">USD</span>
                                            <span className="text-sm font-mono font-bold text-slate-500 text-center">${expectedUsd.toFixed(2)}</span>
                                            <span className={`text-sm font-mono font-black text-center ${diffUsd >= -0.50 && diffUsd <= 0.50 ? 'text-emerald-600' : diffUsd < -5 || diffUsd > 5 ? 'text-red-500' : 'text-amber-600'}`}>
                                                ${declaredUsd.toFixed(2)}
                                            </span>
                                        </div>
                                        {/* Bs Row */}
                                        <div className={`grid grid-cols-3 gap-0 px-4 py-3 ${hasCopTransactions ? 'border-b border-slate-100 dark:border-slate-700/50' : 'border-b border-slate-100 dark:border-slate-700/50'}`}>
                                            <span className="text-sm font-bold text-slate-700 dark:text-slate-200">Bs</span>
                                            <span className="text-sm font-mono font-bold text-slate-500 text-center">{formatBs(expectedBs)}</span>
                                            <span className={`text-sm font-mono font-black text-center ${Math.abs(diffBs) <= expectedBs * 0.02 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                {formatBs(declaredBs)}
                                            </span>
                                        </div>
                                        {/* COP Row */}
                                        {hasCopTransactions && (
                                            <div className="grid grid-cols-3 gap-0 px-4 py-3 border-b border-slate-100 dark:border-slate-700/50">
                                                <span className="text-sm font-bold text-amber-600 dark:text-amber-400">COP</span>
                                                <span className="text-sm font-mono font-bold text-slate-500 text-center">{fmtCop(expectedCop)}</span>
                                                <span className={`text-sm font-mono font-black text-center ${Math.abs(diffCop) <= expectedCop * 0.02 ? 'text-emerald-600' : 'text-amber-600'}`}>
                                                    {fmtCop(declaredCop)}
                                                </span>
                                            </div>
                                        )}
                                        {/* Diff Row */}
                                        <div className="grid grid-cols-3 gap-0 px-4 py-3 bg-slate-100/50 dark:bg-slate-700/30">
                                            <span className="text-xs font-bold text-slate-500 uppercase">Diferencia</span>
                                            <span className={`text-sm font-mono font-black text-center ${diffUsd >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {diffUsd >= 0 ? '+' : ''}{diffUsd.toFixed(2)}
                                            </span>
                                            <span className={`text-sm font-mono font-black text-center ${diffBs >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                {diffBs >= 0 ? '+' : ''}{formatBs(diffBs)}
                                            </span>
                                        </div>
                                        {hasCopTransactions && (
                                            <div className="grid grid-cols-3 gap-0 px-4 py-2 bg-amber-50/50 dark:bg-amber-900/10">
                                                <span className="text-xs font-bold text-amber-500 uppercase">Dif. COP</span>
                                                <span></span>
                                                <span className={`text-sm font-mono font-black text-center ${diffCop >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                                    {diffCop >= 0 ? '+' : ''}{fmtCop(diffCop)}
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Actions */}
                                <div className="flex gap-3 pt-2">
                                    <button onClick={() => setStep(2)} className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
                                        Revisar
                                    </button>
                                    <button
                                        onClick={handleConfirm}
                                        className={`flex-1 py-3.5 text-sm font-bold text-white ${sem.bg} hover:brightness-110 rounded-xl shadow-lg active:scale-[0.98] transition-all flex items-center justify-center gap-2`}
                                    >
                                        <CheckCircle2 size={18} /> Confirmar Cierre
                                    </button>
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>
        </div>
    );
}
