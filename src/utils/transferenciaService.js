import { storageService } from './storageService.js';
import { captureStorageContext, assertStorageContextActive } from '../config/storageScope.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { beginLocalOperation } from '../services/localOperationGuard.js';
import { drainSnapshotWrites } from '../services/localSnapshotQueue.js';
import { assertUsableStock, isBulkProduct, packageFactor, consumeLots, quantityRound } from './inventoryQuantities.js';
import { getLocalISODate } from './dateHelpers.js';
import { ledgerRecords, assertLedgerArrays, assertQueueOwnership, movementStamp, ledgerAudit, pendingOperation } from './localLedger.js';

export const getTransferencias = () => storageService.getItem('farmacia_transferencias_v1', []);
export const getTransferenciasPendientesPara = (list, sede) => list.filter(item => item.estado === 'ENVIADA' && item.destinoId === sede);
export const getTransferenciasEnviadasDesde = (list, sede) => list.filter(item => item.estado === 'ENVIADA' && item.origenId === sede);

async function transfer(kind, input) {
    const options = structuredClone({ ...input, products: undefined });
    const context = Object.freeze({ ...(options.storageContext || captureStorageContext()) });
    const operator = useAuthStore.getState().usuarioActivo;
    const sessionId = useAuthStore.getState().operatorSession?.sessionId;
    if (operator?.rol !== 'DUENO') throw new Error('No tienes permiso para transferir inventario.');
    const verify = () => {
        assertStorageContextActive(context);
        const active = useAuthStore.getState();
        if (active.usuarioActivo?.id !== operator.id || active.usuarioActivo?.rol !== operator.rol || active.operatorSession?.sessionId !== sessionId) throw new Error('El operador cambió durante la transferencia.');
    };
    verify();
    const release = beginLocalOperation(`TRANSFER_${kind}`, context);
    try {
        await drainSnapshotWrites(context);
        const timestamp = new Date().toISOString();
        const requestedId = kind === 'SEND' ? options.operationId || crypto.randomUUID() : options.transferencia?.id;
        if (typeof requestedId !== 'string' || !requestedId) throw new Error('Identificador de transferencia inválido.');
        return await storageService.transaction(ledgerRecords(['products', 'lots', 'transfers', 'audit', 'queue'], context), state => {
            verify(); assertLedgerArrays(state);
            let products = structuredClone(state.products), lots = structuredClone(state.lots), record;
            const prior = state.transfers.find(item => item.id === requestedId);
            const eventId = `${kind.toLowerCase()}_${requestedId}`;
            const queued = assertQueueOwnership(state.queue, eventId, `TRANSFER_${kind}`, context);
            if (queued && (!prior || kind === 'SEND' && prior.id !== requestedId || kind === 'RECEIVE' && prior.estado !== 'RECIBIDA' || kind === 'CANCEL' && prior.estado !== 'CANCELADA')) throw new Error('La transferencia tiene un comprobante sin estado coherente. Requiere conciliación.');
            if (kind === 'SEND') {
                if (!['central', 'norte', 'sur'].includes(options.destinoId) || options.destinoId === context.sedeId) throw new Error('Sede destino inválida.');
                if (!Array.isArray(options.items) || !options.items.length) throw new Error('Transferencia sin productos.');
                const intent = JSON.stringify([context.sedeId, options.destinoId, options.items.map(item => [item.productoId, item.cantidad])]);
                if (prior) {
                    if (prior.intent !== intent) throw new Error('El identificador de transferencia ya pertenece a otro envío.');
                    return { writes: {}, result: { transferencia: prior, updatedProducts: products, duplicate: true } };
                }
                const deductions = Object.create(null);
                const items = options.items.map(item => {
                    const product = products.find(p => p.id === item.productoId);
                    if (!product) throw new Error('Producto no encontrado en la sede origen.');
                    const qty = item.cantidad;
                    if (!Number.isFinite(qty) || qty <= 0 || qty !== quantityRound(qty) || !isBulkProduct(product) && !Number.isInteger(qty)) throw new Error('Cantidad inválida para transferencia.');
                    if (Object.hasOwn(deductions, product.id)) throw new Error('Un producto está duplicado en la transferencia.');
                    if (qty > assertUsableStock(product)) throw new Error(`Stock insuficiente de ${product.name}.`);
                    deductions[product.id] = qty;
                    return { productoId: product.id, nombre: product.name, cantidad: qty, producto: { ...product, stock: 0, stockUnit: 'base', image: null } };
                });
                const allocation = consumeLots(lots, deductions, products, getLocalISODate(new Date(timestamp)));
                products = products.map(p => deductions[p.id] ? { ...p, stock: quantityRound(p.stock - deductions[p.id]), updatedAt: timestamp } : p);
                lots = allocation.lots;
                record = { id: requestedId, schemaVersion: 3, accountId: context.accountId, intent, origenId: context.sedeId, destinoId: options.destinoId,
                    estado: 'ENVIADA', items, lotes: allocation.consumed, createdAt: timestamp,
                    huella: movementStamp('TRANSFERENCIA', requestedId, context, operator, timestamp, { destinoId: options.destinoId }) };
            } else {
                if (!prior || prior.schemaVersion !== 3 || prior.accountId !== context.accountId) throw new Error('Transferencia no encontrada o legada sin lotes verificables; requiere conciliación.');
                const target = kind === 'RECEIVE' ? prior.destinoId : prior.origenId;
                if (target !== context.sedeId) throw new Error(kind === 'RECEIVE' ? 'Esta transferencia no es para esta sede.' : 'Solo la sede origen puede cancelar.');
                const finalState = kind === 'RECEIVE' ? 'RECIBIDA' : 'CANCELADA';
                if (prior.estado === finalState) return { writes: {}, result: { transferencia: prior, updatedProducts: products, duplicate: true } };
                if (prior.estado !== 'ENVIADA') throw new Error('La transferencia ya fue procesada; no se duplicó stock.');
                for (const item of prior.items) {
                    let product = products.find(p => p.id === item.productoId);
                    if (!Number.isFinite(item.cantidad) || item.cantidad <= 0 || !item.producto) throw new Error('Detalle de transferencia inválido.');
                    if (!product && kind === 'RECEIVE') throw new Error('Prepara el producto y sus precios en la sede destino antes de recibir; no se copiarán precios desde origen.');
                    if (!product || packageFactor(product) !== packageFactor(item.producto) || isBulkProduct(product) !== isBulkProduct(item.producto)) throw new Error('El producto o su presentación cambió; concilia antes de recibir.');
                    product.stock = quantityRound(assertUsableStock(product) + item.cantidad);
                    product.updatedAt = timestamp;
                }
                for (const allocation of prior.lotes) {
                    const lotId = kind === 'CANCEL' ? allocation.loteId : `${prior.id}:${allocation.loteId}`;
                    let lot = lots.find(item => item.id === lotId);
                    if (!lot && kind === 'CANCEL') throw new Error('El lote de origen ya no existe; requiere conciliación.');
                    if (!lot) {
                        lot = { id: lotId, productoId: allocation.productoId, numeroLote: allocation.numeroLote, vencimiento: allocation.vencimiento, cantidad: 0, transferenciaId: prior.id };
                        lots.push(lot);
                    }
                    if (String(lot.productoId) !== String(allocation.productoId) || lot.vencimiento !== allocation.vencimiento || !Number.isFinite(lot.cantidad)) throw new Error('El lote no coincide con el envío.');
                    lot.cantidad = quantityRound(lot.cantidad + allocation.cantidad);
                }
                record = { ...prior, estado: finalState, updatedAt: timestamp,
                    [kind === 'RECEIVE' ? 'huellaRecepcion' : 'huellaCancelacion']: movementStamp('TRANSFERENCIA', eventId, context, operator, timestamp) };
            }
            const transfers = prior ? state.transfers.map(item => item.id === record.id ? record : item) : [record, ...state.transfers];
            return { writes: { products, lots, transfers,
                queue: [...state.queue, pendingOperation(eventId, `TRANSFER_${kind}`, record, context, operator, timestamp)],
                audit: [ledgerAudit(eventId, `TRANSFER_${kind}`, context, operator, timestamp, { transferId: record.id }), ...state.audit] },
                result: { transferencia: record, updatedProducts: products, duplicate: false } };
        }, context);
    } finally { release(); }
}
export const enviarTransferencia = options => transfer('SEND', options);
export const recibirTransferencia = options => transfer('RECEIVE', options);
export const cancelarTransferencia = options => transfer('CANCEL', options);
