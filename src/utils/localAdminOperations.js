import { bindStorageContext } from './scopedStorage.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { beginLocalOperation } from '../services/localOperationGuard.js';
import { drainSnapshotWrites } from '../services/localSnapshotQueue.js';
import { ledgerRecords, assertLedgerArrays, assertQueueOwnership, movementStamp, ledgerAudit, pendingOperation } from './localLedger.js';
import { round2 } from './dinero.js';
import { normalizeTender } from './tenderMath.js';
import { assertUsableStock, isBulkProduct, quantityRound } from './inventoryQuantities.js';
import { customerCredit } from './salePlan.js';
import { getOpenCashSession } from './closureLogic.js';

const commands = {
    ADJUST_STOCK: ['products', 'lots', 'sales'], ADD_LOT: ['products', 'lots'], SET_LOT: ['products', 'lots', 'sales'],
    SUPPLIER_INVOICE: ['suppliers', 'invoices'], SUPPLIER_PAYMENT: ['suppliers', 'sales'], CUSTOMER_ADJUSTMENT: ['customers', 'sales'],
};
const finiteMoney = value => Number.isFinite(value) && value >= 0 && value === round2(value);
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value + 'T12:00:00Z')) && new Date(value + 'T12:00:00Z').toISOString().slice(0, 10) === value;

