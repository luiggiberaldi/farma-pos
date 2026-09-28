import { round2, sumR } from './dinero.js';
import { FinancialEngine } from '../core/FinancialEngine.js';
import { normalizeTender, tenderBalance, validateChangeInBs } from './tenderMath.js';
import { getStorageKeyForContext } from '../config/storageScope.js';
import { productIdentity, isBulkProduct, isPackageProduct, packageFactor, quantityInBase, quantityRound, assertUsableStock, consumeLots } from './inventoryQuantities.js';
import { getLocalISODate, getLocalISOTime } from './dateHelpers.js';
import { getOpenCashSession } from './closureLogic.js';
import { assertQueueOwnership } from './localLedger.js';

const closeMoney = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.round(left * 100) === Math.round(right * 100);
const samePrice = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 1e-9;
const safeBalance = value => {
    const number = value == null ? 0 : Number(value);
    if (!Number.isFinite(number) || number < 0) throw new Error('Saldo de cliente inválido; requiere conciliación.');
    return round2(number);
};
export function customerCredit(customer) {
    const aliases = [customer.favor, customer.saldo_favor, customer.saldoFavor].filter(value => value != null).map(safeBalance);
    if (aliases.some(value => value !== aliases[0])) throw new Error('El cliente tiene saldos a favor incompatibles. Concilia el registro antes de operar.');
    return aliases[0] || 0;
}

