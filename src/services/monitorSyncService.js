/**
 * Monitor Upload Service
 * Sube resúmenes periódicos de la sede a Supabase para el modo Monitor del dueño.
 * Solo upload — no toca el flujo de ventas ni el sync operacional (pausado por ADR-001).
 */

import { supabaseCloud } from '../config/supabaseCloud';
import { captureStorageContext } from '../config/storageScope';
import { getLocalISODate } from '../utils/dateHelpers';
import { storageService } from '../utils/storageService';

// Mapeo de sede local → UUID en Supabase (tenant C&Y)
const BRANCH_IDS = {
    central: 'ba19ea5d-1320-49b7-8579-4eb743b81993',
    norte: '31b8d4c0-d08a-4f17-b6c7-e74cab33744c',
    sur: '426642c3-c423-4264-b243-82a36dddcdc3',
};

let uploadTimer = null;
let isUploading = false;

/**
 * Calcula el resumen del día desde los datos locales.
 */
async function buildBranchSnapshot() {
    const context = captureStorageContext();
    const today = getLocalISODate(new Date());

    // Leer ventas del día desde el storage local
    const sales = await storageService.read('sales', context) || [];

    // Filtrar ventas de hoy (no anuladas)
    const todaySales = sales.filter(s => {
        if (!s || s.tipo === 'ANULACION_VENTA') return false;
        const saleDate = s.huella?.fechaComercial || s.fecha?.split('T')[0];
        return saleDate === today && ['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA'].includes(s.tipo);
    });

    // Calcular totales
    let totalUsd = 0, totalBs = 0, cashUsd = 0, posBs = 0, creditUsd = 0;
    let voidsCount = 0, voidsTotalUsd = 0, discountsTotalUsd = 0;

    // Desglose flexible por método de pago: { methodId: { usd, bs, count } }
    const paymentBreakdown = {};

    const addToBreakdown = (methodId, amountUsd, amountBs) => {
        if (!methodId) return;
        if (!paymentBreakdown[methodId]) {
            paymentBreakdown[methodId] = { usd: 0, bs: 0, count: 0 };
        }
        paymentBreakdown[methodId].usd += Number(amountUsd) || 0;
        paymentBreakdown[methodId].bs += Number(amountBs) || 0;
        paymentBreakdown[methodId].count += 1;
    };

    for (const sale of todaySales) {
        if (sale.status === 'ANULADA' || sale.estado === 'ANULADA') {
            voidsCount++;
            voidsTotalUsd += Number(sale.totalUsd) || 0;
            continue;
        }

        totalUsd += Number(sale.totalUsd) || 0;
        totalBs += Number(sale.totalBs) || 0;

        // Desglose por método de pago (todos los registrados)
        for (const payment of (sale.payments || [])) {
            const method = payment.methodId || payment.metodo || 'desconocido';
            const amtUsd = Number(payment.amountUsd) || 0;
            const amtBs = Number(payment.amountBs) || 0;
            addToBreakdown(method, amtUsd, amtBs);

            // Totales legacy para compatibilidad
            if (method.includes('efectivo') && !method.includes('bs') && !method.includes('cop')) {
                cashUsd += amtUsd;
            } else if (method.includes('punto') || method === 'punto_venta') {
                posBs += amtBs;
            } else if (method.includes('fiado')) {
                creditUsd += amtUsd;
            }
        }

        discountsTotalUsd += Number(sale.discountUsd) || Number(sale.descuentoUsd) || 0;
    }

    // Redondear desglose
    for (const key of Object.keys(paymentBreakdown)) {
        paymentBreakdown[key].usd = Math.round(paymentBreakdown[key].usd * 100) / 100;
        paymentBreakdown[key].bs = Math.round(paymentBreakdown[key].bs * 100) / 100;
    }

    // Estado de caja
    const aperturas = sales.filter(s => s.tipo === 'APERTURA_CAJA');
    const lastApertura = aperturas[aperturas.length - 1];
    const cierres = sales.filter(s => s.tipo === 'CIERRE_CAJA');
    const lastCierre = cierres[cierres.length - 1];

    const cashRegisterOpen = lastApertura && (!lastCierre ||
        new Date(lastApertura.huella?.timestamp || 0) > new Date(lastCierre.huella?.timestamp || 0));

    // Nombre del cajero (desde la sesión activa)
    let cashierName = null;
    try {
        const { useAuthStore } = await import('../hooks/store/useAuthStore');
        const usuario = useAuthStore.getState().usuarioActivo;
        if (usuario?.rol === 'CAJERO') cashierName = usuario.nombre;
    } catch { /* silencioso */ }

    return {
        branch_id: BRANCH_IDS[context.sedeId],
        _debugSedeId: context.sedeId,
        snapshot_date: today,
        total_sales_usd: Math.round(totalUsd * 100) / 100,
        total_sales_bs: Math.round(totalBs * 100) / 100,
        transaction_count: todaySales.filter(s => s.status !== 'ANULADA' && s.estado !== 'ANULADA').length,
        cash_usd: Math.round(cashUsd * 100) / 100,
        pos_bs: Math.round(posBs * 100) / 100,
        credit_usd: Math.round(creditUsd * 100) / 100,
        cash_register_open: !!cashRegisterOpen,
        cashier_name: cashierName,
        opening_usd: lastApertura ? Number(lastApertura.openingUsd) || 0 : null,
        opening_bs: lastApertura ? Number(lastApertura.openingBs) || 0 : null,
        voids_count: voidsCount,
        voids_total_usd: Math.round(voidsTotalUsd * 100) / 100,
        discounts_total_usd: Math.round(discountsTotalUsd * 100) / 100,
        payment_breakdown: paymentBreakdown,
    };
}

