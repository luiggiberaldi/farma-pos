import localforage from 'localforage';
import { REMOTE_OPERATIONS_PAUSED, pausedCloudOperation } from '../config/operationSafety.js';
import {
  APP_STORAGE_DB_NAME,
  APP_STORAGE_STORE_NAME,
  getActiveAccountId,
  getScopedStorageKey,
  captureStorageContext,
  getStorageKeyForContext,
} from '../config/storageScope';
import {
  MAX_QUEUE_ATTEMPTS,
  isQueueItemDue,
  nextRetryAt,
  pruneSyncedItems,
} from './offlineQueuePolicy';

const QUEUE_KEY = 'offline_sales_queue';
const SALES_KEY = 'bodega_sales_v1';
const DEVICE_KEY = 'pda_device_id';

localforage.config({
  name: APP_STORAGE_DB_NAME,
  storeName: APP_STORAGE_STORE_NAME,
});

let syncInFlight = false;

function newOperationId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `offline-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// En modo local puro (sin Supabase) la cola vive bajo la pseudo-cuenta
// 'local': la venta NUNCA se pierde y queda lista para reintentos.
const LOCAL_ACCOUNT_ID = 'local';

function getQueueStorageKey(context = captureStorageContext()) {
  return getStorageKeyForContext(QUEUE_KEY, { ...context, accountId: context.accountId || LOCAL_ACCOUNT_ID });
}

function getDeviceId() {
  if (typeof localStorage === 'undefined') return 'unknown-device';
  return localStorage.getItem(DEVICE_KEY) || 'unknown-device';
}

function notifyQueueChanged() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('offline_queue_update'));
  }
}

async function readQueue(context = captureStorageContext()) {
  const key = getQueueStorageKey(context);
  if (!key) return [];
  const queue = await localforage.getItem(key);
  return Array.isArray(queue) ? queue : [];
}

async function writeQueue(queue, context = captureStorageContext()) {
  const key = getQueueStorageKey(context);
  await localforage.setItem(key, queue);
  notifyQueueChanged();
}

async function markLocalSaleSynced(item, serverData) {
  const key = getActiveAccountId() ? getScopedStorageKey(SALES_KEY) : null;
  if (!key) return;

  const sales = await localforage.getItem(key);
  if (!Array.isArray(sales)) return;

  const updated = sales.map(sale => {
    const matches = sale.syncQueueId === item.queue_id || sale.id === item.queue_id;
    if (!matches) return sale;
    return {
      ...sale,
      status: 'COMPLETADA',
      syncMode: 'online_after_retry',
      remoteSaleId: serverData?.sale_id || sale.remoteSaleId || null,
      syncedAt: new Date().toISOString(),
    };
  });

  if (JSON.stringify(updated) !== JSON.stringify(sales)) {
    await localforage.setItem(key, updated);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('app_storage_update', {
        detail: { key: SALES_KEY, source: 'offline_queue' },
      }));
    }
  }
}

export const offlineQueueService = {
  async addSaleToQueue(salePayload, context = captureStorageContext()) {
    // Pin account/branch before the first await; keep legacy entries untouched.
    const accountId = context.accountId || LOCAL_ACCOUNT_ID;

    const queue = await readQueue(context);
    const operationId = salePayload.queue_id || salePayload.operation_id || newOperationId();
    const existing = queue.find(item => item.queue_id === operationId);
    if (existing) return existing;

    const entry = {
      id: operationId,
      queue_id: operationId,
      operation_id: operationId,
      account_id: accountId,
      sede_id: context.sedeId,
      local_sales_key: getStorageKeyForContext(SALES_KEY, context),
      device_id: getDeviceId(),
      payload: salePayload,
      created_at: new Date().toISOString(),
      sync_status: 'pending',
      attempts: 0,
      next_attempt_at: null,
      last_error: null,
    };

    await writeQueue([...queue, entry], context);
    return entry;
  },

  async getQueue() {
    return readQueue();
  },

  async getCounts() {
    const queue = await readQueue();
    return {
      pending: queue.filter(item => item.sync_status === 'pending').length,
      failed: queue.filter(item => item.sync_status === 'failed').length,
      synced: queue.filter(item => item.sync_status === 'synced').length,
    };
  },

  async syncPendingSales() {
    if (REMOTE_OPERATIONS_PAUSED) return pausedCloudOperation();
    if (syncInFlight || typeof navigator !== 'undefined' && !navigator.onLine) return;
    const accountId = getActiveAccountId();
    // Sin cuenta cloud no hay nada que enviar; en desarrollo tampoco existe
    // el worker que atiende /api/checkout, así que no se queman reintentos.
    if (!accountId || import.meta.env.DEV) return;

    syncInFlight = true;
    try {
      let queue = pruneSyncedItems(await readQueue());
      const now = Date.now();
      const pending = queue.filter(item => item.account_id === accountId && isQueueItemDue(item, now));

      for (const item of pending) {
        try {
          const payloadWithOrigin = {
            ...item.payload,
            sync_origin: 'offline_sync',
            original_created_at: item.created_at,
            queue_id: item.queue_id,
            account_id: item.account_id,
            device_id: item.device_id,
          };

          const res = await fetch('/api/checkout', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payloadWithOrigin),
            signal: AbortSignal.timeout(10000),
          });
          const data = await res.json().catch(() => ({}));

          if (!res.ok || data.error || data.code) {
            throw new Error(data.message || data.error || `HTTP ${res.status}`);
          }

          queue = queue.map(q => q.id === item.id ? {
            ...q,
            sync_status: 'synced',
            synced_at: new Date().toISOString(),
            last_error: null,
          } : q);
          await markLocalSaleSynced(item, data);
        } catch (err) {
          const attempts = (item.attempts || 0) + 1;
          queue = queue.map(q => q.id === item.id ? {
            ...q,
            attempts,
            sync_status: attempts >= MAX_QUEUE_ATTEMPTS ? 'failed' : 'pending',
            next_attempt_at: attempts >= MAX_QUEUE_ATTEMPTS ? null : nextRetryAt(attempts),
            last_error: err?.message || 'Error desconocido',
          } : q);
        }

        // Persistir después de cada operación: un apagón no pierde el progreso.
        await writeQueue(queue);
      }

      await writeQueue(pruneSyncedItems(queue));
    } finally {
      syncInFlight = false;
    }
  },

  async retryFailed() {
    if (REMOTE_OPERATIONS_PAUSED) return pausedCloudOperation();
    const queue = await readQueue();
    const reset = queue.map(item => item.sync_status === 'failed'
      ? { ...item, sync_status: 'pending', attempts: 0, next_attempt_at: null, last_error: null }
      : item);
    await writeQueue(reset);
    await this.syncPendingSales();
  },

  async dismissFailed() {
    if (REMOTE_OPERATIONS_PAUSED) return pausedCloudOperation();
    const queue = await readQueue();
    await writeQueue(queue.filter(item => item.sync_status !== 'failed'));
  },

  async getFailedCount() {
    const { failed } = await this.getCounts();
    return failed;
  },
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    offlineQueueService.syncPendingSales().catch(error => {
      console.warn('[Offline Sync] Reintento automático falló:', error?.message || error);
    });
  });
}
