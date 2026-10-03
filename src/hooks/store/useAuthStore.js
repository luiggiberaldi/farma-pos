import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { logEvent } from '../../services/auditService';
import { captureStorageContext, getActiveSedeId, isStorageContextActive } from '../../config/storageScope.js';
import { DEFAULT_USERS, migrateOwnerPinToFactory, normalizeUsers, normalizeUsersOnBoot, CASHIER_FACTORY_PIN, isFactoryPin } from '../../config/userProvisioning.js';
import { OPERATOR_SESSION_KEY, publicOperator, readOperatorSession, saveOperatorSession, canUsePinlessAccess, setPinlessOptIn, getPinlessBlockedMessage } from '../../utils/operatorSession.js';
import { sanitizeBackup } from '../../utils/backupSafety.js';
import { assertLocalOperationAllowed, hasPendingLocalWrites } from '../../services/localOperationGuard.js';
import { generatePinSalt, hashPinPbkdf2, isStrongPinRecord } from '../../utils/pinCrypto.js';
import { lockoutMsFor } from '../../utils/operatorLockPolicy.js';
import { ensureSyncIds, newSyncId } from '../cloudSync/accountSync.js';
import { pushUsersDoc } from '../cloudSync/accountDocs.js';
import { pushCloudSync } from '../useCloudSync.js';

// A3: SHA-256 sin salt (formato legado). Solo se usa para comparar registros
// viejos; todo PIN nuevo o verificado se migra a PBKDF2 (ver pinCrypto.js).
export async function hashPinLegacy(pin) {
    const data = new TextEncoder().encode(String(pin));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, '0')).join('');
}
// Alias transitorio por compatibilidad.
export const hashPin = hashPinLegacy;

// Construye un registro de PIN en el formato fuerte (PBKDF2 + salt).
async function strongPinRecord(pin) {
    const pinSalt = await generatePinSalt();
    return { pin: await hashPinPbkdf2(pin, pinSalt), pinSalt, pinKdf: 'pbkdf2', pinHashed: true, sinPin: false };
}

const isOwner = user => user?.rol === 'DUENO';
const pinLength = user => isOwner(user) ? 6 : 4;
// Ventana durante la cual un restablecimiento de PIN verificado por identidad
// cloud puede aplicarse. Expira si el usuario tarda en confirmar el nuevo PIN.
const PIN_RESET_GRACE_MS = 10 * 60 * 1000;
const credentialIdentity = user => user ? JSON.stringify([user.id, user.rol, user.sedeId ?? null,
    user.pin, user.pinHashed === true, user.pinKdf || null, user.pinSalt || null,
    user.sinPin === true, user.credentialVersion || 0]) : null;
let authEpoch = 0;
let skipConfigPersistence = false;
// Solicitud de restablecimiento de PIN vigente (identidad cloud ya verificada).
let pinResetGrace = null;
const approvals = new Map();
const APPROVAL_MS = 2 * 60 * 1000;

