import { captureStorageContext, isStorageContextActive } from '../config/storageScope.js';

export const OPERATOR_SESSION_KEY = 'abasto-device-session';

// Device-local identity only: never a credential for a remote API.
export function publicOperator(user) {
    if (!user) return null;
    return {
        id: user.id, nombre: user.nombre, rol: user.rol,
        sedeId: user.rol === 'CAJERO' ? user.sedeId : null,
        sinPin: user.sinPin === true && !user.pin,
        credentialVersion: user.credentialVersion || 0,
    };
}

// A10: el acceso sin PIN requiere opt-in explícito del dueño EN ESTE EQUIPO.
// Sin opt-in, el cajero sin PIN no puede entrar directo aunque su registro lo
// permita: la decisión queda registrada por dispositivo, no en la nube.
const PINLESS_OPTIN_PREFIX = 'abasto-pinless-optin:';
function pinlessOptInKey(userId, context) {
    return `${PINLESS_OPTIN_PREFIX}${context.accountId || 'local'}:${context.sedeId || 'na'}:${userId}`;
}
export function isPinlessOptedIn(userId, context = captureStorageContext()) {
    try { return localStorage.getItem(pinlessOptInKey(userId, context)) === '1'; }
    catch { return false; }
}
export function setPinlessOptIn(userId, context, enabled) {
    const key = pinlessOptInKey(userId, context);
    try {
        if (enabled) localStorage.setItem(key, '1');
        else localStorage.removeItem(key);
    } catch { /* almacenamiento no disponible: el opt-in no persiste */ }
}

export function canUsePinlessAccess(user, context = captureStorageContext(), requireLogin = false) {
    return !context.accountId && !requireLogin && user?.rol === 'CAJERO'
        && user.sinPin === true && !user.pin && user.sedeId === context.sedeId
        && isPinlessOptedIn(user?.id, context);
}

export function readOperatorSession(users, context = captureStorageContext(), requireLogin = false) {
    try {
        if (sessionStorage.getItem('farmapos_select_user') === '1') return null;
        const saved = JSON.parse(localStorage.getItem(OPERATOR_SESSION_KEY) || 'null');
        if (saved?.version !== 2 || typeof saved.sessionId !== 'string' || !saved.sessionId
            || saved.accountId !== context.accountId || saved.sedeId !== context.sedeId) return null;
        const user = users.find(u => u.id === saved.user?.id);
        if (!user || !['DUENO', 'ADMIN', 'CAJERO'].includes(user.rol)
            || user.rol !== saved.user.rol || (user.credentialVersion || 0) !== saved.user.credentialVersion) return null;
        if (user.rol === 'CAJERO' && user.sedeId !== context.sedeId) return null;
        if (saved.pinVerified !== true && !canUsePinlessAccess(user, context, requireLogin)) return null;
        if (saved.pinVerified !== true && saved.pinVerified !== false) return null;
        return { ...saved, user: publicOperator(user) };
    } catch { return null; }
}

export function saveOperatorSession(user, { context = captureStorageContext(), pinVerified = true, sessionId = crypto.randomUUID() } = {}) {
    if (!isStorageContextActive(context)) throw new Error('La cuenta o sede cambió durante el acceso.');
    const envelope = { version: 2, sessionId, accountId: context.accountId, sedeId: context.sedeId, pinVerified, user: publicOperator(user) };
    localStorage.setItem(OPERATOR_SESSION_KEY, JSON.stringify(envelope));
    return envelope;
}
