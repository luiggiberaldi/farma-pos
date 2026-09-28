// ============================================================
// 🔔 TOAST — Premium notification system
// Replaces native alert() with styled toast notifications
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import { ToastContext, registerToast } from './toastState.js';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';


const ICONS = {
    success: CheckCircle2,
    error: XCircle,
    warning: AlertTriangle,
    info: Info,
};

const COLORS = {
    success: {
        bg: 'bg-emerald-50 dark:bg-emerald-950/95 border-emerald-300 dark:border-emerald-700',
        icon: 'text-emerald-700 dark:text-emerald-300',
        bar: 'bg-emerald-500',
    },
    error: {
        bg: 'bg-rose-50 dark:bg-rose-950/95 border-rose-300 dark:border-rose-700',
        icon: 'text-rose-700 dark:text-rose-300',
        bar: 'bg-rose-500',
    },
    warning: {
        bg: 'bg-amber-50 dark:bg-amber-950/95 border-amber-300 dark:border-amber-700',
        icon: 'text-amber-800 dark:text-amber-300',
        bar: 'bg-amber-500',
    },
    info: {
        bg: 'bg-slate-50 dark:bg-slate-900/95 border-slate-300 dark:border-slate-600',
        icon: 'text-blue-700 dark:text-blue-300',
        bar: 'bg-blue-500',
    },
};


export function ToastProvider({ children }) {
    const [toasts, setToasts] = useState([]);

    const addToast = useCallback((message, type = 'info', duration = 3000) => {
        const id = Date.now() + Math.random();
        setToasts(prev => [...prev.slice(-4), { id, message, type, duration }]);

        if (duration > 0) {
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, duration);
        }
    }, []);

    useEffect(() => registerToast(addToast), [addToast]);

    const removeToast = useCallback((id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    }, []);

    return (
        <ToastContext.Provider value={addToast}>
            {children}
            {/* Toast container */}
            <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex flex-col gap-2 w-[90vw] max-w-sm pointer-events-none">
                {toasts.map((toast) => {
                    const colors = COLORS[toast.type] || COLORS.info;
                    const IconComp = ICONS[toast.type] || Info;
                    return (
                        <div
                            key={toast.id}
                            className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-3 rounded-xl border backdrop-blur-xl shadow-2xl shadow-black/40 animate-in slide-in-from-top-3 fade-in duration-300 ${colors.bg}`}
                        >
                            <IconComp size={18} className={`${colors.icon} shrink-0 mt-0.5`} />
                            <p className="text-sm text-slate-900 dark:text-slate-100 font-medium flex-1 leading-snug">{toast.message}</p>
                            <button
                                onClick={() => removeToast(toast.id)}
                                aria-label="Cerrar notificación"
                                className="text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white transition-colors shrink-0 mt-0.5"
                            >
                                <X size={14} />
                            </button>
                        </div>
                    );
                })}
            </div>
        </ToastContext.Provider>
    );
}
