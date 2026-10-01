import { useEffect, useRef } from 'react';
import { storageService } from '../utils/storageService';
import { supabaseCloud as supabase } from '../config/supabaseCloud';
import { REMOTE_OPERATIONS_PAUSED, CLOUD_PAUSE_MESSAGE } from '../config/operationSafety.js';
import { captureStorageContext, assertStorageContextActive } from '../config/storageScope.js';
import { sanitizeBackup } from '../utils/backupSafety.js';

const BACKUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutos
const BACKUP_KEY = 'bodega_autobackup_v2';

// Claves criticas que se respaldan (incluye los archivos de retención local:
// el archivo sigue en el dispositivo y debe sobrevivir a una restauración).
const CRITICAL_KEYS = [
    'bodega_products_v1',
    'bodega_customers_v1',
    'bodega_sales_v1',
    'bodega_sales_archive_v1',
    'abasto_audit_log_v1',
    'abasto_audit_archive_v1',
    'bodega_payment_methods_v1',
    'monitor_rates_v12',
];

export function useAutoBackup(isPremium, isDemo, deviceId) {
    const intervalRef = useRef(null);

    useEffect(() => {
        if (!deviceId) return;
        let active = true;
        const performBackup = async () => {
            const context = captureStorageContext();
            try {
                const snapshot = {};
                let hasData = false;

                for (const key of CRITICAL_KEYS) {
                    const val = await storageService.getItem(key, null, context);
                    if (val !== null) {
                        snapshot[key] = val;
                        hasData = true;
                    }
                }

                if (!active || !hasData) return;
                assertStorageContextActive(context);
                await storageService.setItem(BACKUP_KEY, {
                    data: sanitizeBackup(snapshot), context,
                    timestamp: Date.now(),
                    device: navigator.userAgent?.substring(0, 80),
                }, context);

                // Cloud backup deshabilitado: el auto-backup cada 5 min generaba
                // ~170MB/día de egreso en Supabase (288 uploads × ~500KB snapshot).
                // El backup a nube ahora solo ocurre manualmente o al cerrar sesión.
                // Ver: exportCloudBackup() para backup manual bajo demanda.

            } catch (e) {
                console.error('[AutoBackup] Error:', e);
            }
        };

        // Primer backup 15s despues del arranque
        const initialTimer = setTimeout(performBackup, 15000);

        // Backup cada 5 minutos
        intervalRef.current = setInterval(performBackup, BACKUP_INTERVAL_MS);

        return () => {
            active = false;
            clearTimeout(initialTimer);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [isPremium, isDemo, deviceId]);
}

// Restaurar desde backup (para emergencias)
export async function restoreFromBackup() {
    if (REMOTE_OPERATIONS_PAUSED) throw new Error('Restauración pausada para proteger los datos y pendientes de cada sede.');
    const context = captureStorageContext();
    const backup = await storageService.getItem(BACKUP_KEY, null, context);
    if (!backup?.data) return null;
    if (backup.context?.accountId !== context.accountId || backup.context?.sedeId !== context.sedeId) throw new Error('El respaldo no corresponde a esta cuenta y sede.');
    for (const [key, val] of Object.entries(sanitizeBackup(backup.data))) {
        assertStorageContextActive(context);
        await storageService.setItem(key, val, context);
    }

    return {
        restoredKeys: Object.keys(backup.data),
        backupTime: new Date(backup.timestamp).toLocaleString('es-VE'),
    };
}

/**
 * Backup manual a la nube (bajo demanda).
 * Usar desde la UI cuando el usuario lo solicite, o al cerrar sesión.
 */
export async function exportCloudBackup(deviceId) {
    if (REMOTE_OPERATIONS_PAUSED) {
        console.warn(CLOUD_PAUSE_MESSAGE);
        return false;
    }
    if (!deviceId) return false;
    try {
        const backup = await storageService.getItem(BACKUP_KEY, null);
        if (!backup?.data) return false;

        // C2 (2026-09-28): la tabla ya no admite acceso directo anónimo.
        // Se usa el RPC device_backup_save (SECURITY DEFINER), que exige el
        // device_id como capacidad. Ver supabase/migrations/202609280001_device_backups_hardening.sql
        const { error: rpcError } = await supabase.rpc('device_backup_save', {
            p_device_id: deviceId,
            p_backup: sanitizeBackup(backup.data),
        });
        if (rpcError) throw rpcError;

        return true;
    } catch (e) {
        console.error('[CloudBackup] Error al exportar:', e);
        return false;
    }
}
