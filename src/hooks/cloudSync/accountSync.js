/**
 * accountSync.js — Lógica PURA (sin side effects) para los documentos propios
 * a nivel de cuenta: usuarios, política de tasa y datos del negocio.
 *
 * - `bodega_users_v1`: lista de usuarios con identidad estable (`syncId` UUID)
 *   que sobrevive a colisiones de `id` numérico entre equipos. Merge por
 *   `syncId` con last-writer-wins en (credentialVersion, updatedAt) y
 *   desempate determinista por contenido.
 * - `bodega_rate_policy_v1`: { mode, manualRate, updatedAt, updatedBy, ... }.
 * - `bodega_business_v1`: { name, address, phone, instagram, cashea_enabled, ... }.
 *
 * Higiene de credenciales: el PIN en texto plano JAMÁS sale del dispositivo.
 * Solo viajan hashes PBKDF2 (`pinHashed === true`). El hash proactivo se hace
 * en accountDocs.pushUsersDoc antes de cada push.
 *
 * Este módulo no toca localStorage, stores ni red: es testeable en node.
 */

// ─── Llaves de documento ────────────────────────────────────────────────────
export const USER_DOC_KEY = 'bodega_users_v1';
export const RATE_DOC_KEY = 'bodega_rate_policy_v1';
export const BUSINESS_DOC_KEY = 'bodega_business_v1';

export const RATE_MODES = Object.freeze(['bcv', 'euro', 'manual']);

// Campos de usuario que viajan a la nube. `id` (numérico local) y
// `permanente` son por equipo y nunca se sincronizan.
const SYNCED_USER_FIELDS = Object.freeze([
    'syncId', 'nombre', 'rol', 'sedeId', 'sinPin',
    'pin', 'pinSalt', 'pinKdf', 'pinHashed',
    'credentialVersion', 'updatedAt', 'factoryPin',
]);

// Orden canónico de campos: evita que el merge se vea como "cambio" en cada
// poll solo por el orden de las claves (el ganador puede ser el registro
// local o el de la nube, con distinto orden original).
export const USER_FIELD_ORDER = Object.freeze([
    'id', 'syncId', 'nombre', 'rol', 'sedeId', 'sinPin',
    'pin', 'pinSalt', 'pinKdf', 'pinHashed', 'factoryPin',
    'credentialVersion', 'updatedAt', 'permanente',
]);

export function canonicalUser(u) {
    if (!u || typeof u !== 'object') return u;
    const out = {};
    for (const f of USER_FIELD_ORDER) if (u[f] !== undefined) out[f] = u[f];
    for (const k of Object.keys(u)) if (!(k in out)) out[k] = u[k];
    return out;
}

