import { createContext, useContext } from 'react';
export const ToastContext = createContext(null);
let globalToast = null;
export function registerToast(handler) {
    globalToast = handler;
    return () => { if (globalToast === handler) globalToast = null; };
}
export function showToast(message, type = 'info', duration = 3000) { globalToast?.(message, type, duration); }
export function useToast() {
    const context = useContext(ToastContext);
    if (!context) throw new Error('useToast must be used inside ToastProvider');
    return context;
}
