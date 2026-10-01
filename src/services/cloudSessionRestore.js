// ─── Respaldo y restauración resiliente de la sesión cloud ───────────────────
// Causa raíz (2026-10-01): `auth.signOut()` sin scope usa `global` por defecto
// en auth-js y revoca los refresh tokens de TODOS los equipos de la cuenta.
// En los demás equipos, el próximo refresh fallaba con `invalid_grant`
// (no reintentable) y el SDK borraba la sesión local → la app pedía
// "Conectar Estación" aunque nadie había cerrado sesión en ese equipo.
//
// Contrato:
// - El cierre de sesión es SIEMPRE por equipo (CLOUD_SIGNOUT_SCOPE = 'local').
// - Se guarda un respaldo del refresh token en cada SIGNED_IN/TOKEN_REFRESHED.
// - Al arrancar, si el SDK no tiene sesión pero hay respaldo, se intenta un
//   refresh explícito con reintentos ante fallos transitorios.
// - El respaldo SOLO se borra en logout explícito o fallo de autenticación
//   confirmado (invalid_grant, etc.). Un fallo de red jamás borra la sesión.

export const SESSION_BACKUP_KEY = 'farmapos_cloud_session_backup';

// El cierre de sesión cloud es por equipo: nunca debe revocar la sesión de
// otros dispositivos que comparten la cuenta del dueño.
export const CLOUD_SIGNOUT_SCOPE = 'local';

const RESTORE_MAX_ATTEMPTS = 3;
const RESTORE_RETRY_DELAYS_MS = [600, 1800, 4500];

// Patrones que confirman que las credenciales murieron en el servidor.
// Todo lo demás (red caída, 5xx, timeouts, 429) es transitorio: se reintenta
// y el respaldo se conserva.
const CONFIRMED_AUTH_FAILURE_RE =
    /(invalid_grant|refresh_token_not_found|session_not_found|user_not_found|token_revoked|mfa_challenge_expired|otp_expired)/i;

export function saveSessionBackup(storage, session) {
    try {
        const refresh_token = session?.refresh_token;
        const user_id = session?.user?.id;
        if (typeof refresh_token !== 'string' || !refresh_token) return false;
        if (typeof user_id !== 'string' || !user_id) return false;
        storage.setItem(SESSION_BACKUP_KEY, JSON.stringify({
            refresh_token,
            user_id,
            saved_at: Date.now(),
        }));
        return true;
    } catch {
        return false;
    }
}

export function readSessionBackup(storage) {
    try {
        const raw = storage?.getItem(SESSION_BACKUP_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed.refresh_token !== 'string' || !parsed.refresh_token) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function clearSessionBackup(storage) {
    try {
        storage?.removeItem(SESSION_BACKUP_KEY);
    } catch {
        // El borrado del respaldo nunca debe romper el logout.
    }
}

export function isConfirmedAuthFailure(error) {
    if (!error) return false;
    const haystack = [
        error?.code,
        error?.error_code,
        error?.message,
        error?.error,
        typeof error === 'string' ? error : '',
    ].filter(Boolean).join(' ');
    return CONFIRMED_AUTH_FAILURE_RE.test(haystack);
}

// Intenta recuperar la sesión con el refresh token respaldado.
// Devuelve:
//   { status: 'restored', session }   → la sesión volvió, úsala.
//   { status: 'invalid', error }       → las credenciales murieron: borra el respaldo.
//   { status: 'unreachable', error }   → fallo transitorio agotado: CONSERVA el respaldo.
// Nunca borra el respaldo por sí misma: esa decisión es del llamador.
export async function restoreSessionWithRetry(auth, backup, {
    maxAttempts = RESTORE_MAX_ATTEMPTS,
    delaysMs = RESTORE_RETRY_DELAYS_MS,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
    let lastError = null;
    const attempts = Math.max(1, maxAttempts);
    for (let i = 0; i < attempts; i++) {
        if (i > 0) await sleep(delaysMs[Math.min(i - 1, delaysMs.length - 1)] ?? 0);
        try {
            const { data, error } = await auth.refreshSession({ refresh_token: backup.refresh_token });
            if (error) throw error;
            if (data?.session) return { status: 'restored', session: data.session };
            lastError = new Error('El servidor respondió sin sesión.');
        } catch (error) {
            lastError = error;
            if (isConfirmedAuthFailure(error)) return { status: 'invalid', error };
            // Transitorio: se reintenta; el respaldo se conserva.
        }
    }
    return { status: 'unreachable', error: lastError };
}