// Explicit administrative actions only; no whole-history read/modify/write remains in the view.
export async function processLocalAdminOperation(command, input) {
    if (!commands[command]) throw new Error('Operación administrativa inválida.');
    const data = structuredClone(input);
    const operator = useAuthStore.getState().usuarioActivo;
    if (operator?.rol !== 'DUENO') throw new Error('No tienes permiso para esta operación.');
    const repo = bindStorageContext(data.storageContext);
    const context = repo.context;
    repo.assertActive();
    const id = data.operationId || crypto.randomUUID();
    const intent = JSON.stringify([command, { ...data, operationId: undefined, storageContext: undefined }, context.sedeId, operator.id]);
    const timestamp = new Date().toISOString();
    const release = beginLocalOperation(command, context);
    try {
        await drainSnapshotWrites(context);
        return await repo.transaction(ledgerRecords([...commands[command], 'queue', 'audit'], context), state => {
            repo.assertActive(); assertLedgerArrays(state);
            const prior = assertQueueOwnership(state.queue, id, command, context);
            if (prior) {
                if (prior.payload.intent !== intent) throw new Error('El identificador pertenece a otra operación administrativa.');
                return { writes: {}, result: { ...state, duplicate: true, record: prior.payload.record } };
            }
            const writes = {};
            const stamp = movementStamp(command, id, context, operator, timestamp);
            let record = { id, operationId: id, schemaVersion: 3, accountId: context.accountId, sedeId: context.sedeId, timestamp,
                fechaComercial: stamp.fecha, horaComercial: stamp.hora, status: 'PENDIENTE_SYNC', huella: stamp };
            if (['ADJUST_STOCK', 'ADD_LOT', 'SET_LOT'].includes(command)) {
                const product = state.products.find(item => item.id === data.productId);
                if (!product) throw new Error('El producto ya no existe.');
                const stock = assertUsableStock(product);
                if (data.expectedStock != null && stock !== data.expectedStock) throw new Error('El stock cambió. Revisa la cantidad actual antes de ajustar.');
                const productLots = state.lots.filter(item => item.productoId === product.id);
                if (productLots.some(lot => !Number.isFinite(lot.cantidad) || lot.cantidad < 0)) throw new Error('Lotes inválidos; requiere conciliación.');
                let delta = 0;
                if (command === 'ADJUST_STOCK') {
                    delta = data.delta;
                    if (!Number.isFinite(delta) || delta === 0 || quantityRound(delta) !== delta || !isBulkProduct(product) && !Number.isSafeInteger(delta)) throw new Error('Ajuste de stock inválido.');
                    if (productLots.length || product.tracksLots || product.lotTracked) throw new Error('Ajusta la cantidad del lote específico para conservar la trazabilidad.');
                } else {
                    const amount = data.quantity;
                    if (!Number.isFinite(amount) || amount < 0 || amount !== quantityRound(amount) || !isBulkProduct(product) && !Number.isSafeInteger(amount)) throw new Error('Cantidad del lote inválida.');
                    if (command === 'ADD_LOT') {
                        if (amount <= 0 || typeof data.number !== 'string' || !data.number.trim() || !validDate(data.expiry)) throw new Error('Indica número, vencimiento válido y cantidad del lote.');
                        if (productLots.reduce((sum, lot) => sum + lot.cantidad, 0) + amount > stock) throw new Error('El lote excede las unidades sin lote del inventario.');
                        const lot = { id, productoId: product.id, cantidad: amount, numeroLote: data.number.trim(), vencimiento: data.expiry, huella: stamp };
                        writes.lots = [lot, ...state.lots]; record = { ...record, ...lot };
                    } else {
                        const lot = productLots.find(item => item.id === data.lotId);
                        if (!lot || lot.cantidad !== data.expectedQuantity) throw new Error('El lote cambió. Recarga antes de ajustar.');
                        delta = quantityRound(amount - lot.cantidad);
                        writes.lots = state.lots.map(item => item.id === lot.id ? { ...item, cantidad: amount, huella: stamp } : item);
                    }
                }
                if (stock + delta < 0) throw new Error('El ajuste dejaría stock negativo.');
                if (delta !== 0) {
                    writes.products = state.products.map(item => item.id === product.id ? { ...item, stock: quantityRound(stock + delta), updatedAt: timestamp } : item);
                    record = { ...record, tipo: delta > 0 ? 'AJUSTE_ENTRADA' : 'AJUSTE_SALIDA', delta,
                        items: [{ id: product.id, name: product.name, qty: Math.abs(delta) }], totalUsd: 0, totalBs: 0 };
                    writes.sales = [record, ...state.sales];
                }
            } else if (command === 'SUPPLIER_INVOICE') {
                const invoice = data.invoice;
                const supplier = state.suppliers.find(item => item.id === invoice?.supplierId);
                if (!supplier || !invoice?.id || !finiteMoney(invoice.amountUsd) || invoice.amountUsd <= 0 || !finiteMoney(Number(supplier.deuda || 0))) throw new Error('Factura, proveedor o saldo inválido.');
                if (state.invoices.some(item => item.id === invoice.id)) throw new Error('La factura ya está registrada.');
                record = { ...invoice, ...record, id: invoice.id, tipo: 'FACTURA_PROVEEDOR' };
                writes.invoices = [...state.invoices, record];
                writes.suppliers = state.suppliers.map(item => item.id === supplier.id ? { ...item, deuda: round2((item.deuda || 0) + invoice.amountUsd) } : item);
            } else if (command === 'SUPPLIER_PAYMENT') {
                const supplier = state.suppliers.find(item => item.id === data.supplierId);
                const payment = normalizeTender(data.payment, data.rate);
                const debt = Number(supplier?.deuda || 0);
                if (!supplier || !finiteMoney(debt) || payment.amountUsd <= 0 || payment.amountUsd > debt || ['fiado', 'cashea', 'saldo_favor'].includes(payment.methodId)) throw new Error('El pago debe ser recibido por un medio válido y no exceder la deuda del proveedor.');
                writes.suppliers = state.suppliers.map(item => item.id === supplier.id ? { ...item, deuda: round2(debt - payment.amountUsd) } : item);
                const open = getOpenCashSession(state.sales);
                const outgoing = { ...payment, amount: -payment.amount, amountInput: -payment.amountInput, amountUsd: -payment.amountUsd, amountBs: -payment.amountBs };
                record = { ...record, tipo: 'PAGO_PROVEEDOR', supplierId: supplier.id, supplierName: supplier.name, fechaComercial: open?.businessDate || stamp.fecha,
                    cashSessionId: open?.apertura.id || null, totalUsd: -payment.amountUsd, totalBs: -payment.amountBs, rate: data.rate, payments: [outgoing], items: [] };
                writes.sales = [record, ...state.sales];
            } else {
                const current = state.customers.find(item => item.id === data.customerId);
                if (!current) throw new Error('El cliente ya no existe.');
                const debt = Number(current.deuda || 0), credit = customerCredit(current), cashea = Number(current.casheaDeuda || 0);
                if (![debt, credit, cashea].every(finiteMoney) || JSON.stringify([debt, credit, cashea]) !== JSON.stringify(data.expectedBalances)) throw new Error('Los saldos cambiaron. Recarga antes de conciliar.');
                const updated = { ...current, favor: credit, deuda: debt, casheaDeuda: cashea, updatedAt: timestamp };
                if (data.action === 'FORGIVE') { updated.deuda = 0; updated.favor = 0; }
                else if (data.action === 'TO_CASHEA' && debt > 0) { updated.deuda = 0; updated.casheaDeuda = round2(cashea + debt); }
                else if (data.action === 'SETTLE_CASHEA' && cashea > 0) updated.casheaDeuda = 0;
                else throw new Error('Ajuste de saldo inválido.');
                delete updated.saldo_favor; delete updated.saldoFavor;
                writes.customers = state.customers.map(item => item.id === current.id ? updated : item);
                record = { ...record, tipo: 'AJUSTE_CREDITO', customerId: current.id, customerName: current.name, totalUsd: 0, totalBs: 0, items: [], payments: [],
                    action: data.action, before: { deuda: debt, favor: credit, casheaDeuda: cashea }, after: { deuda: updated.deuda, favor: updated.favor, casheaDeuda: updated.casheaDeuda } };
                writes.sales = [record, ...state.sales];
            }
            writes.audit = [ledgerAudit(id, command, context, operator, timestamp, { recordId: record.id }), ...state.audit];
            writes.queue = [...state.queue, pendingOperation(id, command, { intent, record }, context, operator, timestamp)];
            return { writes, result: { ...state, ...writes, record, duplicate: false } };
        });
    } finally { release(); }
}
