import { bindStorageContext } from './scopedStorage.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { beginLocalOperation } from '../services/localOperationGuard.js';
import { round2 } from './dinero.js';
import { getOpenCashSession } from './closureLogic.js';
import { normalizeTender } from './tenderMath.js';
import { customerCredit } from './salePlan.js';
import { ledgerRecords, assertLedgerArrays, assertQueueOwnership, movementStamp, ledgerAudit, pendingOperation } from './localLedger.js';

export async function processCustomerTransaction(input) {
    const options = structuredClone(input);
    const operator = useAuthStore.getState().usuarioActivo;
    if (!['DUENO', 'ADMIN'].includes(operator?.rol)) throw new Error('No tienes permiso para registrar movimientos de cartera.');
    const repo = bindStorageContext(options.storageContext);
    const context = repo.context;
    const { type, customer, currencyMode = 'USD', bcvRate, paymentMethod } = options;
    if (!customer?.id || !['ABONO', 'CREDITO'].includes(type)) throw new Error('Cliente o tipo de movimiento inválido.');
    const raw = Number(options.transactionAmount);
    if (!Number.isFinite(raw) || raw <= 0 || raw !== round2(raw)) throw new Error('El importe debe ser positivo con hasta dos decimales.');
    const payment = normalizeTender({ methodId: paymentMethod || 'efectivo_usd', currency: currencyMode, amountInput: raw }, bcvRate);
    if (payment.amountUsd <= 0) throw new Error('El importe es menor a la precisión admitida para cartera.');
    if (type === 'ABONO' && ['saldo_favor', 'cashea', 'fiado'].includes(payment.methodId)) throw new Error('El abono requiere un medio de pago recibido, no otra deuda.');
    const operationId = options.operationId || crypto.randomUUID();
    const intent = JSON.stringify([type, customer.id, payment.methodId, payment.currency, payment.amount, bcvRate]);
    const timestamp = new Date().toISOString();
    const release = beginLocalOperation('CUSTOMER_TRANSACTION', context);
    try {
        return await repo.transaction(ledgerRecords(['customers', 'sales', 'queue', 'audit'], context), state => {
            repo.assertActive(); assertLedgerArrays(state);
            const current = state.customers.find(item => item.id === customer.id);
            if (!current) throw new Error('El cliente ya no existe.');
            const queued = assertQueueOwnership(state.queue, operationId, 'CUSTOMER_MOVEMENT', context);
            const prior = state.sales.find(item => item.operationId === operationId);
            if (!prior && queued) throw new Error('El movimiento ya tiene un comprobante pendiente. Reconcilia el historial antes de reintentar.');
            if (prior) {
                if (prior.operationIntent !== intent) throw new Error('El identificador pertenece a otro movimiento.');
                return { writes: {}, result: { updatedCustomer: current, newCustomers: state.customers, movement: prior, duplicate: true } };
            }
            const debt = Number(current.deuda || 0), favor = customerCredit(current);
            if (!Number.isFinite(debt) || debt < 0) throw new Error('Saldo inválido; concilia el cliente antes de operar.');
            const netDelta = (type === 'ABONO' ? 1 : -1) * payment.amountUsd;
            const net = round2(favor - debt + netDelta);
            const updatedCustomer = { ...current, favor: Math.max(0, net), deuda: Math.max(0, -net), updatedAt: timestamp };
            delete updatedCustomer.saldo_favor; delete updatedCustomer.saldoFavor;
            const newCustomers = state.customers.map(item => item.id === current.id ? updatedCustomer : item);
            const huella = movementStamp(type, operationId, context, operator, timestamp, { clienteId: current.id });
            const open = getOpenCashSession(state.sales);
            const movement = { id: operationId, operationId, operationIntent: intent, schemaVersion: 3, accountId: context.accountId, sedeId: context.sedeId,
                tipo: type === 'ABONO' ? 'COBRO_DEUDA' : 'AJUSTE_CREDITO', status: 'PENDIENTE_SYNC', timestamp,
                fechaComercial: open?.businessDate || huella.fecha, horaComercial: huella.hora, cashSessionId: open?.apertura?.id || null,
                customerId: current.id, customerName: current.name, clienteId: current.id, clienteName: current.name,
                totalUsd: payment.amountUsd, totalBs: payment.amountBs, rate: bcvRate, fiadoUsd: type === 'CREDITO' ? payment.amountUsd : 0,
                fiadoCollectedUsd: type === 'ABONO' ? Math.min(debt, payment.amountUsd) : 0,
                creditAddedUsd: type === 'ABONO' ? Math.max(0, round2(payment.amountUsd - debt)) : 0,
                payments: type === 'ABONO' ? [payment] : [], items: [], customerDelta: { netDelta, casheaDelta: 0 }, huella };
            return { writes: { customers: newCustomers, sales: [movement, ...state.sales],
                queue: [...state.queue, pendingOperation(operationId, 'CUSTOMER_MOVEMENT', movement, context, operator, timestamp)],
                audit: [ledgerAudit(operationId, type, context, operator, timestamp, { customerId: current.id, amount: payment.amountUsd }), ...state.audit] },
                result: { updatedCustomer, newCustomers, movement } };
        });
    } finally { release(); }
}
