import { storageService } from '../utils/storageService.js';
import { sanitizeBackup } from '../utils/backupSafety.js';
import { captureStorageContext, assertStorageContextActive, getStorageKeyForContext } from '../config/storageScope.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { assertLocalOperationAllowed } from './localOperationGuard.js';
import { drainSnapshotWrites } from './localSnapshotQueue.js';
import { _mergeArraysById } from '../hooks/cloudSync/syncUtils.js';

const IDB_KEYS = [
    'bodega_products_v1', 'my_categories_v1', 'bodega_sales_v1', 'bodega_customers_v1',
    'bodega_cierres_v1', 'bodega_suppliers_v1', 'bodega_supplier_invoices_v1',
    'bodega_accounts_v2', 'bodega_payment_methods_v1', 'farmacia_lotes_v1',
    'farmacia_stock_v1', 'farmacia_caja_v1', 'farmacia_correlativos_v1',
    'farmacia_transferencias_v1', 'farmacia_controlados_v1', 'farmacia_sede_movimientos_v1',
];
const LOCAL_KEYS = [
    'street_rate_bs', 'catalog_use_auto_usdt', 'catalog_custom_usdt_price', 'catalog_show_cash_price',
    'monitor_rates_v12', 'business_name', 'business_rif', 'business_phone', 'printer_paper_width',
    'printer_mode', 'allow_negative_stock', 'bodega_rate_mode', 'bodega_use_auto_rate', 'bodega_custom_rate', 'bodega_inventory_view',
];

function requireOwner() {
    const user = useAuthStore.getState().usuarioActivo;
    if (user?.rol !== 'DUENO') throw new Error('Solo un dueño autenticado puede exportar o restaurar datos.');
    return user;
}

export async function collectBranchBackup() {
    const actor = requireOwner();
    const sessionId = useAuthStore.getState().operatorSession?.sessionId;
    const context = captureStorageContext();
    assertLocalOperationAllowed();
    await drainSnapshotWrites(context);
    const idb = {};
    for (const key of IDB_KEYS) {
        assertStorageContextActive(context);
        const value = await storageService.getItem(key, null, context);
        if (value !== null) idb[key] = value;
    }
    const ls = {};
    for (const key of LOCAL_KEYS) {
        const value = localStorage.getItem(key);
        if (value !== null) ls[key] = value;
    }
    const queue = await storageService.getItem('offline_sales_queue', [], { ...context, accountId: context.accountId || 'local' });
    const draftKey = getStorageKeyForContext('bodega_pending_cart_v2', context);
    const draft = localStorage.getItem(draftKey);
    assertStorageContextActive(context);
    if (requireOwner().id !== actor.id || useAuthStore.getState().operatorSession?.sessionId !== sessionId) throw new Error('La sesión cambió durante la exportación.');
    return sanitizeBackup({ version: '3.0', appName: 'Farma_POS', timestamp: new Date().toISOString(), context, data: { idb, ls },
        recovery: { accountOutbox: queue, branchDraft: draft, note: 'Instantánea de recuperación; no reenvía ni importa operaciones pendientes.' } });
}

export function validateBranchBackup(value, context = captureStorageContext()) {
    const backup = sanitizeBackup(value);
    if (backup?.version !== '3.0' || !backup.data?.idb || backup.context?.accountId !== context.accountId || backup.context?.sedeId !== context.sedeId) {
        throw new Error('El respaldo debe indicar esta cuenta y sede. Los respaldos legados requieren conciliación de origen antes de restaurar.');
    }
    if (Object.keys(backup.data.idb).some(key => !IDB_KEYS.includes(key))
        || Object.keys(backup.data.ls || {}).some(key => !LOCAL_KEYS.includes(key))) throw new Error('El respaldo contiene claves de datos no autorizadas.');
    for (const [key, data] of Object.entries(backup.data.idb)) {
        if (key === 'farmacia_correlativos_v1') {
            if (!data || Array.isArray(data) || typeof data !== 'object') throw new Error('Correlativos inválidos.');
        } else if (!Array.isArray(data)) throw new Error(`Datos inválidos en ${key}.`);
    }
    if (Object.values(backup.data.ls || {}).some(value => typeof value !== 'string')) throw new Error('Configuración de respaldo inválida.');
    return backup;
}

