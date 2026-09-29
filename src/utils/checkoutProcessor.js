import { storageService } from './storageService.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { PrinterSerial } from '../services/PrinterSerial.js';
import { captureStorageContext, assertStorageContextActive } from '../config/storageScope.js';
import { beginLocalOperation } from '../services/localOperationGuard.js';
import { drainSnapshotWrites } from '../services/localSnapshotQueue.js';
import { discountAuthorizationDetails } from './discountAuthorization.js';
import { prepareSale } from './salePlan.js';
import { REMOTE_OPERATIONS_PAUSED } from '../config/operationSafety.js';

export async function processSaleTransaction(input) {
    const options = structuredClone({ ...input, products: undefined, customers: undefined });
    const context = Object.freeze({ ...(options.storageContext || captureStorageContext()) });
    assertStorageContextActive(context);
    const state = useAuthStore.getState();
    const operator = state.usuarioActivo;
    const sessionId = state.operatorSession?.sessionId;
    if (!operator || !['DUENO', 'CAJERO'].includes(operator.rol)) return { success: false, error: 'Selecciona tu usuario antes de vender.' };
    if (operator.rol === 'CAJERO' && operator.sedeId !== context.sedeId) return { success: false, error: 'El cajero no pertenece a la sede activa.' };
    const assertActor = () => {
        assertStorageContextActive(context);
        const active = useAuthStore.getState();
        if (active.usuarioActivo?.id !== operator.id || active.usuarioActivo?.rol !== operator.rol || active.operatorSession?.sessionId !== sessionId) {
            throw new Error('El operador cambió durante la venta.');
        }
    };
    const operationId = options.operationId || crypto.randomUUID();
    if (typeof operationId !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(operationId)) return { success: false, error: 'Identificador de operación inválido.' };
    if (!REMOTE_OPERATIONS_PAUSED) return { success: false, code: 'REMOTE_RELEASE_REQUIRES_REVIEW', error: 'La liberación remota requiere el nuevo contrato de sincronización; no actives el motor legado.' };
    // No read-modify-write or remote request occurs before this local commit.
    // A validated operation is committed with its immutable origin and outbox.
    // The remote sender remains separately paused until server release checks.
    const release = beginLocalOperation('CHECKOUT', context);
    try {
        await drainSnapshotWrites(context);
        assertActor();
        const timestamp = new Date().toISOString();
        let approval;
        let details;
        const records = [
            { name: 'products', key: 'bodega_products_v1', fallback: [] },
            { name: 'customers', key: 'bodega_customers_v1', fallback: [] },
            { name: 'sales', key: 'bodega_sales_v1', fallback: [] },
            { name: 'lots', key: 'farmacia_lotes_v1', fallback: [] },
            { name: 'queue', key: 'offline_sales_queue', context: { ...context, accountId: context.accountId || 'local' }, fallback: [] },
            { name: 'controlled', key: 'farmacia_controlados_v1', fallback: [] },
            { name: 'audit', key: 'abasto_audit_log_v1', fallback: [] },
        ];
        const result = await storageService.transaction(records, snapshot => {
            assertActor();
            try {
                const existing = Array.isArray(snapshot.sales) && snapshot.sales.some(sale => sale.operationId === operationId || sale.id === operationId);
                if (!existing && options.discountData?.value > 0 && operator.rol === 'CAJERO') {
                    details = discountAuthorizationDetails({ ...options.discountData, cartSubtotalUsd: options.cartSubtotalUsd, cart: options.cart });
                    approval = useAuthStore.getState().checkApproval(options.discountData.approvalId, 'DISCOUNT', details);
                    if (!approval) throw new Error('Solicita el PIN administrativo para autorizar este descuento y esta cesta.');
                }
                return prepareSale(options, snapshot, { operationId, operator, context, timestamp,
                    discountAuthorization: approval ? { approver: approval.approver, authorizedAt: approval.createdAt, action: approval.action } : null });
            } catch (error) {
                // Business rejection is a no-write transaction; infrastructure
                // errors still reject the outer promise, never a false receipt.
                return { writes: {}, result: { success: false, error: error.message } };
            }
        }, context);
        if (result.success && !result.duplicate && approval) {
            try { useAuthStore.getState().consumeApproval(approval.id, 'DISCOUNT', details); } catch { /* A committed sale remains committed. */ }
        }
        if (result.success && !result.duplicate) {
            try {
                if (localStorage.getItem('printer_serial_auto_drawer') === 'true' && PrinterSerial.isConnected()) {
                    Promise.resolve(PrinterSerial.openDrawer()).then(drawer => {
                        if (drawer?.ok === false) console.warn('[Checkout] Venta guardada; no se abrió el cajón:', drawer.error);
                    }).catch(error => console.warn('[Checkout] Venta guardada; no se pudo abrir el cajón:', error));
                }
            } catch { result.warnings = ['La venta se guardó; no se pudo consultar la configuración del cajón.']; }
        }
        return result;
    } finally { release(); }
}
