import { storageService } from './storageService';
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { round2 } from './dinero';
import { createNotification, NOTIF_TYPES } from '../services/notificationService';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

/**
 * Handles the logic of voiding a transaction, reverting stock, and reverting customer balances.
 */
export async function processVoidSale(sale, currentSales, currentProducts, options = {}) {
    if (!sale) throw new Error("Sale object is required to void.");
    const { skipRestock = false, skipRevertMoney = false } = options;

    // 1. Crear transacción de anulación en negativo y agregar metadatos a la original
    const voidId = `void_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const user = useAuthStore.getState().usuarioActivo;
    const voidTimestamp = new Date().toISOString();

    const voidTransaction = {
        id: voidId,
        tipo: 'ANULACION_VENTA',
        status: 'COMPLETADA',
        originSaleId: sale.id,
        originSaleNumber: sale.saleNumber,
        timestamp: voidTimestamp,
        cierreId: null,
        cajaCerrada: false,
        totalUsd: -(sale.totalUsd || 0),
        totalBs: -(sale.totalBs || 0),
        rate: sale.rate,
        items: sale.items ? sale.items.map(i => ({ ...i, qty: -Math.abs(i.qty) })) : [],
        payments: sale.payments ? sale.payments.map(p => ({
            ...p,
            amount: -(p.amount || 0),
            amountUsd: p.amountUsd != null ? -p.amountUsd : undefined,
            amountBs: p.amountBs != null ? -p.amountBs : undefined,
        })) : [],
        customerId: sale.customerId,
        customerName: sale.customerName,
        saleNumber: sale.saleNumber,
    };

    const updatedSales = currentSales.map(s => {
        if (s.id === sale.id) {
            return {
                ...s,
                voidedAt: voidTimestamp,
                voidedBy: user?.id,
                relatedVoidId: voidId
            };
        }
        return s;
    });
    // Añadimos la transacción de anulación al historial
    updatedSales.unshift(voidTransaction);

    // 2. Revertir Stock (saltar si skipRestock)
    let updatedProducts = [...currentProducts];
    if (!skipRestock && sale.items && sale.items.length > 0) {
        updatedProducts = currentProducts.map(p => {
            const itemsInSale = sale.items.filter(i => (i._originalId || i.id) === p.id);
            if (itemsInSale.length > 0) {
                const totalToRestore = itemsInSale.reduce((sum, item) => {
                    if (item.isWeight) return sum + item.qty;
                    if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                    return sum + item.qty;
                }, 0);
                return { ...p, stock: (p.stock || 0) + totalToRestore };
            }
            return p;
        });
    }

    // 3. Revertir Deuda/Saldo a Favor del Cliente (saltar si skipRevertMoney)
    const savedCustomers = await storageService.getItem(CUSTOMERS_KEY, []);
    let updatedCustomers = savedCustomers;

    if (!skipRevertMoney) {
        const fiadoAmountUsd = sale.fiadoUsd || (sale.tipo === 'VENTA_FIADA' ? sale.totalUsd : 0) || 0;
        const favorUsed = sale.payments?.filter(p => p.methodId === 'saldo_favor').reduce((sum, p) => sum + p.amountUsd, 0) || 0;

        if (sale.customerId && (fiadoAmountUsd > 0 || favorUsed > 0)) {
            updatedCustomers = savedCustomers.map(c => {
                if (c.id === sale.customerId) {
                    const newDeuda = round2(Math.max(0, (c.deuda || 0) - fiadoAmountUsd));
                    const newFavor = round2((c.saldo_favor || 0) + favorUsed);
                    console.log(`[Anular] Cliente ${c.name}: deuda ${c.deuda} -> ${newDeuda} (revertido fiado $${fiadoAmountUsd}), favor ${c.saldo_favor || 0} -> ${newFavor} (revertido favor $${favorUsed})`);
                    return { ...c, deuda: newDeuda, saldo_favor: newFavor };
                }
                return c;
            });
        }
    }

    // 4. Guardar todo
    await storageService.setItem(SALES_KEY, updatedSales);
    await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);

    logEvent('VENTA', 'VENTA_ANULADA', `Venta #${sale.saleNumber || '?'} anulada - $${sale.totalUsd?.toFixed(2)}`, user, { saleId: sale.id });
    createNotification(
        NOTIF_TYPES.VENTA_ANULADA,
        'Venta anulada',
        `Venta #${sale.saleNumber || '?'} — $${sale.totalUsd?.toFixed(2)} anulada por ${user?.nombre || 'Usuario'}`,
        { saleId: sale.id, totalUsd: sale.totalUsd, userId: user?.id }
    );

    return { updatedSales, updatedProducts, updatedCustomers };
}
