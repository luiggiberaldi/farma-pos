import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logEvent } from '../../services/auditService';
import { captureStorageContext, getActiveSedeId, isStorageContextActive } from '../../config/storageScope.js';
import { DEFAULT_USERS, migrateOwnerPinToFactory, normalizeUsers, CASHIER_FACTORY_PIN } from '../../config/userProvisioning.js';
import { OPERATOR_SESSION_KEY, publicOperator, readOperatorSession, saveOperatorSession, canUsePinlessAccess } from '../../utils/operatorSession.js';
import { sanitizeBackup } from '../../utils/backupSafety.js';
import { assertLocalOperationAllowed, hasPendingLocalWrites } from '../../services/localOperationGuard.js';

export async function hashPin(pin) {
    const data = new TextEncoder().encode(String(pin));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const isAdmin = user => ['DUENO', 'ADMIN'].includes(user?.rol);
const pinLength = user => isAdmin(user) ? 6 : 4;
// Ventana durante la cual un restablecimiento de PIN verificado por identidad
// cloud puede aplicarse. Expira si el usuario tarda en confirmar el nuevo PIN.
const PIN_RESET_GRACE_MS = 10 * 60 * 1000;
const credentialIdentity = user => user ? JSON.stringify([user.id, user.rol, user.sedeId ?? null,
    user.pin, user.pinHashed === true, user.sinPin === true, user.credentialVersion || 0]) : null;
let authEpoch = 0;
let skipConfigPersistence = false;
// Solicitud de restablecimiento de PIN vigente (identidad cloud ya verificada).
let pinResetGrace = null;
const approvals = new Map();
const APPROVAL_MS = 2 * 60 * 1000;

function attemptsKey(userId, context) {
    return `operator_pin_attempts_v2:${context.accountId || 'local'}:${userId}`;
}
function readAttempts(key) {
    try { return JSON.parse(sessionStorage.getItem(key) || '{}'); } catch { return {}; }
}
function noteAttempt(key, success) {
    if (success) { sessionStorage.removeItem(key); return; }
    const old = readAttempts(key);
    const count = old.until && old.until <= Date.now() ? 1 : (old.count || 0) + 1;
    sessionStorage.setItem(key, JSON.stringify({ count, until: count >= 3 ? Date.now() + 30000 : 0 }));
}
function requireOwner(user) {
    if (user?.rol !== 'DUENO') throw new Error('Solo el dueño puede administrar usuarios y credenciales.');
}

export const useAuthStore = create(persist((set, get) => ({
    usuarioActivo: null,
    operatorSession: null,
    usuarios: normalizeUsers(DEFAULT_USERS),
    requireLogin: false,
    adminEmail: '',
    lastAuthError: null,

    // Does not log in, change role, move branch or migrate any credentials.
    verifyPin: async (pinInput, userId, { administrative = false } = {}) => {
        const context = captureStorageContext();
        const epoch = authEpoch;
        const candidate = get().usuarios.find(u => u.id === userId);
        if (!candidate || (administrative && !isAdmin(candidate)) || !candidate.pin) return null;
        if (!new RegExp(`^\\d{${pinLength(candidate)}}$`).test(String(pinInput))) return null;
        const key = attemptsKey(candidate.id, context);
        if ((readAttempts(key).until || 0) > Date.now()) return null;
        const matched = candidate.pinHashed ? candidate.pin === await hashPin(pinInput) : candidate.pin === String(pinInput);
        // A microtask boundary makes cancellation/account changes observable for plaintext too.
        await Promise.resolve();
        const current = get().usuarios.find(u => u.id === userId);
        if (epoch !== authEpoch || !isStorageContextActive(context) || !current
            || credentialIdentity(current) !== credentialIdentity(candidate)) return null;
        if ((readAttempts(key).until || 0) > Date.now()) return null;
        noteAttempt(key, matched);
        return matched ? publicOperator(current) : null;
    },

    cancelPendingAuthentication: () => { authEpoch += 1; approvals.clear(); },

    login: async (pinInput, userId) => {
        assertLocalOperationAllowed();
        if (hasPendingLocalWrites()) throw new Error('Espera a que termine el guardado anterior antes de iniciar sesión.');
        const epoch = ++authEpoch;
        approvals.clear();
        const context = captureStorageContext();
        const user = get().usuarios.find(u => u.id === userId);
        set({ lastAuthError: null });
        if (!user || !['DUENO', 'ADMIN', 'CAJERO'].includes(user.rol)) return false;
        if (user.rol === 'CAJERO' && user.sedeId !== context.sedeId) {
            set({ lastAuthError: 'Este cajero solo puede operar su sede asignada.' });
            return false;
        }
        const pinless = canUsePinlessAccess(user, context, get().requireLogin);
        if (!pinless && !user.pin) {
            set({ lastAuthError: 'El dueño debe configurar un PIN para este cajero antes de acceder con cuenta cloud.' });
            return false;
        }
        const verified = pinless ? publicOperator(user) : await get().verifyPin(pinInput, userId);
        await Promise.resolve();
        if (!verified || epoch !== authEpoch || !isStorageContextActive(context)) return false;
        let authenticated = get().usuarios.find(u => u.id === userId);
        if (credentialIdentity(authenticated) !== credentialIdentity(user)) return false;
        if (!pinless && !authenticated.pinHashed) {
            const hashed = await hashPin(pinInput);
            if (epoch !== authEpoch || !isStorageContextActive(context)
                || credentialIdentity(get().usuarios.find(u => u.id === userId)) !== credentialIdentity(authenticated)) return false;
            authenticated = { ...authenticated, pin: hashed, pinHashed: true, sinPin: false };
            set(state => ({ usuarios: state.usuarios.map(u => u.id === userId ? authenticated : u) }));
        }
        if (epoch !== authEpoch || !isStorageContextActive(context)) return false;
        const envelope = saveOperatorSession(authenticated, { context, pinVerified: !pinless });
        sessionStorage.removeItem('farmapos_select_user');
        try {
            set({ usuarioActivo: envelope.user, operatorSession: envelope, lastAuthError: null });
        } catch (error) {
            try { localStorage.removeItem(OPERATOR_SESSION_KEY); } catch { /* Keep memory locked below. */ }
            try { sessionStorage.setItem('farmapos_select_user', '1'); } catch { /* Best effort. */ }
            try { set({ usuarioActivo: null, operatorSession: null }); } catch { /* Zustand updates memory before persistence. */ }
            throw error;
        }
        void logEvent('AUTH', pinless ? 'LOGIN_SIN_PIN' : 'LOGIN', `${authenticated.nombre} inició sesión local`, envelope.user, null, context);
        return true;
    },

    logout: (reason = 'manual', { preserveSavedSession = false } = {}) => {
        const user = get().usuarioActivo;
        const context = captureStorageContext();
        authEpoch += 1;
        approvals.clear();
        // Memory is locked even if a privacy/quota error prevents persistence.
        try { sessionStorage.setItem('farmapos_select_user', '1'); } catch { /* Keep in-memory lock. */ }
        try { if (!preserveSavedSession) localStorage.removeItem(OPERATOR_SESSION_KEY); } catch { /* Keep in-memory lock. */ }
        try { localStorage.removeItem('farmapos_app_mode'); } catch { /* Noncritical display setting. */ }
        // A storage event may bring a newer PIN/user list from another tab.
        // Invalidate this tab without persisting its stale configuration over it.
        const wasSkipping = skipConfigPersistence;
        skipConfigPersistence = wasSkipping || preserveSavedSession;
        try { set({ usuarioActivo: null, operatorSession: null, lastAuthError: null }); }
        catch { /* Memory is locked even if config write fails. */ }
        finally { skipConfigPersistence = wasSkipping; }
        if (user) void logEvent('AUTH', 'LOGOUT', `${user.nombre} cerró sesión: ${reason}`, user, null, context);
        // Keep the device's branch and every business record/outbox intact.
    },

    rebindSessionContext: () => {
        const session = get().operatorSession;
        const user = get().usuarioActivo;
        if (!session || !user) return;
        const context = captureStorageContext();
        if (session.accountId !== context.accountId || (user.rol === 'CAJERO' && user.sedeId !== context.sedeId)) {
            get().logout('contexto modificado');
            return;
        }
        // Rotate the view lease even when this operator later returns to the
        // same branch; old callbacks must not become valid again (A -> B -> A).
        const envelope = saveOperatorSession(user, { context, pinVerified: session.pinVerified });
        authEpoch += 1;
        approvals.clear();
        set({ operatorSession: envelope });
    },

    issueApproval: async (pin, userId, { action, details }) => {
        if (!['DISCOUNT', 'CHANGE_SEDE'].includes(action)) throw new Error('Acción administrativa inválida.');
        const context = captureStorageContext();
        const actor = get().usuarioActivo;
        if (action === 'DISCOUNT' && !actor) return null;
        if (action === 'CHANGE_SEDE' && actor?.rol === 'CAJERO') return null;
        const epoch = authEpoch;
        const signature = JSON.stringify(details);
        const approver = await get().verifyPin(pin, userId, { administrative: true });
        if (!approver || epoch !== authEpoch || !isStorageContextActive(context)
            || get().usuarioActivo?.id !== actor?.id || get().usuarioActivo?.rol !== actor?.rol) return null;
        const proof = {
            id: crypto.randomUUID(), action, details: JSON.parse(signature),
            accountId: context.accountId, sedeId: context.sedeId,
            operatorId: actor?.id ?? null, operatorRole: actor?.rol ?? null,
            approver, createdAt: new Date().toISOString(), expiresAt: Date.now() + APPROVAL_MS,
        };
        approvals.set(proof.id, { proof: structuredClone(proof), signature, epoch });
        return proof;
    },

    checkApproval: (id, action, details) => {
        const entry = approvals.get(id);
        if (!entry) return null;
        const { proof, signature, epoch } = entry;
        const actor = get().usuarioActivo;
        const approver = get().usuarios.find(u => u.id === proof.approver.id);
        if (epoch !== authEpoch || proof.action !== action || proof.expiresAt <= Date.now()
            || signature !== JSON.stringify(details) || !isStorageContextActive(proof)
            || proof.operatorId !== (actor?.id ?? null) || proof.operatorRole !== (actor?.rol ?? null)
            || !isAdmin(approver) || (approver.credentialVersion || 0) !== proof.approver.credentialVersion) return null;
        return structuredClone(proof);
    },

    consumeApproval: (id, action, details) => {
        const proof = get().checkApproval(id, action, details);
        if (!proof) throw new Error('La autorización expiró o cambió la operación. Solicita nuevamente el PIN administrativo.');
        approvals.delete(id);
        return proof;
    },

    // An embedded developer key must not create an operator session.
    loginAsSuperAdmin: () => false,

    // Recuperación de acceso: identidad cloud verificada (jamás una clave
    // maestra incrustada). Solo el correo configurado como administrador
    // (adminEmail) obtiene la ventana para restablecer el PIN del dueño
    // permanente; no crea sesiones ni toca cajeros.
    requestOwnerPinReset: async (cloudUserId, cloudEmail) => {
        if (!crypto?.randomUUID) throw new Error('Este dispositivo no soporta la verificación de identidad.');
        if (typeof cloudUserId !== 'string' || cloudUserId.length < 8 || cloudUserId.length > 255) {
            throw new Error('Verificación de identidad cloud inválida. Inicia sesión con tu cuenta y reintenta.');
        }
        const adminEmail = typeof get().adminEmail === 'string' ? get().adminEmail.trim().toLowerCase() : '';
        const identity = typeof cloudEmail === 'string' ? cloudEmail.trim().toLowerCase() : '';
        if (!adminEmail || identity !== adminEmail) {
            throw new Error('Esta cuenta no está autorizada para recuperar el acceso. Configura el correo del dueño en Configuración → Usuarios.');
        }
        const owner = get().usuarios.find(u => Number(u?.id) === 1 && u.rol === 'DUENO');
        if (!owner) throw new Error('No se encontró la cuenta del dueño en este dispositivo.');
        const token = crypto.randomUUID();
        pinResetGrace = { token, cloudUserId, requestedAt: Date.now(), expiresAt: Date.now() + PIN_RESET_GRACE_MS };
        return { token, ownerName: owner.nombre, expiresAt: pinResetGrace.expiresAt };
    },

    // Aplica el restablecimiento dentro de la ventana concedida: el dueño
    // define su nuevo PIN (jamás vuelve a un PIN de fábrica conocido), la
    // credencial rota y todas las sesiones/aprobaciones quedan cerradas.
    confirmOwnerPinReset: async (token, nuevoPin) => {
        const context = captureStorageContext();
        const epoch = authEpoch;
        const owner = get().usuarios.find(u => Number(u?.id) === 1 && u.rol === 'DUENO');
        if (!owner) throw new Error('No se encontró la cuenta del dueño en este dispositivo.');
        if (!pinResetGrace || !token || pinResetGrace.token !== token) throw new Error('Solicitud de recuperación inválida.');
        if (pinResetGrace.expiresAt <= Date.now()) { pinResetGrace = null; throw new Error('La recuperación expiró. Verifica tu identidad nuevamente.'); }
        if (!new RegExp(`^\\d{${pinLength(owner)}}$`).test(String(nuevoPin))) throw new Error(`El PIN debe tener ${pinLength(owner)} dígitos.`);
        const hashed = await hashPin(nuevoPin);
        if (!pinResetGrace || pinResetGrace.token !== token) throw new Error('La solicitud de recuperación cambió. Reintenta.');
        if (epoch !== authEpoch || !isStorageContextActive(context)) throw new Error('La sesión cambió durante el restablecimiento.');
        approvals.clear();
        pinResetGrace = null;
        set(state => ({ usuarios: state.usuarios.map(u => u.id === owner.id
            ? { ...u, pin: hashed, pinHashed: true, sinPin: false, credentialVersion: (u.credentialVersion || 0) + 1 } : u) }));
        const active = get().usuarioActivo;
        if (active?.id === owner.id) {
            get().logout('PIN restablecido');
        } else if (!active) {
            // Dispositivo bloqueado: garantiza que la pantalla pida operador
            // y descarta cualquier sobre de sesión previa del dueño.
            try { localStorage.removeItem(OPERATOR_SESSION_KEY); } catch { /* La memoria queda bloqueada por el epoch. */ }
            try { sessionStorage.setItem('farmapos_select_user', '1'); } catch { /* Best effort. */ }
        }
        authEpoch += 1;
        void logEvent('AUTH', 'PIN_RESTABLECIDO', 'PIN del dueño restablecido tras verificación de identidad cloud', null, null, context);
        return true;
    },

    cancelOwnerPinReset: () => {
        const active = get().usuarioActivo;
        if (active?.rol === 'DUENO') get().logout('recuperación cancelada');
        pinResetGrace = null;
    },

    cambiarPin: async (userId, nuevoPin) => {
        const actor = get().usuarioActivo;
        const target = get().usuarios.find(u => u.id === userId);
        if (!target || (actor?.rol !== 'DUENO' && actor?.id !== userId)) throw new Error('No tienes permiso para cambiar este PIN.');
        if (!new RegExp(`^\\d{${pinLength(target)}}$`).test(String(nuevoPin))) throw new Error(`El PIN debe tener ${pinLength(target)} dígitos.`);
        const context = captureStorageContext();
        const epoch = authEpoch;
        const hashed = await hashPin(nuevoPin);
        if (epoch !== authEpoch || !isStorageContextActive(context) || get().usuarioActivo?.id !== actor.id) throw new Error('La sesión cambió durante la actualización del PIN.');
        approvals.clear();
        set(state => ({ usuarios: state.usuarios.map(u => u.id === userId
            ? { ...u, pin: hashed, pinHashed: true, sinPin: false, credentialVersion: (u.credentialVersion || 0) + 1 } : u) }));
        void logEvent('AUTH', 'PIN_CAMBIADO', `PIN cambiado para ${target.nombre || 'usuario'}`, actor, null, context);
        if (actor.id === userId) get().logout('PIN actualizado');
    },

    agregarUsuario: async (nombre, rol, pin, sedeId = getActiveSedeId()) => {
        requireOwner(get().usuarioActivo);
        if (!nombre?.trim() || !['DUENO', 'ADMIN', 'CAJERO'].includes(rol)) throw new Error('Nombre o rol inválido.');
        if (rol === 'CAJERO' && !['central', 'norte', 'sur'].includes(sedeId)) throw new Error('Sede inválida.');
        // Regla de fábrica: un cajero creado sin PIN recibe el PIN de fábrica 0000;
        // no existen usuarios sin PIN. Con cuenta cloud el PIN es obligatorio.
        const factoryPin = rol === 'CAJERO' && !pin && !captureStorageContext().accountId && !get().requireLogin;
        if (!factoryPin && !new RegExp(`^\\d{${pinLength({ rol })}}$`).test(String(pin))) throw new Error('Configura un PIN válido para este usuario.');
        const epoch = authEpoch;
        const context = captureStorageContext();
        const effectivePin = factoryPin ? CASHIER_FACTORY_PIN : pin;
        const hashed = await hashPin(effectivePin);
        if (epoch !== authEpoch || !isStorageContextActive(context)) throw new Error('La sesión cambió.');
        requireOwner(get().usuarioActivo);
        set(state => ({ usuarios: [...state.usuarios, {
            id: Math.max(0, ...state.usuarios.map(u => Number(u.id) || 0)) + 1,
            nombre: nombre.trim(), rol, pin: hashed, pinHashed: true,
            sedeId: rol === 'CAJERO' ? sedeId : null, credentialVersion: 0,
        }] }));
        void logEvent('USUARIO', 'USUARIO_CREADO', `Usuario ${nombre} (${rol}) creado`, get().usuarioActivo);
    },

    eliminarUsuario: userId => {
        requireOwner(get().usuarioActivo);
        const target = get().usuarios.find(u => u.id === userId);
        if (!target || target.id === 1 || target.permanente || get().usuarioActivo.id === userId) return false;
        approvals.clear();
        set(state => ({ usuarios: state.usuarios.filter(u => u.id !== userId) }));
        void logEvent('USUARIO', 'USUARIO_ELIMINADO', `Usuario ${target.nombre} eliminado`, get().usuarioActivo);
        return true;
    },

    editarUsuario: (userId, datos) => {
        requireOwner(get().usuarioActivo);
        const target = get().usuarios.find(u => u.id === userId);
        if (!target) throw new Error('Usuario no encontrado.');
        const changes = Object.fromEntries(Object.entries(datos).filter(([key]) => ['nombre', 'rol', 'sedeId'].includes(key)));
        const updated = { ...target, ...changes };
        if (target.id === 1 || target.permanente) updated.rol = 'DUENO';
        if (!['DUENO', 'ADMIN', 'CAJERO'].includes(updated.rol)
            || (updated.rol === 'CAJERO' && !['central', 'norte', 'sur'].includes(updated.sedeId))) throw new Error('Rol o sede inválido.');
        if (updated.rol !== 'CAJERO') updated.sedeId = null;
        updated.credentialVersion = (target.credentialVersion || 0) + 1;
        approvals.clear();
        set(state => ({ usuarios: state.usuarios.map(u => u.id === userId ? updated : u) }));
        if (get().usuarioActivo?.id === userId) get().logout('usuario actualizado');
    },

    setRequireLogin: val => {
        assertLocalOperationAllowed();
        requireOwner(get().usuarioActivo);
        set({ requireLogin: Boolean(val) });
        if (val && get().operatorSession?.pinVerified !== true) get().logout('PIN requerido');
    },
    setAdminCredentials: email => {
        set({ adminEmail: typeof email === 'string' ? email.trim().toLowerCase() : '' });
    },
}), {
    name: 'abasto-auth-storage',
    version: 4,
    migrate: (persistedState, fromVersion) => {
        const state = sanitizeBackup(persistedState || {});
        if (fromVersion < 1 && state.usuarios) state.usuarios = state.usuarios.map(u =>
            isAdmin(u) && u.pin === '1234' ? { ...u, pin: '123456' } : u);
        if (fromVersion < 2 && state.usuarios) state.usuarios = state.usuarios.map(u =>
            u.pinHashed === undefined ? { ...u, pinHashed: false } : u);
        if (fromVersion < 3 && state.usuarios) state.usuarios = migrateOwnerPinToFactory(state.usuarios);
        return state;
    },
    merge: (persisted, current) => {
        authEpoch += 1;
        approvals.clear();
        const clean = sanitizeBackup(persisted || {});
        const usuarios = normalizeUsers(clean.usuarios || current.usuarios);
        const requireLogin = clean.requireLogin === true;
        const session = readOperatorSession(usuarios, captureStorageContext(), requireLogin);
        return { ...current, usuarios, requireLogin, adminEmail: typeof clean.adminEmail === 'string' ? clean.adminEmail : '',
            usuarioActivo: session?.user || null, operatorSession: session };
    },
    partialize: state => ({ usuarios: state.usuarios, requireLogin: state.requireLogin, adminEmail: state.adminEmail }),
    storage: {
        getItem: name => {
            const raw = localStorage.getItem(name);
            if (!raw) return null;
            try {
                const parsed = JSON.parse(raw);
                const clean = sanitizeBackup(parsed);
                // Remove a legacy password from this live config without touching backup files.
                if (JSON.stringify(clean) !== raw) localStorage.setItem(name, JSON.stringify(clean));
                return clean;
            } catch { return null; }
        },
        setItem: (name, value) => {
            if (!skipConfigPersistence) localStorage.setItem(name, JSON.stringify(sanitizeBackup(value)));
        },
        removeItem: name => localStorage.removeItem(name),
    },
}));
