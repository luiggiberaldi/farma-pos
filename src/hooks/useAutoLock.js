import { useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from './store/useAuthStore';
import { logEvent } from '../services/auditService';
import { getActiveAccountId } from '../config/storageScope.js';

const CAJERO_LOCK_MINUTES = 5; // Fijo, no configurable

export function useAutoLock() {
    const { usuarioActivo, logout, requireLogin } = useAuthStore();
    // Cloud accounts always require operator PIN; cashier lock remains enabled.
    const isAdmin = ['ADMIN', 'DUENO'].includes(usuarioActivo?.rol);
    const isCajero = usuarioActivo?.rol === 'CAJERO';
    const isLoginRequired = Boolean(requireLogin || getActiveAccountId());
    const shouldLock = (isAdmin && isLoginRequired) || isCajero;
    const timeoutRef = useRef(null);

    const getLockMinutes = useCallback(() => {
        if (isCajero) return CAJERO_LOCK_MINUTES;
        const minutesStr = localStorage.getItem('admin_auto_lock_minutes') || '5';
        const minutes = parseInt(minutesStr, 10);
        return isNaN(minutes) || minutes < 1 ? 5 : minutes;
    }, [isCajero]);

    const performLock = useCallback((reason = 'manual') => {
        if (!shouldLock) return;
        logEvent('AUTH', 'SESION_BLOQUEADA', `Bloqueo de ${usuarioActivo?.nombre} (${usuarioActivo?.rol}): ${reason}`, usuarioActivo);
        logout();
    }, [usuarioActivo, logout, shouldLock]);

    const resetTimer = useCallback(() => {
        if (!shouldLock) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            return;
        }
        const ms = getLockMinutes() * 60 * 1000;
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        timeoutRef.current = setTimeout(() => {
            performLock('inactividad');
        }, ms);
    }, [shouldLock, getLockMinutes, performLock]);

    useEffect(() => {
        if (!shouldLock) {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            return;
        }

        const events = ['mousedown', 'mousemove', 'keydown', 'scroll', 'touchstart'];
        let tick = false;
        const throttledResetTimer = () => {
            if (!tick) {
                requestAnimationFrame(() => { resetTimer(); tick = false; });
                tick = true;
            }
        };

        events.forEach(e => window.addEventListener(e, throttledResetTimer, { passive: true }));

        const handleVisibilityChange = () => {
            if (document.hidden) {
                // Admin: bloquear al minimizar. Cajero: solo reiniciar el timer
                if (isAdmin) {
                    performLock('app_minimizada');
                } else {
                    resetTimer();
                }
            } else {
                resetTimer();
            }
        };
        document.addEventListener('visibilitychange', handleVisibilityChange);

        resetTimer();

        return () => {
            events.forEach(e => window.removeEventListener(e, throttledResetTimer));
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
        };
    }, [usuarioActivo, shouldLock, resetTimer, performLock, isAdmin]);

    return { manualLock: () => performLock('manual') };
}
