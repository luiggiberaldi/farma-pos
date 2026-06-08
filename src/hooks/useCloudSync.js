import { useEffect, useRef } from 'react';
import localforage from 'localforage';
import { supabaseCloud } from '../config/supabaseCloud';
import { storageService } from '../utils/storageService';
import { useAuthStore } from './store/useAuthStore';

// Exportado para que SettingsView pueda enviar el broadcast antes de hacer signOut
export const broadcastFactoryReset = async (userId) => {
    try {
        const ch = supabaseCloud.channel(`factory-reset-${userId}`);
        await ch.subscribe();
        await ch.send({ type: 'broadcast', event: 'factory_reset', payload: {} });
        // Pequeña pausa para que el mensaje llegue antes de continuar
        await new Promise(r => setTimeout(r, 800));
        supabaseCloud.removeChannel(ch);
    } catch (e) {
        console.warn('[CloudSync] No se pudo broadcast factory_reset:', e.message);
    }
};

const SYNC_KEYS = [
    // ── IndexedDB (store) ──────────────────────────────────────────────────
    'bodega_products_v1',
    'bodega_customers_v1',
    'bodega_sales_v1',
    'bodega_payment_methods_v1',
    'bodega_accounts_v2',
    'abasto_audit_log_v1',
    'my_categories_v1',           // Categorías de productos
    'bodega_suppliers_v1',        // Proveedores
    'bodega_supplier_invoices_v1',// Facturas de proveedores
    // ── localStorage (local) ──────────────────────────────────────────────
    'abasto-auth-storage',        // Usuarios, PINs, roles
    'monitor_rates_v12',
    'bodega_custom_rate',
    'bodega_use_auto_rate',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled',
    // ── Configuración del negocio (localStorage) ──────────────────────────
    'cashea_enabled',
    'business_address',
    'business_phone',
    'business_instagram',
    'admin_auto_lock_minutes',
    'theme',
    'catalog_show_cash_price',
    'catalog_custom_usdt_price',
    'catalog_use_auto_usdt',
    'street_rate_bs',
    'printer_paper_width',
];

// Llaves que van a colección 'local' (localStorage); el resto va a 'store' (IndexedDB)
const LOCAL_KEYS = [
    'abasto-auth-storage',
    'monitor_rates_v12',
    'bodega_custom_rate',
    'bodega_use_auto_rate',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled',
    'cashea_enabled',
    'business_address',
    'business_phone',
    'business_instagram',
    'admin_auto_lock_minutes',
    'theme',
    'catalog_show_cash_price',
    'catalog_custom_usdt_price',
    'catalog_use_auto_usdt',
    'street_rate_bs',
    'printer_paper_width',
];

// ─── Realtime selectivo ────────────────────────────────────────────────────
// Solo llaves pequeñas (<1KB) van por Realtime para multi-dispositivo instantáneo.
// Datos pesados (productos, ventas, clientes) siguen con polling cada 5 min.
const REALTIME_KEYS = [
    'monitor_rates_v12',
    'bodega_custom_rate',
    'bodega_use_auto_rate',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled',
    'cashea_enabled',
    'business_address',
    'business_phone',
    'business_instagram',
    'admin_auto_lock_minutes',
    'theme',
    'catalog_show_cash_price',
    'catalog_custom_usdt_price',
    'catalog_use_auto_usdt',
    'street_rate_bs',
    'printer_paper_width',
];

// Llaves pesadas — solo polling (evita egreso masivo por Realtime)
const POLLING_ONLY_KEYS = SYNC_KEYS.filter(k => !REALTIME_KEYS.includes(k));

// ─── Llaves que contienen arrays con campo `id` y requieren merge inteligente ──
// Cuando llegan datos de la nube, en vez de sobreescribir el array completo,
// se hace merge por ID: se combinan items locales + nube, y si ambos tienen
// el mismo ID, gana el que tenga updatedAt/createdAt más reciente.
const MERGEABLE_KEYS = [
    'bodega_products_v1',
    'bodega_customers_v1',
    'bodega_sales_v1',
    'bodega_payment_methods_v1',
    'bodega_accounts_v2',
    'abasto_audit_log_v1',
    'my_categories_v1',
    'bodega_suppliers_v1',
    'bodega_supplier_invoices_v1',
];

