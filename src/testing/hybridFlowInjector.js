// ============================================================
// HYBRID FLOW INJECTOR v1.0
// Inyecta ventas de prueba pasando por el checkoutProcessor
// REAL → RPC Supabase (online) o Cola Offline (offline).
// Los productos tienen UUIDs válidos en la tabla products de SB.
// ============================================================

import { supabase } from '../core/supabaseClient';
import { REMOTE_OPERATIONS_PAUSED, CLOUD_PAUSE_MESSAGE, pausedCloudOperation } from '../config/operationSafety.js';
import { offlineQueueService } from '../services/offlineQueueService';
import { round2, sumR, subR } from '../utils/dinero';

// ── 10 productos con UUIDs fijos registrados en Supabase ──
const HYBRID_PRODUCTS = [
    { id: 'a1000001-0000-0000-0000-000000000001', name: 'Harina PAN 1kg',       priceUsd: 1.10, costUsd: 0.75 },
    { id: 'a1000001-0000-0000-0000-000000000002', name: 'Arroz Mary 1kg',        priceUsd: 0.95, costUsd: 0.60 },
    { id: 'a1000001-0000-0000-0000-000000000003', name: 'Aceite Mazeite 1L',     priceUsd: 2.80, costUsd: 2.10 },
    { id: 'a1000001-0000-0000-0000-000000000004', name: 'Azucar Montalban 1kg',  priceUsd: 1.25, costUsd: 0.85 },
    { id: 'a1000001-0000-0000-0000-000000000005', name: 'Pasta Capri 500g',      priceUsd: 0.75, costUsd: 0.50 },
    { id: 'a1000001-0000-0000-0000-000000000006', name: 'Leche Completa 1L',     priceUsd: 1.50, costUsd: 1.10 },
    { id: 'a1000001-0000-0000-0000-000000000007', name: 'Huevos Carton 30u',     priceUsd: 3.50, costUsd: 2.80 },
    { id: 'a1000001-0000-0000-0000-000000000008', name: 'Queso Llanero 1kg',     priceUsd: 4.00, costUsd: 3.20 },
    { id: 'a1000001-0000-0000-0000-000000000009', name: 'Cafe Madrid 500g',      priceUsd: 3.20, costUsd: 2.50 },
    { id: 'a1000001-0000-0000-0000-000000000010', name: 'Jabon Las Llaves 3u',   priceUsd: 1.80, costUsd: 1.20 },
];

// Número de ventas de prueba a inyectar
const INJECT_COUNT = 5;

// ── Mulberry32 PRNG determinista ──
function createSeededRandom(seed) {
    let s = seed | 0;
    return () => {
        s = s + 0x6D2B79F5 | 0;
        let t = Math.imul(s ^ s >>> 15, 1 | s);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

/**
 * Inyecta ventas de prueba usando el flujo REAL de checkout.
 * - Online: llama a la RPC process_checkout en Supabase.
 * - Offline: encola en offlineQueueService (IndexedDB).
 * @param {function} onLog - callback(msg, type) para mostrar progreso.
 */
export async function injectHybridFlowSales(onLog = () => {}) {
    if (REMOTE_OPERATIONS_PAUSED) {
        onLog(CLOUD_PAUSE_MESSAGE, 'warn');
        return { ...pausedCloudOperation(), successCount: 0, failCount: 0, mode: 'paused' };
    }
    const rand = createSeededRandom(99999);
    const isOnline = navigator.onLine;

    onLog(`Iniciando Hybrid Flow Injector v1.0`, 'info');
    onLog(`Modo: ${isOnline ? 'ONLINE (RPC Supabase)' : 'OFFLINE (Cola IndexedDB)'}`, isOnline ? 'success' : 'warn');
    onLog(`Inyectando ${INJECT_COUNT} ventas de prueba...`, 'info');

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < INJECT_COUNT; i++) {
        try {
            // Seleccionar 1-3 productos aleatorios
            const itemCount = Math.floor(rand() * 3) + 1;
            const cartItems = [];
            let totalUsd = 0;

            for (let j = 0; j < itemCount; j++) {
                const p = HYBRID_PRODUCTS[Math.floor(rand() * HYBRID_PRODUCTS.length)];
                const qty = Math.floor(rand() * 3) + 1;
                const subtotal = round2(p.priceUsd * qty);
                cartItems.push({ id: p.id, qty, priceUsd: p.priceUsd });
                totalUsd = sumR(totalUsd, subtotal);
            }

            // Método de pago: pago_movil o efectivo_usd
            const useCard = rand() > 0.5;
            const payments = [{
                methodId: useCard ? 'pago_movil' : 'efectivo_usd',
                amountUsd: totalUsd,
            }];

            const rpcPayload = {
                total: totalUsd,
                cart: cartItems,
                payments,
                fiadoUsd: 0,
            };

            if (isOnline) {
                // ── Modo Online: llamar RPC directamente ──
                const rpcPromise = supabase.rpc('process_checkout', { payload: rpcPayload });
                const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('TIMEOUT')), 5000));
                const { data, error } = await Promise.race([rpcPromise, timeout]);

                if (error) throw error;
                onLog(`[${i+1}/${INJECT_COUNT}] ✅ Online OK → sale_id: ${data.sale_id?.slice(0,8)}... | $${totalUsd.toFixed(2)}`, 'success');
            } else {
                // ── Modo Offline: enqueue en IndexedDB ──
                await offlineQueueService.addSaleToQueue(rpcPayload);
                onLog(`[${i+1}/${INJECT_COUNT}] 📦 Offline enqueued | $${totalUsd.toFixed(2)}`, 'warn');
            }

            successCount++;
        } catch (err) {
            failCount++;
            onLog(`[${i+1}/${INJECT_COUNT}] ❌ Error: ${err.message}`, 'error');
        }

        // Pequeña pausa para no saturar el backend
        await new Promise(r => setTimeout(r, 200));
    }

    // ── Resumen ──
    onLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'section');
    onLog(`RESUMEN HYBRID FLOW INJECTOR`, 'section');
    onLog(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'section');
    onLog(`Exitosas: ${successCount} | Fallidas: ${failCount}`, successCount > 0 ? 'success' : 'error');

    if (!isOnline && successCount > 0) {
        onLog(`${successCount} ventas en la cola offline. Conecta internet y presiona "Sync" para enviarlas.`, 'warn');
        // Intentar sincronizar si hay conexion
    } else if (isOnline && successCount > 0) {
        onLog(`Verifica en Supabase: tablas sales, sale_items y journal_entries.`, 'info');
    }

    return { successCount, failCount, mode: isOnline ? 'online' : 'offline' };
}
