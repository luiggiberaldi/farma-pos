import { SUPABASE_FREE_PROFILE } from '../config/supabaseFreeTier.js';

const KEY = 'farmapos_sync_metrics_v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const BUCKETS = new Set([
    'bodega_products_v1', 'bodega_customers_v1', 'bodega_sales_v1',
    'bodega_cierres_v1', 'bodega_payment_methods_v1', 'bodega_accounts_v2',
    'my_categories_v1', 'bodega_suppliers_v1', 'bodega_supplier_invoices_v1',
    'abasto_audit_log_v1', 'abasto-auth-storage', 'monitor_rates_v12',
    'bodega_custom_rate', 'bodega_use_auto_rate', 'tasa_cop', 'cop_enabled',
    'auto_cop_enabled', 'cashea_enabled', 'business_address', 'business_phone',
    'business_instagram', 'admin_auto_lock_minutes', 'theme',
    'catalog_show_cash_price', 'catalog_custom_usdt_price', 'catalog_use_auto_usdt',
    'street_rate_bs', 'printer_paper_width',
    'sdk_auth', 'sdk_rest', 'sdk_storage', 'sdk_functions', 'sdk_other',
]);
const METRICS = Object.freeze({
    push: 'pushCount', pull: 'pullCount', uploadBytes: 'bytesUploaded',
    downloadBytes: 'bytesDownloaded', skipHash: 'skippedByHash', error: 'errors',
    request: 'requests', blocked: 'blocked', oversized: 'oversized',
    unknownResponseSize: 'responsesWithoutSize',
});
const FIELDS = Object.values(METRICS);

function emptyCounters() {
    return Object.fromEntries(FIELDS.map(field => [field, 0]));
}

function isRecord(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function finiteCount(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function addCount(current, increment) {
    return Math.min(Number.MAX_VALUE, current + increment);
}

function read() {
    try {
        const stored = JSON.parse(localStorage.getItem(KEY) || '{}');
        if (!isRecord(stored)) return {};
        const today = new Date(Date.now()).toISOString().slice(0, 10);
        const cutoff = Date.parse(today) - (SUPABASE_FREE_PROFILE.metricsDays - 1) * DAY_MS;
        const all = {};
        for (const [day, bucket] of Object.entries(stored)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isRecord(bucket)) continue;
            const timestamp = Date.parse(day);
            if (!Number.isFinite(timestamp) || timestamp < cutoff || day > today
                || new Date(timestamp).toISOString().slice(0, 10) !== day) continue;
            const cleanBucket = {};
            for (const [key, item] of Object.entries(bucket)) {
                if (!BUCKETS.has(key) || !isRecord(item)) continue;
                cleanBucket[key] = Object.fromEntries(FIELDS.map(field => [field, finiteCount(item[field])]));
            }
            if (Object.keys(cleanBucket).length) all[day] = cleanBucket;
        }
        return all;
    } catch {
        return {};
    }
}

function write(value) {
    try {
        localStorage.setItem(KEY, JSON.stringify(value));
    } catch {
        // Metrics must never affect synchronization or checkout.
    }
}

export function utf8ByteLength(value) {
    try {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        return typeof serialized === 'string' ? new TextEncoder().encode(serialized).byteLength : 0;
    } catch {
        return 0;
    }
}

export function recordSyncMetric(key, metric, bytes = 0) {
    // Only fixed labels and numeric counters are stored, never identities or payloads.
    if (!BUCKETS.has(key) || typeof metric !== 'string' || !Object.hasOwn(METRICS, metric)) return;
    const all = read();
    const day = new Date(Date.now()).toISOString().slice(0, 10);
    const bucket = all[day] || {};
    const item = bucket[key] || emptyCounters();
    const field = METRICS[metric];
    const increment = metric === 'uploadBytes' || metric === 'downloadBytes' ? finiteCount(bytes) : 1;
    item[field] = addCount(item[field], increment);
    bucket[key] = item;
    all[day] = bucket;
    write(all);
}

export function getSyncMetrics() {
    return read();
}

export function getSyncMetricSummary() {
    const all = read();
    const summary = { days: Object.keys(all).length, ...emptyCounters(),
        sdkBytesUploaded: 0, sdkBytesDownloaded: 0, sdkErrors: 0 };
    for (const bucket of Object.values(all)) {
        for (const [key, item] of Object.entries(bucket)) {
            for (const field of FIELDS) summary[field] = addCount(summary[field], item[field]);
            if (key.startsWith('sdk_')) {
                summary.sdkBytesUploaded = addCount(summary.sdkBytesUploaded, item.bytesUploaded);
                summary.sdkBytesDownloaded = addCount(summary.sdkBytesDownloaded, item.bytesDownloaded);
                summary.sdkErrors = addCount(summary.sdkErrors, item.errors);
            }
        }
    }
    // The UI uses only sdkBytes* for HTTP estimates. Legacy per-document bytes
    // remain available for compatibility, never added to the same traffic total.
    return summary;
}
