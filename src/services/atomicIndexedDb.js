import { APP_STORAGE_DB_NAME, APP_STORAGE_STORE_NAME } from '../config/storageScope.js';

// One native readwrite transaction over the existing localForage object store.
// Reads and the synchronous planner run under the same IndexedDB lock, including
// other tabs. No network/await is allowed in the planner; no localStorage fallback.
export function atomicIndexedDb(records, plan, { indexedDBFactory = globalThis.indexedDB, databaseName = APP_STORAGE_DB_NAME, storeName = APP_STORAGE_STORE_NAME } = {}) {
    if (!indexedDBFactory) return Promise.reject(new Error('Se requiere IndexedDB para confirmar una operación atómica. Los datos anteriores se conservan.'));
    if (!Array.isArray(records) || !records.length || new Set(records.map(record => record.name)).size !== records.length
        || new Set(records.map(record => record.key)).size !== records.length) return Promise.reject(new Error('Contrato de transacción local inválido.'));
    return new Promise((resolve, reject) => {
        let database;
        let settled = false;
        const fail = error => { if (!settled) { settled = true; database?.close(); reject(error); } };
        const request = indexedDBFactory.open(databaseName);
        request.onerror = () => fail(request.error || new Error('No se pudo abrir el almacenamiento local.'));
        request.onblocked = () => fail(new Error('Otra pestaña bloquea el almacenamiento. Cierra la versión antigua antes de continuar.'));
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains(storeName)) request.result.createObjectStore(storeName);
        };
        request.onsuccess = () => {
            database = request.result;
            if (settled) { database.close(); return; }
            database.onversionchange = () => database.close();
            let transaction;
            try { transaction = database.transaction(storeName, 'readwrite'); }
            catch (error) { fail(error); return; }
            const store = transaction.objectStore(storeName);
            const values = Object.create(null);
            const keys = new Map(records.map(record => [record.name, record.key]));
            let left = records.length;
            let result;
            let cause;
            transaction.onerror = () => { cause ||= transaction.error; };
            transaction.onabort = () => fail(cause || transaction.error || new Error('Operación cancelada: no se guardó ningún cambio.'));
            transaction.oncomplete = () => {
                database.close();
                if (!settled) { settled = true; resolve(result); }
            };
            const execute = () => {
                try {
                    const update = plan(values);
                    if (!update || typeof update.then === 'function' || !update.writes || typeof update.writes !== 'object') {
                        throw new Error('El plan de transacción debe ser síncrono y declarar todas sus escrituras.');
                    }
                    result = structuredClone(update.result);
                    // Clone all values before the first put; a serialization error
                    // aborts the whole transaction, never a partially saved sale.
                    const writes = Object.entries(update.writes).map(([name, value]) => {
                        if (!keys.has(name)) throw new Error('La operación intentó escribir fuera de su contexto declarado.');
                        return [keys.get(name), structuredClone(value)];
                    });
                    for (const [key, value] of writes) store.put(value, key);
                } catch (error) { cause = error; transaction.abort(); }
            };
            for (const record of records) {
                const read = store.get(record.key);
                read.onerror = () => { cause = read.error; };
                read.onsuccess = () => {
                    try {
                        values[record.name] = read.result === undefined ? structuredClone(record.fallback) : read.result;
                        left -= 1;
                        if (!left) execute();
                    } catch (error) { cause = error; transaction.abort(); }
                };
            }
        };
    });
}
