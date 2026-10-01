/**
 * ═══════════════════════════════════════════════════════
 *  AUDIT SERVICE — Bitacora Universal Oculta
 *  Registra todas las acciones de la app con usuario,
 *  timestamp, categoría y descripción.
 *
 *  Cloud sync: requiere tabla en Supabase:
 *    CREATE TABLE audit_log (
 *      id UUID PRIMARY KEY,
 *      ts BIGINT NOT NULL,
 *      cat TEXT NOT NULL,
 *      action TEXT NOT NULL,
 *      desc TEXT,
 *      user_id INT,
 *      user_name TEXT,
 *      user_role TEXT,
 *      email TEXT,
 *      device_id TEXT,
 *      meta JSONB,
 *      synced_at TIMESTAMPTZ DEFAULT NOW()
 *    );
 * ═══════════════════════════════════════════════════════
 */
import { storageService } from '../utils/storageService';
import { captureStorageContext } from '../config/storageScope';
import { REMOTE_OPERATIONS_PAUSED, CLOUD_PAUSE_MESSAGE, pausedCloudOperation } from '../config/operationSafety.js';
import {
    AUDIT_ARCHIVE_KEY, AUDIT_HOT_DAYS,
    auditTimestampMs, splitByAge, appendToArchive, readFullAuditLog,
} from '../utils/localRetention.js';

const AUDIT_KEY = 'abasto_audit_log_v1';
const AUDIT_SYNC_CURSOR = 'abasto_audit_sync_cursor';
const MAX_ENTRIES = 15000;
const MAX_AGE_DAYS = 90;
const SYNC_BATCH = 200; // entries per cloud push

// ─── Core ──────────────────────────────────────────────

/**
 * Registra un evento en el audit log.
 * @param {string} cat - Categoría (AUTH, VENTA, INVENTARIO, CLIENTE, PROVEEDOR, CONFIG, USUARIO, SISTEMA)
 * @param {string} action - Código de acción (ej: VENTA_COMPLETADA)
 * @param {string} desc - Descripción legible
 * @param {object} [user] - { id, nombre, rol } del usuario activo
 * @param {object} [meta] - Datos extra opcionales
 */
export async function logEvent(cat, action, desc, user = null, meta = null, context = captureStorageContext()) {
    try {
        const entry = {
            id: crypto.randomUUID(),
            ts: Date.now(),
            cat,
            action,
            desc,
            userId: user?.id ?? null,
            userName: user?.nombre ?? 'Sistema',
            userRole: user?.rol ?? 'SYSTEM',
            sedeId: context.sedeId,
        };
        if (meta) entry.meta = meta;

        // Retención local por archivo: las entradas viejas se mueven al archivo
        // del dispositivo en la misma transacción (no se borran). Ver
        // utils/localRetention.js — es la "política de retención explícita y
        // respaldada" que pedía purgeOldEntries.
        await storageService.transaction([
            { name: 'audit', key: AUDIT_KEY, fallback: [] },
            { name: 'auditArchive', key: AUDIT_ARCHIVE_KEY, fallback: [] },
        ], state => {
            if (!Array.isArray(state.audit) || !Array.isArray(state.auditArchive)) throw new Error('Bitácora inválida; no se sobrescribirá.');
            const split = splitByAge([entry, ...state.audit], auditTimestampMs, AUDIT_HOT_DAYS, entry.ts);
            const writes = { audit: split.hot };
            if (split.archived.length) writes.auditArchive = appendToArchive(split.archived, state.auditArchive);
            return { writes };
        }, context);
    } catch (err) {
        // Silencioso — el audit log nunca debe romper la app
        console.warn('[AuditService] Error writing log:', err);
    }
}

// ─── Queries ───────────────────────────────────────────

/**
 * Obtiene los logs con filtros opcionales.
 * @param {object} [filters]
 * @param {string} [filters.cat] - Filtrar por categoría
 * @param {number} [filters.userId] - Filtrar por usuario
 * @param {number} [filters.fromTs] - Desde timestamp
 * @param {number} [filters.toTs] - Hasta timestamp
 * @param {number} [filters.limit] - Máximo de resultados
 * @returns {Promise<Array>}
 */
export async function getAuditLog(filters = {}) {
    try {
        // Lee caliente + archivo: el visor muestra el historial completo.
        let log = await readFullAuditLog(storageService, captureStorageContext());

        if (filters.cat) {
            log = log.filter(e => e.cat === filters.cat);
        }
        if (filters.userId) {
            log = log.filter(e => e.userId === filters.userId);
        }
        if (filters.fromTs) {
            log = log.filter(e => e.ts >= filters.fromTs);
        }
        if (filters.toTs) {
            log = log.filter(e => e.ts <= filters.toTs);
        }
        if (filters.limit) {
            log = log.slice(0, filters.limit);
        }

        return log;
    } catch (err) {
        console.warn('[AuditService] Error reading log:', err);
        return [];
    }
}

/**
 * Cuenta total de registros.
 */
export async function getAuditCount() {
    try {
        const log = await storageService.getItem(AUDIT_KEY, []);
        return log.length;
    } catch {
        return 0;
    }
}

// ─── Mantenimiento ─────────────────────────────────────