function attemptsKey(userId, context) {
    return `operator_pin_attempts_v3:${context.accountId || 'local'}:${userId}`;
}
// El bloqueo de sesión sobrevive a una recarga: sin esto, recargar la
// página esquivaría el PIN de desbloqueo. La llave se valida contra la
// sesión restaurada en merge() y se limpia en unlock()/logout().
const SESSION_LOCK_KEY = 'farmapos_session_locked';
// El turno fichado también sobrevive a recargas para no perder la salida.
const SHIFT_KEY = 'farmapos_shift';
// A10: los intentos viven en localStorage (otra pestaña ya no reinicia el
// contador). La ventana de bloqueo exponencial vive en
// utils/operatorLockPolicy.js (lockoutMsFor) para poder testearse aislada.
function readAttempts(key) {
    try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
function noteAttempt(key, success) {
    if (success) { try { localStorage.removeItem(key); } catch { /* noop */ } return; }
    const old = readAttempts(key);
    const failures = (old.failures || 0) + 1;
    const until = lockoutMsFor(failures);
    try {
        localStorage.setItem(key, JSON.stringify({
            failures, until: until ? Date.now() + until : 0,
        }));
    } catch { /* almacenamiento lleno: se pierde el contador, no el bloqueo en memoria */ }
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
    // Bloqueo real de sesión (Lock ≠ Logout): conserva operador, sesión y
    // carrito; solo el usuario que bloqueó puede desbloquear con su PIN.
    sessionLocked: null,
    // Clock-in/clock-out (patrón Toast/Lightspeed, versión mínima): el cajero
    // ficha entrada tras el PIN; la salida se registra al cerrar el turno.
    // Queda en el log de auditoría (AUTH/TURNO_*) para que el dueño lo vea.
    shift: null,
    clockInOffer: null,

    // Does not log in, change role, move branch or migrate any credentials.
    verifyPin: async (pinInput, userId, { administrative = false } = {}) => {
        const context = captureStorageContext();
        const epoch = authEpoch;
        const candidate = get().usuarios.find(u => u.id === userId);
        if (!candidate || (administrative && !isOwner(candidate)) || !candidate.pin) return null;
        if (!new RegExp(`^\\d{${pinLength(candidate)}}$`).test(String(pinInput))) return null;
        const key = attemptsKey(candidate.id, context);
        if ((readAttempts(key).until || 0) > Date.now()) return null;
        const matched = isStrongPinRecord(candidate)
            ? candidate.pin === await hashPinPbkdf2(pinInput, candidate.pinSalt)
            : candidate.pinHashed
                ? candidate.pin === await hashPinLegacy(pinInput)
                : candidate.pin === String(pinInput);
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
        if (!user || !['DUENO', 'CAJERO'].includes(user.rol)) return false;
        if (user.rol === 'CAJERO' && user.sedeId !== context.sedeId) {
            set({ lastAuthError: 'Este cajero solo puede operar su sede asignada.' });
            return false;
        }
        const pinless = canUsePinlessAccess(user, context, get().requireLogin);
        if (!pinless && !user.pin) {
            set({ lastAuthError: getPinlessBlockedMessage(user, get().requireLogin) });
            return false;
        }
        const verified = pinless ? publicOperator(user) : await get().verifyPin(pinInput, userId);
        await Promise.resolve();
        if (!verified || epoch !== authEpoch || !isStorageContextActive(context)) return false;
        let authenticated = get().usuarios.find(u => u.id === userId);
        if (credentialIdentity(authenticated) !== credentialIdentity(user)) return false;
        if (!pinless && !isStrongPinRecord(authenticated)) {
            // A3: migración oportunista al formato fuerte en cada login válido.
            const strong = await strongPinRecord(pinInput);
            if (epoch !== authEpoch || !isStorageContextActive(context)
                || credentialIdentity(get().usuarios.find(u => u.id === userId)) !== credentialIdentity(authenticated)) return false;
            authenticated = { ...authenticated, ...strong };
            set(state => ({ usuarios: state.usuarios.map(u => u.id === userId ? authenticated : u) }));
        }
        if (epoch !== authEpoch || !isStorageContextActive(context)) return false;
        const envelope = saveOperatorSession(authenticated, { context, pinVerified: !pinless });
        sessionStorage.removeItem('farmapos_select_user');
        try {
            // Clock-in: tras el PIN, el cajero ve la opción de fichar entrada
            // (salvo que ya tenga un turno abierto de antes).
            const shiftOpen = get().shift?.userId === authenticated.id;
            const clockInOffer = authenticated.rol === 'CAJERO' && !shiftOpen
                ? { userId: authenticated.id, userName: authenticated.nombre }
                : null;
            set({ usuarioActivo: envelope.user, operatorSession: envelope, lastAuthError: null, clockInOffer });
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
        // Clock-out: al cerrar el turno se registra la salida si había
        // una entrada fichada (queda en auditoría para el dueño).
        const shift = get().shift;
        if (user && shift?.userId === user.id && shift?.clockInAt) {
            const clockOutAt = new Date().toISOString();
            const durationMin = Math.max(0, Math.round((Date.parse(clockOutAt) - Date.parse(shift.clockInAt)) / 60000));
            void logEvent('AUTH', 'TURNO_FINALIZADO',
                `${user.nombre} fichó salida de turno (${durationMin} min)`, user,
                { clockInAt: shift.clockInAt, clockOutAt, durationMin }, context);
        }
        try { localStorage.removeItem(SESSION_LOCK_KEY); } catch { /* noop */ }
        try { localStorage.removeItem(SHIFT_KEY); } catch { /* noop */ }
        // Memory is locked even if a privacy/quota error prevents persistence.
        try { sessionStorage.setItem('farmapos_select_user', '1'); } catch { /* Keep in-memory lock. */ }
        try { if (!preserveSavedSession) localStorage.removeItem(OPERATOR_SESSION_KEY); } catch { /* Keep in-memory lock. */ }
        try { localStorage.removeItem('farmapos_app_mode'); } catch { /* Noncritical display setting. */ }
        // A storage event may bring a newer PIN/user list from another tab.
        // Invalidate this tab without persisting its stale configuration over it.
        const wasSkipping = skipConfigPersistence;
        skipConfigPersistence = wasSkipping || preserveSavedSession;
        try { set({ usuarioActivo: null, operatorSession: null, lastAuthError: null, sessionLocked: null, shift: null, clockInOffer: null }); }
        catch { /* Memory is locked even if config write fails. */ }
        finally { skipConfigPersistence = wasSkipping; }
        if (user) void logEvent('AUTH', 'LOGOUT', `${user.nombre} cerró sesión: ${reason}`, user, null, context);
        // Keep the device's branch and every business record/outbox intact.
    },

    // Lock ≠ Logout: bloquea la pantalla conservando operador, sesión y
    // carrito. Solo quien bloqueó puede desbloquear con su PIN.
    lock: (reason = 'manual') => {
        const user = get().usuarioActivo;
        if (!user) return false;
        authEpoch += 1;
        approvals.clear();
        const locked = { userId: user.id, userName: user.nombre, rol: user.rol, at: new Date().toISOString(), reason };
        try { localStorage.setItem(SESSION_LOCK_KEY, JSON.stringify(locked)); } catch { /* noop */ }
        set({ sessionLocked: locked });
        void logEvent('AUTH', 'SESION_BLOQUEADA', `${user.nombre} bloqueó su sesión (${reason})`, user);
        return true;
    },

    unlock: async (pinInput) => {
        const locked = get().sessionLocked;
        if (!locked) return false;
        const verified = await get().verifyPin(pinInput, locked.userId);
        if (!verified) return false;
        try { localStorage.removeItem(SESSION_LOCK_KEY); } catch { /* noop */ }
        set({ sessionLocked: null });
        void logEvent('AUTH', 'SESION_DESBLOQUEADA', `${locked.userName} desbloqueó su sesión`, verified);
        return true;
    },

    // Ficha la entrada del turno del cajero en curso.
    clockIn: () => {
        const user = get().usuarioActivo;
        if (!user || user.rol !== 'CAJERO') return false;
        const clockInAt = new Date().toISOString();
        const shift = { userId: user.id, clockInAt };
        try { localStorage.setItem(SHIFT_KEY, JSON.stringify(shift)); } catch { /* noop */ }
        set({ shift, clockInOffer: null });
        void logEvent('AUTH', 'TURNO_INICIADO', `${user.nombre} fichó entrada de turno`, user, { clockInAt });
        return true;
    },

    clearClockInOffer: () => set({ clockInOffer: null }),

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
        if (!['DISCOUNT', 'CHANGE_SEDE', 'VOID_SALE'].includes(action)) throw new Error('Acción administrativa inválida.');
        const context = captureStorageContext();
        const actor = get().usuarioActivo;
        if (action === 'DISCOUNT' && !actor) return null;
        if (action === 'VOID_SALE' && !actor) return null;
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
            || !isOwner(approver) || (approver.credentialVersion || 0) !== proof.approver.credentialVersion) return null;
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
        const strong = await strongPinRecord(nuevoPin);
        if (!pinResetGrace || pinResetGrace.token !== token) throw new Error('La solicitud de recuperación cambió. Reintenta.');
        if (epoch !== authEpoch || !isStorageContextActive(context)) throw new Error('La sesión cambió durante el restablecimiento.');
        approvals.clear();
        pinResetGrace = null;
        set(state => ({ usuarios: state.usuarios.map(u => u.id === owner.id
            ? { ...u, ...strong, credentialVersion: (u.credentialVersion || 0) + 1, updatedAt: new Date().toISOString() } : u) }));
        pushUsersSoon();
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
        const strong = await strongPinRecord(nuevoPin);
        if (epoch !== authEpoch || !isStorageContextActive(context) || get().usuarioActivo?.id !== actor.id) throw new Error('La sesión cambió durante la actualización del PIN.');
        approvals.clear();
        set(state => ({ usuarios: state.usuarios.map(u => u.id === userId
            ? { ...u, ...strong, factoryPin: isFactoryPin(String(nuevoPin)), credentialVersion: (u.credentialVersion || 0) + 1, updatedAt: new Date().toISOString() } : u) }));
        void logEvent('AUTH', 'PIN_CAMBIADO', `PIN cambiado para ${target.nombre || 'usuario'}`, actor, null, context);
        pushUsersSoon();
        if (actor.id === userId) get().logout('PIN actualizado');
    },

    quitarPin: async (userId) => {
        const actor = get().usuarioActivo;
        requireOwner(actor);
        const target = get().usuarios.find(u => u.id === userId);
        if (!target || target.rol !== 'CAJERO') throw new Error('Solo se puede quitar el PIN a un cajero.');
        if (target.sinPin === true && !target.pin) throw new Error('Este cajero ya no tiene PIN.');
        const context = captureStorageContext();
        const epoch = authEpoch;
        if (epoch !== authEpoch || !isStorageContextActive(context) || get().usuarioActivo?.id !== actor.id) throw new Error('La sesión cambió durante la actualización.');
        approvals.clear();
        set(state => ({ usuarios: state.usuarios.map(u => u.id === userId
            ? { ...u, pin: null, pinHashed: false, pinSalt: null, sinPin: true, factoryPin: false, credentialVersion: (u.credentialVersion || 0) + 1, updatedAt: new Date().toISOString() } : u) }));
        pushUsersSoon();
        // El dueño quitó el PIN en este equipo: activar el acceso sin PIN aquí mismo
        // para que "quitar PIN" funcione como se espera. El opt-in sigue siendo por
        // equipo: otros dispositivos requieren su propia activación.
        setPinlessOptIn(userId, context, true);
        void logEvent('AUTH', 'PIN_ELIMINADO', `PIN eliminado para ${target.nombre || 'usuario'} (acceso sin PIN)`, actor, null, context);
    },

    agregarUsuario: async (nombre, rol, pin, sedeId = getActiveSedeId()) => {
        requireOwner(get().usuarioActivo);
        if (!nombre?.trim() || !['DUENO', 'CAJERO'].includes(rol)) throw new Error('Nombre o rol inválido.');
        if (rol === 'CAJERO' && !['central', 'norte', 'sur'].includes(sedeId)) throw new Error('Sede inválida.');
        // Regla de fábrica: los cajeros SIEMPRE se crean sin PIN; el dueño lo
        // configura después con "Cambiar PIN" o activa el acceso sin PIN por
        // equipo. Un cajero sin PIN queda con sinPin=true y sin hash.
        // Funciona con o sin cuenta cloud (el opt-in pinless es por dispositivo).
        const pinlessCashier = rol === 'CAJERO';
        if (rol === 'DUENO' && !new RegExp(`^\\d{${pinLength({ rol })}}$`).test(String(pin))) throw new Error('El dueño requiere un PIN válido.');
        const epoch = authEpoch;
        const context = captureStorageContext();
        const strong = pinlessCashier ? { pin: null, sinPin: true } : await strongPinRecord(pin);
        if (epoch !== authEpoch || !isStorageContextActive(context)) throw new Error('La sesión cambió.');
        requireOwner(get().usuarioActivo);
        const newUserId = Math.max(0, ...get().usuarios.map(u => Number(u.id) || 0)) + 1;
        set(state => ({ usuarios: [...state.usuarios, {
            id: newUserId, syncId: newSyncId(),
            nombre: nombre.trim(), rol, ...strong, factoryPin: pinlessCashier ? false : isFactoryPin(String(pin)),
            sedeId: rol === 'CAJERO' ? sedeId : null, credentialVersion: 0,
            updatedAt: new Date().toISOString(),
        }] }));
        pushUsersSoon();
        // Cajero creado sin PIN por el dueño en este equipo: activar el acceso sin
        // PIN aquí mismo para que pueda entrar sin un segundo paso manual.
        if (pinlessCashier) setPinlessOptIn(newUserId, context, true);
        void logEvent('USUARIO', 'USUARIO_CREADO', `Usuario ${nombre} (${rol}) creado`, get().usuarioActivo);
    },

    eliminarUsuario: userId => {
        requireOwner(get().usuarioActivo);
        const target = get().usuarios.find(u => u.id === userId);
        if (!target || target.id === 1 || target.permanente || get().usuarioActivo.id === userId) return false;
        approvals.clear();
        set(state => ({ usuarios: state.usuarios.filter(u => u.id !== userId) }));
        void logEvent('USUARIO', 'USUARIO_ELIMINADO', `Usuario ${target.nombre} eliminado`, get().usuarioActivo);
        pushUsersSoon();
        return true;
    },

    editarUsuario: (userId, datos) => {
        requireOwner(get().usuarioActivo);
        const target = get().usuarios.find(u => u.id === userId);
        if (!target) throw new Error('Usuario no encontrado.');
        const changes = Object.fromEntries(Object.entries(datos).filter(([key]) => ['nombre', 'rol', 'sedeId'].includes(key)));
        const updated = { ...target, ...changes };
        if (target.id === 1 || target.permanente) updated.rol = 'DUENO';
        if (!['DUENO', 'CAJERO'].includes(updated.rol)
            || (updated.rol === 'CAJERO' && !['central', 'norte', 'sur'].includes(updated.sedeId))) throw new Error('Rol o sede inválido.');
        if (updated.rol !== 'CAJERO') updated.sedeId = null;
        updated.credentialVersion = (target.credentialVersion || 0) + 1;
        updated.updatedAt = new Date().toISOString();
        approvals.clear();
        set(state => ({ usuarios: state.usuarios.map(u => u.id === userId ? updated : u) }));
        pushUsersSoon();
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
            isOwner(u) && u.pin === '1234' ? { ...u, pin: '123456' } : u);
        if (fromVersion < 2 && state.usuarios) state.usuarios = state.usuarios.map(u =>
            u.pinHashed === undefined ? { ...u, pinHashed: false } : u);
        if (fromVersion < 3 && state.usuarios) state.usuarios = migrateOwnerPinToFactory(state.usuarios);
        return state;
    },
    merge: (persisted, current) => {
        authEpoch += 1;
        approvals.clear();
        const clean = sanitizeBackup(persisted || {});
        const usuarios = ensureSyncIds(normalizeUsersOnBoot(clean.usuarios || current.usuarios));
        const requireLogin = clean.requireLogin === true;
        const session = readOperatorSession(usuarios, captureStorageContext(), requireLogin);
        // Restaura el bloqueo de sesión si sigue siendo el mismo operador;
        // si no, la llave huérfana se descarta.
        let sessionLocked = null;
        try {
            const raw = localStorage.getItem(SESSION_LOCK_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed?.userId && session?.user?.id === parsed.userId) {
                sessionLocked = { userId: parsed.userId, userName: session.user.nombre, rol: session.user.rol,
                    at: parsed.at || null, reason: parsed.reason || 'sesión' };
            } else if (raw) {
                try { localStorage.removeItem(SESSION_LOCK_KEY); } catch { /* noop */ }
            }
        } catch { /* llave corrupta: se ignora el bloqueo */ }
        let shift = null;
        try {
            const raw = localStorage.getItem(SHIFT_KEY);
            const parsed = raw ? JSON.parse(raw) : null;
            if (parsed?.userId && parsed?.clockInAt && session?.user?.id === parsed.userId) shift = parsed;
        } catch { /* turno corrupto: se ignora */ }
        return { ...current, usuarios, requireLogin, adminEmail: typeof clean.adminEmail === 'string' ? clean.adminEmail : '',
            usuarioActivo: session?.user || null, operatorSession: session, sessionLocked, shift };
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

// Push best-effort del documento de usuarios a la nube tras cada mutación del
// store. Grafo acíclico: accountDocs no importa el store ni el motor de sync;
// recibe todo inyectado.
function pushUsersSoon() {
    void pushUsersDoc({
        getState: useAuthStore.getState,
        setState: partial => useAuthStore.setState(partial),
        push: pushCloudSync,
    }).catch(() => {});
}