/**
 * Merge inteligente de arrays por ID.
 * Combina localArr + cloudArr sin perder items de ninguno.
 * Si un item existe en ambos, gana el más reciente (por updatedAt o createdAt).
 */
function _mergeArraysById(localArr, cloudArr) {
    if (!Array.isArray(localArr) || !Array.isArray(cloudArr)) return cloudArr;

    const map = new Map();

    // Primero agregar todos los locales
    for (const item of localArr) {
        const id = item?.id;
        if (id) map.set(id, item);
    }

    // Luego agregar/sobreescribir con los de la nube si son más recientes
    for (const item of cloudArr) {
        const id = item?.id;
        if (!id) {
            // Items sin id: agregar directamente
            map.set(Symbol(), item);
            continue;
        }

        const existing = map.get(id);
        if (!existing) {
            map.set(id, item);
        } else {
            // Comparar timestamps — gana el más reciente
            const localTime = existing.updatedAt || existing.createdAt || '';
            const cloudTime = item.updatedAt || item.createdAt || '';
            if (cloudTime >= localTime) {
                map.set(id, item);
            }
            // Si local es más reciente, se queda el local (ya está en el map)
        }
    }

    return Array.from(map.values());
}

// ─── Estado Global del Motor ───────────────────────────────────────────────
let pollIntervalId = null;
let realtimeChannel = null;     // Canal Realtime para tasas/config (payloads pequeños)
// Intentional module-level singletons: shared across all hook instances to
// coordinate cloud-sync echo prevention and debounce timers.
let isSyncingFromCloud = false; // true mientras aplicamos cambios de la nube → evita eco
let pendingPush = {};           // Debounce: { [key]: timeoutId }
let lastSyncTime = null;        // Timestamp del último pull exitoso

// Keep a reference to the native setItem for _applyFromCloud to bypass any interceptor
const _nativeSetItem = localStorage.setItem.bind(localStorage);

// Cache de hashes para evitar resubir datos idénticos (reduce egreso ~60%)
const _lastPushHash = {};

function _debouncePush(key, value) {
    if (pendingPush[key]) clearTimeout(pendingPush[key]);
    pendingPush[key] = setTimeout(() => {
        delete pendingPush[key];
        pushCloudSync(key, value).catch(() => {});
    }, 2000); // 2s debounce — agrupa cambios rápidos antes de enviar a la nube
}

/**
 * Empuja una llave al sincronizador de Supabase.
 * Llamado desde storageService (colección 'store') y el interceptor localStorage (colección 'local').
 */
export const pushCloudSync = async (key, value) => {
    if (isSyncingFromCloud) return;          // Nunca re-emitir lo que llegó de la nube
    if (!SYNC_KEYS.includes(key)) return;

    try {
        // Seguridad: eliminar adminPassword antes de sincronizar auth-storage a la nube
        let sanitizedValue = value;
        if (key === 'abasto-auth-storage') {
            try {
                const parsed = typeof value === 'string' ? JSON.parse(value) : value;
                if (parsed?.state?.adminPassword) {
                    sanitizedValue = JSON.parse(JSON.stringify(parsed));
                    delete sanitizedValue.state.adminPassword;
                }
            } catch { }
        }

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
            } catch { }
        }

        // Deduplicación: generar hash rápido del payload para no resubir datos idénticos.
        const serialized = typeof sanitizedValue === 'string' ? sanitizedValue : JSON.stringify(sanitizedValue);
        // Hash includes length + start + middle + end to catch changes anywhere in payload
        const mid = Math.floor(serialized.length / 2);
        const hash = serialized.length + ':' + serialized.slice(0, 100) + serialized.slice(mid, mid + 100) + serialized.slice(-100);
        if (_lastPushHash[key] === hash) return; // Sin cambios reales → skip
        // NOTA: hash se actualiza DESPUÉS del push exitoso para garantizar reintentos si falla

        const { data: { session } } = await supabaseCloud.auth.getSession();
        if (!session?.user?.id) return;

        const collectionType = LOCAL_KEYS.includes(key) ? 'local' : 'store';

        await supabaseCloud.from('sync_documents').upsert({
            user_id: session.user.id,
            collection: collectionType,
            doc_id: key,
            data: { payload: sanitizedValue },
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_id,collection,doc_id' });

        // Solo marcar como enviado si el push fue exitoso
        _lastPushHash[key] = hash;

    } catch (e) {
        console.warn('[CloudSync] Error al enviar a la nube:', e.message ?? e);
    }
};

