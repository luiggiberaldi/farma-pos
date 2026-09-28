/**
 * ═══════════════════════════════════════════════════════
 *  NOTIFICATION SERVICE — Alertas Admin en tiempo real
 *
 *  Almacena notificaciones críticas localmente y las
 *  sincroniza a Supabase para visibilidad cross-device.
 *
 *  Tabla Supabase requerida:
 *    CREATE TABLE admin_notifications (
 *      id UUID PRIMARY KEY,
 *      ts BIGINT NOT NULL,
 *      type TEXT NOT NULL,
 *      title TEXT NOT NULL,
 *      body TEXT,
 *      email TEXT NOT NULL,
 *      device_id TEXT,
 *      meta JSONB,
 *      read BOOLEAN DEFAULT false,
 *      created_at TIMESTAMPTZ DEFAULT NOW()
 *    );
 * ═══════════════════════════════════════════════════════
 */

import { REMOTE_OPERATIONS_PAUSED, pausedCloudOperation } from '../config/operationSafety.js';

const NOTIF_KEY = 'abasto_admin_notifications_v1';
const MAX_NOTIFS = 200;

// ─── Types ──────────────────────────────────────────────
export const NOTIF_TYPES = {
    VENTA_ANULADA:     'venta_anulada',
    CAJA_CERRADA:      'caja_cerrada',
    PIN_BLOQUEADO:     'pin_bloqueado',
    NUEVO_DISPOSITIVO: 'nuevo_dispositivo',
    DESCUENTO_ALTO:    'descuento_alto',
    SESION_BLOQUEADA:  'sesion_bloqueada',
};

function readNotifs() {
    try {
        return JSON.parse(localStorage.getItem(NOTIF_KEY) || '[]');
    } catch { return []; }
}

function saveNotifs(notifs) {
    try {
        localStorage.setItem(NOTIF_KEY, JSON.stringify(notifs));
    } catch { /* silencioso */ }
}

// ─── Core ───────────────────────────────────────────────

/**
 * Crea una notificación admin y la persiste localmente.
 * @param {string} type - De NOTIF_TYPES
 * @param {string} title
 * @param {string} body
 * @param {object} [meta]
 */
export function createNotification(type, title, body, meta = null) {
    const notif = {
        id: crypto.randomUUID(),
        ts: Date.now(),
        type,
        title,
        body,
        read: false,
        meta,
    };

    const notifs = [notif, ...readNotifs()];
    if (notifs.length > MAX_NOTIFS) notifs.length = MAX_NOTIFS;
    saveNotifs(notifs);

    // Disparar evento para que el badge se actualice en tiempo real
    window.dispatchEvent(new CustomEvent('admin-notification', { detail: notif }));

    return notif;
}

/**
 * Obtiene las notificaciones (más recientes primero).
 */
export function getNotifications() {
    return readNotifs();
}

/**
 * Cuenta las notificaciones no leídas.
 */
export function getUnreadCount() {
    return readNotifs().filter(n => !n.read).length;
}

/**
 * Marca todas como leídas.
 */
export function markAllRead() {
    const notifs = readNotifs().map(n => ({ ...n, read: true }));
    saveNotifs(notifs);
    window.dispatchEvent(new CustomEvent('admin-notification-read'));
}

/**
 * Marca una como leída por ID.
 */
export function markRead(id) {
    const notifs = readNotifs().map(n => n.id === id ? { ...n, read: true } : n);
    saveNotifs(notifs);
    window.dispatchEvent(new CustomEvent('admin-notification-read'));
}

/**
 * Borra todas las notificaciones.
 */
export function clearNotifications() {
    saveNotifs([]);
    window.dispatchEvent(new CustomEvent('admin-notification-read'));
}

// ─── Cloud Sync ─────────────────────────────────────────

/**
 * Pushea notificaciones no sincronizadas a Supabase.
 */
export async function syncNotificationsToCloud(adminEmail, deviceId) {
    if (REMOTE_OPERATIONS_PAUSED) return pausedCloudOperation();
    if (!adminEmail) return;
    try {
        const { supabaseCloud } = await import('../config/supabaseCloud');
        const notifs = readNotifs().filter(n => !n.synced);
        if (!notifs.length) return;

        const rows = notifs.map(n => ({
            id: n.id,
            ts: n.ts,
            type: n.type,
            title: n.title,
            body: n.body ?? null,
            email: adminEmail,
            device_id: deviceId ?? null,
            meta: n.meta ?? null,
            read: n.read,
        }));

        const { error } = await supabaseCloud
            .from('admin_notifications')
            .upsert(rows, { onConflict: 'id' });

        if (!error) {
            const synced = readNotifs().map(n =>
                notifs.some(x => x.id === n.id) ? { ...n, synced: true } : n
            );
            saveNotifs(synced);
        }
    } catch (err) {
        console.warn('[NotificationService] Cloud sync error:', err);
    }
}
