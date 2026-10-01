import React, { useState, useCallback } from 'react';
import { ConfirmContext } from './confirmState.js';
import { useEscapeToClose } from './useEscapeToClose';
import { AlertTriangle, LogOut, Trash2, Link2Off, ShoppingCart } from 'lucide-react';

// ─── Context ─────────────────────────────────────────────────────────────────

// ─── Modal UI ─────────────────────────────────────────────────────────────────
// Sistema único de confirmación de la app (auditoría de modales 2026-10-01).
const VARIANTS = {
    danger:  { icon: Trash2,     iconBg: 'bg-red-50 dark:bg-red-900/20',     iconColor: 'text-red-500',    btn: 'bg-red-500 hover:bg-red-600 shadow-red-500/20' },
    warning: { icon: AlertTriangle, iconBg: 'bg-amber-50 dark:bg-amber-900/20', iconColor: 'text-amber-500', btn: 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' },
    cart:    { icon: ShoppingCart, iconBg: 'bg-slate-100 dark:bg-slate-800', iconColor: 'text-slate-500',   btn: 'bg-slate-700 hover:bg-slate-800 shadow-slate-700/20' },
    danger:  { icon: Trash2,     iconBg: 'bg-red-50 dark:bg-red-900/20',     iconColor: 'text-red-500',    btn: 'bg-red-500 hover:bg-red-600 shadow-red-500/20' },
    warning: { icon: AlertTriangle, iconBg: 'bg-amber-50 dark:bg-amber-900/20', iconColor: 'text-amber-500', btn: 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' },
    logout:  { icon: LogOut,     iconBg: 'bg-rose-50 dark:bg-rose-900/20',   iconColor: 'text-rose-500',   btn: 'bg-rose-500 hover:bg-rose-600 shadow-rose-500/20' },
    unlink:  { icon: Link2Off,   iconBg: 'bg-orange-50 dark:bg-orange-900/20', iconColor: 'text-orange-500', btn: 'bg-orange-500 hover:bg-orange-600 shadow-orange-500/20' },
};

function ConfirmDialog({ isOpen, title, message, confirmText, cancelText, variant, onConfirm, onCancel }) {
    useEscapeToClose(onCancel, isOpen);
    if (!isOpen) return null;
    const v = VARIANTS[variant] || VARIANTS.danger;
    const Icon = v.icon;

    return (
        <div
            className="fixed inset-0 z-[9999] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200"
            onClick={onCancel}
        >
            <div
                role="dialog"
                aria-modal="true"
                aria-label={title}
                className="bg-white dark:bg-slate-900 rounded-[1.5rem] p-6 max-w-sm w-full shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Icon */}
                <div className={`w-14 h-14 ${v.iconBg} rounded-2xl flex items-center justify-center mx-auto mb-4`}>
                    <Icon size={28} className={v.iconColor} />
                </div>

                {/* Title */}
                <h3 className="text-lg font-black text-slate-800 dark:text-white text-center mb-2">{title}</h3>

                {/* Message */}
                {message && (
                    <p className="text-sm text-slate-500 dark:text-slate-400 text-center leading-relaxed mb-6 whitespace-pre-line">{message}</p>
                )}

                {/* Actions */}
                <div className="flex gap-3 w-full">
                    <button
                        onClick={onCancel}
                        className="flex-1 py-3.5 text-sm font-bold text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={onConfirm}
                        className={`flex-1 py-3.5 text-sm font-bold text-white ${v.btn} rounded-xl shadow-lg active:scale-95 transition-all`}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}

// ─── Provider ─────────────────────────────────────────────────────────────────
export function ConfirmProvider({ children }) {
    const [state, setState] = useState({ isOpen: false });
    const resolveRef = React.useRef(null);

    const confirm = useCallback(({ title, message, confirmText = 'Confirmar', cancelText = 'Cancelar', variant = 'danger' }) => {
        return new Promise(resolve => {
            resolveRef.current = resolve;
            setState({ isOpen: true, title, message, confirmText, cancelText, variant });
        });
    }, []);

    const handleConfirm = () => {
        setState(s => ({ ...s, isOpen: false }));
        resolveRef.current?.(true);
    };

    const handleCancel = () => {
        setState(s => ({ ...s, isOpen: false }));
        resolveRef.current?.(false);
    };

    return (
        <ConfirmContext.Provider value={confirm}>
            {children}
            <ConfirmDialog {...state} onConfirm={handleConfirm} onCancel={handleCancel} />
        </ConfirmContext.Provider>
    );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────