// Describes what a restore would do, so the operator confirms with numbers
// instead of trusting a filename.
export function previewBranchBackup(value, context = captureStorageContext()) {
    const backup = validateBranchBackup(value, context);
    const counts = {};
    for (const [key, data] of Object.entries(backup.data.idb)) {
        counts[key] = Array.isArray(data) ? data.length : 1;
    }
    return {
        sourceTimestamp: backup.timestamp,
        branch: backup.context.sedeId,
        account: backup.context.accountId || 'local',
        collections: counts,
        configKeys: Object.keys(backup.data.ls || {}).length,
        preservedOutbox: Array.isArray(backup.recovery?.accountOutbox) ? backup.recovery.accountOutbox.length : 0,
        hasDraft: typeof backup.recovery?.branchDraft === 'string' && backup.recovery.branchDraft.length > 0,
    };
}

// Un restore NUNCA borra datos del equipo: cada colección se fusiona con los
// datos vivos (unión por ID + LWW por item con el mismo merge del cloud sync).
// Las ventas, cierres y clientes creados después del respaldo sobreviven; el
// respaldo aporta los registros que falten. Los correlativos avanzan al máximo
// (un restore jamás puede reutilizar números de venta).
export function mergeRestoreCollection(key, backupData, liveData) {
    if (key === 'farmacia_correlativos_v1') {
        const merged = { ...(liveData && typeof liveData === 'object' && !Array.isArray(liveData) ? liveData : {}) };
        for (const [k, v] of Object.entries(backupData || {})) {
            if (typeof v === 'number' && (!Number.isFinite(merged[k]) || v > merged[k])) merged[k] = v;
        }
        return merged;
    }
    const live = Array.isArray(liveData) ? liveData : [];
    return _mergeArraysById(live, Array.isArray(backupData) ? backupData : []);
}

export async function restoreBranchBackup(value) {
    const actor = requireOwner();
    const sessionId = useAuthStore.getState().operatorSession?.sessionId;
    const context = captureStorageContext();
    assertLocalOperationAllowed();
    const backup = validateBranchBackup(value, context);
    await drainSnapshotWrites(context);
    assertStorageContextActive(context);

    // Adopting the backup's own outbox could re-send an operation the server
    // already committed. Require the device to be clean first.
    const queueContext = { ...context, accountId: context.accountId || 'local' };
    const liveQueue = await storageService.getItem('offline_sales_queue', [], queueContext);
    if (Array.isArray(liveQueue) && liveQueue.length) {
        throw new Error(`Hay ${liveQueue.length} operaciones pendientes en este equipo. Confírmalas o resuélvelas antes de restaurar. No se modificó ningún dato.`);
    }

    const restored = Object.entries(backup.data.idb);
    const preservedOutbox = Array.isArray(backup.recovery?.accountOutbox) ? backup.recovery.accountOutbox : [];
    const evidence = {
        restoredAt: new Date().toISOString(),
        restoredBy: { id: actor.id, nombre: actor.nombre, rol: actor.rol },
        sourceTimestamp: backup.timestamp ?? null,
        collections: restored.map(([key]) => key),
        // Kept as evidence only; never adopted as the live queue.
        preservedOutbox,
    };
    const records = [
        ...restored.map(([key]) => ({ name: key, key, fallback: key === 'farmacia_correlativos_v1' ? {} : [] })),
        { name: 'evidence', key: `backup_restore_${crypto.randomUUID()}`, fallback: null },
    ];
    // Cada colección se fusiona con los datos vivos dentro de una sola
    // transacción IndexedDB: un fallo deja los datos anteriores intactos y
    // un restore jamás borra ventas, cierres ni clientes del equipo.
    await storageService.transaction(records, (values) => {
        assertStorageContextActive(context);
        const current = useAuthStore.getState();
        if (current.usuarioActivo?.id !== actor.id || current.operatorSession?.sessionId !== sessionId) {
            throw new Error('La sesión cambió durante la restauración. No se modificó ningún dato.');
        }
        const writes = {};
        for (const [key, backupData] of restored) {
            writes[key] = mergeRestoreCollection(key, backupData, values[key]);
        }
        return { writes: { ...writes, evidence }, result: null };
    }, context);

    // Display configuration lives in localStorage and is not transactional, so
    // it is applied after the commit and rolled back on its own if it fails.
    const applied = [];
    let configWarning = null;
    try {
        for (const [key, raw] of Object.entries(backup.data.ls || {})) { localStorage.setItem(key, raw); applied.push(key); }
        if (evidence && typeof backup.recovery?.branchDraft === 'string') {
            localStorage.setItem(getStorageKeyForContext('bodega_pending_cart_v2', context), backup.recovery.branchDraft);
            applied.push('bodega_pending_cart_v2');
        }
    } catch {
        for (const key of applied) localStorage.removeItem(key);
        configWarning = 'Los datos se restauraron, pero la configuración visual no pudo aplicarse por completo.';
    }
    return {
        collections: evidence.collections.length,
        preservedOutbox: preservedOutbox.length,
        configKeys: applied.length,
        warning: configWarning,
    };
}
