/**
 * Hook que conecta auditService con el usuario activo del auth store.
 * Uso: const { log } = useAudit();
 *      log('VENTA', 'VENTA_COMPLETADA', 'Venta $25.50', { saleId: '...' });
 */
import { useCallback, useState } from 'react';
import { captureStorageContext } from '../config/storageScope.js';
import { useAuthStore } from './store/useAuthStore';
import { logEvent } from '../services/auditService';

export function useAudit() {
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);
    const [context] = useState(captureStorageContext);
    const log = useCallback((cat, action, desc, meta = null) => {
        logEvent(cat, action, desc, usuarioActivo, meta, context);
    }, [usuarioActivo, context]);

    return { log };
}
