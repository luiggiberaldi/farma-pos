import { captureStorageContext } from '../config/storageScope.js';

const blockers = new Map();
const operations = new Map();

// Same-tab coordination only; it does not replace an IndexedDB transaction.
export function registerContextBlocker(check) {
    const id = Symbol('context-blocker');
    blockers.set(id, check);
    return () => blockers.delete(id);
}

export function getContextChangeBlockReason() {
    if (operations.size) return 'Hay una operación en curso. Espera su resultado antes de cambiar de sede.';
    for (const check of blockers.values()) {
        const reason = check();
        if (reason) return reason;
    }
    return null;
}

export function hasPendingLocalWrites() {
    return [...operations.values()].some(operation => !['CHANGE_SEDE'].includes(operation.label));
}

export function assertContextChangeAllowed() {
    const reason = getContextChangeBlockReason();
    if (reason) throw new Error(reason);
}

export function assertLocalOperationAllowed() {
    if ([...operations.values()].some(operation => ['CHANGE_SEDE', 'RESTORE_BACKUP', 'RECOVER_INVENTORY'].includes(operation.label))) {
        throw new Error('Hay un cambio de sede o restauración en curso. Espera antes de operar.');
    }
}

export function beginLocalOperation(label, context = captureStorageContext()) {
    assertLocalOperationAllowed();
    const id = Symbol(label);
    operations.set(id, { label, context });
    return () => operations.delete(id);
}
