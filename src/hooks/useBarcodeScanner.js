import { useEffect, useRef } from 'react';

/**
 * Hook para escuchar eventos del teclado globalmente y detectar 
 * lecturas de escáneres de código de barras (emuladores de teclado rápidos).
 */
export function useBarcodeScanner({ onScan, enabled = true, timeout = 50 }) {
    const buffer = useRef('');
    const lastKeyTime = useRef(0);

    useEffect(() => {
        if (!enabled) return;

        const handleKeyDown = (e) => {
            // Ignorar si el usuario está enfocado y escribiendo en un input
            if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) {
                return;
            }

            // Ignorar teclas modificadoras u otras teclas de control (solo tomamos Enter para confirmar)
            if (e.key.length > 1 && e.key !== 'Enter') {
                return;
            }

            const currentTime = Date.now();
            
            // Si el tiempo entre teclas supera el 'timeout', asumimos teclado manual y limpiamos buffer
            if (currentTime - lastKeyTime.current > timeout) {
                buffer.current = '';
            }
            
            lastKeyTime.current = currentTime;

            if (e.key === 'Enter') {
                if (buffer.current.length >= 3) {
                    // Prevenir comportamientos por defecto si asimilamos que es un escaneo
                    e.preventDefault();
                    const scannedCode = buffer.current;
                    buffer.current = '';
                    onScan(scannedCode);
                } else {
                    buffer.current = '';
                }
                return;
            }

            buffer.current += e.key;
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onScan, enabled, timeout]);
}
