const VALID_SEDES = new Set(['central', 'norte', 'sur']);

export const CLOUD_DOCUMENT_VERSION = 'v2';

// Inventario y movimientos físicos nunca comparten documento entre sedes.
export const CLOUD_SEDE_SCOPED_KEYS = Object.freeze(new Set([
    'bodega_products_v1',
    'bodega_sales_v1',
    'bodega_cierres_v1',
    'bodega_payment_methods_v1',
    'bodega_accounts_v2',
    'bodega_customers_v1',
    'farmacia_stock_v1',
    'farmacia_lotes_v1',
    'farmacia_caja_v1',
    'farmacia_correlativos_v1',
    'farmacia_controlados_v1',
    'abasto_audit_log_v1',
    'farmacia_sede_movimientos_v1',
    'bodega_suppliers_v1',
    'bodega_supplier_invoices_v1',
]));

// Estas entidades pertenecen a la cuenta completa y no deben duplicarse por sede.
export const CLOUD_ACCOUNT_SCOPED_KEYS = Object.freeze(new Set([
    'abasto-auth-storage',
    'my_categories_v1',
    'farmacia_transferencias_v1',
    // Preferencias de cuenta que ya forman parte del contrato local sync.
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
]));

function assertAccount(accountId) {
    if (typeof accountId !== 'string' || accountId.length < 1 || accountId.length > 255 || /[:\s]/.test(accountId)) {
        throw new Error('Cuenta cloud inválida para documento sincronizado.');
    }
}

function assertEntity(key) {
    if (typeof key !== 'string' || !/^[a-zA-Z0-9_-]{1,120}$/.test(key)) {
        throw new Error('Entidad cloud inválida para documento sincronizado.');
    }
}

export function isCloudSedeScopedKey(key) {
    return CLOUD_SEDE_SCOPED_KEYS.has(key);
}

export function isCloudAccountScopedKey(key) {
    return CLOUD_ACCOUNT_SCOPED_KEYS.has(key);
}

export function hasCloudDocumentPolicy(key) {
    return isCloudSedeScopedKey(key) || isCloudAccountScopedKey(key);
}

export function buildCloudDocumentId(key, { accountId, sedeId } = {}) {
    assertEntity(key);
    assertAccount(accountId);
    if (isCloudSedeScopedKey(key)) {
        if (!VALID_SEDES.has(sedeId)) throw new Error('Sede cloud inválida para documento sede-scoped.');
        return `${CLOUD_DOCUMENT_VERSION}:${key}:account:${accountId}:sede:${sedeId}`;
    }
    if (!isCloudAccountScopedKey(key)) throw new Error(`Entidad cloud sin política de alcance: ${key}`);
    return `${CLOUD_DOCUMENT_VERSION}:${key}:account:${accountId}`;
}

export function parseCloudDocumentId(docId) {
    if (typeof docId !== 'string') return null;
    const match = docId.match(/^v2:([a-zA-Z0-9_-]{1,120}):account:([^:\s]{1,255})(?::sede:(central|norte|sur))?$/);
    if (!match) return null;
    const [, key, accountId, sedeId] = match;
    const sedeScoped = isCloudSedeScopedKey(key);
    const accountScoped = isCloudAccountScopedKey(key);
    if ((!sedeScoped && !accountScoped) || (sedeScoped && !sedeId) || (accountScoped && sedeId)) return null;
    return { version: CLOUD_DOCUMENT_VERSION, key, accountId, sedeId: sedeId || null, sedeScoped };
}

export function isCloudDocumentForContext(docId, key, { accountId, sedeId } = {}) {
    const parsed = parseCloudDocumentId(docId);
    if (!parsed || parsed.key !== key || parsed.accountId !== accountId) return false;
    return !parsed.sedeScoped || parsed.sedeId === sedeId;
}

export function isLegacyCloudDocumentId(docId) {
    return typeof docId === 'string' && !parseCloudDocumentId(docId);
}
