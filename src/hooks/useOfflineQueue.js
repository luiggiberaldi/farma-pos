import { useState, useEffect, useCallback } from 'react';

/**
 * Hook para detectar estado online/offline y cachear tasas.
 * La app ya guarda ventas localmente con storageService (IndexedDB).
 * Este hook agrega:
 * - Detección online/offline reactiva
 * - Cache de última tasa conocida para usar offline
 * - Indicador visual controlado
 */
export function useOfflineQueue() {
    const [isOnline, setIsOnline] = useState(
        typeof navigator !== 'undefined' ? navigator.onLine : true
    );

    const verifyConnectivity = useCallback(async () => {
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
            setIsOnline(false);
            return false;
        }
        try {
            const response = await fetch('/favicon.ico', { cache: 'no-store' });
            const online = response.ok;
            setIsOnline(online);
            return online;
        } catch {
            setIsOnline(false);
            return false;
        }
    }, []);

    useEffect(() => {
        const goOnline = () => { setIsOnline(true); verifyConnectivity(); };
        const goOffline = () => setIsOnline(false);
        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);
        const initialCheck = setTimeout(verifyConnectivity, 0);
        const interval = setInterval(verifyConnectivity, 60000);
        return () => {
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
            clearTimeout(initialCheck);
            clearInterval(interval);
        };
    }, [verifyConnectivity]);

    /** Guardar tasa en cache para uso offline */
    const cacheRates = useCallback((rates) => {
        if (rates && rates.bcv?.price > 0) {
            localStorage.setItem('offline_cached_rates', JSON.stringify({
                ...rates,
                cachedAt: new Date().toISOString(),
            }));
        }
    }, []);

    /** Obtener tasa cacheada */
    const getCachedRates = useCallback(() => {
        try {
            const saved = localStorage.getItem('offline_cached_rates');
            return saved ? JSON.parse(saved) : null;
        } catch { return null; }
    }, []);

    return { isOnline, cacheRates, getCachedRates, verifyConnectivity };
}
