// Namespace exclusivo de Listo POS Lite.
// No reutilizar BodegaApp/TasasAlDiaApp: otras aplicaciones pueden usar esos nombres.
export const APP_STORAGE_DB_NAME = 'ListoPOSLiteApp_v1';
export const APP_STORAGE_STORE_NAME = 'listo_pos_data';
export const ACTIVE_ACCOUNT_STORAGE_KEY = 'listo_pos_active_account_id';
export const ACTIVE_SEDE_STORAGE_KEY = 'farmacia_active_sede_id';

const SEDE_SCOPED_KEYS = new Set([
    'bodega_products_v1', 'bodega_sales_v1', 'bodega_cierres_v1',
    'bodega_payment_methods_v1', 'bodega_accounts_v2',
    'farmacia_stock_v1', 'farmacia_lotes_v1', 'farmacia_caja_v1',
]);

export function getActiveAccountId() {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) || '';
}

export function setActiveAccountId(accountId) {
    if (typeof localStorage === 'undefined') return;
    if (accountId) localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, accountId);
    else localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
}

export function getActiveSedeId() {
    if (typeof localStorage === 'undefined') return 'central';
    return localStorage.getItem(ACTIVE_SEDE_STORAGE_KEY) || 'central';
}

export function setActiveSedeId(sedeId) {
    if (typeof localStorage === 'undefined') return;
    if (sedeId) localStorage.setItem(ACTIVE_SEDE_STORAGE_KEY, sedeId);
    else localStorage.removeItem(ACTIVE_SEDE_STORAGE_KEY);
}

export function getScopedStoragePrefix(key = '') {
    const accountId = getActiveAccountId();
    const accountPrefix = accountId ? `account:${accountId}:` : 'unscoped:';
    return SEDE_SCOPED_KEYS.has(key)
        ? `${accountPrefix}sede:${getActiveSedeId()}:`
        : accountPrefix;
}

export function getScopedStorageKey(key) {
    return `${getScopedStoragePrefix(key)}${key}`;
}

export function isSedeScopedKey(key) {
    return SEDE_SCOPED_KEYS.has(key);
}
