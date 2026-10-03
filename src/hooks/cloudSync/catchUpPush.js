/**
 * Catch-up push resiliente para la sincronización V2.
 *
 * Sube los datos locales que la nube aún no tiene tras el pull inicial.
 * A diferencia del fire-and-forget anterior, este módulo:
 *  - NO aborta si la pestaña está oculta o sin red: espera (con tope) a que
 *    vuelva a ser visible / online en vez de descartar todo el trabajo.
 *  - NO aborta todo si una llave falla: registra el error, continúa con las
 *    demás y deja el catch-up marcado como incompleto para reintentar.
 *  - Persiste el completado por cuenta en localStorage, de modo que un
 *    catch-up interrumpido se reintenta en el próximo arranque (o al volver
 *    la pestaña visible) en vez de perderse para siempre.
 */

export const CATCHUP_DONE_PREFIX = 'farmapos_catchup_done_';
const CATCHUP_WAIT_DEFAULT_MS = 30000;

export function catchUpDoneKey(accountId) {
    return `${CATCHUP_DONE_PREFIX}${accountId || ''}`;
}

export function isCatchUpComplete(accountId) {
    try {
        if (!accountId || typeof localStorage === 'undefined') return false;
        return localStorage.getItem(catchUpDoneKey(accountId)) === '1';
    } catch {
        return false;
    }
}

export function markCatchUpComplete(accountId) {
    try {
        if (!accountId || typeof localStorage === 'undefined') return;
        localStorage.setItem(catchUpDoneKey(accountId), '1');
    } catch {
        // best-effort
    }
}

export function clearCatchUpComplete(accountId) {
    try {
        if (!accountId || typeof localStorage === 'undefined') return;
        localStorage.removeItem(catchUpDoneKey(accountId));
    } catch {
        // best-effort
    }
}

function waitForOnline(timeoutMs) {
    if (typeof navigator !== 'undefined' && navigator.onLine) return Promise.resolve(true);
    return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try { window.removeEventListener('online', onOnline); } catch {}
            clearTimeout(timer);
            resolve(ok);
        };
        const onOnline = () => finish(true);
        try { window.addEventListener('online', onOnline); } catch {}
        const timer = setTimeout(() => finish(false), timeoutMs);
        // Re-chequear por si cambió entre la lectura y el listener
        try { if (navigator.onLine) finish(true); } catch {}
    });
}

function waitForVisible(timeoutMs) {
    const isVisible = () => {
        try { return document.visibilityState === 'visible'; } catch { return true; }
    };
    if (isVisible()) return Promise.resolve(true);
    return new Promise((resolve) => {
        let done = false;
        const finish = (ok) => {
            if (done) return;
            done = true;
            try { document.removeEventListener('visibilitychange', onChange); } catch {}
            clearTimeout(timer);
            resolve(ok);
        };
        const onChange = () => { if (isVisible()) finish(true); };
        try { document.addEventListener('visibilitychange', onChange); } catch {}
        const timer = setTimeout(() => finish(false), timeoutMs);
        if (isVisible()) finish(true);
    });
}

/**
 * Ejecuta el catch-up push de forma resiliente.
 *
 * @param {Object} opts
 * @param {string} opts.userId - UID de la cuenta (para la bandera persistente).
 * @param {string[]} opts.keys - Llaves a subir (SYNC_KEYS).
 * @param {(key: string) => Promise<any>} opts.readLocal - Lee el valor local de una llave (null si no existe).
 * @param {Set<string>} opts.cloudDocIds - Llaves que la nube ya tiene (del pull).
 * @param {() => boolean} opts.isCurrent - false si esta ejecución fue invalidada.
 * @param {(key: string, value: any) => Promise<{status:string,code?:string}|undefined>} opts.pushFn - Equivalente a pushCloudSync(key, val, true).
 * @param {() => Promise<void>} opts.pushUsersDoc - Sube el documento propio de usuarios.
 * @param {number} [opts.spacingMs=1000] - Pausa entre llaves.
 * @param {number} [opts.waitMs=30000] - Tope de espera por visibilidad/red.
 * @param {(msg: string) => void} [opts.log] - Logger (por defecto console.log).
 * @returns {Promise<{completed:boolean, reason?:string, pushed:number, skipped:number, errors:Array}>}
 */
