// Namespace exclusivo de Farma POS.
// Las claves sede-scoped hacen que cada sede tenga su propio inventario;
// el dueño lee otras sedes con getItemForSede (solo lectura).
// No reutilizar BodegaApp/TasasAlDiaApp: otras aplicaciones pueden usar esos nombres.
export const APP_STORAGE_DB_NAME = 'ListoPOSLiteApp_v1';
export const APP_STORAGE_STORE_NAME = 'listo_pos_data';
export const ACTIVE_ACCOUNT_STORAGE_KEY = 'listo_pos_active_account_id';
export const ACTIVE_SEDE_STORAGE_KEY = 'farmacia_active_sede_id';

const SEDE_SCOPED_KEYS = new Set([
    'bodega_products_v1', 'bodega_sales_v1', 'bodega_cierres_v1',
    'bodega_payment_methods_v1', 'bodega_accounts_v2',
    'bodega_customers_v1',
    'farmacia_stock_v1', 'farmacia_lotes_v1', 'farmacia_caja_v1',
    'farmacia_correlativos_v1', 'farmacia_seed_done_v1',
    // Transferencias son eventos account-scoped con origen/destino explícitos:
    // ambas sedes deben poder descubrir el mismo envío sin compartir inventario.
    'farmacia_controlados_v1', 'abasto_audit_log_v1',
    'farmacia_sede_movimientos_v1',
    'bodega_suppliers_v1', 'bodega_supplier_invoices_v1',
    // La cola es account-scoped: cada entrada lleva sede_id y operación global,
    // permitiendo detectar colisiones de operationId entre sedes.
    'bodega_pending_cart_v2', 'bodega_autobackup_v2',
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

export function captureStorageContext() {
    return Object.freeze({ accountId: getActiveAccountId(), sedeId: getActiveSedeId() });
}

export function isStorageContextActive(context) {
    return context?.accountId === getActiveAccountId() && context?.sedeId === getActiveSedeId();
}

export function assertStorageContextActive(context) {
    if (!isStorageContextActive(context)) throw new Error('La cuenta o sede cambió durante la operación. Vuelve a consultar los datos.');
}

export function getStorageKeyForContext(key, context) {
    if (!context || typeof context.accountId !== 'string' || !['central', 'norte', 'sur'].includes(context.sedeId)) {
        throw new Error('Contexto de cuenta o sede inválido.');
    }
    const scopeKey = key.startsWith('_sync_local_ts_') ? key.slice('_sync_local_ts_'.length) : key;
    const prefix = context.accountId ? `account:${context.accountId}:` : 'unscoped:';
    return SEDE_SCOPED_KEYS.has(scopeKey) ? `${prefix}sede:${context.sedeId}:${key}` : `${prefix}${key}`;
}

export function getScopedStoragePrefix(key = '', accountIdOverride = null) {
    const context = { accountId: accountIdOverride || getActiveAccountId(), sedeId: getActiveSedeId() };
    const scoped = getStorageKeyForContext(key, context);
    return key ? scoped.slice(0, -key.length) : scoped;
}

export function getScopedStorageKey(key, accountIdOverride = null) {
    return `${getScopedStoragePrefix(key, accountIdOverride)}${key}`;
}

// Clave explícita para leer una sede arbitraria (reportes consolidados).
export function getSedeStorageKey(key, sedeId) {
    return getStorageKeyForContext(key, { accountId: getActiveAccountId(), sedeId });
}

