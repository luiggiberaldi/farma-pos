import { SEDES } from '../../config/sedes.js';
import SedeName from '../security/SedeName.jsx';
import { useSedeStore } from '../../hooks/store/useSedeStore.js';
import { showToast } from '../Toast.js';

/**
 * Barra de sedes para el dueño — reemplazo compacto y responsive de la
 * tarjeta "Consolidado multi-sede" (que ahora vive en el modo Supervisión).
 * Segmento horizontal con scroll si no caben. El dueño ya autenticado cambia
 * de sede directo, sin reingresar el PIN.
 */
export default function SedeSwitcherBar({ isDueno, sedeActivaId, triggerHaptic }) {
    if (!isDueno) return null;
    const switchSede = async (sedeId) => {
        triggerHaptic?.();
        try {
            await useSedeStore.getState().setSedeActiva(sedeId);
        } catch (error) {
            showToast(error?.message || 'No se pudo cambiar de sede', 'error');
        }
    };
    return (
        <div className="flex gap-2 overflow-x-auto px-4 sm:px-6 pt-1 pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {SEDES.map(s => {
                const activa = s.id === sedeActivaId;
                return (
                    <button
                        key={s.id}
                        onClick={() => { if (!activa) switchSede(s.id); }}
                        className={`flex items-center gap-1.5 shrink-0 rounded-full pl-2.5 pr-3 py-1.5 text-[11px] font-black border transition-all active:scale-95 ${
                            activa
                                ? 'text-white border-transparent shadow-sm'
                                : 'bg-white text-slate-600 border-slate-200'
                        }`}
                        style={activa ? { background: s.color } : undefined}
                        aria-current={activa ? 'true' : undefined}
                    >
                        {!activa && <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />}
                        <SedeName nombre={s.nombre} size="xs" />
                    </button>
                );
            })}
        </div>
    );
}
