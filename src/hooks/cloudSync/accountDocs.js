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
 * cuenta. (Tasa y negocio se agregan en sus fases.)
 */
export async function applyAccountDocFromCloud(cloudKey, payload, cloudUpdatedAt, deps) {
    if (cloudKey === USER_DOC_KEY) {
        await applyUsersFromCloud(payload, deps);
    }
    // RATE_DOC_KEY / BUSINESS_DOC_KEY → fases C y D.
}

export { sanitizeAuthEnvelopeForCloud } from './accountSync.js';
