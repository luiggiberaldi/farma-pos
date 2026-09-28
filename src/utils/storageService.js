import localforage from 'localforage';
import { pushCloudSync } from '../hooks/useCloudSync';
import { APP_STORAGE_DB_NAME, APP_STORAGE_STORE_NAME, captureStorageContext, getStorageKeyForContext } from '../config/storageScope';
import { atomicIndexedDb } from '../services/atomicIndexedDb.js';

localforage.config({
    name: APP_STORAGE_DB_NAME,
    storeName: APP_STORAGE_STORE_NAME,
    description: 'Almacenamiento local aislado de Farma POS'
});

/**
 * Servicio de almacenamiento que previene el límite de 5MB de localStorage
 * Migrando los datos pesados a IndexedDB a través de localforage.
 */
export const storageService = {
    async transaction(records, plan, context = captureStorageContext()) {
        // Initialize the existing database without changing its name/version.
        // Transactional writes never degrade into independent localStorage puts.
        await localforage.ready();
        if (localforage.driver() !== localforage.INDEXEDDB) throw new Error('IndexedDB no está disponible. No se confirmó la operación; conserva tus respaldos.');
        const fallbacks = new Map();
        const pinned = records.map(record => {
            const recordContext = Object.freeze({ ...(record.context || context) });
            const key = getStorageKeyForContext(record.key, recordContext);
            const raw = localStorage.getItem(key);
            let fallback = record.fallback;
            if (raw !== null) {
                try { fallback = JSON.parse(raw); }
                catch { throw new Error('Hay datos de recuperación ilegibles. No se sobrescribirá el almacenamiento.'); }
                fallbacks.set(key, raw);
            }
            return { ...record, context: recordContext, key, fallback };
        });
        let committedWrites = [];
        const result = await atomicIndexedDb(pinned, values => {
            const update = plan(values);
            committedWrites = Object.keys(update?.writes || {});
            return update;
        });
        for (const name of committedWrites) {
            const record = pinned.find(item => item.name === name);
            const original = records.find(item => item.name === name);
            try {
                if (fallbacks.has(record.key) && localStorage.getItem(record.key) === fallbacks.get(record.key)) localStorage.removeItem(record.key);
                if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('app_storage_update', {
                    detail: { key: original.key, context: record.context, source: 'atomic-commit' },
                }));
                localStorage.setItem('farmapos_storage_change', JSON.stringify({ key: original.key, context: record.context, nonce: crypto.randomUUID() }));
            } catch { /* Commit already succeeded; observers cannot unconfirm it. */ }
        }
        if (committedWrites.some(name => records.find(item => item.name === name)?.key === 'offline_sales_queue')) {
            try { window.dispatchEvent(new CustomEvent('offline_queue_update')); } catch { /* Optional notification. */ }
        }
        return result;
    },
    /**
     * Obtiene un item de IndexedDB.
     * Si no existe, consulta localStorage solo para recuperación de lectura.
     * Una escritura explícita posterior adopta el fallback después de confirmar.
     */
    async getItem(key, defaultValue = null, context = captureStorageContext()) {
        const scopedKey = getStorageKeyForContext(key, context);
        try {
            // Pin the key before the first await; a UI branch change must not
            // change the namespace used by a fallback read.

            const value = await localforage.getItem(scopedKey);

            if (value !== null) {
                return value;
            }

            // No importar automáticamente bases de otras aplicaciones.
            // Los datos de versiones anteriores deben entrar por backup explícito.

            // Si no existe en IndexedDB, revisar únicamente el fallback de esta cuenta.
            const fallbackValue = localStorage.getItem(scopedKey);
            if (fallbackValue !== null) {
                // Lectura de recuperación sin migración ni escritura implícita.

                let parsedValue;
                try {
                    parsedValue = JSON.parse(fallbackValue);
                } catch (e) {
                    parsedValue = fallbackValue; // Intentional: some keys store plain strings (e.g. business_name)
                }

                // Read-only recovery. A delayed fallback read must never write an
                // old value over a newer IndexedDB transaction. The next explicit
                // setItem/transaction adopts and clears this fallback after commit.
                return parsedValue;
            }

            // 3. No existe en ningún lado
            return defaultValue;

        } catch (error) {
            console.error(`[Storage Error] Leyendo ${key}:`, error);
            // Fallback drástico en caso de que el navegador bloquee IndexedDB por privacidad extrema
            const backup = localStorage.getItem(scopedKey);
            if (backup) {
                try { return JSON.parse(backup); } catch (e) { return backup; }
            }
            return defaultValue;
        }
    },

    /**
     * Guarda un item directamente en IndexedDB
     */
    async setItem(key, value, context = captureStorageContext()) {
        const scopedKey = getStorageKeyForContext(key, context);
        try {
            await localforage.setItem(scopedKey, value);
            try { localStorage.removeItem(scopedKey); } catch(e) { /* IndexedDB is authoritative. */ } // Evitar residuos de fallback de esta cuenta
            // Registrar timestamp de modificación local para resolución de conflictos con nube
            try { localStorage.setItem(getStorageKeyForContext('_sync_local_ts_' + key, context), new Date().toISOString()); } catch(e) { /* Best effort timestamp. */ }
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key, context } }));
            }
            // Emitir a la nube solo si la llave pertenece al contrato de sync.
            // Evita preparar timers/hash para backups y claves locales no sincronizables.
            pushCloudSync(key, value, false, context).catch(() => {});
        } catch (error) {
            console.error(`[Storage Error] Guardando ${key}:`, error);
            // Fallback de emergencia a localStorage si falla algo catastrófico
            try {
                localStorage.setItem(scopedKey, typeof value === 'string' ? value : JSON.stringify(value));
                try { localStorage.setItem(getStorageKeyForContext('_sync_local_ts_' + key, context), new Date().toISOString()); } catch(e) { /* Best effort timestamp. */ }
                if (typeof window !== "undefined") {
                    window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key, context } }));
                }
                pushCloudSync(key, value, false, context).catch(() => {});
            } catch (e) {
                console.error(`[Storage Error CRÍTICO] Ni IndexedDB ni LocalStorage funcionan para ${key}`, e);
                throw new Error('No se pudieron guardar los datos locales. No se confirmó la operación.', { cause: e });
            }
        }
    },

    /**
     * Lectura de otra sede (solo lectura). La usa el dueño/admin para
     * reportes consolidados y dashboard multi-sede. NUNCA escribe aquí.
     */
    async getItemForSede(key, sedeId, defaultValue = null, context = captureStorageContext()) {
        try {
            const value = await localforage.getItem(getStorageKeyForContext(key, { ...context, sedeId }));
            return value !== null ? value : defaultValue;
        } catch (error) {
            console.error(`[Storage Error] Leyendo ${key} de sede ${sedeId}:`, error);
            return defaultValue;
        }
    },

    /**
     * Elimina un item
     */
    async removeItem(key, context = captureStorageContext()) {
        try {
            const scopedKey = getStorageKeyForContext(key, context);
            await localforage.removeItem(scopedKey);
            localStorage.removeItem(scopedKey); // Por si acaso quedó algún residuo
            // Notificar a componentes React del borrado
            if (typeof window !== "undefined") {
                window.dispatchEvent(new CustomEvent("app_storage_update", { detail: { key, context } }));
            }
            // Sincronizar borrado a la nube (enviar array vacío para que no restaure datos viejos)
            pushCloudSync(key, [], false, context);
        } catch (error) {
            console.error(`[Storage Error] Borrando ${key}:`, error);
        }
    }
};
