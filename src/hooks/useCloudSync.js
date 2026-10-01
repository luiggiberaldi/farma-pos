import { useEffect, useState } from 'react';
import localforage from 'localforage';
import { supabaseCloud } from '../config/supabaseCloud';
import { APP_STORAGE_DB_NAME, APP_STORAGE_STORE_NAME, getScopedStorageKey, setActiveAccountId, captureStorageContext, getActiveSedeId } from '../config/storageScope';
import { buildCloudDocumentId, parseCloudDocumentId, isCloudDocumentForContext, isSalesChunkKey, buildSalesChunkDocumentId, salesChunkDocIdLike, salesChunkDateOf } from '../config/cloudDocumentScope.js';
import { recordSyncMetric } from '../utils/syncMetrics';
import { syncV2Paused, pausedCloudOperation } from '../config/operationSafety.js';
import { SUPABASE_FREE_PROFILE, inspectSyncPayload, fingerprintSyncPayload } from '../config/supabaseFreeTier.js';
import { SALES_ARCHIVE_KEY, SALES_HOT_DAYS, saleTimestampMs, splitByAge, appendToArchive } from '../utils/localRetention.js';
import { SYNC_KEYS, LOCAL_KEYS, REALTIME_KEYS, POLLING_ONLY_KEYS, MERGEABLE_KEYS, PULL_IGNORE_KEYS, HEAVY_KEYS, DEBOUNCE_MS, DEBOUNCE_MS_HEAVY } from './cloudSync/syncKeys.js';
import { _mergeArraysById, _computePushHash, sanitizeForPush, SALES_SYNC_WINDOW_DAYS } from './cloudSync/syncUtils.js';
import { planSalesChunkPushes, saleChunkDay, staleChunkKeys, SALES_CHUNK_PRUNE_INTERVAL_MS, SALES_CHUNK_PRUNE_TS_KEY } from './cloudSync/salesChunks.js';
export { broadcastFactoryReset, broadcastForceReload } from './cloudSync/syncBroadcast.js';
export { sanitizeForPush } from './cloudSync/syncUtils.js';
// ─── Estado Global del Motor ───────────────────────────────────────────────
let pollIntervalId = null;
let realtimeChannel = null;     // Canal Realtime para tasas/config (payloads pequeños)
let factoryResetChannel = null; // Canal broadcast factory-reset / force_reload
// Cada re-ejecución del efecto invalida el initSync anterior (aún en vuelo
// tras un await), evitando que dos inits compitan por el estado global y
// dejen el canal Realtime CLOSED (doble SIGNED_IN al iniciar sesión).
let syncGeneration = 0;
// Intentional module-level singletons: shared across all hook instances to
// coordinate cloud-sync echo prevention and debounce timers.
let isSyncingFromCloud = false; // true mientras aplicamos cambios de la nube → evita eco
let lastSyncTime = null;        // Timestamp del último pull exitoso
let initialSyncReady = false;   // Bloquea pushes hasta hidratar la cuenta activa
let activeSyncUserId = null;    // Evita reutilizar el estado de otra cuenta

// Keep a reference to the native setItem for _applyFromCloud to bypass any interceptor
const _nativeSetItem = localStorage.setItem.bind(localStorage);

// Cache de hashes y temporizadores para evitar saturación y envíos redundantes
const _lastPushHash = {};
const _pushDebounceTimers = {};
const _pendingPushValues = {}; // último valor pendiente por llave, para flush al ocultar

/**
 * Empuja una llave al sincronizador de Supabase.
 * Llamado desde storageService (colección 'store') y el interceptor localStorage (colección 'local').
 * Soporta un parámetro bypassDebounce para subidas iniciales o forzadas inmediatas.
 */
/**
 * Upsert genérico de UN documento a sync_documents.
 * docKey: llave lógica para métricas y hash-dedup (ej. 'bodega_sales_20261001').
 * pendingKey/pendingValue: qué reintentar si el envío falla (por defecto el
 * propio documento; ventas reintentan la llave lógica para re-fragmentar).
 */