/**
 * Obtiene el JWT de la sesión cloud de la estación para autenticar
 * las llamadas al Monitor. Sin sesión no hay subida/lectura.
 */
async function getMonitorAuthHeader() {
    try {
        const { data } = await supabaseCloud.auth.getSession();
        const token = data?.session?.access_token;
        return token ? { Authorization: `Bearer ${token}` } : null;
    } catch {
        return null;
    }
}

/**
 * Sube el snapshot actual a Supabase (vía API server-side).
 */
export async function uploadBranchSnapshot() {
    if (isUploading) return;
    isUploading = true;
    // Estado observable para depuración (window.__monitorStatus)
    const setStatus = (s) => {
        if (typeof window !== 'undefined') {
            window.__monitorStatus = { ...s, at: new Date().toISOString() };
        }
    };

    try {
        const snapshot = await buildBranchSnapshot();
        if (!snapshot.branch_id) {
            console.warn('[Monitor] Sede no mapeada, omitiendo subida. sedeId:', snapshot._debugSedeId);
            setStatus({ ok: false, error: 'sede_no_mapeada', sedeId: snapshot._debugSedeId });
            return;
        }

        // Usar URL absoluta para evitar problemas con base path en PWA
        const apiUrl = `${window.location.origin}/api/monitor-upload`;
        const authHeader = await getMonitorAuthHeader();
        if (!authHeader) {
            setStatus({ ok: false, error: 'sin_sesion_cloud' });
            return;
        }
        // La sede la deriva el servidor desde la sesión del operador validada.
        // Se envía el credential del dispositivo para que el servidor pueda
        // validar la sesión y derivar el branch_id (nunca se confía en el cliente).
        let deviceHeader = {};
        try {
            const { operatorRemoteSession } = await import('./operatorRemoteSession');
            const deviceCredential = operatorRemoteSession.getDeviceCredential();
            if (deviceCredential) deviceHeader = { 'X-Pharmacy-Device': deviceCredential };
        } catch { /* silencioso */ }
        const response = await fetch(apiUrl, {
            method: 'POST',
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...authHeader,
                ...deviceHeader,
            },
            body: JSON.stringify({
                p_snapshot_date: snapshot.snapshot_date,
                p_total_sales_usd: snapshot.total_sales_usd,
                p_total_sales_bs: snapshot.total_sales_bs,
                p_transaction_count: snapshot.transaction_count,
                p_cash_usd: snapshot.cash_usd,
                p_pos_bs: snapshot.pos_bs,
                p_credit_usd: snapshot.credit_usd,
                p_cash_register_open: snapshot.cash_register_open,
                p_cashier_name: snapshot.cashier_name,
                p_opening_usd: snapshot.opening_usd,
                p_opening_bs: snapshot.opening_bs,
                p_voids_count: snapshot.voids_count,
                p_voids_total_usd: snapshot.voids_total_usd,
                p_discounts_total_usd: snapshot.discounts_total_usd,
                p_payment_breakdown: snapshot.payment_breakdown,
            }),
            signal: AbortSignal.timeout(10000),
        });

        if (!response.ok) throw new Error(`API respondió ${response.status}`);

        const { id } = await response.json();
        console.log('[Monitor] Snapshot subido:', snapshot.snapshot_date, snapshot.branch_id);
        setStatus({ ok: true, branch_id: snapshot.branch_id, id });
        return id;
    } catch (error) {
        console.error('[Monitor] Error subiendo snapshot:', error.message);
        setStatus({ ok: false, error: error.message });
        // No bloquear la app si falla la subida
    } finally {
        isUploading = false;
    }
}

/**
 * Inicia la subida periódica (cada 5 minutos).
 */
export function startMonitorUpload(intervalMs = 5 * 60 * 1000) {
    stopMonitorUpload();
    // Subida inicial
    uploadBranchSnapshot().catch(() => {});
    // Subidas periódicas
    uploadTimer = setInterval(() => uploadBranchSnapshot().catch(() => {}), intervalMs);
    console.log('[Monitor] Subida periódica iniciada');
}

// Exponer globalmente para depuración manual desde la consola
if (typeof window !== 'undefined') {
    window.__monitorUpload = uploadBranchSnapshot;
}

/**
 * Detiene la subida periódica.
 */
export function stopMonitorUpload() {
    if (uploadTimer) {
        clearInterval(uploadTimer);
        uploadTimer = null;
    }
}

/**
 * Lee los snapshots del día para el monitor (vía API server-side).
 */
export async function fetchBranchSnapshots(snapshotDate = null) {
    try {
        const date = snapshotDate || getLocalISODate(new Date());
        // El tenant lo deriva el servidor desde la sesión; no se envía.
        const apiUrl = `${window.location.origin}/api/monitor-snapshots?date=${date}`;
        const authHeader = await getMonitorAuthHeader();
        if (!authHeader) return [];
        const response = await fetch(
            apiUrl,
            {
                headers: { ...authHeader },
                signal: AbortSignal.timeout(10000),
            }
        );

        if (!response.ok) throw new Error(`API respondió ${response.status}`);

        const { snapshots } = await response.json();
        return snapshots || [];
    } catch (error) {
        console.error('[Monitor] Error leyendo snapshots:', error.message);
        return [];
    }
}
