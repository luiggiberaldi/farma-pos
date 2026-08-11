import localforage from 'localforage';
import {
  APP_STORAGE_DB_NAME,
  APP_STORAGE_STORE_NAME,
  getActiveAccountId,
  getScopedStorageKey,
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

function getQueueStorageKey() {
  const accountId = getActiveAccountId();
  return accountId ? getScopedStorageKey(QUEUE_KEY) : null;
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

async function readQueue() {
  const key = getQueueStorageKey();
  if (!key) return [];
  const queue = await localforage.getItem(key);
  return Array.isArray(queue) ? queue : [];
}

async function writeQueue(queue) {
  const key = getQueueStorageKey();
  if (!key) throw new Error('No hay una cuenta activa para guardar la cola offline.');
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
  async addSaleToQueue(salePayload) {
    const accountId = getActiveAccountId();
    if (!accountId) {
      throw new Error('No se puede encolar una venta sin cuenta activa.');
    }

    const queue = await readQueue();
    const operationId = salePayload.queue_id || salePayload.operation_id || newOperationId();
    const existing = queue.find(item => item.queue_id === operationId);
    if (existing) return existing;

    const entry = {
      id: operationId,
      queue_id: operationId,
      operation_id: operationId,
      account_id: accountId,
      device_id: getDeviceId(),
      payload: salePayload,
      created_at: new Date().toISOString(),
      sync_status: 'pending',
      attempts: 0,
      next_attempt_at: null,
      last_error: null,
    };

    await writeQueue([...queue, entry]);
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
    if (syncInFlight || typeof navigator !== 'undefined' && !navigator.onLine) return;
    const accountId = getActiveAccountId();
    if (!accountId) return;

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
    const queue = await readQueue();
    const reset = queue.map(item => item.sync_status === 'failed'
      ? { ...item, sync_status: 'pending', attempts: 0, next_attempt_at: null, last_error: null }
      : item);
    await writeQueue(reset);
    await this.syncPendingSales();
  },

  async dismissFailed() {
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