/**
 * Aplica un documento recibido de la nube al almacenamiento local.
 * Garantiza que isSyncingFromCloud esté activo durante toda la operación.
 * Si cloudUpdatedAt se provee, verifica que sea más reciente que el timestamp local
 * para evitar sobreescribir cambios locales con datos desactualizados de la nube.
 */
async function _applyFromCloud(docId, collection, payload, cloudUpdatedAt) {
    // Para llaves mergeables (arrays con id), NUNCA saltamos — siempre hacemos merge
    const isMergeable = MERGEABLE_KEYS.includes(docId) && collection === 'store';

    // Protección contra sobreescritura para llaves NO mergeables
    if (!isMergeable && cloudUpdatedAt) {
        try {
            const localTs = localStorage.getItem('_sync_local_ts_' + docId);
            if (localTs && localTs > cloudUpdatedAt) {
                console.log(`[CloudSync] Skip ${docId}: local (${localTs}) más reciente que nube (${cloudUpdatedAt}). Resubiendo...`);
                const { default: lf } = await import('localforage');
                lf.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                const localData = await lf.getItem(docId);
                if (localData !== null) {
                    delete _lastPushHash[docId];
                    pushCloudSync(docId, localData).catch(() => {});
                }
                return;
            }
        } catch(e) { /* Si falla la comparación, aplicar de todas formas */ }
    }

    isSyncingFromCloud = true;
    try {
        if (collection === 'local') {
            let finalPayload = payload;

            // abasto-auth-storage: the cloud copy has adminPassword stripped for security.
            // Preserve the local credentials so isCloudConfigured stays true.
            if (docId === 'abasto-auth-storage') {
                try {
                    const incoming = typeof payload === 'string' ? JSON.parse(payload) : JSON.parse(JSON.stringify(payload));
                    const existingRaw = localStorage.getItem('abasto-auth-storage');
                    if (existingRaw) {
                        const existing = JSON.parse(existingRaw);
                        if (existing?.state?.adminPassword && !incoming?.state?.adminPassword) {
                            incoming.state.adminPassword = existing.state.adminPassword;
                        }
                        if (existing?.state?.adminEmail && !incoming?.state?.adminEmail) {
                            incoming.state.adminEmail = existing.state.adminEmail;
                        }
                    }
                    finalPayload = incoming;
                } catch { /* keep original payload on parse error */ }
            }

            const stringPayload = typeof finalPayload === 'string' ? finalPayload : JSON.stringify(finalPayload);
            _nativeSetItem(docId, stringPayload);   // Escribe sin pasar por el interceptor
            window.dispatchEvent(new StorageEvent('storage', {
                key: docId,
                newValue: stringPayload,
                storageArea: localStorage
            }));
            if (docId === 'abasto-auth-storage') {
                useAuthStore.persist.rehydrate();
            }
        } else {
            // Colección 'store' → IndexedDB
            const { default: localforage } = await import('localforage');
            localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

            let finalData = payload;

            // Merge inteligente para arrays con ID (ventas, productos, clientes, etc.)
            if (isMergeable && Array.isArray(payload)) {
                try {
                    const localData = await localforage.getItem(docId);
                    if (Array.isArray(localData)) {
                        finalData = _mergeArraysById(localData, payload);
                        console.log(`[CloudSync] Merge ${docId}: local=${localData.length}, nube=${payload.length}, resultado=${finalData.length}`);

                        // Si el merge produjo más items que la nube, re-subir el resultado
                        if (finalData.length > payload.length) {
                            setTimeout(() => {
                                delete _lastPushHash[docId];
                                pushCloudSync(docId, finalData).catch(() => {});
                            }, 500);
                        }
                    }
                } catch (e) {
                    console.warn(`[CloudSync] Merge falló para ${docId}, usando datos de nube:`, e.message);
                }
            }

            await localforage.setItem(docId, finalData);

            // Notificar a los componentes React que lean este store
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId } }));
        }
    } finally {
        isSyncingFromCloud = false;
    }
}

