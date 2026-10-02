import { REMOTE_OPERATIONS_PAUSED } from '../config/operationSafety.js';

// Remote operator verification is an identity check, not a business write.
// It never enables sync/checkout: those stay gated by operationSafety.js.
export const REMOTE_OPERATOR_ENDPOINT = '/api/operator-session';
export const REMOTE_AUTHORITY_KEY = 'farmapos_remote_operator';
export const REMOTE_DEVICE_KEY = 'farmapos_remote_device';
export const REMOTE_ROLES = Object.freeze(['DUENO', 'CAJERO']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PROOF = /^[A-Za-z0-9_-]{43}$/;
const PIN = /^\d{8,12}$/;

function memoryStorage() {
    const values = new Map();
    return {
        getItem: key => (values.has(key) ? values.get(key) : null),
        setItem: (key, value) => { values.set(key, String(value)); },
        removeItem: key => { values.delete(key); },
    };
}

// Per-tab sessionStorage on purpose: the device proof and authority must never
// reach localStorage/IndexedDB, so local backups cannot export them.
function browserStorage() {
    try {
        if (typeof sessionStorage !== 'undefined' && sessionStorage) return sessionStorage;
    } catch { /* Storage can throw in hardened/private contexts. */ }
    return memoryStorage();
}

async function cloudAccessToken() {
    const { supabaseCloud } = await import('../config/supabaseCloud.js');
    const { data, error } = await supabaseCloud.auth.getSession();
    if (error) return null;
    return data?.session?.access_token || null;
}

export function isValidDeviceCredential(value) {
    if (typeof value !== 'string' || value.length > 200) return false;
    const parts = value.split('.');
    return parts.length === 2 && UUID.test(parts[0]) && PROOF.test(parts[1]);
}

function safeAuthority(value) {
    if (!value || typeof value !== 'object') return null;
    const { operator_id, tenant_id, branch_id, role, name, expires_at } = value;
    if (!UUID.test(operator_id) || !UUID.test(tenant_id) || !UUID.test(branch_id)) return null;
    if (!REMOTE_ROLES.includes(role) || typeof name !== 'string' || !name.trim() || name.length > 120) return null;
    if (!Number.isFinite(Date.parse(expires_at))) return null;
    return { operator_id, tenant_id, branch_id, role, name, expires_at };
}

function safeDirectory(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.operators) || !Array.isArray(value.branches)) return null;
    const operators = [];
    for (const item of value.operators) {
        if (!item || !UUID.test(item.id) || typeof item.local_code !== 'string' || typeof item.name !== 'string'
            || !REMOTE_ROLES.includes(item.role) || (item.branch_id !== null && !UUID.test(item.branch_id))) return null;
        operators.push({ id: item.id, local_code: item.local_code, name: item.name, role: item.role, branch_id: item.branch_id ?? null });
    }
    const branches = [];
    for (const item of value.branches) {
        if (!item || !UUID.test(item.id) || typeof item.code !== 'string' || typeof item.name !== 'string') return null;
        branches.push({ id: item.id, code: item.code, name: item.name });
    }
    return { operators, branches };
}

function failure(code, message) {
    return { ok: false, code, message };
}

const DENIED = 'La verificación remota fue rechazada.';
const UNAVAILABLE = 'La verificación remota no está disponible en este equipo.';

