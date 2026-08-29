import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SEDE_ID, getVisibleSedes } from '../../config/sedes';

export const useSedeStore = create(
    persist(
        (set, get) => ({
            sedeActivaId: DEFAULT_SEDE_ID,
            setSedeActiva: (sedeId, usuario) => {
                const allowed = getVisibleSedes(usuario).some(sede => sede.id === sedeId);
                if (allowed) set({ sedeActivaId: sedeId });
            },
            syncWithUser: (usuario) => {
                const visible = getVisibleSedes(usuario);
                const current = visible.some(sede => sede.id === get().sedeActivaId)
                    ? get().sedeActivaId
                    : visible[0].id;
                if (current !== get().sedeActivaId) set({ sedeActivaId: current });
                return current;
            },
        }),
        { name: 'farmacia-sede-storage', partialize: state => ({ sedeActivaId: state.sedeActivaId }) }
    )
);
