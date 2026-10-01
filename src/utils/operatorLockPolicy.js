// Política pura de bloqueo de sesión y formato de sedes.
// Sin dependencias de React/store: 100% testeable en Node.

export const DUENO_AUTO_LOCK_KEY = 'admin_auto_lock_minutes';
export const DEFAULT_DUENO_LOCK_MINUTES = 5;

// AJUSTE 1 (2026-10-01): el bloqueo por inactividad SOLO aplica al dueño.
// El cajero nunca se bloquea solo. "jefe o dueño" y "admin" del pedido del
// usuario mapean al único rol administrativo real del sistema: DUENO
// (el rol ADMIN fue eliminado en la fase A del plan de fixeo 2026-09-29).
export function shouldAutoLockForRole(rol, loginRequired) {
    return rol === 'DUENO' && Boolean(loginRequired);
}

// Minutos de inactividad antes de bloquear. Solo el dueño lo tiene
// configurable (localStorage 'admin_auto_lock_minutes'); el cajero
// devuelve null porque nunca se bloquea solo.
export function autoLockMinutesFor(rol) {
    if (rol !== 'DUENO') return null;
    let minutes = DEFAULT_DUENO_LOCK_MINUTES;
    try {
        const raw = localStorage.getItem(DUENO_AUTO_LOCK_KEY);
        if (raw != null) {
            const parsed = parseInt(raw, 10);
            if (!Number.isNaN(parsed) && parsed >= 1) minutes = parsed;
        }
    } catch { /* almacenamiento inaccesible: se usa el valor por defecto */ }
    return minutes;
}

// A10: bloqueo anti-fuerza bruta del PIN. Ventana exponencial 30s, 60s,
// 120s… con tope de 15 min. (Movida desde useAuthStore.js para testearla
// en aislamiento; la semántica no cambió.)
export const LOCKOUT_BASE_MS = 30_000;
export const LOCKOUT_MAX_MS = 15 * 60_000;
export function lockoutMsFor(failures) {
    if (failures < 3) return 0;
    return Math.min(LOCKOUT_BASE_MS * 2 ** (failures - 3), LOCKOUT_MAX_MS);
}

// AJUSTE 2 (2026-10-01): hay dos sedes "C&Y" que solo se distinguen por el
// año final (2025 vs 2026). Separa la base del año para que el año siempre
// se muestre como chip enfatizado y nunca truncado; además normaliza
// "C&y"/"c&y" a "C&Y" en mayúsculas en todos lados.
export function parseSedeNombre(nombre) {
    const raw = String(nombre || '').trim();
    const match = raw.match(/^(.*?)[\s\-–—]*(19|20)(\d{2})\s*$/);
    let base = match ? match[1].trim() : raw;
    const year = match ? `${match[2]}${match[3]}` : null;
    base = base.replace(/\bc&y\b/gi, 'C&Y');
    return { base: base || raw, year };
}
