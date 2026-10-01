/**
 * accountDocs.js — Orquestación con side effects de los documentos propios a
 * nivel de cuenta (usuarios, política de tasa, datos del negocio).
 *
 * Diseño: este módulo NO importa el store ni el motor de sync (grafo
 * acíclico). Recibe `{ getState, setState, push }` inyectados:
 * - En producción los proveen useAuthStore / useCloudSync.
 * - En tests se inyectan fakes (sin harness pesado).
 *
 * - `pushUsersDoc()` endurece PINs en texto plano (hash PBKDF2 proactivo,
 *   sin tocar credentialVersion para no cerrar la sesión activa) antes de
 *   subir: la nube jamás ve un PIN legible.
 * - `applyUsersFromCloud()` reconcilia (merge por syncId + dedup por
 *   identidad) y propaga la convergencia.
 */
import { hashPinPbkdf2, generatePinSalt } from '../../utils/pinCrypto.js';
import {
    USER_DOC_KEY,
    ensureSyncIds, sanitizeUsersForCloud, sanitizeIncomingUsers, reconcileUsers,
    canonicalUser,
} from './accountSync.js';
import {
    RATE_DOC_KEY,
    sanitizeRatePolicy, canEditRatePolicy, describeRatePolicy, isTimestampNewer,
} from './accountSync.js';
import {
    BUSINESS_DOC_KEY,
    sanitizeBusinessDoc, mergeBusinessDocs,
} from './accountSync.js';
// NOTA: logEvent se resuelve por import dinámico (auditService usa imports sin
// extensión que solo el bundler resuelve) o se inyecta como `audit` en tests.

// Réplica de strongPinRecord (useAuthStore, privada): formato fuerte PBKDF2.
async function strongPinRecord(pin) {
    const pinSalt = await generatePinSalt();
    return { pin: await hashPinPbkdf2(pin, pinSalt), pinSalt, pinKdf: 'pbkdf2', pinHashed: true, sinPin: false };
}

/**
 * Sube el documento de usuarios. Antes: asigna syncId a quien no tenga y
 * hashea en el store local cualquier PIN que siga en texto plano (migración
 * proactiva del formato; no toca credentialVersion → no cierra sesión).
 * Best-effort: nunca lanza.
 *
 * @param {{getState: () => {usuarios: Array}, setState: (p: object) => void, push: (key: string, value: any, bypass: boolean) => Promise<any>}} deps
 */
export async function pushUsersDoc({ getState, setState, push } = {}) {
    try {
        let usuarios = ensureSyncIds(getState().usuarios || []);
        let changed = usuarios !== (getState().usuarios || []);
        const next = [];
        for (const u of usuarios) {
            if (u?.pin && u.pinHashed !== true && u.sinPin !== true) {
                const strong = await strongPinRecord(u.pin);
                next.push({ ...u, ...strong });
                changed = true;
            } else {
                next.push(u);
            }
        }
        if (changed) {
            setState({ usuarios: next });
            usuarios = next;
        }
        return await push(USER_DOC_KEY, sanitizeUsersForCloud(usuarios), true);
    } catch {
        return undefined;
    }
}

/**
 * Aplica el documento de usuarios que llegó de la nube: reconcilia con el
 * estado local (adopción por identidad + merge LWW por syncId) y, si hubo
 * cambios, propaga la convergencia de vuelta a la nube (el hash-dedup del
 * motor evita pushes redundantes).
 * Devuelve true si el estado local cambió.
 */
export async function applyUsersFromCloud(payload, { getState, setState, push } = {}) {
    const incoming = sanitizeIncomingUsers(payload);
    if (!incoming) return false;
    const current = getState().usuarios || [];
    const merged = reconcileUsers(current, incoming);
    // Comparación canónica: el orden de las claves no es un cambio.
    const norm = arr => JSON.stringify((arr || []).map(canonicalUser));
    if (norm(merged) === norm(current)) return false;
    setState({ usuarios: merged });
    await pushUsersDoc({ getState, setState, push });
    return true;
}

/**
 * Dispatcher de _applyFromCloud para los documentos propios a nivel de
 * cuenta. (Negocio se agrega en la fase D.)
 */
