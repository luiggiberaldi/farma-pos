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
    // NOTA: 'abasto-auth-storage' salió del sync ingenuo (subía PINs en texto
    // plano y pisaba por last-writer-wins). Los usuarios viajan en el
    // documento propio 'bodega_users_v1' (merge por syncId). Ver PULL_IGNORE_KEYS.
    'bodega_users_v1',            // Usuarios (merge por syncId, sin PINs en texto plano)
    'bodega_rate_policy_v1',      // Política de tasa a nivel de cuenta (fast-lane 5 min)
    'bodega_business_v1',         // Identidad del negocio a nivel de cuenta
    // NOTA: 'bodega_custom_rate', 'bodega_use_auto_rate', 'cashea_enabled',
    // 'business_address', 'business_phone' y 'business_instagram' SALIERON del
    // sync ingenuo: viajan dentro de los documentos propios de arriba (con
    // LWW / merge por campo). Dejarlas aquí causaba doble vía: el camino
    // ingenuo aplicaba last-writer-wins ciego y pisaba la política ganadora.
    'monitor_rates_v12',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled',
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
    'bodega_users_v1',
    'bodega_rate_policy_v1',
    'bodega_business_v1',
    'monitor_rates_v12',
    // NOTA: las 6 llaves cubiertas por los docs propios (bodega_custom_rate,
    // bodega_use_auto_rate, cashea_enabled, business_address, business_phone,
    // business_instagram) no van aquí: el interceptor no debe disparar pushes
    // para ellas; solo viajan dentro de bodega_rate_policy_v1 /
    // bodega_business_v1.
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled',
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
    // ADR-003: el inventario también se mezcla por ID (antes la nube lo
    // reemplazaba). El merge por ID con LWW por updatedAt preserva el stock
    // vivo de cada equipo; la semilla canónica 1539 no trae updatedAt para
    // no pisar ventas reales.
    'bodega_products_v1',
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
// Los archivos de retención local nunca salen del dispositivo.
// (Defensa en profundidad: tampoco están en SYNC_KEYS.)
export const PULL_IGNORE_KEYS = [
    'abasto_audit_log_v1',
    'bodega_sales_archive_v1',
    'abasto_audit_archive_v1',
    // El sobre completo de auth lo subían versiones viejas con PINs en texto
    // plano y last-writer-wins sobre la lista completa. Los usuarios ahora
    // viajan en 'bodega_users_v1' (merge por syncId); este sobre se ignora.
    'abasto-auth-storage',
];
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
