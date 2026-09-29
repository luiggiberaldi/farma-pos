import { UserPlus, Phone, Send } from 'lucide-react';

export default function TicketClientModal({ ticketPendingSale, setTicketPendingSale, ticketClientName, setTicketClientName, ticketClientPhone, setTicketClientPhone, ticketClientDocument, setTicketClientDocument, onRegister }) {
    if (!ticketPendingSale) return null;
    const reset = () => { setTicketPendingSale(null); setTicketClientName(''); setTicketClientPhone(''); setTicketClientDocument(''); };
    return (
    <div
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200"
        onClick={reset}
    >
        <div
            className="bg-white w-full max-w-sm rounded-[24px] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100"
            onClick={(e) => e.stopPropagation()}
        >
            <div className="p-6">
                <div className="flex justify-center mb-4">
                    <div className="w-16 h-16 bg-[#0B8D63]/10 text-[#0B8D63] rounded-full flex items-center justify-center">
                        <UserPlus size={28} />
                    </div>
                </div>
                <h3 className="text-lg font-black text-center text-slate-800 mb-1">
                    Registrar Cliente
                </h3>
                <p className="text-xs text-center text-slate-500 mb-5">
                    Para enviar el ticket, registra los datos del cliente.
                </p>

                <div className="space-y-3">
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5">Nombre del Cliente *</label>
                        <input
                            type="text"
                            value={ticketClientName}
                            onChange={(e) => setTicketClientName(e.target.value)}
                            placeholder="Ej: María García"
                            autoFocus
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1">
                            Cédula / RIF (Opcional)
                        </label>
                        <input
                            type="text"
                            value={ticketClientDocument}
                            onChange={(e) => setTicketClientDocument(e.target.value.toUpperCase())}
                            placeholder="Ej: V-12345678"
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all uppercase"
                        />
                    </div>
                    <div>
                        <label className="block text-[10px] font-bold text-slate-400 uppercase mb-1.5 flex items-center gap-1">
                            <Phone size={10} /> Teléfono / WhatsApp
                        </label>
                        <input
                            type="tel"
                            value={ticketClientPhone}
                            onChange={(e) => setTicketClientPhone(e.target.value)}
                            placeholder="Ej: 0414-1234567"
                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-medium text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-brand/50 focus:border-brand transition-all"
                        />
                    </div>
                </div>
            </div>
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50 flex gap-3">
                <button
                    onClick={reset}
                    className="flex-1 py-3 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all"
                >
                    Cancelar
                </button>
                <button
                    onClick={onRegister}
                    disabled={!ticketClientName.trim()}
                    className="flex-1 py-3 bg-brand disabled:bg-slate-300 dark:disabled:bg-slate-700 hover:bg-brand-dark text-white font-bold rounded-xl active:scale-[0.98] transition-all flex justify-center items-center gap-2 shadow-md shadow-brand/20"
                >
                    <Send size={16} /> Registrar y Enviar
                </button>
            </div>
        </div>
    </div>
    );
}
