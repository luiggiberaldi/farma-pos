import { RefreshCw, ShoppingCart, Keyboard, Lock, Landmark, Euro, PenTool } from 'lucide-react';
import Tooltip from '../Tooltip';
import { useAuthStore } from '../../hooks/store/useAuthStore';

const formatBs = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function SalesHeader({
    effectiveRate,
    useAutoRate,
    setUseAutoRate,
    customRate,
    setCustomRate,
    showRateConfig,
    setShowRateConfig,
    setShowKeyboardHelp,
    triggerHaptic,
    rates,
    rateMode,
    setRateMode
}) {
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);
    const isLocked = usuarioActivo?.rol === 'CAJERO';

    const handleRateToggle = () => {
        if (isLocked) return;
        setShowRateConfig(!showRateConfig);
    };

    return (
        <div className="shrink-0 mb-2 lg:mb-1.5 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-3 sm:p-4 lg:p-3 shadow-sm border border-slate-100 dark:border-slate-800">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-2 lg:mb-1">
                <div className="flex justify-between items-center w-full sm:w-auto">
                    <h2 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <div className="bg-emerald-500 text-white p-1.5 sm:p-2 rounded-xl shadow-lg shadow-emerald-500/30">
                            <ShoppingCart size={20} className="sm:w-[22px] sm:h-[22px]" />
                        </div>
                        Punto de Venta
                    </h2>
                    {/* Tasa Móvil (visible solo en sm) */}
                    <div className="sm:hidden flex items-center gap-1">
                        <button 
                            onClick={handleRateToggle} 
                            disabled={isLocked}
                            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all ${
                                isLocked 
                                    ? 'bg-slate-100 border-slate-200 opacity-80 cursor-not-allowed dark:bg-slate-800/50 text-slate-400' 
                                    : rateMode === 'bcv'
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-400 hover:bg-emerald-100'
                                        : rateMode === 'euro'
                                            ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-400 hover:bg-blue-100'
                                            : 'bg-indigo-50 border-indigo-200 text-indigo-600 dark:bg-indigo-950/20 dark:border-indigo-800 dark:text-indigo-400 hover:bg-indigo-100'
                            }`}
                        >
                            {isLocked ? (
                                <Lock size={11} />
                            ) : (
                                <span className="flex items-center mr-0.5">
                                    {rateMode === 'bcv' && <Landmark size={11} />}
                                    {rateMode === 'euro' && <Euro size={11} />}
                                    {rateMode === 'manual' && <PenTool size={11} />}
                                </span>
                            )}
                            <strong className="text-[11px] font-black">{formatBs(effectiveRate)}</strong>
                        </button>
                    </div>
                </div>

                {/* Tasa Desktop y Botones (oculto en sm) */}
                <div className="hidden sm:flex items-center gap-2">
                    <button 
                        onClick={() => setShowKeyboardHelp(true)}
                        className="hidden md:flex items-center gap-1.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 px-3 py-1.5 rounded-xl transition-colors hover:bg-indigo-100 dark:hover:bg-indigo-900/40"
                    >
                        <Keyboard size={14} />
                        <span className="text-xs font-bold">Atajos (PC)</span>
                    </button>

                    <Tooltip text={isLocked ? "Solo los administradores pueden fijar la tasa" : (rateMode === 'bcv' ? "Usando Tasa Oficial Dólar BCV" : rateMode === 'euro' ? "Usando Tasa Oficial Euro BCV" : "Usando Tasa Manual fijada por ti")} position="bottom">
                        <button 
                            onClick={handleRateToggle} 
                            disabled={isLocked}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all group ${
                                isLocked 
                                    ? 'bg-slate-100 border-slate-200 dark:bg-slate-800/80 dark:border-slate-800 cursor-not-allowed opacity-80 text-slate-400' 
                                    : rateMode === 'bcv'
                                        ? 'bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/20 dark:border-emerald-800 dark:text-emerald-400 hover:border-emerald-400'
                                        : rateMode === 'euro'
                                            ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-950/20 dark:border-blue-800 dark:text-blue-400 hover:border-blue-400'
                                            : 'bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-800 dark:text-indigo-400 hover:border-indigo-400'
                            }`}
                        >
                            <span className="text-xs font-bold flex items-center gap-1.5">
                                {isLocked ? <Lock size={12} /> : <RefreshCw size={12} className={showRateConfig ? "text-current animate-spin-once" : ""} />}
                                {rateMode === 'bcv' && (
                                    <>
                                        <Landmark size={14} className="text-emerald-500" />
                                        <span>Dólar BCV:</span>
                                    </>
                                )}
                                {rateMode === 'euro' && (
                                    <>
                                        <Euro size={14} className="text-blue-500" />
                                        <span>Euro BCV:</span>
                                    </>
                                )}
                                {rateMode === 'manual' && (
                                    <>
                                        <PenTool size={14} className="text-indigo-500" />
                                        <span>Tasa Manual:</span>
                                    </>
                                )}
                            </span>
                            <strong className="text-sm font-black">{formatBs(effectiveRate)} Bs</strong>
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* Rate Config Panel */}
            {showRateConfig && (
                <div className="bg-slate-50 dark:bg-slate-950 rounded-xl sm:rounded-2xl border border-slate-200 dark:border-slate-800 p-3 mb-3 animate-in fade-in slide-in-from-top-2">
                    <span className="block text-xs font-bold text-slate-500 mb-2">Selecciona Tipo de Tasa</span>
                    
                    <div className="grid grid-cols-3 gap-2 mb-3">
                        {/* Botón Dólar BCV */}
                        <button
                            type="button"
                            onClick={() => { triggerHaptic && triggerHaptic(); setRateMode('bcv'); }}
                            className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center select-none ${
                                rateMode === 'bcv'
                                    ? 'bg-emerald-50 border-emerald-400 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400 ring-2 ring-emerald-500/10'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                        >
                            <Landmark size={20} className={rateMode === 'bcv' ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'} />
                            <span className="text-[10px] font-black tracking-tight leading-none mt-1">Dólar BCV</span>
                            {rates?.bcv?.price > 0 && (
                                <span className="text-[9px] font-bold opacity-80 mt-1">{formatBs(rates.bcv.price)}</span>
                            )}
                        </button>

                        {/* Botón Euro BCV */}
                        <button
                            type="button"
                            onClick={() => { triggerHaptic && triggerHaptic(); setRateMode('euro'); }}
                            className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center select-none ${
                                rateMode === 'euro'
                                    ? 'bg-blue-50 border-blue-400 text-blue-700 dark:bg-blue-950/30 dark:border-blue-800 dark:text-blue-400 ring-2 ring-blue-500/10'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                        >
                            <Euro size={20} className={rateMode === 'euro' ? 'text-blue-500' : 'text-slate-400 dark:text-slate-500'} />
                            <span className="text-[10px] font-black tracking-tight leading-none mt-1">Euro BCV</span>
                            {rates?.euro?.price > 0 && (
                                <span className="text-[9px] font-bold opacity-80 mt-1">{formatBs(rates.euro.price)}</span>
                            )}
                        </button>

                        {/* Botón Manual */}
                        <button
                            type="button"
                            onClick={() => { triggerHaptic && triggerHaptic(); setRateMode('manual'); }}
                            className={`flex flex-col items-center justify-center p-2 rounded-xl border transition-all text-center select-none ${
                                rateMode === 'manual'
                                    ? 'bg-indigo-50 border-indigo-400 text-indigo-700 dark:bg-indigo-950/30 dark:border-indigo-800 dark:text-indigo-400 ring-2 ring-indigo-500/10'
                                    : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                            }`}
                        >
                            <PenTool size={20} className={rateMode === 'manual' ? 'text-indigo-500' : 'text-slate-400 dark:text-slate-500'} />
                            <span className="text-[10px] font-black tracking-tight leading-none mt-1">Manual</span>
                            <span className="text-[9px] font-bold opacity-80 mt-1">
                                {parseFloat(customRate) > 0 ? formatBs(customRate) : 'Fijar'}
                            </span>
                        </button>
                    </div>

                    {rateMode === 'manual' && (
                        <div className="mb-2">
                            <input 
                                type="number" 
                                value={customRate} 
                                onChange={e => setCustomRate(e.target.value)}
                                className="w-full p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold text-indigo-600 dark:text-indigo-400 outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20"
                                placeholder="Ingresa Tasa Manual (Bs por $)" 
                                autoFocus 
                            />
                        </div>
                    )}
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); setShowRateConfig(false); }}
                        className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-sm rounded-xl shadow-sm shadow-emerald-500/20 active:scale-95 transition-all"
                    >
                        Aceptar
                    </button>
                </div>
            )}
        </div>
    );
}
