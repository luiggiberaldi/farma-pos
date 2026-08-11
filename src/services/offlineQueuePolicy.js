export const MAX_QUEUE_ATTEMPTS = 10;
export const RETRY_BASE_MS = 2000;
export const RETRY_MAX_MS = 5 * 60 * 1000;

export function retryDelayMs(attempts) {
    const exponent = Math.max(0, Number(attempts) || 0);
    return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * (2 ** exponent));
}

export function nextRetryAt(attempts, now = Date.now()) {
    return new Date(now + retryDelayMs(attempts)).toISOString();
}

export function isQueueItemDue(item, now = Date.now()) {
    if (!item || item.sync_status !== 'pending') return false;
    if (!item.next_attempt_at) return true;
    const nextAttempt = Date.parse(item.next_attempt_at);
    return Number.isNaN(nextAttempt) || nextAttempt <= now;
}

export function belongsToAccount(item, accountId) {
    return Boolean(accountId) && item?.account_id === accountId;
}

export function pruneSyncedItems(queue, now = Date.now(), retentionMs = 24 * 60 * 60 * 1000) {
    return queue.filter(item => {
        if (item.sync_status !== 'synced' || !item.synced_at) return true;
        const syncedAt = Date.parse(item.synced_at);
        return Number.isNaN(syncedAt) || now - syncedAt < retentionMs;
    });
}
