import React from 'react';
import { X, ShieldCheck } from 'lucide-react';
import { useAuthStore } from '../../hooks/store/useAuthStore.js';
import { useSedeStore } from '../../hooks/store/useSedeStore.js';
import { SEDES } from '../../config/sedes.js';
import LoginPinModal from './LoginPinModal';

export default function BranchPinModal({ targetSedeId, onClose }) {
    const users = useAuthStore(s => s.usuarios);
    const owner = users.find(user => Number(user.id) === 1 && user.rol === 'DUENO' && user.pin);
    const ownerExists = users.some(user => Number(user.id) === 1 && user.rol === 'DUENO');

    if (!targetSedeId) return null;
    if (owner) {
        return <LoginPinModal
            isOpen
            user={owner}
            forcePin
            purpose="sede"
            onClose={onClose}
            onSubmit={async pin => {
                const success = await useSedeStore.getState().setSedeActiva(targetSedeId, { pin, approverId: owner.id });
                if (success) onClose();
                return success;
            }}
        />;
    }

    return <div role="dialog" aria-modal="true" aria-labelledby="branch-auth-title" className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
        <div className="relative bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm border border-slate-200 dark:border-slate-700 shadow-2xl" onClick={event => event.stopPropagation()}>
            <button type="button" onClick={onClose} aria-label="Cancelar cambio de sede" className="absolute top-3 right-3 p-2 text-slate-500"><X size={20} /></button>
            <ShieldCheck size={28} className="text-emerald-600 mb-3" />
            <h2 id="branch-auth-title" className="font-bold text-lg text-slate-800 dark:text-white">{ownerExists ? 'El dueño no tiene PIN configurado' : 'No se encontró el Dueño'}</h2>
            <p className="my-3 text-sm text-slate-500">Configura el PIN del Dueño antes de cambiar a {SEDES.find(sede => sede.id === targetSedeId)?.nombre || 'esta sede'}.</p>
            <button type="button" onClick={onClose} className="mt-3 w-full py-3 rounded-xl bg-slate-200 text-slate-700 font-bold">Cerrar</button>
        </div>
    </div>;
}
