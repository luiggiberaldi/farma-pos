import { create } from 'zustand';
import { SEDES, DEFAULT_SEDE_ID } from '../../config/sedes.js';
import { captureStorageContext, getActiveSedeId, assertStorageContextActive, setActiveSedeId, getStorageKeyForContext } from '../../config/storageScope.js';
import { useAuthStore } from './useAuthStore.js';
import { storageService } from '../../utils/storageService.js';
import { crearHuella } from '../../utils/huella.js';
import { logEvent } from '../../services/auditService.js';
import { assertContextChangeAllowed, beginLocalOperation } from '../../services/localOperationGuard.js';

const validSede = id => SEDES.some(sede => sede.id === id);

export const useSedeStore = create((set) => ({
    sedeActivaId: validSede(getActiveSedeId()) ? getActiveSedeId() : DEFAULT_SEDE_ID,

    // PIN authorization is checked here, not trusted from a caller-provided role.
    // Also used by the locked selector: approval never signs in the administrator.
    setSedeActiva: async (sedeId, { pin, approverId } = {}) => {
        if (!validSede(sedeId)) throw new Error('Sede inválida.');
        const context = captureStorageContext();
        const actor = useAuthStore.getState().usuarioActivo;
        if (actor?.rol === 'CAJERO') throw new Error('Un cajero no puede cambiar de sede.');
        if (sedeId === context.sedeId) return true;
        assertContextChangeAllowed();
        const draftRaw = localStorage.getItem(getStorageKeyForContext('bodega_pending_cart_v2', context));
        if (draftRaw) {
            let draft;
            try { draft = JSON.parse(draftRaw); } catch { throw new Error('El borrador actual necesita revisión antes de cambiar de sede.'); }
            if (!Array.isArray(draft?.items) || draft.items.length) throw new Error('Resuelve primero la cesta de la sede actual.');
        }
        const details = { from: context.sedeId, to: sedeId };
        const owner = useAuthStore.getState().usuarios.find(user => Number(user.id) === 1 && user.rol === 'DUENO');
        // El dueño ya autenticado con su PIN no necesita reingresarlo: la sesión
        // del store es la prueba. Otros casos siguen exigiendo el PIN del dueño.
        const actorIsOwner = !!actor && !!owner && actor.rol === 'DUENO' && String(actor.id) === String(owner.id);
        let approval = null;
        let approver = null;
        if (actorIsOwner) {
            approver = actor;
        } else {
            if (!owner || String(approverId) !== String(owner.id)) throw new Error('Solo el PIN del Dueño puede cambiar de sede.');
            approval = await useAuthStore.getState().issueApproval(pin, owner.id, { action: 'CHANGE_SEDE', details });
            if (!approval) return false;
            approver = approval.approver;
        }
        assertStorageContextActive(context);
        assertContextChangeAllowed();
        const release = beginLocalOperation('CHANGE_SEDE', context);
        try {
            const huella = await crearHuella({ tipo: 'CAMBIO_SEDE', usuario: actor || approver, context,
                detalle: { sedeAnterior: context.sedeId, sedeNueva: sedeId, aprobadorId: approver.id } });
            const history = await storageService.getItem('farmacia_sede_movimientos_v1', [], context);
            assertStorageContextActive(context);
            if (approval && !useAuthStore.getState().checkApproval(approval.id, 'CHANGE_SEDE', details)) throw new Error('La autorización de sede expiró.');
            await storageService.setItem('farmacia_sede_movimientos_v1', [{
                id: crypto.randomUUID(), tipo: 'CAMBIO_SEDE_AUTORIZADO', sedeAnterior: context.sedeId, sedeNueva: sedeId,
                usuarioId: actor?.id ?? null, aprobador: approver, huella,
            }, ...history], context);
            assertStorageContextActive(context);
            if (approval) useAuthStore.getState().consumeApproval(approval.id, 'CHANGE_SEDE', details);
            setActiveSedeId(sedeId);
            try { useAuthStore.getState().rebindSessionContext(); } catch (error) {
                setActiveSedeId(context.sedeId);
                throw error;
            }
            set({ sedeActivaId: sedeId });
            void logEvent('SISTEMA', 'SEDE_CAMBIADA', `Cambio de sede: ${context.sedeId} → ${sedeId}`, actor || approver,
                { sedeAnterior: context.sedeId, sedeNueva: sedeId, huella, aprobadorId: approver.id }, context);
            return true;
        } finally { release(); }
    },

    // Only mirror the canonical device context. Never derive a branch from a role
    // or silently overwrite it while React mounts a new operator.
    syncWithUser: () => {
        const sedeId = getActiveSedeId();
        if (!validSede(sedeId)) throw new Error('La sede del dispositivo no es válida.');
        set({ sedeActivaId: sedeId });
        return sedeId;
    },
}));
