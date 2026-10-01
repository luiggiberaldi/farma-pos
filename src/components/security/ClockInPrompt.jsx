import { Clock } from 'lucide-react';
import { useAuthStore } from '../../hooks/store/useAuthStore.js';
import { showToast } from '../Toast.js';

// Clock-in integrado al login (patrón Toast/Lightspeed, versión mínima):
// tras ingresar el PIN, el cajero ve la opción de fichar entrada.
// La oferta vive en el store para cubrir todos los puntos de login
// (LockScreen y hoja de cambio de operador). Sin pantallas nuevas.
export default function ClockInPrompt() {
    const offer = useAuthStore(s => s.clockInOffer);
    const clearClockInOffer = useAuthStore(s => s.clearClockInOffer);
    const clockIn = useAuthStore(s => s.clockIn);
    if (!offer) return null;

    const accept = () => {
        if (clockIn()) {
            showToast(`Entrada fichada · ${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`, 'success');
        }
        clearClockInOffer();
    };

    return (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Fichar entrada de turno">
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl border border-slate-200 dark:border-slate-700 text-center">
                <div className="mx-auto mb-3 w-12 h-12 rounded-2xl bg-emerald-100 dark:bg-emerald-900/40 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                    <Clock size={24} />
                </div>
                <h2 className="text-base font-black text-slate-800 dark:text-white">Hola, {offer.userName?.split(' ')[0]}</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 mb-5">¿Deseas fichar tu entrada de turno ahora?</p>
                <div className="flex gap-2">
                    <button
                        type="button"
                        onClick={clearClockInOffer}
                        className="flex-1 min-h-[44px] rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-sm font-bold active:scale-95 transition-transform"
                    >
                        Ahora no
                    </button>
                    <button
                        type="button"
                        onClick={accept}
                        className="flex-1 min-h-[44px] rounded-xl bg-emerald-600 text-white text-sm font-black shadow-lg shadow-emerald-600/25 active:scale-95 transition-transform"
                    >
                        Fichar entrada
                    </button>
                </div>
            </div>
        </div>
    );
}
