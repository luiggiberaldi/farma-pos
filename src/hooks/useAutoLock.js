import { useEffect, useCallback, useRef } from 'react';
import { useAuthStore } from './store/useAuthStore';
import { getActiveAccountId } from '../config/storageScope.js';
import { shouldAutoLockForRole, autoLockMinutesFor } from '../utils/operatorLockPolicy.js';

// AJUSTE 1 (2026-10-01): el bloqueo por inactividad SOLO lo tiene el dueño
// ("jefe o dueño" y "admin" del pedido = rol DUENO). El cajero nunca se
// bloquea solo. Además es un bloqueo real (Lock ≠ Logout): conserva
// operador, sesión y carrito; solo quien bloqueó desbloquea con su PIN.
export function useAutoLock() {
    const { usuarioActivo, lock, requireLogin } = useAuthStore();
    // Cloud accounts always require operator PIN.
    const isLoginRequired = Boolean(requireLogin || getActiveAccountId());
    const shouldLock = shouldAutoLockForRole(usuarioActivo?.rol, isLoginRequired);
    const timeoutRef = useRef(null);

    const getLockMinutes = useCallback(() => autoLockMinutesFor(usuarioActivo?.rol) ?? 5, [usuarioActivo?.rol]);

    const performLock = useCallback((reason = 'manual') => {
        if (!shouldLock) return;
        lock(reason);
    }, [lock, shouldLock]);

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
                performLock('app_minimizada');
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
    }, [usuarioActivo, shouldLock, resetTimer, performLock]);

    return { manualLock: () => performLock('manual') };
}
