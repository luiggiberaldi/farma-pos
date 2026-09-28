import { storageService } from './storageService.js';
import { captureStorageContext, assertStorageContextActive } from '../config/storageScope.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';

// Bind repository calls to the view that started them. An old async callback
// must not choose the new account/branch after its first await.
export function bindStorageContext(context = captureStorageContext()) {
    const pinned = Object.freeze({ ...context });
    const actor = useAuthStore.getState().usuarioActivo;
    const sessionId = useAuthStore.getState().operatorSession?.sessionId;
    const assertOwnerContext = () => {
        assertStorageContextActive(pinned);
        const active = useAuthStore.getState();
        if (active.usuarioActivo?.id !== actor?.id || active.usuarioActivo?.rol !== actor?.rol || active.operatorSession?.sessionId !== sessionId) {
            throw new Error('La sesión de esta vista ya no está activa.');
        }
    };
    return Object.freeze({
        context: pinned,
        assertActive: assertOwnerContext,
        getItem: (key, fallback = null) => storageService.getItem(key, fallback, pinned),
        transaction: (records, planner) => {
            assertOwnerContext();
            return storageService.transaction(records, values => { assertOwnerContext(); return planner(values); }, pinned);
        },
        setItem: (key, value) => {
            assertOwnerContext();
            return storageService.setItem(key, value, pinned);
        },
        removeItem: key => {
            assertOwnerContext();
            return storageService.removeItem(key, pinned);
        },
        getItemForSede: (key, sedeId, fallback = null) => storageService.getItemForSede(key, sedeId, fallback, pinned),
    });
}