export function createRemoteOperatorSession({
    fetchImpl = globalThis.fetch,
    getAccessToken = cloudAccessToken,
    storage = browserStorage(),
    endpoint = REMOTE_OPERATOR_ENDPOINT,
    now = () => Date.now(),
} = {}) {
    function readAuthority() {
        try {
            const parsed = JSON.parse(storage.getItem(REMOTE_AUTHORITY_KEY) || 'null');
            const authority = safeAuthority(parsed);
            if (!authority) return null;
            return Date.parse(authority.expires_at) > now() ? authority : null;
        } catch { return null; }
    }
    function writeAuthority(authority) {
        try { storage.setItem(REMOTE_AUTHORITY_KEY, JSON.stringify(authority)); } catch { /* Session-only convenience. */ }
    }
    function clear() {
        try { storage.removeItem(REMOTE_AUTHORITY_KEY); } catch { /* Nothing to clear. */ }
    }
    function getDeviceCredential() {
        try {
            const value = storage.getItem(REMOTE_DEVICE_KEY);
            return isValidDeviceCredential(value) ? value : null;
        } catch { return null; }
    }
    function setDeviceCredential(value) {
        if (value === null || value === '') { storage.removeItem(REMOTE_DEVICE_KEY); clear(); return true; }
        if (!isValidDeviceCredential(value)) return false;
        storage.setItem(REMOTE_DEVICE_KEY, value);
        // A credential from another terminal must not keep an unrelated authority alive.
        clear();
        return true;
    }
    async function request(body) {
        const deviceCredential = getDeviceCredential();
        if (!deviceCredential) return failure('unconfigured', 'Falta vincular este equipo.');
        let token;
        try { token = await getAccessToken(); } catch { return failure('unavailable', UNAVAILABLE); }
        if (!token) return failure('no-account', 'Inicia sesión en la cuenta cloud para verificar.');
        let response;
        try {
            response = await fetchImpl(endpoint, {
                method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
                    'x-pharmacy-device': deviceCredential },
                body: JSON.stringify(body),
            });
        } catch { return failure('unavailable', UNAVAILABLE); }
        if (response.status === 503 || response.status === 404) return failure('unavailable', UNAVAILABLE);
        if (!response.ok) return failure('denied', DENIED);
        try { return { ok: true, payload: await response.json() }; }
        catch { return failure('unavailable', UNAVAILABLE); }
    }
    // La matrícula no exige ni envía un secreto previo: obtenerlo es el punto.
    async function enrollRequest(label) {
        let token;
        try { token = await getAccessToken(); } catch { return failure('unavailable', UNAVAILABLE); }
        if (!token) return failure('no-account', 'Inicia sesión en la cuenta cloud para vincular.');
        let response;
        try {
            response = await fetchImpl(endpoint, {
                method: 'POST', credentials: 'include', cache: 'no-store', redirect: 'error',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action: 'enroll-device', label }),
            });
        } catch { return failure('unavailable', UNAVAILABLE); }
        if (response.status === 503 || response.status === 404) return failure('unavailable', UNAVAILABLE);
        if (response.status === 409) {
            let code = null;
            try { code = (await response.json())?.error; } catch { /* Cuerpo ilegible: denegación genérica. */ }
            if (code === 'device_limit') return failure('device_limit', 'Límite de 6 equipos alcanzado.');
            return failure('denied', DENIED);
        }
        if (!response.ok) return failure('denied', DENIED);
        let payload;
        try { payload = await response.json(); } catch { return failure('unavailable', UNAVAILABLE); }
        if (!isValidDeviceCredential(payload?.deviceCredential)) {
            return failure('invalid', 'El servidor no devolvió un identificador válido.');
        }
        return { ok: true, deviceCredential: payload.deviceCredential };
    }
    return {
        isDeviceLinked: () => Boolean(getDeviceCredential()),
        getDeviceCredential,
        getDeviceId: () => getDeviceCredential()?.split('.')[0] || null,
        setDeviceCredential,
        getAuthority: readAuthority,
        clear,
        paused: () => REMOTE_OPERATIONS_PAUSED,
        async enrollDevice(label) {
            if (typeof label !== 'string' || !label.trim() || label.length > 120) {
                return failure('invalid', 'La etiqueta del equipo no es válida.');
            }
            if (getDeviceCredential()) return { ok: true, already: true };
            const result = await enrollRequest(label.trim());
            if (!result.ok) return result;
            setDeviceCredential(result.deviceCredential);
            return { ok: true };
        },
        async listDevices() {
            const result = await request({ action: 'list-devices' });
            if (!result.ok) return result;
            const devices = Array.isArray(result.payload) ? result.payload.filter(device =>
                device && UUID.test(device.id) && typeof device.label === 'string'
                    && typeof device.enabled === 'boolean' && typeof device.created_at === 'string') : null;
            if (!devices) return failure('invalid', 'La lista de equipos no es válida.');
            return { ok: true, devices };
        },
        async revokeDevice(deviceId) {
            if (!UUID.test(deviceId || '')) return failure('invalid', 'Identificador de equipo inválido.');
            const result = await request({ action: 'revoke-device', deviceId });
            if (!result.ok) return result;
            if (deviceId === getDeviceCredential()?.split('.')[0]) setDeviceCredential(null);
            return { ok: true };
        },
        async directory() {
            const result = await request({ action: 'directory' });
            if (!result.ok) return result;
            const directory = safeDirectory(result.payload);
            return directory ? { ok: true, directory } : failure('invalid', 'El directorio remoto no es válido.');
        },
        async login({ operatorId, branchId, pin }) {
            if (!UUID.test(operatorId || '') || !UUID.test(branchId || '') || !PIN.test(pin || '')) {
                return failure('invalid', 'Operador, sede o PIN remoto inválidos.');
            }
            const result = await request({ action: 'login', operatorId, branchId, pin });
            if (!result.ok) return result;
            const authority = safeAuthority(result.payload?.operator);
            if (!authority) return failure('invalid', 'La autoridad remota no es válida.');
            writeAuthority(authority);
            return { ok: true, authority };
        },
        async logout() {
            const result = await request({ action: 'logout' });
            clear();
            // The local session is cleared even if the server could not be reached;
            // a stale authority must never outlive the operator's intent.
            return result.ok ? { ok: true } : { ok: true, warning: result.message };
        },
    };
}

export const remoteOperatorSession = createRemoteOperatorSession();
