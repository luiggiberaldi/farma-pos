import { Trash2 } from 'lucide-react';
import { showToast } from '../Toast';
import { supabaseCloud } from '../../config/supabaseCloud';

export default function DeleteHistoryModal({ isOpen, onClose, deleteConfirmText, setDeleteConfirmText, setSales, storageService, salesKey, remotePaused, cloudPauseMessage }) {
    if (!isOpen) return null;
    const handleDelete = async () => {
                        if (remotePaused) {
                            showToast('Borrado bloqueado durante la pausa de sincronización para conservar ventas y pendientes.', 'warning');
                            return;
                        }
                        if (deleteConfirmText.trim().toUpperCase() === 'BORRAR') {
                            setSales([]);
                            // 1. Borrar local
                            await storageService.removeItem(salesKey);
                            localStorage.removeItem('cierre_notified_date');
                            // 2. Borrar de la nube para que no se restaure al recargar
                            try {
                                const { data: { session } } = await supabaseCloud.auth.getSession();
                                if (session?.user?.id) {
                                    await supabaseCloud.from('sync_documents').delete()
                                        .eq('user_id', session.user.id)
                                        .eq('doc_id', salesKey);
                                }
                            } catch (e) { /* sin nube, ignorar */ }
                            onClose();
                            showToast('Historial y reportes eliminados', 'success');
                            setTimeout(() => window.location.reload(), 800);
                        }
    };
    return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
        <div className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100">
            <div className="p-6 flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-red-50 text-red-500 rounded-full flex items-center justify-center mb-4">
                    <Trash2 size={32} />
                </div>
                <h3 className="text-xl font-black text-slate-800 mb-2">¿Estás absolutamente seguro?</h3>
                <p className="text-sm text-slate-500 mb-4 px-2">
                    Esta acción borrará permanentemente <strong className="text-red-500">TODO el historial de ventas y reportes estadísticos</strong>. (No afectará tu inventario de productos).
                </p>
                {remotePaused && (
                    <p role="status" className="mb-3 text-sm font-bold text-amber-800 dark:text-amber-200">
                        Borrado bloqueado: se conservan el historial y las ventas pendientes durante la pausa de sincronización.
                    </p>
                )}
                <div className="w-full bg-slate-50 p-4 rounded-xl border border-slate-200 mb-2 mt-2">
                    <p className="text-xs font-bold text-slate-600 mb-2 uppercase tracking-wide">Escribe "BORRAR" para confirmar:</p>
                    <input
                        type="text"
                        value={deleteConfirmText}
                        onChange={(e) => setDeleteConfirmText(e.target.value)}
                        placeholder="Ej. BORRAR"
                        className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-center font-black text-red-500 uppercase tracking-widest focus:ring-2 focus:ring-red-500 focus:border-red-500 transition-all outline-none"
                    />
                </div>
            </div>
            <div className="p-4 border-t border-slate-100 bg-slate-50 flex gap-3">
                <button
                    onClick={onClose}
                    className="flex-1 py-3.5 bg-white border-2 border-slate-200 text-slate-700 font-bold rounded-xl active:scale-[0.98] transition-all"
                >
                    Cancelar
                </button>
                <button
                    onClick={handleDelete}
                    disabled={remotePaused || deleteConfirmText.trim().toUpperCase() !== 'BORRAR'}
                    title={remotePaused ? cloudPauseMessage : undefined}
                    className="flex-1 py-3.5 bg-red-500 disabled:bg-slate-300 disabled:text-slate-500 text-white font-bold rounded-xl active:scale-[0.98] transition-all flex justify-center items-center gap-2"
                >
                    <Trash2 size={18} /> Borrar Historial y Reportes
                </button>
            </div>
        </div>
    </div>
    );
}