export function prepareSale(options, state, { operationId, operator, context, timestamp, discountAuthorization = null }) {
    const { products, customers, sales, lots, queue, controlled, audit } = state;
    if (![products, customers, sales, lots, queue, controlled, audit].every(Array.isArray)) throw new Error('Datos locales inválidos; no se sobrescribirá el historial.');
    const intent = JSON.stringify({
        account: context.accountId, branch: context.sedeId, operator: operator.id,
        cart: Array.isArray(options.cart) ? options.cart.map(item => [productIdentity(item || {}), item?.qty, item?.priceUsd, item?.exactBs ?? null, item?.mode || item?._mode || null]) : null,
        total: options.cartTotalUsd, totalBs: options.cartTotalBs, rate: options.effectiveRate, customer: options.selectedCustomerId || null,
        discount: [options.discountData?.type || 'percentage', Number(options.discountData?.value || 0)],
        payments: Array.isArray(options.payments) ? options.payments.map(payment => [payment?.methodId, payment?.currency || null, payment?.amountInput ?? payment?.amount ?? null, payment?.amountUsd, payment?.amountBs ?? null, payment?.reference || null]) : null,
        change: [options.changeBreakdown?.changeUsdGiven || 0, options.changeBreakdown?.changeBsGiven || 0],
        prescription: options.prescription ? [options.prescription.reference, options.prescription.prescriber, options.prescription.confirmed] : null,
    });
    const queued = assertQueueOwnership(queue, operationId, 'SALE', context);
    const existing = sales.find(sale => sale.operationId === operationId || sale.id === operationId);
    if (!existing && queued) throw new Error('Existe un comprobante pendiente para ese identificador. Reconcilia el historial antes de reintentar.');
    if (existing) {
        if (existing.operationIntent !== intent) throw new Error('Conflicto de idempotencia: ese identificador pertenece a otra operación.');
        return { writes: {}, result: { success: true, duplicate: true, sale: existing, updatedProducts: products, updatedCustomers: customers, syncMode: existing.syncMode || 'offline' } };
    }
    if (!Array.isArray(options.cart) || options.cart.length === 0) throw new Error('Carrito vacío.');
    const effectiveRate = Number(options.effectiveRate);
    if (!Number.isFinite(effectiveRate) || effectiveRate <= 0) throw new Error('Fija una tasa válida antes de cobrar.');
    const now = new Date(timestamp);
    const today = getLocalISODate(now);
    const openSession = getOpenCashSession(sales);
    if (options.cashSessionId && openSession?.apertura?.id !== options.cashSessionId) throw new Error('La caja cambió o se cerró. Abre el turno vigente antes de vender.');
    if (openSession && options.businessDate && openSession.businessDate !== options.businessDate) throw new Error('La fecha comercial no coincide con la caja abierta.');
    const selectedCustomer = customers.find(customer => customer.id === options.selectedCustomerId);
    if (options.selectedCustomerId && !selectedCustomer) throw new Error('El cliente ya no existe. Vuelve a seleccionarlo.');
    const deductions = {};
    const items = options.cart.map(item => {
        if (!item || !Number.isFinite(item.priceUsd) || item.priceUsd <= 0) throw new Error('Precio inválido en la cesta.');
        const id = productIdentity(item);
        const product = products.find(p => String(p.id) === id);
        const custom = !product && item.kind === 'custom' && id.startsWith('custom_');
        if (!product && !custom) throw new Error(`El producto ${item.name || id} ya no existe en esta sede.`);
        if (custom) {
            if (!['DUENO', 'ADMIN'].includes(operator.rol)) throw new Error('Solo un administrador puede registrar un monto libre.');
            if (!Number.isSafeInteger(item.qty) || item.qty <= 0) throw new Error('Cantidad de monto libre inválida.');
            if (item.exactBs != null && (!Number.isFinite(item.exactBs) || item.exactBs <= 0)) throw new Error('Monto libre en Bs inválido.');
            return { id, productId: id, kind: 'custom', name: item.name || 'Monto libre', qty: item.qty, priceUsd: item.priceUsd,
                exactBs: item.exactBs ?? null, costUsd: 0, costBs: 0, mode: 'unit', factor: 1, quantityBase: 0, isWeight: false };
        }
        const { mode, factor, quantityBase } = quantityInBase(item, product);
        const stock = assertUsableStock(product);
        if (product.vencimiento && (!/^\d{4}-\d{2}-\d{2}$/.test(product.vencimiento) || product.vencimiento <= today)) throw new Error(`${product.name}: producto vencido o vencimiento inválido.`);
        const packagePrice = Number(product.priceUsdt ?? product.priceUsd);
        const price = mode === 'unit' && isPackageProduct(product) ? Number(product.unitPriceUsd) : packagePrice;
        if (!Number.isFinite(price) || price <= 0 || !samePrice(item.priceUsd, price)) throw new Error(`Cambió el precio de ${product.name}. Actualiza la cesta antes de cobrar.`);
        if ((item.requiresPrescription && !product.requiresPrescription) || (item.isControlled && !product.isControlled)) {
            throw new Error('Cambió la información farmacéutica del producto. Actualiza la cesta.');
        }
        if (product.requiresPrescription || product.isControlled) {
            const evidence = options.prescription;
            if (!selectedCustomer?.documentId?.trim()) throw new Error('Se requiere un cliente con documento para productos con receta o controlados.');
            if (!evidence?.reference?.trim() || !evidence?.prescriber?.trim() || evidence.confirmed !== true) throw new Error('Registra referencia, prescriptor y verificación de la receta antes de confirmar.');
        }
        deductions[id] = quantityRound((deductions[id] || 0) + quantityBase);
        if (deductions[id] > stock) throw new Error(`${product.name}: stock insuficiente. Actualiza la cesta.`);
        const divisor = mode === 'unit' && isPackageProduct(product) ? packageFactor(product) : 1;
        const costUsd = product.costUsd == null ? null : Number(product.costUsd) / divisor;
        const costBs = Number(product.costBs || 0) / divisor;
        if (costUsd != null && (!Number.isFinite(costUsd) || costUsd < 0) || !Number.isFinite(costBs) || costBs < 0) throw new Error('Costo de producto inválido.');
        return { id: item.id, productId: id, _originalId: id, _mode: mode, _unitsPerPackage: packageFactor(product),
            mode, factor, quantityBase, stockUnit: 'base', name: item.name || product.name, qty: item.qty, priceUsd: price,
            costUsd, costBs, exactBs: product.exactBs != null ? round2(Number(product.exactBs) / divisor) : null,
            isWeight: isBulkProduct(product), requiresPrescription: Boolean(product.requiresPrescription), isControlled: Boolean(product.isControlled) };
    });
    const discount = options.discountData || { type: 'percentage', value: 0 };
    const discountValue = Number(discount.value || 0);
    if (!Number.isFinite(discountValue) || discountValue < 0 || !['percentage', 'fixed'].includes(discount.type || 'percentage') || (discount.type === 'percentage' && discountValue > 100)) throw new Error('Descuento inválido.');
    const totals = FinancialEngine.buildCartTotals(items, { ...discount, value: discountValue }, effectiveRate, options.copEnabled ? options.tasaCop : 0);
    if (totals.totalUsd <= 0.01 || discountValue > 0 && discount.type === 'fixed' && discountValue > totals.subtotalUsd) throw new Error('El total o descuento de la venta no es válido.');
    if (!closeMoney(options.cartTotalUsd, totals.totalUsd) || !closeMoney(options.cartSubtotalUsd, totals.subtotalUsd)
        || options.cartTotalBs != null && !closeMoney(options.cartTotalBs, totals.totalBs)) throw new Error('Los totales cambiaron. Revisa la cesta antes de cobrar.');
    if (operator.rol === 'CAJERO' && totals.discountAmountUsd > 0 && !discountAuthorization) throw new Error('Solicita autorización administrativa para el descuento.');
    if (!Array.isArray(options.payments)) throw new Error('Pagos inválidos.');
    const payments = options.payments.map(payment => normalizeTender(payment, effectiveRate)).filter(payment => payment.amount > 0);
    const balance = tenderBalance(payments, totals.totalBs, effectiveRate);
    const fiadoUsd = balance.remainingUsd;
    if (balance.remainingBs > 0 && fiadoUsd <= 0.01) throw new Error('Queda un remanente en Bs. Completa el pago exacto.');
    const casheaUsd = sumR(payments.filter(payment => payment.methodId === 'cashea').map(payment => payment.amountUsd));
    const favorUsed = sumR(payments.filter(payment => payment.methodId === 'saldo_favor').map(payment => payment.amountUsd));
    if ((fiadoUsd > 0.01 || casheaUsd > 0 || favorUsed > 0) && !selectedCustomer) throw new Error('Se requiere cliente para fiado, Cashea o saldo a favor.');
    if (casheaUsd > 0 && fiadoUsd > 0.01) throw new Error('Completa el pago inicial de Cashea; no se combinará con fiado adicional.');
    if (balance.changeBs > 0 && (casheaUsd > 0 || favorUsed > 0)) throw new Error('Cashea y saldo a favor requieren pago exacto, sin retirar efectivo.');
    const change = validateChangeInBs(balance.changeBs, options.changeBreakdown, effectiveRate);
    if (!change.valid) throw new Error(change.error);
    const allocation = consumeLots(lots, deductions, products, today);
    const updatedProducts = products.map(product => deductions[String(product.id)] ? { ...product, stock: quantityRound(Number(product.stock) - deductions[String(product.id)]), stockUnit: 'base', updatedAt: timestamp } : product);
    let updatedCustomers = customers;
    let customerDelta = null;
    if (selectedCustomer) {
        const debt = safeBalance(selectedCustomer.deuda);
        const credit = customerCredit(selectedCustomer);
        const cashea = safeBalance(selectedCustomer.casheaDeuda);
        if (favorUsed > credit) throw new Error('Saldo a favor insuficiente; no se confirmó el cobro.');
        const net = round2(credit - favorUsed - debt - fiadoUsd);
        const updated = { ...selectedCustomer, favor: Math.max(0, net), deuda: Math.max(0, -net), casheaDeuda: round2(cashea + casheaUsd), updatedAt: timestamp };
        delete updated.saldo_favor; delete updated.saldoFavor;
        customerDelta = { netDelta: round2(-favorUsed - fiadoUsd), casheaDelta: casheaUsd };
        updatedCustomers = customers.map(customer => customer.id === updated.id ? updated : customer);
    }
    const number = sales.reduce((maximum, sale) => Math.max(maximum, Number(sale.saleNumber) || 0), 0) + 1;
    const correlativo = `V-${String(number).padStart(7, '0')}`;
    const huella = { correlativo, sedeId: context.sedeId, usuarioId: operator.id, usuarioNombre: operator.nombre, rol: operator.rol,
        clienteId: selectedCustomer?.id || null, clienteNombre: selectedCustomer?.name || 'Consumidor Final', fecha: today, hora: getLocalISOTime(now), ts: now.getTime(), tipo: 'VENTA', ref: operationId };
    const sale = { id: operationId, operationId, operationIntent: intent, syncQueueId: operationId, schemaVersion: 3, accountId: context.accountId, sedeId: context.sedeId,
        saleNumber: number, tipo: casheaUsd > 0 ? 'VENTA_CASHEA' : fiadoUsd > 0.01 ? 'VENTA_FIADA' : 'VENTA', status: 'PENDIENTE_SYNC', syncMode: 'offline',
        items, cartSubtotalUsd: totals.subtotalUsd, discountType: discount.type, discountValue, discountAmountUsd: totals.discountAmountUsd, discountAuthorization,
        totalUsd: totals.totalUsd, totalBs: totals.totalBs, totalCop: 0, copEnabled: false, tasaCop: 0,
        payments, rate: effectiveRate, rateSource: options.rateMode === 'manual' ? 'Manual' : options.rateMode === 'euro' ? 'Euro Auto' : 'BCV Auto',
        timestamp, cashSessionId: openSession?.apertura?.id || null, fechaComercial: openSession?.businessDate || options.businessDate || today, horaComercial: getLocalISOTime(now),
        changeUsd: change.changeUsdGiven, changeBs: change.changeBsGiven,
        customerId: selectedCustomer?.id || null, customerName: selectedCustomer?.name || 'Consumidor Final', customerDocument: selectedCustomer?.documentId || null, customerPhone: selectedCustomer?.phone || null,
        customerDelta, fiadoUsd, casheaUsd, huella, lotesConsumidos: allocation.consumed,
        prescription: items.some(item => item.requiresPrescription || item.isControlled) ? { reference: options.prescription.reference.trim(), prescriber: options.prescription.prescriber.trim(), confirmed: true, verifiedBy: operator.id } : null };
    const payload = { schemaVersion: 3, operation_id: operationId, queue_id: operationId, sede_id: context.sedeId, total: sale.totalUsd,
        cart: items, payments, changeUsd: sale.changeUsd, changeBs: sale.changeBs, fiadoUsd, casheaUsd, rate: effectiveRate, sale };
    const entry = { id: operationId, queue_id: operationId, operation_id: operationId, schema_version: 3, account_id: context.accountId || 'local',
        sede_id: context.sedeId, operator_id: operator.id, local_sales_key: getStorageKeyForContext('bodega_sales_v1', context), kind: 'SALE',
        payload, sync_status: 'pending', attempts: 0, created_at: timestamp, next_attempt_at: null };
    const controlledEntries = items.some(item => item.isControlled) ? [{ id: operationId, ventaId: operationId, ...huella, clienteDocumento: sale.customerDocument, prescription: sale.prescription, items: items.filter(item => item.isControlled) }, ...controlled] : controlled;
    const auditEntry = { id: operationId, ts: now.getTime(), cat: 'VENTA', action: 'VENTA_CONFIRMADA_LOCAL', desc: `Venta ${correlativo} confirmada localmente`, userId: operator.id, userName: operator.nombre, userRole: operator.rol, sedeId: context.sedeId, meta: { saleId: operationId, total: sale.totalUsd } };
    return { writes: { products: updatedProducts, customers: updatedCustomers, sales: [sale, ...sales], lots: allocation.lots,
        queue: [...queue, entry], controlled: controlledEntries, audit: [auditEntry, ...audit] },
        result: { success: true, sale, updatedProducts, updatedCustomers, syncMode: 'offline' } };
}
