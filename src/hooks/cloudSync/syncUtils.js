import { sanitizeBackup } from '../../utils/backupSafety.js';
import { fingerprintSyncPayload } from '../../config/supabaseFreeTier.js';

/**
 * Merge inteligente de arrays por ID.
 * Combina localArr + cloudArr sin perder items de ninguno.
 * Si un item existe en ambos, gana el más reciente (por updatedAt o createdAt).
 */
export function _mergeArraysById(localArr, cloudArr) {
    if (!Array.isArray(localArr) || !Array.isArray(cloudArr)) return cloudArr;

    const map = new Map();

    // Primero agregar todos los locales
    for (const item of localArr) {
        const id = item?.id ?? item?.cierreId;
        if (id !== null && id !== undefined) map.set(String(id), item);
    }

    // Luego agregar/sobreescribir con los de la nube si son más recientes
    for (const item of cloudArr) {
        const id = item?.id ?? item?.cierreId;
        if (id === null || id === undefined) {
            // Items sin id: agregar directamente
            map.set(Symbol(), item);
            continue;
        }

        const existing = map.get(String(id));
        if (!existing) {
            map.set(String(id), item);
        } else {
            // Comparar timestamps — gana el más reciente
            const localTime = existing.updatedAt || existing.createdAt || '';
            const cloudTime = item.updatedAt || item.createdAt || '';
            if (cloudTime >= localTime) {
                map.set(String(id), item);
            }
            // Si local es más reciente, se queda el local (ya está en el map)
        }
    }

    return Array.from(map.values());
}

// ─── Sanitización previa al push ───────────────────────────────────────────
// Ventana de sync para ventas. El historial completo se conserva en el
// dispositivo, en el backup de login/logout (cloud_backups) y fila por fila
// en la tabla sales; solo la réplica en sync_documents se recorta.
export const SALES_SYNC_WINDOW_DAYS = 30;

export function _trimSalesForSync(arr) {
    if (!Array.isArray(arr)) return arr;
    const cutoff = Date.now() - SALES_SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    return arr.filter(s => {
        const t = Date.parse(s?.timestamp || s?.updatedAt || s?.createdAt || '');
        return isNaN(t) ? true : t >= cutoff; // sin fecha parseable → conservar
    });
}

/**
 * Única fuente de verdad de las transformaciones previas al upsert.
 * La usa performUpsert y también uploadLocalBackup (useCloudAuthLogic), que
 * espeja el backup de login a sync_documents.
 */
export function sanitizeForPush(key, value) {
    let sanitizedValue = sanitizeBackup(value, key);

    // Sensitive fields/session selectors are removed centrally before any push.

    // Egress: eliminar imágenes base64 de productos antes de subir a la nube.
    // Las imágenes (204 KB de 218 KB por usuario) son el mayor driver de egreso.
    // Se conservan solo en local (IndexedDB); el otro dispositivo verá el producto sin imagen.
    if (key === 'bodega_products_v1') {
        try {
            const arr = Array.isArray(sanitizedValue) ? sanitizedValue
                : (typeof sanitizedValue === 'string' ? JSON.parse(sanitizedValue) : sanitizedValue);
            if (Array.isArray(arr)) {
                sanitizedValue = arr.map(({ image, ...rest }) => rest);
            }
        } catch {
            // Payload no parseable: preserve original value.
        }
    }

    // Disk I/O: subir solo las ventas recientes; el documento completo crecía
    // sin límite y cada venta reescribía megabytes de JSONB (TOAST + WAL).
    if (key === 'bodega_sales_v1') {
        try {
            const arr = typeof sanitizedValue === 'string' ? JSON.parse(sanitizedValue) : sanitizedValue;
            sanitizedValue = _trimSalesForSync(arr);
        } catch { /* payload ilegible → subir tal cual */ }
    }

    return sanitizedValue;
}

// Hash the complete UTF-8 payload: sampling slices can miss an interior edit.
export const _computePushHash = fingerprintSyncPayload;
