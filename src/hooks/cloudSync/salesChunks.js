/**
 * Chunks diarios de ventas para sync_documents (append-only).
 *
 * El documento monolítico `bodega_sales_v1` (ventana de 30 días en un solo
 * JSONB) chocaba con el cap local de 1 MiB a partir de ~21 ventas/día/sede:
 * el push entero se difería. Con chunks diarios cada push sube como máximo
 * las ventas de UN día comercial (~1.7 KB/venta → ~600 ventas/día de techo
 * por chunk, 28× más holgura), y los chunks viejos se podan de la nube.
 *
 * Política de retención cloud (sin cambios): solo la ventana de
 * SALES_SYNC_WINDOW_DAYS vive en sync_documents. El historial completo sigue
 * en el dispositivo (hot 90 días + archivo local) y en cloud_backups.
 *
 * Este módulo es lógica pura y determinista (sin Supabase) para poder
 * probarse sin red. El motor (useCloudSync) inyecta el cliente.
 */
import { SALES_SYNC_WINDOW_DAYS } from './syncUtils.js';

// ─── Día comercial de una venta → YYYYMMDD ─────────────────────────────────
// Misma precedencia que getSaleBusinessDate (closureLogic), pero sin traer
// sus dependencias: fechaComercial → businessDate → timestamp → hoy.
const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function toLocalDayParts(d) {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

export function saleChunkDay(sale, nowMs = Date.now()) {
    const iso = sale?.fechaComercial || sale?.businessDate || null;
    if (typeof iso === 'string') {
        const m = iso.match(DAY_RE);
        if (m) return `${m[1]}${m[2]}${m[3]}`;
    }
    const t = Date.parse(sale?.timestamp || sale?.updatedAt || sale?.createdAt || '');
    if (!Number.isNaN(t)) return toLocalDayParts(new Date(t));
    // Sin fecha parseable → día actual (política: conservar, nunca perder).
    return toLocalDayParts(new Date(nowMs));
}

// ─── Agrupación por día ─────────────────────────────────────────────────────
export function groupSalesByDay(sales, nowMs = Date.now()) {
    const groups = new Map();
    if (!Array.isArray(sales)) return groups;
    for (const sale of sales) {
        const day = saleChunkDay(sale, nowMs);
        let arr = groups.get(day);
        if (!arr) { arr = []; groups.set(day, arr); }
        arr.push(sale);
    }
    return groups;
}

// ─── Planificación del push ─────────────────────────────────────────────────
// Devuelve los chunks a subir, ordenados por día ascendente, limitados a la
// ventana cloud. No muta el array de entrada.
export function planSalesChunkPushes(sales, { windowDays = SALES_SYNC_WINDOW_DAYS, nowMs = Date.now() } = {}) {
    const groups = groupSalesByDay(sales, nowMs);
    const cutoffDay = toLocalDayParts(new Date(nowMs - windowDays * 24 * 60 * 60 * 1000));
    const plans = [];
    for (const [day, daySales] of groups) {
        if (day < cutoffDay) continue; // fuera de la ventana cloud → queda en local
        plans.push({ chunkKey: `bodega_sales_${day}`, day, sales: daySales.slice() });
    }
    plans.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
    return plans;
}

// ─── Poda: chunks más viejos que la ventana ─────────────────────────────────
export function staleChunkKeys(chunkKeys, { windowDays = SALES_SYNC_WINDOW_DAYS, nowMs = Date.now() } = {}) {
    const cutoffDay = toLocalDayParts(new Date(nowMs - windowDays * 24 * 60 * 60 * 1000));
    const stale = [];
    for (const key of chunkKeys || []) {
        const m = typeof key === 'string' ? key.match(/^bodega_sales_(\d{8})$/) : null;
        if (m && m[1] < cutoffDay) stale.push(key);
    }
    return stale;
}

// Frecuencia máxima de la poda (una vez al día por dispositivo basta: los
// chunks envejecen exactamente un día por día).
export const SALES_CHUNK_PRUNE_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const SALES_CHUNK_PRUNE_TS_KEY = '_sales_chunks_pruned_ts';
