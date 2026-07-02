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

const AUDIT_KEY = 'abasto_audit_log_v1';
const AUDIT_SYNC_CURSOR = 'abasto_audit_sync_cursor';
const MAX_ENTRIES = 15000;
const MAX_AGE_DAYS = 90;
const SYNC_BATCH = 50; // entries per cloud push

// ─── Core ──────────────────────────────────────────────

/**
 * Registra un evento en el audit log.
 * @param {string} cat - Categoría (AUTH, VENTA, INVENTARIO, CLIENTE, PROVEEDOR, CONFIG, USUARIO, SISTEMA)
 * @param {string} action - Código de acción (ej: VENTA_COMPLETADA)
 * @param {string} desc - Descripción legible
 * @param {object} [user] - { id, nombre, rol } del usuario activo
 * @param {object} [meta] - Datos extra opcionales
 */
export async function logEvent(cat, action, desc, user = null, meta = null) {
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
        };
        if (meta) entry.meta = meta;

        const log = await storageService.getItem(AUDIT_KEY, []);
        log.unshift(entry); // Más reciente primero

        // Límite duro
        if (log.length > MAX_ENTRIES) {
            log.length = MAX_ENTRIES;
        }

        await storageService.setItem(AUDIT_KEY, log);
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
        let log = await storageService.getItem(AUDIT_KEY, []);

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
 */
export async function purgeOldEntries() {
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
    }
}

/**
 * Borra todo el audit log. Solo admin.
 */
export async function clearAuditLog() {
    await storageService.setItem(AUDIT_KEY, []);
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