export async function applyAccountDocFromCloud(cloudKey, payload, cloudUpdatedAt, deps) {
    if (cloudKey === USER_DOC_KEY) {
        await applyUsersFromCloud(payload, deps);
        return;
    }
    if (cloudKey === RATE_DOC_KEY) {
        await applyRatePolicyFromCloud(payload, cloudUpdatedAt);
        return;
    }
    if (cloudKey === BUSINESS_DOC_KEY) {
        await applyBusinessFromCloud(payload, cloudUpdatedAt);
    }
}

export { sanitizeAuthEnvelopeForCloud } from './accountSync.js';

// ─── Política de tasa (Fase C) ──────────────────────────────────────────────

const RATE_TS_KEY = '_rate_policy_ts';         // ISO del último cambio aplicado/publicado
const RATE_LOCAL_KEY = '_rate_policy_local';   // snapshot JSON para reintento offline
const RATE_PENDING_KEY = '_rate_policy_pending'; // '1' = hay push pendiente por reintentar

function safeGet(k) {
    try { return localStorage.getItem(k); } catch { return null; }
}
function safeSet(k, v) {
    try { localStorage.setItem(k, v); } catch { /* almacenamiento no disponible */ }
}
function dispatchRateStorageEvent(key, newValue) {
    try {
        // En el navegador: StorageEvent real. En node (tests): objeto plano
        // con key/newValue, que es lo único que lee ProductContext.
        const evt = typeof StorageEvent !== 'undefined'
            ? new StorageEvent('storage', { key, newValue: String(newValue ?? '') })
            : { type: 'storage', key, newValue: String(newValue ?? '') };
        window.dispatchEvent(evt);
    } catch { /* entorno sin DOM */ }
}

/** Lee la política de tasa efectiva del localStorage. */
export function readRatePolicyLocal() {
    const mode = safeGet('bodega_rate_mode') || 'bcv';
    const manualRate = safeGet('bodega_custom_rate') || '';
    return sanitizeRatePolicy({ mode, manualRate });
}

/**
 * Escribe la política en localStorage y avisa a ProductContext en esta
 * pestaña con StorageEvents sintéticos (bodega_rate_mode y
 * bodega_custom_rate; NUNCA bodega_use_auto_rate: su handler mapearía
 * euro→bcv).
 */
function writeRatePolicyLocal(policy, ts) {
    safeSet('bodega_rate_mode', policy.mode);
    safeSet('bodega_use_auto_rate', JSON.stringify(policy.mode !== 'manual'));
    if (policy.mode === 'manual') {
        if (policy.manualRate) safeSet('bodega_custom_rate', String(policy.manualRate));
    } else {
        try { localStorage.removeItem('bodega_custom_rate'); } catch { /* noop */ }
    }
    safeSet(RATE_TS_KEY, ts);
    safeSet(RATE_LOCAL_KEY, JSON.stringify(policy));
    dispatchRateStorageEvent('bodega_rate_mode', policy.mode);
    if (policy.mode === 'manual') dispatchRateStorageEvent('bodega_custom_rate', policy.manualRate || '');
}

/**
 * Publica un cambio de tasa del dueño: escribe local, audita y sube a la
 * nube con bypass (propagación inmediata). Gate duro: solo DUENO.
 * Si el push falla (offline), queda marcado para reintento en el fast-lane.
 */
export async function publishRatePolicy({ mode, manualRate } = {}, { getState, push, audit } = {}) {
    const me = getState?.()?.usuarioActivo;
    if (!canEditRatePolicy(me?.rol)) return { status: 'denied' };
    const prev = readRatePolicyLocal();
    const now = new Date().toISOString();
    const next = sanitizeRatePolicy({
        mode, manualRate: mode === 'manual' ? manualRate : '',
        updatedAt: now, updatedBy: me?.id ?? null, updatedByName: me?.nombre || '',
    });
    if (!next) return { status: 'invalid' };
    if (prev && prev.mode === next.mode && prev.manualRate === next.manualRate) {
        return { status: 'unchanged', policy: prev };
    }
    writeRatePolicyLocal(next, now);
    try {
        const auditFn = audit || (await import('../../services/auditService.js')).logEvent;
        await auditFn('TASA', 'TASA_ACTUALIZADA',
            `Tasa de ${describeRatePolicy(prev)} a ${describeRatePolicy(next)} por ${me?.nombre || 'dueño'}`);
    } catch { /* auditoría best-effort */ }
    try {
        await push(RATE_DOC_KEY, next, true);
        try { localStorage.removeItem(RATE_PENDING_KEY); } catch { /* noop */ }
    } catch {
        safeSet(RATE_PENDING_KEY, '1');
    }
    return { status: 'ok', policy: next };
}

