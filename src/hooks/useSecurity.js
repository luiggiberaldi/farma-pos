import { useState, useEffect } from 'react';

/**
 * Identificador estable del dispositivo (fingerprint SHA-256 del hardware).
 * El sistema de licencias premium/demo fue desmontado en la transformación
 * a Farmacia César — este hook queda solo como proveedor de deviceId.
 */
export function useSecurity() {
    const [deviceId, setDeviceId] = useState('');

    useEffect(() => {
        // Fingerprinting: mismo hardware → mismo hash SHA-256
        const generateFingerprint = async () => {
            const nav = window.navigator;
            const screen = window.screen;

            const components = [
                nav.userAgent,
                nav.language,
                nav.hardwareConcurrency || 1,
                nav.deviceMemory || 1,
                screen.width,
                screen.height,
                screen.colorDepth,
                new Date().getTimezoneOffset()
            ].join('|');

            if (!window.crypto || !window.crypto.subtle) {
                // Fallback (solo en http sin SSL)
                let hash = 0;
                for (let i = 0; i < components.length; i++) {
                    hash = ((hash << 5) - hash) + components.charCodeAt(i);
                    hash |= 0;
                }
                const hex = Math.abs(hash).toString(16).toUpperCase().padStart(8, '0');
                return `LPL-${hex}`;
            }

            const encoder = new TextEncoder();
            const data = encoder.encode(components);
            const hashBuffer = await crypto.subtle.digest('SHA-256', data);
            const hashArray = Array.from(new Uint8Array(hashBuffer));
            const hex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase().substring(0, 8);
            return `LPL-${hex}`;
        };

        const initDeviceId = async () => {
            let storedId;
            try {
                storedId = localStorage.getItem('pda_device_id');
            } catch (e) {
                console.warn('[Security] localStorage not available:', e.message);
            }
            if (!storedId) {
                storedId = await generateFingerprint();
                try {
                    localStorage.setItem('pda_device_id', storedId);
                } catch (e) {
                    // Storage bloqueado — continuar con ID en memoria
                }
            }
            setDeviceId(storedId);
        };

        initDeviceId();
    }, []);

    // No-op: compatibilidad con componentes que aún lo llaman (RPCs legacy eliminadas)
    const forceHeartbeat = async () => {};

    return {
        deviceId,
        forceHeartbeat,
        // Compat: sin sistema de licencias toda la app está "desbloqueada"
        isPremium: true,
        loading: false,
        isDemo: false,
        demoExpires: null,
        demoTimeLeft: '',
        demoExpiredMsg: '',
        dismissExpiredMsg: () => {},
        demoUsed: false,
        unlockApp: async () => ({ success: true, status: 'NO_LICENSE_SYSTEM' }),
        activateDemo: async () => ({ success: false, status: 'NO_LICENSE_SYSTEM' }),
        generateCodeForClient: async () => null,
    };
}