export async function runCatchUpPush({
    userId,
    keys,
    readLocal,
    cloudDocIds,
    isCurrent,
    pushFn,
    pushUsersDoc,
    spacingMs = 1000,
    waitMs = CATCHUP_WAIT_DEFAULT_MS,
    log = (...args) => console.log('[CloudSync]', ...args),
}) {
    const errors = [];
    let pushed = 0;
    let skipped = 0;
    const checkCurrent = typeof isCurrent === 'function' ? isCurrent : () => true;

    log(`Catch-up push: iniciando para ${keys.length} llaves.`);

    for (const key of keys) {
        if (!checkCurrent()) {
            log('Catch-up push: ejecución invalidada, se reintentará.');
            return { completed: false, reason: 'superseded', pushed, skipped, errors };
        }
        // Red: esperar en vez de abortar.
        try {
            if (typeof navigator !== 'undefined' && !navigator.onLine) {
                log('Catch-up push: sin red, esperando...');
                const online = await waitForOnline(waitMs);
                if (!online) {
                    log('Catch-up push: sigue sin red, se reintentará.');
                    return { completed: false, reason: 'offline-timeout', pushed, skipped, errors };
                }
            }
        } catch { /* best-effort */ }
        // Visibilidad: esperar en vez de abortar.
        try {
            const visible = await waitForVisible(waitMs);
            if (!visible) {
                log('Catch-up push: pestaña oculta, se reintentará al volver visible.');
                return { completed: false, reason: 'hidden-timeout', pushed, skipped, errors };
            }
        } catch { /* best-effort */ }
        if (!checkCurrent()) {
            return { completed: false, reason: 'superseded', pushed, skipped, errors };
        }

        let val = null;
        try {
            val = await readLocal(key);
        } catch (e) {
            errors.push({ key, error: e?.message ?? String(e) });
            log(`Catch-up push: no se pudo leer ${key}, se continúa.`);
            continue;
        }
        if (val == null) {
            skipped++;
            continue;
        }
        // No subir arrays vacíos si la nube ya tiene datos para esta llave.
        // Previene que un dispositivo nuevo borre el inventario de la nube.
        if (Array.isArray(val) && val.length === 0 && cloudDocIds?.has(key)) {
            log(`Catch-up push: skip ${key} (local vacío, nube ya tiene datos).`);
            skipped++;
            continue;
        }
        try {
            const result = await pushFn(key, val);
            if (result?.code === 'SYNC_SEND_FAILED') {
                errors.push({ key, error: 'SYNC_SEND_FAILED' });
                log(`Catch-up push: ${key} falló el envío, se continúa y reintentará.`);
            } else {
                pushed++;
            }
        } catch (e) {
            errors.push({ key, error: e?.message ?? String(e) });
            log(`Catch-up push: error en ${key}, se continúa.`, e?.message ?? e);
        }
        if (spacingMs > 0) {
            await new Promise(r => setTimeout(r, spacingMs));
        }
    }

    // ── Documento propio de usuarios (no vive bajo su llave en el store) ──
    if (checkCurrent() && typeof pushUsersDoc === 'function') {
        try {
            await pushUsersDoc();
            log('Catch-up push: documento de usuarios procesado.');
        } catch (e) {
            errors.push({ key: 'bodega_users_v1', error: e?.message ?? String(e) });
            log('Catch-up push: documento de usuarios falló, se reintentará.');
        }
    }

    if (errors.length === 0 && checkCurrent()) {
        markCatchUpComplete(userId);
        log(`Catch-up push: completado (${pushed} subidas, ${skipped} omitidas).`);
        return { completed: true, pushed, skipped, errors };
    }
    log(`Catch-up push: incompleto (${errors.length} errores), se reintentará.`);
    return { completed: false, reason: errors.length ? 'key-errors' : 'superseded', pushed, skipped, errors };
}
