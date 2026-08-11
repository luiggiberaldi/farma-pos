import test from 'node:test';
import assert from 'node:assert/strict';

import {
  belongsToAccount,
  isQueueItemDue,
  nextRetryAt,
  pruneSyncedItems,
  retryDelayMs,
} from '../src/services/offlineQueuePolicy.js';
import {
  getScopedStorageKey,
  setActiveAccountId,
} from '../src/config/storageScope.js';

function installLocalStorage() {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

test('retry delay uses exponential backoff and caps at five minutes', () => {
  assert.equal(retryDelayMs(0), 2000);
  assert.equal(retryDelayMs(1), 4000);
  assert.equal(retryDelayMs(10), 300000);
  assert.equal(retryDelayMs(99), 300000);
});

test('pending queue item is due only after its retry time', () => {
  const now = Date.parse('2026-08-11T12:00:00.000Z');
  const future = nextRetryAt(1, now);
  assert.equal(isQueueItemDue({ sync_status: 'pending', next_attempt_at: future }, now), false);
  assert.equal(isQueueItemDue({ sync_status: 'pending', next_attempt_at: future }, now + 4000), true);
  assert.equal(isQueueItemDue({ sync_status: 'failed' }, now), false);
});

test('queue entries belong only to their active account', () => {
  assert.equal(belongsToAccount({ account_id: 'account-a' }, 'account-a'), true);
  assert.equal(belongsToAccount({ account_id: 'account-a' }, 'account-b'), false);
  assert.equal(belongsToAccount({ account_id: 'account-a' }, ''), false);
});

test('synced queue entries are retained during the recovery window', () => {
  const now = Date.parse('2026-08-11T12:00:00.000Z');
  const queue = [
    { id: 'pending', sync_status: 'pending' },
    { id: 'recent', sync_status: 'synced', synced_at: new Date(now - 1000).toISOString() },
    { id: 'old', sync_status: 'synced', synced_at: new Date(now - 25 * 60 * 60 * 1000).toISOString() },
  ];
  assert.deepEqual(pruneSyncedItems(queue, now).map(item => item.id), ['pending', 'recent']);
});

test('storage keys are isolated by account', () => {
  installLocalStorage();
  setActiveAccountId('account-a');
  const accountAKey = getScopedStorageKey('bodega_products_v1');
  setActiveAccountId('account-b');
  const accountBKey = getScopedStorageKey('bodega_products_v1');

  assert.notEqual(accountAKey, accountBKey);
  assert.equal(accountAKey, 'account:account-a:bodega_products_v1');
  assert.equal(accountBKey, 'account:account-b:bodega_products_v1');
});