async function performDocumentUpsert({ docKey, docId, collectionType, value, context, sanitizeKey, pendingKey, pendingValue }) {
    try {
        const sanitizedValue = sanitizeForPush(sanitizeKey, value);

        const { serialized, bytes, allowed, warning } = inspectSyncPayload(sanitizedValue);
        if (!allowed) {
            recordSyncMetric(docKey, 'oversized');
            _pendingPushValues[pendingKey || docKey] = { value: pendingValue !== undefined ? pendingValue : value, context };
            console.warn(`[CloudSync] ${docKey} supera el límite local de 1 MiB; datos conservados sin marcar envío.`);
            return { status: 'deferred', code: 'FREE_TIER_PAYLOAD_LIMIT', bytes };
        }
        if (warning) console.warn(`[CloudSync] ${docKey} supera 250 KiB; conviene usar deltas antes de ampliar.`);
        const hash = await _computePushHash(serialized);
        if (_lastPushHash[docKey] === hash) {
            recordSyncMetric(docKey, 'skipHash');
            return { status: 'ok', skipped: true };
        } // Sin cambios reales → skip
        // NOTA: hash se actualiza DESPUÉS del push exitoso para garantizar reintentos si falla

        const { data: { session } } = await supabaseCloud.auth.getSession();
        if (!session?.user?.id || session.user.id !== context.accountId) return;

        const { error } = await supabaseCloud.from('sync_documents').upsert({
            user_id: session.user.id,
            collection: collectionType,
            doc_id: docId,
            data: { payload: sanitizedValue, sourceKey: docKey, sedeId: context.sedeId },
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,collection,doc_id' });
        if (error) throw error;

        // Solo marcar como enviado si el push fue exitoso
        _lastPushHash[docKey] = hash;
        recordSyncMetric(docKey, 'push');
        recordSyncMetric(docKey, 'uploadBytes', bytes);

        // Broadcast ligero para llaves de Realtime (tasas/config < 1KB)
        // Usa canal Broadcast en vez de postgres_changes para NO activar
        // la decodificación lógica de WAL en la base de datos.
        if (SUPABASE_FREE_PROFILE.realtimeEnabled && REALTIME_KEYS.includes(docKey) && realtimeChannel) {
            try {
                await realtimeChannel.send({
                    type: 'broadcast',
                    event: 'sync_update',
                    payload: { doc_id: docId, collection: collectionType, data: sanitizedValue }
                });
            } catch (bcastErr) {
                // No crítico: el otro dispositivo lo verá en el próximo pull
                console.warn('[CloudSync] Broadcast falló (no crítico):', bcastErr?.message);
            }
        }
        return { status: 'ok', bytes };
    } catch (e) {
        _pendingPushValues[pendingKey || docKey] = { value: pendingValue !== undefined ? pendingValue : value, context };
        recordSyncMetric(docKey, 'error');
        console.warn('[CloudSync] Error al enviar a la nube:', e.message ?? e);
        return { status: 'deferred', code: 'SYNC_SEND_FAILED' };
    }
}

/**
 * Push de ventas fragmentado por día comercial (chunks append-only).
 * Reemplaza el documento monolítico de 30 días: cada chunk se sube por
 * separado y el gate de 1 MiB aplica por día (~600 ventas/día de techo),
 * no al agregado mensual. Los chunks fuera de la ventana cloud no se suben
 * (quedan en el dispositivo) y los viejos se podan una vez al día.
 */
async function pushSalesChunks(sales, context) {
    const plans = planSalesChunkPushes(sales);
    if (plans.length === 0) return { status: 'ok', chunks: 0 };
    const { data: { session } } = await supabaseCloud.auth.getSession();
    if (!session?.user?.id || session.user.id !== context.accountId) return;

    let pushed = 0, deferred = 0, failed = 0;
    for (const plan of plans) {
        const result = await performDocumentUpsert({
            docKey: plan.chunkKey,
            docId: buildSalesChunkDocumentId(plan.day, context),
            collectionType: 'store',
            value: plan.sales,
            context,
            sanitizeKey: plan.chunkKey,
            pendingKey: 'bodega_sales_v1',
            pendingValue: sales,
        });
        if (result?.code === 'SYNC_SEND_FAILED') failed++;
        else if (result?.status === 'deferred') deferred++;
        else pushed++;
        // Un solo día con >1 MiB (~600 ventas) no bloquea los demás días.
    }
    // Poda oportunista: best-effort, una vez al día por dispositivo.
    maybePruneStaleSalesChunks(context).catch(() => {});
    if (failed > 0) return { status: 'deferred', code: 'SYNC_SEND_FAILED' };
    if (deferred > 0) return { status: 'deferred', code: 'FREE_TIER_PAYLOAD_LIMIT', chunks: plans.length, deferred };
    return { status: 'ok', chunks: pushed };
}

/**
 * Elimina de sync_documents los chunks de ventas más viejos que la ventana
 * cloud. Corre como máximo una vez cada 24 h por dispositivo; los datos no
 * se pierden (siguen en el dispositivo y en cloud_backups).
 */
async function maybePruneStaleSalesChunks(context) {
    try {
        const last = Number(localStorage.getItem(SALES_CHUNK_PRUNE_TS_KEY) || 0);
        if (Date.now() - last < SALES_CHUNK_PRUNE_INTERVAL_MS) return;
        const { data: { session } } = await supabaseCloud.auth.getSession();
        if (!session?.user?.id || session.user.id !== context.accountId) return;
        const { data: metas, error } = await supabaseCloud
            .from('sync_documents')
            .select('doc_id')
            .eq('user_id', session.user.id)
            .like('doc_id', salesChunkDocIdLike({ accountId: session.user.id, sedeId: context.sedeId }));
        if (error) throw error;
        const keys = (metas || [])
            .map(m => parseCloudDocumentId(m.doc_id))
            .filter(p => p && isSalesChunkKey(p.key))
            .map(p => p.key);
        const stale = staleChunkKeys(keys);
        if (stale.length > 0) {
            const staleIds = stale.map(k => buildSalesChunkDocumentId(salesChunkDateOf(k), context));
            const { error: delError } = await supabaseCloud
                .from('sync_documents')
                .delete()
                .eq('user_id', session.user.id)
                .in('doc_id', staleIds);
            if (delError) throw delError;
            console.log(`[CloudSync] Poda de chunks de ventas: ${stale.length} documento(s) >${SALES_SYNC_WINDOW_DAYS}d eliminados.`);
        }
        localStorage.setItem(SALES_CHUNK_PRUNE_TS_KEY, String(Date.now()));
    } catch (e) {
        console.warn('[CloudSync] Poda de chunks de ventas falló (no crítico):', e.message ?? e);
    }
}

/**
 * Descubre chunks de ventas en la nube para cuenta/sede.
 * metaOnly: solo doc_id/collection/updated_at (fase 1 del polling).
 */
async function _discoverSalesChunks(userId, sedeId, updatedAfter = null, metaOnly = false) {
    try {
        let query = supabaseCloud
            .from('sync_documents')
            .select(metaOnly ? 'doc_id, collection, updated_at' : 'collection, doc_id, data, updated_at')
            .eq('user_id', userId)
            .like('doc_id', salesChunkDocIdLike({ accountId: userId, sedeId }));
        if (updatedAfter) query = query.gt('updated_at', updatedAfter);
        const { data, error } = await query;
        if (error) throw error;
        const ctx = { accountId: userId, sedeId };
        return (data || []).filter(d => {
            const parsed = parseCloudDocumentId(d.doc_id);
            return parsed && isSalesChunkKey(parsed.key) && isCloudDocumentForContext(d.doc_id, parsed.key, ctx);
        });
    } catch (e) {
        console.warn('[CloudSync] Discovery de chunks de ventas falló:', e.message ?? e);
        return [];
    }
}

/**
 * Lee un documento account-scoped puntual de sync_documents.
 * La usa el fast-lane de tasa (accountDocs) para chequear cambios sin
 * esperar el polling general de 60 min.
 * Devuelve { payload, updatedAt } o null. Best-effort: nunca lanza.
 */
export const fetchAccountDoc = async (docKey) => {
    try {
        const { data: { session } } = await supabaseCloud.auth.getSession();
        const accountId = session?.user?.id;
        if (!accountId) return null;
        const { data, error } = await supabaseCloud
            .from('sync_documents')
            .select('data, updated_at')
            .eq('user_id', accountId)
            .eq('doc_id', buildCloudDocumentId(docKey, { accountId }))
            .maybeSingle();
        if (error || !data) return null;
        return { payload: data.data?.payload ?? null, updatedAt: data.updated_at || null };
    } catch {
        return null;
    }
};

export const pushCloudSync = async (key, value, bypassDebounce = false, storageContext = captureStorageContext()) => {
    const context = Object.freeze({ ...storageContext });
    if (syncV2Paused()) return pausedCloudOperation();
    // Salir antes de cualquier trabajo de debounce/serialización para claves no sincronizables.
    if (!SYNC_KEYS.includes(key)) return;
    if (isSyncingFromCloud) return;          // Nunca re-emitir lo que llegó de la nube
    // Nunca enviar datos locales antes de terminar el pull inicial de la cuenta.
    // Esto evita que otro sistema o la cuenta anterior contamine la nube activa.
    if (!initialSyncReady) return;

    const performPush = async () => {
        // Ventas: push fragmentado por día (chunks append-only). Elimina el
        // techo de ~21 ventas/día/sede del documento monolítico.
        if (key === 'bodega_sales_v1') return pushSalesChunks(value, context);
        return performDocumentUpsert({
            docKey: key,
            docId: buildCloudDocumentId(key, context),
            collectionType: LOCAL_KEYS.includes(key) ? 'local' : 'store',
            value,
            context,
            sanitizeKey: key,
        });
    };

    if (bypassDebounce) {
        if (_pushDebounceTimers[key]) {
            clearTimeout(_pushDebounceTimers[key]);
            delete _pushDebounceTimers[key];
        }
        delete _pendingPushValues[key];
        return await performPush();
    } else {
        _pendingPushValues[key] = { value, context };
        if (_pushDebounceTimers[key]) clearTimeout(_pushDebounceTimers[key]);
        const delay = HEAVY_KEYS.includes(key) ? DEBOUNCE_MS_HEAVY : DEBOUNCE_MS;
        _pushDebounceTimers[key] = setTimeout(() => {
            delete _pushDebounceTimers[key];
            const pending = _pendingPushValues[key];
            delete _pendingPushValues[key];
            if (pending) pushCloudSync(key, pending.value, true, pending.context).catch(() => {});
        }, delay);
    }
};

/**
 * Dispara inmediatamente todos los pushes pendientes de debounce.
 * Best-effort: se llama al ocultar/cerrar la pestaña; si el fetch se cancela,
 * el catch-up push del próximo arranque y la cola offline de ventas cubren el hueco.
 */
export const flushPendingPushes = () => {
    if (syncV2Paused()) return pausedCloudOperation();
    for (const key of Object.keys(_pushDebounceTimers)) {
        clearTimeout(_pushDebounceTimers[key]);
        delete _pushDebounceTimers[key];
        const pending = _pendingPushValues[key];
        delete _pendingPushValues[key];
        if (pending) pushCloudSync(key, pending.value, true, pending.context).catch(() => {});
    }
};

/**
 * Aplica un documento recibido de la nube al almacenamiento local.
 * Garantiza que isSyncingFromCloud esté activo durante toda la operación.
 * Si cloudUpdatedAt se provee, verifica que sea más reciente que el timestamp local
 * para evitar sobreescribir cambios locales con datos desactualizados de la nube.
 */
async function _applyFromCloud(docId, collection, payload, cloudUpdatedAt) {
    if (syncV2Paused()) return pausedCloudOperation();

    const context = captureStorageContext();
    const parsedDoc = parseCloudDocumentId(docId);
    if (!parsedDoc || !isCloudDocumentForContext(docId, parsedDoc.key, context)) {
        // Documentos legacy o de otra cuenta/sede nunca se depositan en el store activo.
        console.warn(`[CloudSync] Documento rechazado por contexto: ${docId}`);
        return;
    }
    const cloudKey = parsedDoc.key;
    // Llaves legadas subidas por versiones viejas de la app: ignorar para no
    // pisar el estado local (ej. el audit log, que ahora vive en la tabla audit_log)
    if (PULL_IGNORE_KEYS.includes(cloudKey)) return;
    // Documentos propios a nivel de cuenta (usuarios, tasa, negocio): ramas
    // dedicadas con merge/auditoría; nunca el camino genérico de localStorage.
    if (cloudKey === 'bodega_users_v1' || cloudKey === 'bodega_rate_policy_v1' || cloudKey === 'bodega_business_v1') {
        const { applyAccountDocFromCloud } = await import('./cloudSync/accountDocs.js');
        const { useAuthStore } = await import('./store/useAuthStore.js');
        await applyAccountDocFromCloud(cloudKey, payload, cloudUpdatedAt, {
            getState: useAuthStore.getState,
            setState: partial => useAuthStore.setState(partial),
            push: pushCloudSync,
        });
        return;
    }
    // Los chunks diarios de ventas se fusionan en la llave caliente local.
    const localKey = isSalesChunkKey(cloudKey) ? 'bodega_sales_v1' : cloudKey;

    // ADR-003: todas las llaves mergeables (incluido el inventario) se mezclan
    // por ID con LWW por updatedAt. Ya no hay reemplazo autoritativo.
    // Los chunks de ventas siempre son mergeables: solo agregan ventas por ID.
    const isMergeable = (MERGEABLE_KEYS.includes(localKey) || isSalesChunkKey(cloudKey)) && collection === 'store';

    // Protección contra sobreescritura para llaves NO mergeables.
    if (!isMergeable && cloudUpdatedAt) {
        try {
            const localTs = localStorage.getItem(getScopedStorageKey('_sync_local_ts_' + localKey));
            if (localTs && localTs > cloudUpdatedAt) {
                console.log(`[CloudSync] Skip ${localKey}: local (${localTs}) más reciente que nube (${cloudUpdatedAt}). Resubiendo...`);
                const { default: lf } = await import('localforage');
                lf.config({ name: APP_STORAGE_DB_NAME, storeName: APP_STORAGE_STORE_NAME });
                const localData = await lf.getItem(getScopedStorageKey(localKey));
                if (localData !== null) {
                    delete _lastPushHash[localKey];
                    pushCloudSync(localKey, localData).catch(() => {});
                }
                return;
            }
        } catch(e) { /* Si falla la comparación, aplicar de todas formas */ }
    }

    isSyncingFromCloud = true;
    try {
        if (collection === 'local') {
            const finalPayload = payload;

            const stringPayload = typeof finalPayload === 'string' ? finalPayload : JSON.stringify(finalPayload);
            _nativeSetItem(localKey, stringPayload);   // Escribe sin pasar por el interceptor
            window.dispatchEvent(new StorageEvent('storage', {
                key: localKey,
                newValue: stringPayload,
                storageArea: localStorage
            }));
        } else {
            // Colección 'store' → IndexedDB
            const { default: localforage } = await import('localforage');
            localforage.config({ name: APP_STORAGE_DB_NAME, storeName: APP_STORAGE_STORE_NAME });

            let finalData = payload;

            // Merge inteligente para arrays con ID (ventas, productos, clientes, etc.)
            if (isMergeable && Array.isArray(payload)) {
                try {
                    const localData = await localforage.getItem(getScopedStorageKey(localKey));
                    if (Array.isArray(localData)) {
                        finalData = _mergeArraysById(localData, payload);
                        console.log(`[CloudSync] Merge ${cloudKey}: local=${localData.length}, nube=${payload.length}, resultado=${finalData.length}`);

                        // Si el merge produjo más items que la nube, re-subir el resultado.
                        // Para chunks se compara solo el día del chunk: el local
                        // siempre tiene más historial (90 días calientes) que un
                        // día de la nube, y comparar el array completo causaría
                        // re-push en cada poll. El hash por chunk evita re-subir
                        // los días que ya están iguales en la nube.
                        const comparable = isSalesChunkKey(cloudKey)
                            ? finalData.filter(s => saleChunkDay(s) === salesChunkDateOf(cloudKey)).length
                            : finalData.length;
                        if (comparable > payload.length) {
                            setTimeout(() => {
                                pushCloudSync(localKey, finalData).catch(() => {});
                            }, 500);
                        }
                    }
                } catch (e) {
                    console.warn(`[CloudSync] Merge falló para ${cloudKey}, usando datos de nube:`, e.message);
                }
            }

            await localforage.setItem(getScopedStorageKey(localKey), finalData);
            // Retención local: si el merge del pull trae ventas viejas a la
            // clave caliente, se archivan en el dispositivo (no se borran).
            if (localKey === 'bodega_sales_v1' && Array.isArray(finalData)) {
                try {
                    const archiveKey = getScopedStorageKey(SALES_ARCHIVE_KEY);
                    const existing = await localforage.getItem(archiveKey);
                    const split = splitByAge(finalData, saleTimestampMs, SALES_HOT_DAYS);
                    if (split.archived.length) {
                        await localforage.setItem(getScopedStorageKey(localKey), split.hot);
                        await localforage.setItem(archiveKey, appendToArchive(split.archived, existing));
                    }
                } catch (e) {
                    console.warn('[CloudSync] Archivo de retención falló, se conserva caliente:', e.message);
                }
            }
            const serializedPayload = typeof finalData === 'string' ? finalData : JSON.stringify(finalData);
            recordSyncMetric(cloudKey, 'pull');
            recordSyncMetric(cloudKey, 'downloadBytes', new TextEncoder().encode(serializedPayload).byteLength);

            // Notificar a los componentes React que lean este store
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: localKey, source: 'cloud' } }));
        }
    } finally {
        isSyncingFromCloud = false;
    }
}