/**
 * Aplica la política de tasa que llegó de la nube (LWW por updatedAt).
 * Devuelve true si se aplicó.
 */
export async function applyRatePolicyFromCloud(payload, cloudUpdatedAt) {
    const incoming = sanitizeRatePolicy(payload);
    if (!incoming) return false;
    const incomingTs = incoming.updatedAt || cloudUpdatedAt || '';
    const localTs = safeGet(RATE_TS_KEY) || '';
    if (!isTimestampNewer(incomingTs, localTs)) return false;
    writeRatePolicyLocal(incoming, incomingTs);
    return true;
}

/**
 * Chequeo two-way genérico de un documento de cuenta: si la nube trae algo
 * más nuevo lo aplica; si quedó un push pendiente (offline) lo reintenta.
 * Respeta pestaña visible, red y sesión activa.
 */
async function pollAccountDocOnce({ docKey, tsKey, pendingKey, localKey, apply, getState, pull, push }) {
    try {
        if (typeof document !== 'undefined' && document.hidden) return { status: 'skipped' };
        if (typeof navigator !== 'undefined' && !navigator.onLine) return { status: 'skipped' };
        if (!getState?.()?.usuarioActivo) return { status: 'skipped' };
        let remote = null;
        try {
            remote = await pull(docKey);
        } catch {
            return { status: 'error' };
        }
        const localTs = safeGet(tsKey) || '';
        const remoteTs = remote?.updatedAt || remote?.payload?.updatedAt || '';
        if (remote?.payload && isTimestampNewer(remoteTs, localTs)) {
            const applied = await apply(remote.payload, remote.updatedAt);
            return { status: applied ? 'applied' : 'in-sync' };
        }
        if (safeGet(pendingKey) === '1' && localTs && !isTimestampNewer(remoteTs, localTs)) {
            let snap = null;
            try { snap = JSON.parse(safeGet(localKey)); } catch { /* snapshot corrupto */ }
            if (snap) {
                try {
                    await push(docKey, snap, true);
                    try { localStorage.removeItem(pendingKey); } catch { /* noop */ }
                    return { status: 'republished' };
                } catch {
                    return { status: 'pending' };
                }
            }
        }
        return { status: 'in-sync' };
    } catch {
        return { status: 'error' };
    }
}

/**
 * Chequeo two-way del fast-lane para la tasa.
 */
export function pollRatePolicyOnce(deps = {}) {
    return pollAccountDocOnce({
        ...deps,
        docKey: RATE_DOC_KEY, tsKey: RATE_TS_KEY, pendingKey: RATE_PENDING_KEY, localKey: RATE_LOCAL_KEY,
        apply: (p, ts) => applyRatePolicyFromCloud(p, ts),
    });
}

/**
 * Fast-lane de documentos de cuenta: chequea tasa y negocio cada 5 min + al
 * volver visible la pestaña + uno inmediato al arrancar. Devuelve stop.
 * Se inicia desde App.jsx junto a useCloudSync.
 */
export function startAccountDocsFastLane({ getState, pull, push } = {}) {
    let timer = null;
    let inFlight = false;
    const tick = async () => {
        if (inFlight) return;
        inFlight = true;
        try {
            await pollRatePolicyOnce({ getState, pull, push });
            await pollBusinessOnce({ getState, pull, push });
        } finally {
            inFlight = false;
        }
    };
    const onVisible = () => {
        if (typeof document !== 'undefined' && document.visibilityState === 'visible') void tick();
    };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', onVisible);
    if (typeof setInterval !== 'undefined') timer = setInterval(tick, 5 * 60 * 1000);
    void tick();
    return () => {
        if (timer) clearInterval(timer);
        if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVisible);
    };
}

// ─── Datos del negocio (Fase D) ─────────────────────────────────────────────

const BUSINESS_TS_KEY = '_business_ts';           // ISO del último cambio aplicado/publicado
const BUSINESS_LOCAL_KEY = '_business_local';     // snapshot JSON para reintento offline
const BUSINESS_PENDING_KEY = '_business_pending'; // '1' = hay push pendiente por reintentar

const BUSINESS_LS_KEYS = {
    name: 'business_name',
    address: 'business_address',
    phone: 'business_phone',
    instagram: 'business_instagram',
};

