const SECRET_KEYS = new Set(['adminpassword', 'password', 'access_token', 'refresh_token', 'accessToken', 'refreshToken'].map(key => key.toLowerCase()));
const SESSION_KEYS = new Set(['abasto-device-session', 'usuarioActivo', 'operatorSession', 'pda_explicit_login', 'premium_token', 'approvalId', 'authorization', 'listo_pos_active_account_id', 'farmacia_active_sede_id', 'farmacia-sede-storage', 'farmapos_cloud_signed_out', 'farmapos_select_user', 'farmapos_app_mode', 'farmapos_remote_operator', 'farmapos_remote_device'].map(key => key.toLowerCase()));

// Pure: sanitize NEW export/import values, never silently edit old backup files.
// Preserve the string/object shape of serialized localStorage values.
export function sanitizeBackup(value, key = '', depth = 0) {
    if (depth > 40) throw new Error('El respaldo excede la profundidad admitida.');
    if (typeof value === 'string') {
        if (value.trim().startsWith('{') || value.trim().startsWith('[')) {
            let parsed;
            try { parsed = JSON.parse(value); } catch {
                if (key === 'abasto-auth-storage') throw new Error('No se puede exportar una configuración de acceso inválida.');
                return value;
            }
            return JSON.stringify(sanitizeBackup(parsed, key, depth + 1));
        }
        if (key === 'abasto-auth-storage') throw new Error('No se puede exportar una configuración de acceso inválida.');
        return value;
    }
    if (Array.isArray(value)) return value.map(item => sanitizeBackup(item, '', depth + 1));
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value)
        .filter(([name]) => !SECRET_KEYS.has(name.toLowerCase()) && !SESSION_KEYS.has(name.toLowerCase())
            && !/^sb-.+-auth-token$/i.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name))
        .map(([name, item]) => [name, sanitizeBackup(item, name, depth + 1)]));
}