// ─── Hook de React ─────────────────────────────────────────────────────────
export function useCloudSync() {
    const [authEpoch, setAuthEpoch] = useState(0);
    // El sincronizador debe reaccionar al cambio real de sesión, aunque el
    // auth-storage local todavía no tenga adminEmail.
    useEffect(() => {
        if (syncV2Paused()) return;
        const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange((event) => {
            if (event === 'SIGNED_IN' || event === 'SIGNED_OUT') {
                setAuthEpoch(value => value + 1);
            }
        });
        return () => subscription.unsubscribe();
    }, []);

    // La sesión de Supabase es la fuente de verdad; no bloquear el pull por
    // depender de una preferencia local que puede estar vacía o ser antigua.
    const isCloudConfigured = true;

    useEffect(() => {
        // Esta ejecución del efecto es la autoridad actual: cualquier initSync
        // de una ejecución anterior (todavía en vuelo tras un await) se aborta.
        if (syncV2Paused()) return;
        const myGen = ++syncGeneration;
        const isCurrent = () => syncGeneration === myGen;

        // Interceptor de localStorage — solo para llaves 'local'
        const originalSetItem = localStorage.setItem.bind(localStorage);
        localStorage.setItem = function (key, value) {
            originalSetItem(key, value);
            if (!isSyncingFromCloud && LOCAL_KEYS.includes(key)) {
                pushCloudSync(key, value).catch(() => {});
            }
        };

        // Flush best-effort de pushes pendientes al ocultar/cerrar la pestaña.
        // Con el debounce largo de HEAVY_KEYS, sin esto un cierre rápido dejaría
        // el último cambio sin subir hasta el próximo arranque.
        const onHiddenFlush = () => {
            if (document.visibilityState === 'hidden') flushPendingPushes();
        };
        const onPageHideFlush = () => flushPendingPushes();
        document.addEventListener('visibilitychange', onHiddenFlush);
        window.addEventListener('pagehide', onPageHideFlush);
        const removeFlushListeners = () => {
            document.removeEventListener('visibilitychange', onHiddenFlush);
            window.removeEventListener('pagehide', onPageHideFlush);
        };

        if (!isCloudConfigured) {
            initialSyncReady = false;
            activeSyncUserId = null;
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
                lastSyncTime = null;
            }
            if (realtimeChannel) {
                supabaseCloud.removeChannel(realtimeChannel);
                realtimeChannel = null;
            }
            if (factoryResetChannel) {
                supabaseCloud.removeChannel(factoryResetChannel);
                factoryResetChannel = null;
            }
            return () => { localStorage.setItem = originalSetItem; removeFlushListeners(); };
        }

        const initSync = async () => {
            try {
                let session = (await supabaseCloud.auth.getSession()).data.session;
                if (!isCurrent()) return;

                if (!session?.user?.id) {
                    initialSyncReady = false;
                    activeSyncUserId = null;
                    setActiveAccountId(null);
                    return;
                }

                const userId = session.user.id;
                // Asegurar el namespace correcto antes de leer o escribir IndexedDB.
                setActiveAccountId(userId);

                // Misma cuenta ya sincronizada (doble SIGNED_IN del login,
                // remounts): no repetir el pull ni el catch-up. Solo re-crear
                // los canales que el cleanup de la ejecución anterior cerró.
                const alreadySynced = initialSyncReady && activeSyncUserId === userId;
                if (!alreadySynced) {
                    if (activeSyncUserId !== userId) {
                        activeSyncUserId = userId;
                        for (const key of Object.keys(_lastPushHash)) delete _lastPushHash[key];
                    }
                    initialSyncReady = false;

                // ── Pull Inicial: descarga todos los documentos ──────────────
                // Saltarse si acaba de hacerse una importación local (el flag evita que
                // Supabase sobreescriba los datos recién importados).
                let docs = null;
                const skipPull = sessionStorage.getItem('skip_cloud_pull');
                if (skipPull) {
                    sessionStorage.removeItem('skip_cloud_pull');
                    console.log('[CloudSync] Pull inicial omitido (importación reciente).');
                } else {
                    const { data, error } = await supabaseCloud
                        .from('sync_documents')
                        .select('collection, doc_id, data, updated_at')
                        .eq('user_id', userId)
                        .in('collection', ['store', 'local'])
                        .in('doc_id', SYNC_KEYS.map(key => buildCloudDocumentId(key, { accountId: userId, sedeId: getActiveSedeId() })));
                    if (error) throw error;
                    docs = data;

                    if (docs?.length > 0) {
                        for (const doc of docs) {
                            await _applyFromCloud(doc.doc_id, doc.collection, doc.data.payload, doc.updated_at);
                            // Seed del hash-cache con lo que la nube ya tiene: el catch-up
                            // push de abajo salta las llaves idénticas en vez de re-subir
                            // los ~26 documentos completos en cada arranque.
                            try {
                                const p = doc.data.payload;
                                const serialized = typeof p === 'string' ? p : JSON.stringify(p);
                                const parsed = parseCloudDocumentId(doc.doc_id);
                                if (parsed) _lastPushHash[parsed.key] = await _computePushHash(serialized);
                            } catch { /* sin seed → push normal, como antes */ }
                        }
                        console.log(`[CloudSync] Pull inicial: ${docs.length} documentos procesados.`);
                    }

                    // ── Pull inicial de chunks de ventas (doc_ids dinámicos) ──
                    // El doc monolítico legado (si existe en la nube) ya vino en el
                    // pull fijo de arriba y converge una sola vez por merge por ID;
                    // a partir de aquí las ventas viajan en chunks diarios.
                    const chunkDocs = await _discoverSalesChunks(userId, getActiveSedeId());
                    for (const doc of chunkDocs) {
                        await _applyFromCloud(doc.doc_id, doc.collection, doc.data.payload, doc.updated_at);
                        try {
                            const p = doc.data.payload;
                            const serialized = typeof p === 'string' ? p : JSON.stringify(p);
                            const parsed = parseCloudDocumentId(doc.doc_id);
                            if (parsed) _lastPushHash[parsed.key] = await _computePushHash(serialized);
                        } catch { /* sin seed → push normal */ }
                    }
                    if (chunkDocs.length > 0) {
                        console.log(`[CloudSync] Pull inicial: ${chunkDocs.length} chunks de ventas procesados.`);
                    }
                }
                if (!isCurrent()) return;

                lastSyncTime = new Date().toISOString();
                // Desde este punto los cambios nuevos de esta cuenta sí pueden subir.
                initialSyncReady = true;

                // ── Catch-up push: subir datos locales que la nube no tiene ──
                // Asegura que claves recién agregadas al sync (ej. categorías, proveedores,
                // config) queden en Supabase aunque nunca hayan sido modificadas en este
                // dispositivo desde que se activó el sync.
                // El hash deduplication evita resubir lo que ya está igual en la nube.
                // Set de doc_ids que la nube ya tiene (del pull inicial)
                const cloudDocIds = new Set(docs?.map(d => parseCloudDocumentId(d.doc_id)?.key).filter(Boolean) || []);

                (async () => {
                    const { default: lf } = await import('localforage');
                    lf.config({ name: APP_STORAGE_DB_NAME, storeName: APP_STORAGE_STORE_NAME });
                    for (const key of SYNC_KEYS) {
                        if (!isCurrent() || !navigator.onLine || document.visibilityState !== 'visible') return;
                        if (LOCAL_KEYS.includes(key)) {
                            const val = localStorage.getItem(key);
                            if (val != null) {
                                const result = await pushCloudSync(key, val, true);
                                if (result?.code === 'SYNC_SEND_FAILED') return;
                            }
                        } else {
                            const val = await lf.getItem(getScopedStorageKey(key));
                            // No subir arrays vacíos si la nube ya tiene datos para esta llave.
                            // Esto previene que un dispositivo nuevo borre el inventario de la nube.
                            if (val != null) {
                                // ADR-003: el inventario SÍ se sube tras el merge inicial para
                                // que el stock vivo del equipo llegue a la nube (el merge por ID
                                // con LWW ya resolvió los conflictos en el pull).
                                if (Array.isArray(val) && val.length === 0 && cloudDocIds.has(key)) {
                                    console.log(`[CloudSync] Skip push ${key}: local vacío, nube ya tiene datos`);
                                    continue;
                                }
                                if (!isCurrent()) return;
                                const result = await pushCloudSync(key, val, true);
                                if (result?.code === 'SYNC_SEND_FAILED') return;
                            }
                        }
                        // Pausa entre keys para no saturar Supabase con burst
                        await new Promise(r => setTimeout(r, SUPABASE_FREE_PROFILE.catchUpSpacingMs));
                    }
                    // ── Catch-up del documento propio de usuarios ──
                    // No vive en localStorage bajo su llave: se empuja explícito
                    // tras el merge inicial (el hash-dedup salta si no hay cambios).
                    try {
                        const { pushUsersDoc } = await import('./cloudSync/accountDocs.js');
                        const { useAuthStore } = await import('./store/useAuthStore.js');
                        if (isCurrent() && navigator.onLine) await pushUsersDoc({
                            getState: useAuthStore.getState,
                            setState: partial => useAuthStore.setState(partial),
                            push: pushCloudSync,
                        });
                    } catch { /* best-effort */ }
                })().catch(() => {});
                }

                if (!isCurrent()) return;

                // ── Listener de Factory Reset remoto ─────────────────────────
                // Si otro dispositivo con la misma cuenta hace factory reset,
                // este equipo también limpia y recarga.
                if (SUPABASE_FREE_PROFILE.realtimeEnabled && !factoryResetChannel) {
                    factoryResetChannel = supabaseCloud.channel(`factory-reset-${userId}`)
                        .on('broadcast', { event: 'factory_reset' }, async () => {
                        console.log('[CloudSync] Factory reset remoto recibido — limpiando...');
                        try {
                            await localforage.clear();
                            localStorage.clear();
                            if ('caches' in window) {
                                const cacheKeys = await caches.keys();
                                await Promise.all(cacheKeys.map(k => caches.delete(k)));
                            }
                            if ('serviceWorker' in navigator) {
                                const regs = await navigator.serviceWorker.getRegistrations();
                                await Promise.all(regs.map(r => r.unregister()));
                            }
                        } catch (e) {
                            console.warn('[CloudSync] Error parcial en factory reset:', e);
                        }
                        window.location.reload();
                    })
                    .on('broadcast', { event: 'force_reload' }, () => {
                        console.log('[CloudSync] Recarga remota recibida — actualizando...');
                        window.location.reload();
                    })
                        .subscribe();
                }

                // ── Realtime: solo tasas y config (payloads <1KB) ─────────────
                // Esto permite que 2 dispositivos con la misma cuenta vean
                // cambios de tasa instantáneamente sin egreso significativo.
                if (SUPABASE_FREE_PROFILE.realtimeEnabled && !realtimeChannel) {
                    // Canal Broadcast privado por usuario.
                    // NO usa postgres_changes → no activa decodificación lógica de WAL.
                    // Los mensajes viajan cliente→cliente a través de los servidores de
                    // Supabase Realtime sin pasar por la base de datos.
                    realtimeChannel = supabaseCloud
                        .channel(`sync-rates-${userId}`, {
                            config: { broadcast: { self: false } }
                        })
                        .on(
                            'broadcast',
                            { event: 'sync_update' },
                            async ({ payload }) => {
                                if (isSyncingFromCloud) return;
                                const { doc_id, collection, data } = payload;
                                const parsed = parseCloudDocumentId(doc_id);
                                // Solo procesar llaves ligeras (tasas/config) y el documento de esta cuenta/sede.
                                if (!parsed || !REALTIME_KEYS.includes(parsed.key)
                                    || !isCloudDocumentForContext(doc_id, parsed.key, captureStorageContext())) return;
                                console.log(`[CloudSync] Realtime Broadcast: ${doc_id} actualizado`);
                                await _applyFromCloud(doc_id, collection, data);
                            }
                        )
                        .subscribe((status) => {
                            console.log(`[CloudSync] Realtime Broadcast canal: ${status}`);
                        });
                }

                // ── Polling cada 60 min: solo datos pesados ──────────────────
                // Productos, ventas, clientes, cuentas — payloads grandes que
                // no necesitan ser instantáneos. 60 min optimiza egress para 5GB/mes.
                if (!pollIntervalId) {
                    const POLL_INTERVAL = SUPABASE_FREE_PROFILE.pollIntervalMs;
                    let pollInFlight = false;
                    const pollForChanges = async () => {
                        if (!isCurrent() || pollInFlight || isSyncingFromCloud || document.visibilityState !== 'visible' || !navigator.onLine) return;
                        pollInFlight = true;
                        try {
                            const currentSession = (await supabaseCloud.auth.getSession()).data.session;
                            if (!currentSession?.user?.id) return;

                            // ── Fase 1: solo metadatos (doc_id + updated_at) ──────────
                            // Costo: ~1 KB en vez de 218 KB. Solo bajamos data si algo cambió.
                            let metaQuery = supabaseCloud
                                .from('sync_documents')
                                .select('doc_id, collection, updated_at')
                                .eq('user_id', currentSession.user.id)
                                .in('doc_id', POLLING_ONLY_KEYS.map(key => buildCloudDocumentId(key, {
                                    accountId: currentSession.user.id,
                                    sedeId: getActiveSedeId(),
                                })));

                            if (lastSyncTime) {
                                metaQuery = metaQuery.gt('updated_at', lastSyncTime);
                            }
                            // Chunks de ventas: doc_ids dinámicos → discovery por patrón
                            // LIKE en paralelo con la lista fija (solo metadatos).
                            const [fixedMetaRes, chunkMetas] = await Promise.all([
                                metaQuery,
                                _discoverSalesChunks(currentSession.user.id, getActiveSedeId(), lastSyncTime, true),
                            ]);
                            if (fixedMetaRes.error) throw fixedMetaRes.error;
                            const changedMeta = [...(fixedMetaRes.data || []), ...chunkMetas];
                            if (!isCurrent()) return;

                            // ── Fase 2: bajar solo los docs que realmente cambiaron ───
                            if (changedMeta?.length > 0) {
                                const changedIds = changedMeta.map(d => d.doc_id);
                                const { data: changed, error: payloadError } = await supabaseCloud
                                    .from('sync_documents')
                                    .select('collection, doc_id, data, updated_at')
                                    .eq('user_id', currentSession.user.id)
                                    .in('doc_id', changedIds);
                                if (payloadError) throw payloadError;
                                if (!isCurrent()) return;

                                if (changed?.length > 0) {
                                    for (const doc of changed) {
                                        console.log(`[CloudSync] Polling: ${doc.doc_id} actualizado`);
                                        await _applyFromCloud(doc.doc_id, doc.collection, doc.data.payload, doc.updated_at);
                                    }
                                }
                            }

                            lastSyncTime = new Date().toISOString();
                        } catch (err) {
                            console.warn('[CloudSync] Error en polling:', err.message ?? err);
                        } finally { pollInFlight = false; }
                    };

                    if (document.visibilityState === 'visible') pollIntervalId = setInterval(pollForChanges, POLL_INTERVAL);
                    console.log('[CloudSync] Perfil Free: polling visible de 60 min; Realtime desactivado.');

                    // ── Pausar polling con pestaña oculta — ahorra egress ────────
                    // Si la pestaña no está visible, pausamos el interval.
                    // Al volver visible, hacemos un poll inmediato (con cooldown) y reiniciamos el interval.
                    let lastVisibilityPoll = 0;
                    const VISIBILITY_COOLDOWN_MS = SUPABASE_FREE_PROFILE.visibilityCooldownMs;

                    const onVisible = () => {
                        if (document.visibilityState === 'visible') {
                            // Reactivar polling
                            if (!pollIntervalId) {
                                pollIntervalId = setInterval(pollForChanges, POLL_INTERVAL);
                            }
                            const now = Date.now();
                            if (now - lastVisibilityPoll >= VISIBILITY_COOLDOWN_MS) {
                                lastVisibilityPoll = now;
                                pollForChanges().catch(() => {});
                            }
                        } else {
                            // Pestaña oculta — pausar polling para ahorrar egress
                            if (pollIntervalId) {
                                clearInterval(pollIntervalId);
                                pollIntervalId = null;
                            }
                        }
                    };
                    document.addEventListener('visibilitychange', onVisible);
                    // Guardar referencia para cleanup
                    window.__cloudSyncVisibilityListener = onVisible;
                }

            } catch (err) {
                console.error('[CloudSync] Fallo en inicialización P2P:', err);
                initialSyncReady = false; // Permitir reintento
            }
        };

        initSync();

        return () => {
            // Invalidar cualquier initSync de esta ejecución que siga en vuelo
            // (ej. un pull no terminado cuando el efecto re-ejecute).
            syncGeneration++;
            // NOTA: no se resetean initialSyncReady/activeSyncUserId aquí.
            // Si el efecto se re-ejecuta con la misma cuenta (doble SIGNED_IN
            // al login), initSync lo detecta y omite el pull duplicado.
            // El reset ocurre dentro de initSync cuando cambia de cuenta o
            // la sesión desaparece.
            localStorage.setItem = originalSetItem;
            removeFlushListeners();
            // Empujar (no descartar) los cambios pendientes antes de desmontar
            flushPendingPushes();
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
            }
            if (realtimeChannel) {
                supabaseCloud.removeChannel(realtimeChannel);
                realtimeChannel = null;
            }
            if (factoryResetChannel) {
                supabaseCloud.removeChannel(factoryResetChannel);
                factoryResetChannel = null;
            }
            if (window.__cloudSyncVisibilityListener) {
                document.removeEventListener('visibilitychange', window.__cloudSyncVisibilityListener);
                delete window.__cloudSyncVisibilityListener;
            }
        };
    // La sesión de Supabase, no las credenciales persistidas localmente, controla
    // el ciclo de vida del sincronizador. Evita repetir el pull cuando solo cambia
    // el estado local de autenticación.
    }, [authEpoch, isCloudConfigured]);
}