export function newSyncId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `sync-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Garantiza que cada usuario tenga un `syncId` estable. No toca los que ya
 * tienen. Devuelve el mismo arreglo si no hubo cambios.
 */
export function ensureSyncIds(users) {
    if (!Array.isArray(users)) return users;
    let changed = false;
    const next = users.map(u => {
        if (u && typeof u.syncId === 'string' && u.syncId.length > 0) return u;
        changed = true;
        return { ...(u || {}), syncId: newSyncId() };
    });
    return changed ? next : users;
}

/**
 * Llave de identidad para deduplicar humanos: mismo rol + sede + nombre
 * normalizado. Se usa solo en la primera convergencia y como red de
 * seguridad anti split-brain (mismo humano, distinto syncId).
 */
export function identityKey(u) {
    const rol = String(u?.rol || '').trim().toUpperCase();
    const sede = String(u?.sedeId || '').trim().toLowerCase();
    const nombre = String(u?.nombre || '').trim().toLowerCase().normalize('NFC');
    return `${rol}|${sede}|${nombre}`;
}

/**
 * Sanitiza usuarios para SUBIR a la nube. Reglas:
 * - Solo campos conocidos.
 * - `pin` solo viaja si `pinHashed === true` (hash PBKDF2). En texto plano
 *   se elimina: la nube nunca ve un PIN legible.
 * - Sin `syncId` no se sincroniza (defensa).
 */
export function sanitizeUsersForCloud(users) {
    if (!Array.isArray(users)) return [];
    const out = [];
    for (const u of users) {
        if (!u || typeof u !== 'object') continue;
        if (typeof u.syncId !== 'string' || u.syncId.length === 0) continue;
        const clean = {};
        for (const f of SYNCED_USER_FIELDS) {
            if (u[f] !== undefined) clean[f] = u[f];
        }
        if (clean.pinHashed !== true) delete clean.pin;
        out.push(clean);
    }
    return out;
}

/**
 * Sanitiza usuarios que VIENEN de la nube (defensa: solo campos conocidos,
 * sin PINs en texto plano aunque la nube los trajera).
 * Devuelve null si el payload no es un arreglo.
 */
export function sanitizeIncomingUsers(payload) {
    if (!Array.isArray(payload)) return null;
    const out = [];
    for (const u of payload) {
        if (!u || typeof u !== 'object') continue;
        if (typeof u.syncId !== 'string' || u.syncId.length === 0) continue;
        const clean = {};
        for (const f of SYNCED_USER_FIELDS) {
            if (u[f] !== undefined) clean[f] = u[f];
        }
        if (clean.pinHashed !== true) delete clean.pin;
        out.push(clean);
    }
    return out;
}

/**
 * Orden total entre dos registros del MISMO syncId. >0 gana `a`, <0 gana
 * `b`, 0 idénticos. LWW en credentialVersion → updatedAt → desempate
 * determinista por contenido (todos los equipos deciden lo mismo).
 */
export function compareUserRecords(a, b) {
    const cvA = Number(a?.credentialVersion) || 0;
    const cvB = Number(b?.credentialVersion) || 0;
    if (cvA !== cvB) return cvA > cvB ? 1 : -1;
    const tA = String(a?.updatedAt || '');
    const tB = String(b?.updatedAt || '');
    if (tA !== tB) return tA > tB ? 1 : -1;
    const sA = JSON.stringify(a ?? null);
    const sB = JSON.stringify(b ?? null);
    if (sA === sB) return 0;
    return sA > sB ? 1 : -1;
}

/**
 * Merge por syncId con LWW. El ganador aporta los campos sincronizados; los
 * campos locales (`id`, `permanente`) se preservan del registro local.
 * Usuarios nuevos de la nube reciben un id numérico local (maxId + 1).
 * Usuarios locales sin syncId se conservan tal cual (defensa).
 */
export function mergeUsers(localUsers, cloudUsers) {
    const local = Array.isArray(localUsers) ? localUsers : [];
    const cloud = Array.isArray(cloudUsers) ? cloudUsers : [];
    const bySyncId = new Map();
    const noSyncId = [];
    let maxId = 0;
    for (const u of local) {
        const n = Number(u?.id) || 0;
        if (n > maxId) maxId = n;
        if (u?.syncId) bySyncId.set(u.syncId, u);
        else noSyncId.push({ ...(u || {}) });
    }
    const seen = new Set();
    const merged = [];
    for (const c of cloud) {
        if (!c || typeof c !== 'object' || !c.syncId) continue;
        const l = bySyncId.get(c.syncId);
        if (!l) {
            maxId += 1;
            merged.push(canonicalUser({ ...c, id: maxId }));
        } else {
            seen.add(c.syncId);
            const winner = compareUserRecords(l, c) >= 0 ? l : c;
            const keep = { ...winner, id: l.id };
            if (l.permanente !== undefined) keep.permanente = l.permanente;
            merged.push(canonicalUser(keep));
        }
    }
    for (const [syncId, l] of bySyncId) {
        if (!seen.has(syncId)) merged.push(canonicalUser({ ...(l || {}) }));
    }
    for (const u of noSyncId) merged.push(canonicalUser(u));
    return merged;
}

/**
 * Reconciliación completa local ↔ nube:
 * 1. Asigna syncId a usuarios locales sin identidad.
 * 2. Adopción por identidad: un local recién identificado adopta el syncId
 *    de su gemelo en la nube (primera convergencia, sin duplicar).
 * 3. Merge por syncId con LWW.
 * 4. Colapso anti split-brain: si el mismo humano quedó con dos syncIds
 *    distintos, gana el LWW y se conserva el id numérico local.
 */
export function reconcileUsers(localUsers, cloudUsers) {
    const local = Array.isArray(localUsers) ? localUsers : [];
    const cloud = sanitizeIncomingUsers(cloudUsers) || [];
    const hadSyncId = new Set();
    for (const u of local) if (u?.syncId) hadSyncId.add(u.syncId);
    let withIds = ensureSyncIds(local);
    const fresh = withIds.filter(u => !hadSyncId.has(u.syncId));
    const claimed = new Set(hadSyncId);
    const usedCloudIds = new Set();
    if (fresh.length > 0 && cloud.length > 0) {
        withIds = withIds.map(u => {
            if (!fresh.includes(u)) return u;
            const k = identityKey(u);
            const twin = cloud.find(c =>
                !usedCloudIds.has(c.syncId) && !claimed.has(c.syncId) && identityKey(c) === k);
            if (!twin) return u;
            usedCloudIds.add(twin.syncId);
            claimed.add(twin.syncId);
            return { ...u, syncId: twin.syncId };
        });
    }
    const localBySyncId = new Map(withIds.map(u => [u.syncId, u]));
    const merged = mergeUsers(withIds, cloud);
    // Colapso por identidad (split-brain)
    const groups = new Map();
    for (const u of merged) {
        const k = identityKey(u);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k).push(u);
    }
    const out = [];
    for (const [, g] of groups) {
        if (g.length === 1) { out.push(canonicalUser(g[0])); continue; }
        let winner = g[0];
        for (let i = 1; i < g.length; i++) {
            if (compareUserRecords(g[i], winner) > 0) winner = g[i];
        }
        const localTwin = g.map(m => localBySyncId.get(m.syncId)).find(Boolean);
        const keep = { ...winner };
        if (localTwin) {
            keep.id = localTwin.id;
            if (localTwin.permanente !== undefined) keep.permanente = localTwin.permanente;
        }
        out.push(canonicalUser(keep));
    }
    return out;
}

// ─── Higiene del sobre de auth (backup en la nube) ──────────────────────────

/**
 * Sanitiza el sobre `abasto-auth-storage` para el espejo de backup en la
 * nube: los PINs en texto plano se eliminan (solo viajan hashes PBKDF2).
 * Devuelve el string del sobre saneado (o el original si no es parseable).
 */
export function sanitizeAuthEnvelopeForCloud(raw) {
    if (typeof raw !== 'string' || !raw) return raw;
    try {
        const env = JSON.parse(raw);
        const state = env?.state;
        if (!state || !Array.isArray(state.usuarios)) return raw;
        const cleanUsers = state.usuarios.map(u => {
            if (!u || typeof u !== 'object') return u;
            if (u.pinHashed === true) return u;
            const { pin, ...rest } = u;
            return rest;
        });
        return JSON.stringify({ ...env, state: { ...state, usuarios: cleanUsers } });
    } catch {
        return raw;
    }
}


export function sanitizeRatePolicy(p) {
    if (!p || typeof p !== 'object') return null;
    if (!RATE_MODES.includes(p.mode)) return null;
    return {
        mode: p.mode,
        manualRate: String(p.manualRate ?? ''),
        updatedAt: String(p.updatedAt || ''),
        updatedBy: p.updatedBy ?? null,
        updatedByName: String(p.updatedByName || ''),
    };
}

/** true si el timestamp ISO `a` es más reciente que `b`. '' = desconocido (el más viejo). */
export function isTimestampNewer(a, b) {
    if (!a) return false;
    if (!b) return true;
    return a > b;
}

/** Solo el dueño puede cambiar la tasa (gate de UI + lógica). */
export function canEditRatePolicy(rol) {
    return rol === 'DUENO';
}

/** Descripción corta para auditoría ("de X a Y"). */
export function describeRatePolicy(p) {
    if (!p || typeof p !== 'object') return '—';
    if (p.mode === 'bcv') return 'Dólar BCV';
    if (p.mode === 'euro') return 'Euro BCV';
    if (p.mode === 'manual') return `Manual ${p.manualRate ? `${p.manualRate} Bs` : 'sin valor'}`;
    return '—';
}

// ─── Datos del negocio ──────────────────────────────────────────────────────

export function sanitizeBusinessDoc(b) {
    if (!b || typeof b !== 'object') return null;
    return {
        name: String(b.name ?? ''),
        address: String(b.address ?? ''),
        phone: String(b.phone ?? ''),
        instagram: String(b.instagram ?? ''),
        cashea_enabled: b.cashea_enabled === true,
        updatedAt: String(b.updatedAt || ''),
        updatedByName: String(b.updatedByName || ''),
    };
}