/** Lee el doc de negocio efectivo del localStorage. */
export function readBusinessLocal() {
    const doc = { fieldTs: {} };
    for (const [f, k] of Object.entries(BUSINESS_LS_KEYS)) doc[f] = safeGet(k) || '';
    doc.cashea_enabled = safeGet('cashea_enabled') === 'true';
    try {
        const snap = JSON.parse(safeGet(BUSINESS_LOCAL_KEY) || 'null');
        if (snap && typeof snap.fieldTs === 'object') doc.fieldTs = snap.fieldTs;
    } catch { /* sin snapshot previo */ }
    doc.updatedAt = safeGet(BUSINESS_TS_KEY) || '';
    return sanitizeBusinessDoc(doc);
}

function writeBusinessLocal(doc) {
    const clean = sanitizeBusinessDoc(doc);
    if (!clean) return;
    for (const [f, k] of Object.entries(BUSINESS_LS_KEYS)) safeSet(k, clean[f]);
    safeSet('cashea_enabled', clean.cashea_enabled ? 'true' : 'false');
    safeSet(BUSINESS_TS_KEY, clean.updatedAt);
    safeSet(BUSINESS_LOCAL_KEY, JSON.stringify(clean));
}

/**
 * Publica cambios del dueño en los datos del negocio. `changedFields` lleva
 * solo los campos editados (el resto se conserva del estado local); cada
 * campo publicado queda marcado con su timestamp para el merge por campo.
 * Gate duro: solo DUENO. Push bypass inmediato; si falla queda pendiente.
 */
export async function publishBusinessDoc(changedFields = {}, { getState, push, audit } = {}) {
    const me = getState?.()?.usuarioActivo;
    if (me?.rol !== 'DUENO') return { status: 'denied' };
    const prev = readBusinessLocal();
    const now = new Date().toISOString();
    const next = { ...prev, fieldTs: { ...prev.fieldTs }, updatedAt: now, updatedByName: me?.nombre || '' };
    let touched = false;
    for (const f of ['name', 'address', 'phone', 'instagram']) {
        if (changedFields[f] !== undefined) {
            next[f] = String(changedFields[f] ?? '');
            next.fieldTs[f] = now;
            touched = true;
        }
    }
    if (changedFields.cashea_enabled !== undefined) {
        next.cashea_enabled = changedFields.cashea_enabled === true;
        next.fieldTs.cashea_enabled = now;
        touched = true;
    }
    if (!touched) return { status: 'unchanged' };
    const clean = sanitizeBusinessDoc(next);
    writeBusinessLocal(clean);
    try {
        const auditFn = audit || (await import('../../services/auditService.js')).logEvent;
        await auditFn('NEGOCIO', 'DATOS_NEGOCIO_ACTUALIZADOS',
            `Datos del negocio actualizados por ${me?.nombre || 'dueño'}`);
    } catch { /* auditoría best-effort */ }
    try {
        await push(BUSINESS_DOC_KEY, clean, true);
        try { localStorage.removeItem(BUSINESS_PENDING_KEY); } catch { /* noop */ }
    } catch {
        safeSet(BUSINESS_PENDING_KEY, '1');
    }
    return { status: 'ok', doc: clean };
}

/**
 * Aplica el doc de negocio que llegó de la nube con merge por campo
 * (vacío entrante nunca borra local no-vacío). Devuelve true si cambió algo.
 */
export async function applyBusinessFromCloud(payload, cloudUpdatedAt) {
    const incoming = sanitizeBusinessDoc(payload);
    if (!incoming) return false;
    if (!incoming.updatedAt && cloudUpdatedAt) incoming.updatedAt = String(cloudUpdatedAt);
    const local = readBusinessLocal();
    const { doc, changed } = mergeBusinessDocs(local, incoming);
    if (!changed) return false;
    writeBusinessLocal(doc);
    return true;
}

/** Chequeo two-way del fast-lane para los datos del negocio. */
export function pollBusinessOnce(deps = {}) {
    return pollAccountDocOnce({
        ...deps,
        docKey: BUSINESS_DOC_KEY, tsKey: BUSINESS_TS_KEY, pendingKey: BUSINESS_PENDING_KEY, localKey: BUSINESS_LOCAL_KEY,
        apply: (p, ts) => applyBusinessFromCloud(p, ts),
    });
}
