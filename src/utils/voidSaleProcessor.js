import { storageService } from './storageService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { round2 } from './dinero';
import { getLocalISODate, getLocalISOTime } from './dateHelpers';
import { getOpenCashSession } from './closureLogic';
import { captureStorageContext, assertStorageContextActive } from '../config/storageScope.js';
import { beginLocalOperation } from '../services/localOperationGuard.js';
import { drainSnapshotWrites } from '../services/localSnapshotQueue.js';
import { ledgerRecords, assertLedgerArrays, assertQueueOwnership, movementStamp, ledgerAudit, pendingOperation } from './localLedger.js';
import { productIdentity, quantityRound, isPackageProduct } from './inventoryQuantities.js';
import { customerCredit } from './salePlan.js';

export async function processVoidSale(request, _currentSales, _currentProducts, options = {}) {
    const context = options.storageContext || captureStorageContext();
    const actor = useAuthStore.getState().usuarioActivo;
    const sessionId = useAuthStore.getState().operatorSession?.sessionId;
    if (actor?.rol !== 'DUENO') throw new Error('No tienes permiso para anular ventas.');
    if (!request?.id || (request.sedeId || request.huella?.sedeId) !== context.sedeId) throw new Error('Solo puedes anular una venta identificada de la sede activa.');
    const verify = () => {
        assertStorageContextActive(context);
        const current = useAuthStore.getState();
        if (current.usuarioActivo?.id !== actor.id || current.usuarioActivo?.rol !== actor.rol || current.operatorSession?.sessionId !== sessionId) throw new Error('El operador cambió durante la anulación.');
    };
    verify();
    if (options.skipRevertMoney) throw new Error('Una anulación sin reverso financiero requiere conciliación; no se aplicará automáticamente.');
    const release = beginLocalOperation('VOID_SALE', context);
    try {
        await drainSnapshotWrites(context);
        const timestamp = new Date().toISOString();
        return await storageService.transaction(ledgerRecords(['sales', 'products', 'customers', 'lots', 'controlled', 'audit', 'queue'], context), state => {
            verify(); assertLedgerArrays(state);
            const sale = state.sales.find(item => item.id === request.id);
            if (!sale || (sale.sedeId || sale.huella?.sedeId) !== context.sedeId || sale.accountId != null && sale.accountId !== context.accountId) throw new Error('No se encontró la venta en la sede activa.');
            if (!['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(sale.tipo)) throw new Error('Este movimiento no admite anulación de venta.');
            const id = `void_${sale.id}`;
            const queued = assertQueueOwnership(state.queue, id, 'VOID', context);
            const prior = state.sales.find(item => item.originSaleId === sale.id && item.tipo === 'ANULACION_VENTA');
            if (!prior && queued) throw new Error('Existe un reverso pendiente sin historial. Requiere conciliación.');
            if (prior) return { writes: {}, result: { updatedSales: state.sales, updatedProducts: state.products, updatedCustomers: state.customers, duplicate: true, reversal: prior } };
            if (sale.relatedVoidId || sale.status === 'ANULADA' || sale.estado === 'ANULADA' || sale.anuladaEn) throw new Error('La venta ya fue anulada; revisa su reverso antes de actuar.');
            const products = structuredClone(state.products), lots = structuredClone(state.lots), customers = structuredClone(state.customers);
            if (!options.skipRestock) {
                const quantities = new Map();
                for (const item of sale.items || []) {
                    if (item.kind === 'custom') continue;
                    const product = products.find(p => String(p.id) === productIdentity(item));
                    if (!product) throw new Error('El producto de la venta ya no existe; requiere conciliación.');
                    let quantity = item.quantityBase;
                    if (quantity == null) {
                        if (sale.schemaVersion >= 3) throw new Error('Venta sin cantidad base verificable; requiere conciliación.');
                        if (isPackageProduct(product) || item._mode === 'unit' || String(item.id).endsWith('_unit')) throw new Error('Venta legada sin unidades base verificables; requiere conciliación.');
                        quantity = item.qty;
                    }
                    if (!Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(Number(product.stock))) throw new Error('Cantidad de reverso inválida.');
                    const key = String(product.id);
                    quantities.set(key, quantityRound((quantities.get(key) || 0) + quantity));
                    product.stock = quantityRound(Number(product.stock) + quantity);
                    product.updatedAt = timestamp;
                }
                const allocations = new Map();
                const seenLots = new Set();
                if (sale.schemaVersion >= 3 && !Array.isArray(sale.lotesConsumidos)) throw new Error('Falta la trazabilidad de lotes de la venta; requiere conciliación.');
                for (const consumed of sale.lotesConsumidos || []) {
                    const lot = lots.find(l => l.id === consumed.loteId);
                    const key = String(consumed.productoId ?? lot?.productoId);
                    if (!lot || !quantities.has(key) || String(lot.productoId) !== key || seenLots.has(lot.id)
                        || !Number.isFinite(lot.cantidad) || lot.cantidad < 0 || !Number.isFinite(consumed.cantidad) || consumed.cantidad <= 0
                        || (consumed.vencimiento != null && consumed.vencimiento !== lot.vencimiento)) throw new Error('No se puede restaurar el lote exacto; requiere conciliación.');
                    seenLots.add(lot.id);
                    allocations.set(key, quantityRound((allocations.get(key) || 0) + consumed.cantidad));
                    lot.cantidad = quantityRound(lot.cantidad + consumed.cantidad);
                }
                for (const [key, quantity] of quantities) {
                    const product = products.find(item => String(item.id) === key);
                    const tracked = product?.tracksLots || product?.lotTracked || lots.some(lot => String(lot.productoId) === key);
                    if ((tracked || allocations.has(key)) && allocations.get(key) !== quantity) throw new Error('Los lotes consumidos no coinciden con las unidades de la venta; requiere conciliación.');
                }
            }
            if (sale.customerId) {
                const customer = customers.find(item => item.id === sale.customerId);
                const favorUsed = (sale.payments || []).filter(p => p.methodId === 'saldo_favor').reduce((sum, p) => sum + (p.amountUsd || 0), 0);
                if (!sale.customerDelta && (sale.fiadoUsd > 0 || sale.casheaUsd > 0 || favorUsed > 0)) throw new Error('Venta legada sin delta financiero verificable; requiere conciliación.');
                const delta = sale.customerDelta;
                if (delta) {
                    if (!customer || !Number.isFinite(delta.netDelta) || !Number.isFinite(delta.casheaDelta)) throw new Error('Cliente o delta financiero inválido.');
                    const debt = Number(customer.deuda || 0), cashea = Number(customer.casheaDeuda || 0);
                    if (!Number.isFinite(debt) || debt < 0 || !Number.isFinite(cashea) || cashea < delta.casheaDelta) throw new Error('Cashea o deuda ya conciliada; revisa abonos antes de anular.');
                    const net = round2(customerCredit(customer) - debt - delta.netDelta);
                    customer.favor = Math.max(0, net); customer.deuda = Math.max(0, -net);
                    customer.casheaDeuda = round2(cashea - delta.casheaDelta);
                    delete customer.saldo_favor; delete customer.saldoFavor;
                }
            }
            const now = new Date(timestamp);
            const huella = movementStamp('ANULACION_VENTA', id, context, actor, timestamp, { ventaId: sale.id, skipRestock: Boolean(options.skipRestock) });
            const reversal = { ...sale, id, operationId: id, syncQueueId: id, schemaVersion: 3, tipo: 'ANULACION_VENTA', status: 'PENDIENTE_SYNC', syncMode: 'offline',
                originSaleId: sale.id, originSaleType: sale.tipo, relatedVoidId: null, voidedAt: null, operationIntent: null,
                timestamp, fechaComercial: getOpenCashSession(state.sales)?.businessDate || getLocalISODate(now), horaComercial: getLocalISOTime(now), cajaCerrada: false, cierreId: null,
                huella, skipRestock: Boolean(options.skipRestock), skipRevertMoney: false,
                items: (sale.items || []).map(item => ({ ...item, qty: -Math.abs(item.qty), ...(item.quantityBase != null ? { quantityBase: -item.quantityBase } : {}) })),
                payments: (sale.payments || []).map(payment => Object.fromEntries(Object.entries(payment).map(([key, value]) => [key, ['amount', 'amountInput', 'amountUsd', 'amountBs', 'amountCop'].includes(key) && typeof value === 'number' ? -value : value]))),
            };
            for (const key of ['totalUsd', 'totalBs', 'totalCop', 'cartSubtotalUsd', 'discountAmountUsd', 'fiadoUsd', 'casheaUsd', 'changeUsd', 'changeBs']) reversal[key] = -(sale[key] || 0);
            reversal.customerDelta = sale.customerDelta ? { netDelta: -sale.customerDelta.netDelta, casheaDelta: -sale.customerDelta.casheaDelta } : null;
            const sales = [reversal, ...state.sales.map(item => item.id === sale.id ? { ...item, relatedVoidId: id, voidedAt: timestamp, voidedBy: actor.id } : item)];
            const queue = [...state.queue.map(entry => entry.queue_id === sale.syncQueueId ? { ...entry, relatedVoidId: id } : entry), pendingOperation(id, 'VOID', reversal, context, actor, timestamp)];
            const controlled = state.controlled.some(item => item.ventaId === sale.id) ? [{ id, ventaId: sale.id, tipo: 'ANULACION', ...huella }, ...state.controlled] : state.controlled;
            return { writes: { sales, products, lots, customers, queue, controlled, audit: [ledgerAudit(id, 'VENTA_ANULADA', context, actor, timestamp, { saleId: sale.id }), ...state.audit] },
                result: { updatedSales: sales, updatedProducts: products, updatedCustomers: customers, reversal } };
        }, context);
    } finally { release(); }
}
