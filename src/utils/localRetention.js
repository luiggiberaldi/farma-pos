/**
 * Retención local por archivo (localRetention).
 *
 * Política: nada se borra del dispositivo. Los registros viejos se MUEVEN
 * de la clave "caliente" (hot) a una clave de archivo (archive) en el mismo
 * IndexedDB del equipo. El archivo sigue en el dispositivo, entra en el
 * auto-backup local y puede exportarse; simplemente deja de cargarse en
 * los caminos calientes (checkout, dashboard, velocidad de inventario).
 *
 * Esto materializa la "política de retención explícita y respaldada" que
 * pedía auditService.purgeOldEntries: el log caliente queda acotado y la
 * evidencia se conserva archivada en el equipo + respaldo local.
 *
 * Ventanas:
 *  - Ventas calientes: SALES_HOT_DAYS (el sync solo necesita 30 días,
 *    velocidad de inventario 14, monitor el día actual; 90 da holgura).
 *  - Auditoría caliente: AUDIT_HOT_DAYS.
 *  - Lotes muertos: se purgan (no se archivan) los lotes con cantidad <= 0
 *    y vencidos: la lógica de asignación exige cantidad > 0 y
 *    vencimiento futuro, así que son invisibles para la app.
 */

export const SALES_ARCHIVE_KEY = 'bodega_sales_archive_v1';
export const AUDIT_ARCHIVE_KEY = 'abasto_audit_archive_v1';

export const SALES_HOT_DAYS = 90;
export const AUDIT_HOT_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Timestamp en ms de una venta. Nunca lanza; devuelve NaN si no hay fecha
 * interpretable (esos registros JAMÁS se archivan: ante la duda, caliente).
 */
export function saleTimestampMs(sale) {
    if (!sale || typeof sale !== 'object') return NaN;
    const raw = sale.timestamp || sale.fecha || sale.huella?.fechaComercial || '';
    if (!raw) return NaN;
    const ms = typeof raw === 'number' ? raw : Date.parse(String(raw));
    return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Timestamp en ms de una entrada de auditoría (campo ts numérico).
 */
export function auditTimestampMs(entry) {
    const ms = Number(entry?.ts);
    return Number.isFinite(ms) ? ms : NaN;
}

/**
 * Parte un arreglo en { hot, archived } por antigüedad.
 * Pura y determinista. Reglas:
 *  - Conserva el orden original en ambas mitades.
 *  - `cutoff = nowMs - hotDays*DAY_MS`; archiva solo ts < cutoff
 *    (estrictamente menor: el borde exacto queda en caliente).
 *  - Sin timestamp válido → caliente (nunca archivar lo desconocido).
 *  - No muta el arreglo de entrada.
 */
export function splitByAge(items, getTimestampMs, hotDays, nowMs = Date.now()) {
    const list = Array.isArray(items) ? items : [];
    const cutoff = nowMs - hotDays * DAY_MS;
    const hot = [];
    const archived = [];
    for (const item of list) {
        const ts = getTimestampMs(item);
        if (Number.isFinite(ts) && ts < cutoff) archived.push(item);
        else hot.push(item);
    }
    return { hot, archived };
}

/**
 * Añade un lote recién archivado al archivo existente.
 * Los recién archivados son más nuevos que el archivo previo
 * (el corte avanza monótonamente), así que van primero.
 */
export function appendToArchive(newlyArchived, existingArchive) {
    const prev = Array.isArray(existingArchive) ? existingArchive : [];
    if (!newlyArchived.length) return prev;
    return [...newlyArchived, ...prev];
}

/**
 * Purga lotes muertos: cantidad <= 0 Y vencidos (vencimiento < todayStr).
 * La asignación de lotes exige cantidad > 0 y vencimiento futuro, así que
 * estos registros son invisibles para la app. Conservador: cualquier
 * registro malformado o con stock > 0 se conserva.
 *
 * @param {Array} lots
 * @param {string} todayStr 'YYYY-MM-DD' local
 * @returns {{ lots: Array, purged: number }}
 */
export function purgeDeadLots(lots, todayStr) {
    const list = Array.isArray(lots) ? lots : [];
    const kept = [];
    let purged = 0;
    for (const lot of list) {
        const qty = Number(lot?.cantidad);
        const expired = typeof lot?.vencimiento === 'string' && lot.vencimiento < todayStr;
        if (Number.isFinite(qty) && qty <= 0 && expired) {
            purged++;
            continue;
        }
        kept.push(lot);
    }
    return { lots: kept, purged };
}

// ─── Lectores hot+archivo ────────────────────────────────────────────────
// Los flujos que necesitan historial completo (reportes, cierres,
// correcciones históricas) leen ambas claves. Los caminos calientes
// (checkout, dashboard) siguen leyendo solo la clave caliente.

/**
 * Lee ventas calientes + archivadas (calientes primero).
 */
export async function readAllSales(storageService, context) {
    const [hot, archive] = await Promise.all([
        storageService.getItem('bodega_sales_v1', [], context),
        storageService.getItem(SALES_ARCHIVE_KEY, [], context),
    ]);
    const hotList = Array.isArray(hot) ? hot : [];
    const arcList = Array.isArray(archive) ? archive : [];
    return [...hotList, ...arcList];
}

/**
 * Lee ventas calientes + archivadas para una sede (vista de reportes).
 */
export async function readSalesForSede(storageService, sedeId, context) {
    const [hot, archive] = await Promise.all([
        storageService.getItemForSede('bodega_sales_v1', sedeId, [], context),
        storageService.getItemForSede(SALES_ARCHIVE_KEY, sedeId, [], context),
    ]);
    const hotList = Array.isArray(hot) ? hot : [];
    const arcList = Array.isArray(archive) ? archive : [];
    return [...hotList, ...arcList];
}

/**
 * Lee auditoría caliente + archivada (caliente primero).
 */
export async function readFullAuditLog(storageService, context) {
    const [hot, archive] = await Promise.all([
        storageService.getItem('abasto_audit_log_v1', [], context),
        storageService.getItem(AUDIT_ARCHIVE_KEY, [], context),
    ]);
    const hotList = Array.isArray(hot) ? hot : [];
    const arcList = Array.isArray(archive) ? archive : [];
    return [...hotList, ...arcList];
}
