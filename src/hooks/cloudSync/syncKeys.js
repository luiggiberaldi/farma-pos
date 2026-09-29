import { SUPABASE_FREE_PROFILE } from '../../config/supabaseFreeTier.js';

export const SYNC_KEYS = [
    // ── IndexedDB (store) ──────────────────────────────────────────────────
    'bodega_products_v1',
    'bodega_customers_v1',
    'bodega_sales_v1',
    'bodega_cierres_v1',
    'bodega_payment_methods_v1',
    'bodega_accounts_v2',
    'farmacia_lotes_v1',
    'farmacia_controlados_v1',
    'farmacia_correlativos_v1',
    'farmacia_caja_v1',
    'farmacia_transferencias_v1',
    // 'abasto_audit_log_v1' eliminado: el audit va incremental a la tabla
    // audit_log (auditService.syncAuditToCloud). Subir el array completo
    // (~2-4 MB) en cada logEvent agotaba el Disk IO Budget de Supabase.
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
export const LOCAL_KEYS = [
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
// Free keeps Realtime disabled. Future polling uses the central 60-minute profile.
export const REALTIME_KEYS = [
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
export const POLLING_ONLY_KEYS = SUPABASE_FREE_PROFILE.realtimeEnabled
    ? SYNC_KEYS.filter(k => !REALTIME_KEYS.includes(k)) : SYNC_KEYS;

// ─── Llaves que contienen arrays con campo `id` y requieren merge inteligente ──
// Cuando llegan datos de la nube, en vez de sobreescribir el array completo,
// se hace merge por ID: se combinan items locales + nube, y si ambos tienen
// el mismo ID, gana el que tenga updatedAt/createdAt más reciente.
export const MERGEABLE_KEYS = [
    // El inventario no se mezcla: la cuenta/nube activa es la fuente de verdad.
    'bodega_customers_v1',
    'bodega_sales_v1',
    'bodega_cierres_v1',
    'bodega_payment_methods_v1',
    'bodega_accounts_v2',
    'my_categories_v1',
    'bodega_suppliers_v1',
    'bodega_supplier_invoices_v1',
    'farmacia_transferencias_v1',
    'farmacia_controlados_v1',
];

// Llaves legadas que dispositivos con versiones viejas aún pueden subir a
// sync_documents; se ignoran al recibir para no pisar el estado local.
export const PULL_IGNORE_KEYS = ['abasto_audit_log_v1'];
// Llaves con payloads grandes: debounce largo para agrupar ráfagas (ej. hora
// pico de ventas) en un solo upsert y reducir el Disk I/O de Supabase.
export const HEAVY_KEYS = [
    'bodega_sales_v1',
    'bodega_products_v1',
    'bodega_accounts_v2',
    'bodega_customers_v1',
    'bodega_supplier_invoices_v1',
];
export const DEBOUNCE_MS = SUPABASE_FREE_PROFILE.lightDebounceMs;
export const DEBOUNCE_MS_HEAVY = SUPABASE_FREE_PROFILE.heavyDebounceMs;
