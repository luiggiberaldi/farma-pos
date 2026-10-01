import { useEffect } from 'react';

/**
 * Cierra un modal/overlay con la tecla Escape.
 * Solo se suscribe al keydown mientras `active` sea true, para poder
 * llamarlo antes del `return null` de los modales condicionales.
 */
export function useEscapeToClose(onClose, active = true) {
    useEffect(() => {
        if (!active || typeof onClose !== 'function') return;
        const handleKeyDown = (e) => {
            if (e.key === 'Escape') onClose();
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [active, onClose]);
}
