import React from 'react';
import { MapPin } from 'lucide-react';
import { SEDES, getVisibleSedes } from '../config/sedes';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { useSedeStore } from '../hooks/store/useSedeStore';

export default function SedeSelector({ className = '' }) {
    const usuario = useAuthStore(state => state.usuarioActivo);
    const sedeActivaId = useSedeStore(state => state.sedeActivaId);
    const setSedeActiva = useSedeStore(state => state.setSedeActiva);
    const sedes = getVisibleSedes(usuario);
    const sede = SEDES.find(item => item.id === sedeActivaId) || sedes[0];

    if (!sede || sedes.length <= 1) {
        return <span className={`inline-flex items-center gap-1 text-xs font-bold text-slate-600 dark:text-slate-300 ${className}`}><MapPin size={14} />{sede?.nombre}</span>;
    }

    return <label className={`inline-flex items-center gap-1 ${className}`}>
        <MapPin size={14} className="text-primary" />
        <select
            value={sedeActivaId}
            onChange={event => setSedeActiva(event.target.value, usuario)}
            className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-700 outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            aria-label="Sede activa"
        >
            {sedes.map(item => <option key={item.id} value={item.id}>{item.nombre}</option>)}
        </select>
    </label>;
}
