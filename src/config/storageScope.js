// Namespace exclusivo de Listo POS Lite.
// No reutilizar BodegaApp/TasasAlDiaApp: otras aplicaciones pueden usar esos nombres.
export const APP_STORAGE_DB_NAME = 'ListoPOSLiteApp_v1';
export const APP_STORAGE_STORE_NAME = 'listo_pos_data';
export const ACTIVE_ACCOUNT_STORAGE_KEY = 'listo_pos_active_account_id';

export function getActiveAccountId() {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(ACTIVE_ACCOUNT_STORAGE_KEY) || '';
}

export function setActiveAccountId(accountId) {
    if (typeof localStorage === 'undefined') return;
    if (accountId) localStorage.setItem(ACTIVE_ACCOUNT_STORAGE_KEY, accountId);
    else localStorage.removeItem(ACTIVE_ACCOUNT_STORAGE_KEY);
}

export function getScopedStoragePrefix() {
    const accountId = getActiveAccountId();
    return accountId ? `account:${accountId}:` : 'unscoped:';
}

export function getScopedStorageKey(key) {
    return `${getScopedStoragePrefix()}${key}`;
}
