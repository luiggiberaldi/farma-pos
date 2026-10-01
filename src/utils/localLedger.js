import { getStorageKeyForContext } from '../config/storageScope.js';
import { getLocalISODate, getLocalISOTime } from './dateHelpers.js';

const KEYS = Object.freeze({ products: 'bodega_products_v1', sales: 'bodega_sales_v1', customers: 'bodega_customers_v1', lots: 'farmacia_lotes_v1',
    transfers: 'farmacia_transferencias_v1', controlled: 'farmacia_controlados_v1', audit: 'abasto_audit_log_v1', queue: 'offline_sales_queue', closures: 'bodega_cierres_v1',
    suppliers: 'bodega_suppliers_v1', invoices: 'bodega_supplier_invoices_v1',
    salesArchive: 'bodega_sales_archive_v1', auditArchive: 'abasto_audit_archive_v1' });
export function ledgerRecords(names, context) {
    return names.map(name => {
        if (!KEYS[name]) throw new Error('Colección de operación desconocida.');
        return { name, key: KEYS[name], fallback: [], ...(name === 'queue' ? { context: { ...context, accountId: context.accountId || 'local' } } : {}) };
    });
}
export function assertLedgerArrays(state) {
    if (Object.values(state).some(value => !Array.isArray(value))) throw new Error('Hay datos locales inválidos. No se sobrescribirá el historial.');
}
export function assertQueueOwnership(queue, id, kind, context) {
    if (typeof id !== 'string' || id.length < 8 || id.length > 180 || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error('Identificador de operación inválido.');
    const matches = queue.filter(entry => entry.queue_id === id || entry.operation_id === id || entry.id === id);
    if (matches.length > 1 || matches.some(entry => entry.kind !== kind || entry.sede_id !== context.sedeId || entry.account_id !== (context.accountId || 'local'))) {
        throw new Error('Conflicto de idempotencia: el identificador pertenece a otra operación o sede.');
    }
    return matches[0] || null;
}
export function movementStamp(type, id, context, operator, timestamp, detail = null) {
    const now = new Date(timestamp);
    return { correlativo: `${type}-${id}`, tipo: type, ref: id, sedeId: context.sedeId, usuarioId: operator.id, usuarioNombre: operator.nombre,
        rol: operator.rol, fecha: getLocalISODate(now), hora: getLocalISOTime(now), ts: now.getTime(), ...(detail ? { detalle: detail } : {}) };
}
export function ledgerAudit(id, action, context, operator, timestamp, meta) {
    return { id, ts: new Date(timestamp).getTime(), cat: 'OPERACION', action, desc: action, userId: operator.id, userName: operator.nombre,
        userRole: operator.rol, sedeId: context.sedeId, meta };
}
export function pendingOperation(id, kind, payload, context, operator, timestamp) {
    return { id, queue_id: id, operation_id: id, schema_version: 3, kind, account_id: context.accountId || 'local', sede_id: context.sedeId,
        operator_id: operator.id, local_sales_key: getStorageKeyForContext('bodega_sales_v1', context), payload,
        sync_status: 'pending', attempts: 0, created_at: timestamp, next_attempt_at: null, last_error: null };
}