// ─── Hook de React ─────────────────────────────────────────────────────────
export function useCloudSync() {
    const adminEmail = useAuthStore(s => s.adminEmail);
    const adminPassword = useAuthStore(s => s.adminPassword);
    const isCloudConfigured = Boolean(adminEmail);
    const isInitialized = useRef(false);

    useEffect(() => {
        // Interceptor de localStorage — solo para llaves 'local'
        const originalSetItem = localStorage.setItem.bind(localStorage);
        localStorage.setItem = function (key, value) {
            originalSetItem(key, value);
            if (!isSyncingFromCloud && LOCAL_KEYS.includes(key)) {
                _debouncePush(key, value);
            }
        };

        if (!isCloudConfigured) {
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
                isInitialized.current = false;
                lastSyncTime = null;
            }
            if (realtimeChannel) {
                supabaseCloud.removeChannel(realtimeChannel);
                realtimeChannel = null;
            }
            return () => { localStorage.setItem = originalSetItem; };
        }

        if (isInitialized.current) return () => { localStorage.setItem = originalSetItem; };

        const initSync = async () => {
            try {
                let session = (await supabaseCloud.auth.getSession()).data.session;

                if (!session?.user?.id) return;

                isInitialized.current = true;
                const userId = session.user.id;

                // ── Pull Inicial: descarga todos los documentos ──────────────
                // Saltarse si acaba de hacerse una importación local (el flag evita que
                // Supabase sobreescriba los datos recién importados).
                let docs = null;
                const skipPull = sessionStorage.getItem('skip_cloud_pull');
                if (skipPull) {
                    sessionStorage.removeItem('skip_cloud_pull');
                    console.log('[CloudSync] Pull inicial omitido (importación reciente).');
                } else {
                    const { data } = await supabaseCloud
                        .from('sync_documents')
                        .select('collection, doc_id, data, updated_at')
                        .eq('user_id', userId)
                        .in('collection', ['store', 'local']);
                    docs = data;

                    if (docs?.length > 0) {
                        for (const doc of docs) {
                            await _applyFromCloud(doc.doc_id, doc.collection, doc.data.payload, doc.updated_at);
                        }
                        console.log(`[CloudSync] Pull inicial: ${docs.length} documentos procesados.`);
                    }
                }

                lastSyncTime = new Date().toISOString();

                // ── Catch-up push: subir datos locales que la nube no tiene ──
                // Asegura que claves recién agregadas al sync (ej. categorías, proveedores,
                // config) queden en Supabase aunque nunca hayan sido modificadas en este
                // dispositivo desde que se activó el sync.
                // El hash deduplication evita resubir lo que ya está igual en la nube.
                // Set de doc_ids que la nube ya tiene (del pull inicial)
                const cloudDocIds = new Set(docs?.map(d => d.doc_id) || []);

                (async () => {
                    const { default: lf } = await import('localforage');
                    lf.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    for (const key of SYNC_KEYS) {
                        if (LOCAL_KEYS.includes(key)) {
                            const val = localStorage.getItem(key);
                            if (val != null) pushCloudSync(key, val).catch(() => {});
                        } else {
                            const val = await lf.getItem(key);
                            // No subir arrays vacíos si la nube ya tiene datos para esta llave.
                            // Esto previene que un dispositivo nuevo borre el inventario de la nube.
                            if (val != null) {
                                if (Array.isArray(val) && val.length === 0 && cloudDocIds.has(key)) {
                                    console.log(`[CloudSync] Skip push ${key}: local vacío, nube ya tiene datos`);
                                    continue;
                                }
                                pushCloudSync(key, val).catch(() => {});
                            }
                        }
                        // Pausa entre keys para no saturar Supabase con burst
                        await new Promise(r => setTimeout(r, 120));
                    }
                })().catch(() => {});

                // ── Listener de Factory Reset remoto ─────────────────────────
                // Si otro dispositivo con la misma cuenta hace factory reset,
                // este equipo también limpia y recarga.
                supabaseCloud.channel(`factory-reset-${userId}`)
                    .on('broadcast', { event: 'factory_reset' }, async () => {
                        console.log('[CloudSync] Factory reset remoto recibido — limpiando...');
                        try {
                            await localforage.clear();
                            try {
                                const oldStore = localforage.createInstance({ name: 'TasasAlDiaApp', storeName: 'app_data' });
                                await oldStore.clear();
                            } catch (e) { /* ignorar */ }
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
                    .subscribe();

                // ── Realtime: solo tasas y config (payloads <1KB) ─────────────
                // Esto permite que 2 dispositivos con la misma cuenta vean
                // cambios de tasa instantáneamente sin egreso significativo.
                if (!realtimeChannel) {
                    realtimeChannel = supabaseCloud
                        .channel('sync-rates')
                        .on(
                            'postgres_changes',
                            {
                                event: 'UPDATE',
                                schema: 'public',
                                table: 'sync_documents',
                                filter: `user_id=eq.${userId}`
                            },
                            async (payload) => {
                                if (isSyncingFromCloud) return;
                                const { doc_id, collection, data } = payload.new;
                                // Solo procesar llaves de Realtime (tasas/config)
                                if (!REALTIME_KEYS.includes(doc_id)) return;
                                console.log(`[CloudSync] Realtime: ${doc_id} actualizado`);
                                await _applyFromCloud(doc_id, collection, data.payload);
                            }
                        )
                        .subscribe((status) => {
                            console.log(`[CloudSync] Realtime canal: ${status}`);
                        });
                }

                // ── Polling cada 60 min: solo datos pesados ──────────────────
                // Productos, ventas, clientes, cuentas — payloads grandes que
                // no necesitan ser instantáneos. 60 min optimiza egress para 5GB/mes.
                if (!pollIntervalId) {
                    const POLL_INTERVAL = 60 * 60 * 1000; // 60 minutos — optimizado para egress

                    const pollForChanges = async () => {
                        if (isSyncingFromCloud) return;
                        try {
                            const currentSession = (await supabaseCloud.auth.getSession()).data.session;
                            if (!currentSession?.user?.id) return;

                            // ── Fase 1: solo metadatos (doc_id + updated_at) ──────────
                            // Costo: ~1 KB en vez de 218 KB. Solo bajamos data si algo cambió.
                            let metaQuery = supabaseCloud
                                .from('sync_documents')
                                .select('doc_id, collection, updated_at')
                                .eq('user_id', currentSession.user.id)
                                .in('doc_id', POLLING_ONLY_KEYS);

                            if (lastSyncTime) {
                                metaQuery = metaQuery.gt('updated_at', lastSyncTime);
                            }

                            const { data: changedMeta } = await metaQuery;

                            // ── Fase 2: bajar solo los docs que realmente cambiaron ───
                            if (changedMeta?.length > 0) {
                                const changedIds = changedMeta.map(d => d.doc_id);
                                const { data: changed } = await supabaseCloud
                                    .from('sync_documents')
                                    .select('collection, doc_id, data, updated_at')
                                    .eq('user_id', currentSession.user.id)
                                    .in('doc_id', changedIds);

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
                        }
                    };

                    pollIntervalId = setInterval(pollForChanges, POLL_INTERVAL);
                    console.log('[CloudSync] Híbrido iniciado: Realtime (config) + Polling 60min (datos)');

                    // ── Pausar polling con pestaña oculta — ahorra egress ────────
                    // Si la pestaña no está visible, pausamos el interval.
                    // Al volver visible, hacemos un poll inmediato (con cooldown) y reiniciamos el interval.
                    let lastVisibilityPoll = 0;
                    const VISIBILITY_COOLDOWN_MS = 10 * 60 * 1000; // mínimo 10 min entre polls por visibilidad

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
                isInitialized.current = false; // Permitir reintento
            }
        };

        initSync();

        return () => {
            localStorage.setItem = originalSetItem;
            // Clear all pending debounce timers to prevent pushes after unmount
            for (const key of Object.keys(pendingPush)) {
                clearTimeout(pendingPush[key]);
                delete pendingPush[key];
            }
            if (pollIntervalId) {
                clearInterval(pollIntervalId);
                pollIntervalId = null;
            }
            if (realtimeChannel) {
                supabaseCloud.removeChannel(realtimeChannel);
                realtimeChannel = null;
            }
            if (window.__cloudSyncVisibilityListener) {
                document.removeEventListener('visibilitychange', window.__cloudSyncVisibilityListener);
                delete window.__cloudSyncVisibilityListener;
            }
        };
    }, [isCloudConfigured, adminEmail, adminPassword]);
}
