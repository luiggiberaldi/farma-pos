import React, { useState } from 'react';
import { DollarSign, Wallet, X, CheckCircle2 } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

export default function CashReconciliationModal({
    isOpen,
    onClose,
    onConfirm,
    expectedUsd = 0,
    expectedBs = 0,
    bcvRate = 1
}) {
    const [actualUsd, setActualUsd] = useState('');
    const [actualBs, setActualBs] = useState('');

    useEscapeToClose(onClose, isOpen);
    if (!isOpen) return null;

    const handleConfirm = () => {
        const declaredUsd = parseFloat(actualUsd) || 0;
        const declaredBs = parseFloat(actualBs) || 0;
        
        onConfirm({
            declaredUsd,
            declaredBs,
            diffUsd: declaredUsd - expectedUsd,
            diffBs: declaredBs - expectedBs
        });
        
        setActualUsd('');
        setActualBs('');
        onClose();
    };

    return (
        <div className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200" onClick={onClose}>
            <div role="dialog" aria-modal="true" aria-label="Cuadre de caja" className="relative bg-white dark:bg-slate-900 rounded-[1.5rem] p-6 max-w-sm w-full shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}>
                
                {/* Close Button */}
                <button onClick={onClose} className="absolute top-4 right-4 modal-close text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <X size={16} />
                </button>

                {/* Header */}
                <div className="w-14 h-14 bg-indigo-50 dark:bg-indigo-900/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Wallet size={28} className="text-indigo-500" />
                </div>
                <h3 className="text-xl font-black text-slate-800 dark:text-white text-center mb-1">Cuadre de Caja</h3>
                <p className="text-sm text-slate-500 dark:text-slate-400 text-center mb-6 leading-relaxed">
                    Ingresa cuánto efectivo físico tienes en la gaveta en este momento.
                </p>

                {/* Expected Summary (Optional visibility, can be hidden if blind close is preferred) */}
                <div className="flex justify-between items-center bg-slate-50 dark:bg-slate-800/50 p-3 rounded-xl mb-4 border border-slate-100 dark:border-slate-700/50">
                    <span className="text-xs font-bold text-slate-500 uppercase">Sistema espera:</span>
                    <div className="text-right">
                        <div className="text-sm font-black text-slate-800 dark:text-white">${expectedUsd.toFixed(2)}</div>
                        <div className="text-xs font-bold text-slate-400">{formatBs(expectedBs)} Bs</div>
                    </div>
                </div>

                {/* Inputs */}
                <div className="space-y-4 mb-6">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1 block">Efectivo Físico (USD)</label>
                        <div className="relative flex items-center">
                            <DollarSign size={16} className="absolute left-3.5 text-slate-400" />
                            <input
                                type="number"
                                step="any"
                                value={actualUsd}
                                onChange={e => setActualUsd(e.target.value)}
                                placeholder="0.00"
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-3 pl-10 pr-4 text-slate-800 dark:text-white font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-mono"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1 block">Efectivo Físico (Bs)</label>
                        <div className="relative flex items-center">
                            <span className="absolute left-3.5 font-bold text-slate-400">Bs</span>
                            <input
                                type="number"
                                step="any"
                                value={actualBs}
                                onChange={e => setActualBs(e.target.value)}
                                placeholder="0.00"
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-3 pl-10 pr-4 text-slate-800 dark:text-white font-bold outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 transition-all font-mono"
                            />
                        </div>
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3 w-full">
                    <button onClick={onClose}
                        className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors">
                        Cancelar
                    </button>
                    <button 
                        onClick={handleConfirm}
                        className="flex-1 py-3.5 text-sm font-bold text-white bg-indigo-500 hover:bg-indigo-600 rounded-xl shadow-lg shadow-indigo-500/20 active:scale-95 transition-all flex items-center justify-center gap-2"
                    >
                        <CheckCircle2 size={18} /> Continuar
                    </button>
                </div>
            </div>
        </div>
    );
}