/**
 * Elimina registros con más de MAX_AGE_DAYS días.
 * Llamar al iniciar la app.
 *
 * Política vigente (2026-10-01): NO se borra evidencia. En su lugar,
 * logEvent archiva automáticamente las entradas de más de AUDIT_HOT_DAYS
 * (90) días a `abasto_audit_archive_v1` en el mismo dispositivo, y el
 * archivo entra en el auto-backup local. Esa es la "política de retención
 * explícita y respaldada" que exigía este comentario: el log caliente
 * queda acotado y nada se pierde. Esta función se conserva como no-op
 * intencional por compatibilidad.
 */
export async function purgeOldEntries() {
    // Business evidence is retained: logEvent archives entries older than
    // AUDIT_HOT_DAYS to abasto_audit_archive_v1 (on-device + local backup)
    // instead of deleting them. See utils/localRetention.js.
    return { status: 'retained' };
    /* Legacy retention, intentionally not executed.
    try {
        const log = await storageService.getItem(AUDIT_KEY, []);
        const cutoff = Date.now() - (MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
        const filtered = log.filter(e => e.ts >= cutoff);
        
        if (filtered.length < log.length) {
            await storageService.setItem(AUDIT_KEY, filtered);
            console.log(`[AuditService] Purged ${log.length - filtered.length} old entries`);
        }
    } catch (err) {
        console.warn('[AuditService] Error purging:', err);
    } */
}

/**
 * Borra todo el audit log. Solo admin.
 */
export async function clearAuditLog() {
    throw new Error('La huella de operaciones no se elimina desde la aplicación. Exporta y concilia antes de definir retención.');
}

/**
 * Exporta el log como JSON descargable.
 */
export async function exportAuditLog() {
    const log = await storageService.getItem(AUDIT_KEY, []);
    const blob = new Blob([JSON.stringify(log, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ─── Cloud Sync ─────────────────────────────────────────────────────────────

/**
 * Sincroniza entradas del audit log local a Supabase.
 * Llama desde App.jsx al iniciar o en background periódicamente.
 * Solo actúa si adminEmail está configurado.
 *
 * @param {string} adminEmail - Email de la cuenta admin
 * @param {string} deviceId - ID del dispositivo actual
 */
export async function syncAuditToCloud(adminEmail, deviceId) {
    if (REMOTE_OPERATIONS_PAUSED) return pausedCloudOperation();
    if (!adminEmail) return;

    try {
        const { supabaseCloud } = await import('../config/supabaseCloud');

        // Evitar llamadas no autorizadas si no hay sesión activa
        const { data: { session } } = await supabaseCloud.auth.getSession();
        if (!session?.user?.id) return;

        const log = await storageService.getItem(AUDIT_KEY, []);
        if (!log.length) return;

        // Cursor: el timestamp del último entry ya sincronizado
        const cursor = parseInt(localStorage.getItem(AUDIT_SYNC_CURSOR) || '0', 10);

        // Entries no sincronizadas (más recientes primero → invertir para procesar cronológicamente)
        const pending = log.filter(e => e.ts > cursor).reverse().slice(0, SYNC_BATCH);
        if (!pending.length) return;

        const rows = pending.map(e => ({
            id: e.id,
            ts: e.ts,
            cat: e.cat,
            action: e.action,
            desc: e.desc,
            user_id: e.userId ?? null,
            user_name: e.userName ?? 'Sistema',
            user_role: e.userRole ?? 'SYSTEM',
            email: adminEmail,
            device_id: deviceId ?? null,
            meta: e.meta ?? null,
        }));

        const { error } = await supabaseCloud
            .from('audit_log')
            .upsert(rows, { onConflict: 'id' });

        if (!error) {
            const newCursor = Math.max(...pending.map(e => e.ts));
            localStorage.setItem(AUDIT_SYNC_CURSOR, String(newCursor));
        }
    } catch (err) {
        // Silencioso — sync cloud nunca debe romper la app
        console.warn('[AuditService] Cloud sync error:', err);
    }
}

/**
 * Lee el audit log consolidado (todos los dispositivos) desde la tabla
 * audit_log de Supabase. RLS (migración 003) restringe al email de la cuenta.
 *
 * @param {object} [filters] - { cat, fromTs, toTs, limit=200, offset=0 }
 * @returns {Promise<{entries: Array, total: number}>}
 */
export async function getCloudAuditLog(filters = {}) {
    if (REMOTE_OPERATIONS_PAUSED) throw new Error(CLOUD_PAUSE_MESSAGE);
    const { cat, fromTs, toTs, limit = 200, offset = 0 } = filters;
    const { supabaseCloud } = await import('../config/supabaseCloud');

    const { data: { session } } = await supabaseCloud.auth.getSession();
    if (!session?.user) throw new Error('Sin sesión en la nube');

    let q = supabaseCloud
        .from('audit_log')
        .select('id, ts, cat, action, desc, user_id, user_name, user_role, device_id, meta', { count: 'exact' })
        .order('ts', { ascending: false })
        .range(offset, offset + limit - 1);

    if (cat) q = q.eq('cat', cat);
    if (fromTs) q = q.gte('ts', fromTs);
    if (toTs) q = q.lte('ts', toTs);

    const { data, error, count } = await q;
    if (error) throw error;

    return {
        entries: (data || []).map(r => ({
            id: r.id,
            ts: Number(r.ts), // BIGINT llega como string en algunos drivers
            cat: r.cat,
            action: r.action,
            desc: r.desc,
            userId: r.user_id,
            userName: r.user_name,
            userRole: r.user_role,
            deviceId: r.device_id,
            meta: r.meta,
        })),
        total: count ?? 0,
    };
}
