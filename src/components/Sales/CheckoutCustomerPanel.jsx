import { Users, ChevronDown, Wallet } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';

export default function CheckoutCustomerPanel(props) {
    const {
        selectedCustomer, setShowCustomerSheet, availableFavor,
        requiresPrescription, prescription, setPrescription, prescriptionReady,
        totalPaidWithCasheaUsd, isPaid, changeUsd, remainingUsd,
        changeBs, remainingBs, usableFavor, handleSaldoFavor,
    } = props;
    return (
        <>
    {/* -- CLIENTE -- */}
    <div className="px-3 py-2">
        <button
            onClick={() => setShowCustomerSheet(true)}
            className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 active:scale-[0.98] transition-all ${
                selectedCustomer
                    ? 'border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/50 dark:bg-indigo-950/20'
                    : 'border-dashed border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
            }`}
        >
            {selectedCustomer ? (
                <>
                    <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-base font-black text-indigo-600 dark:text-indigo-400 shrink-0">
                        {selectedCustomer.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1 text-left min-w-0">
                        <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Cliente</p>
                        <p className="text-sm font-black text-indigo-700 dark:text-indigo-300 truncate">{selectedCustomer.name}</p>
                        {selectedCustomer.customerDocument && (
                            <p className="text-[10px] text-indigo-400 font-medium">{selectedCustomer.customerDocument}</p>
                        )}
                    </div>
                    {selectedCustomer.deuda > 0.01 && (
                        <span className="text-[11px] font-black text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg border border-red-200 dark:border-red-800 shrink-0">
                            Debe ${selectedCustomer.deuda.toFixed(2)}
                        </span>
                    )}
                    {availableFavor > 0.01 && (
                        <span className="text-[11px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 shrink-0">
                            Favor ${availableFavor.toFixed(2)}
                        </span>
                    )}
                    <ChevronDown size={15} className="text-indigo-400 shrink-0" />
                </>
            ) : (
                <>
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <Users size={18} className="text-slate-400" />
                    </div>
                    <div className="flex-1 text-left">
                        <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cliente</p>
                        <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Consumidor Final</p>
                    </div>
                    <ChevronDown size={15} className="text-slate-400" />
                </>
            )}
        </button>
    </div>

    {requiresPrescription && <fieldset className="mx-3 my-2 space-y-2 rounded-xl border border-teal-300 dark:border-teal-700 bg-teal-50 dark:bg-teal-950/30 p-3">
        <legend className="px-1 text-sm font-bold text-teal-900 dark:text-teal-100">Verificación de receta</legend>
        <p className="text-xs text-slate-700 dark:text-slate-200">Selecciona un cliente con documento y registra la evidencia de dispensación.</p>
        <label className="block text-xs font-semibold">Referencia de receta<input aria-label="Referencia de receta" maxLength={120} value={prescription.reference} onChange={e => setPrescription(p => ({ ...p, reference: e.target.value, confirmed: false }))} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-slate-900 dark:text-white" /></label>
        <label className="block text-xs font-semibold">Profesional prescriptor<input aria-label="Profesional prescriptor" maxLength={120} value={prescription.prescriber} onChange={e => setPrescription(p => ({ ...p, prescriber: e.target.value, confirmed: false }))} className="mt-1 w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 p-2 text-slate-900 dark:text-white" /></label>
        <label className="flex items-start gap-2 text-xs text-slate-800 dark:text-slate-100"><input type="checkbox" checked={prescription.confirmed} onChange={e => setPrescription(p => ({ ...p, confirmed: e.target.checked }))} />He comprobado la receta y el documento del cliente</label>
        {!prescriptionReady && <p role="status" className="text-xs font-semibold text-amber-800 dark:text-amber-200">La evidencia y el documento son obligatorios.</p>}
    </fieldset>}
    {/* -- MONTO PAGADO / FALTA (SOLO PC) -- */}
    <div className="hidden lg:block px-3 pb-2">
        <div className="flex items-center justify-between px-1 pb-2">
            <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">Monto Pagado</span>
            <span className="text-xs font-black text-emerald-600 dark:text-emerald-400">${totalPaidWithCasheaUsd.toFixed(2)}</span>
        </div>
        <div className={`p-4 rounded-2xl border-2 ${isPaid
            ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
            : 'bg-slate-50 border-slate-200 dark:bg-slate-900/40 dark:border-slate-700'}`}>
            <p className={`text-[10px] font-black uppercase tracking-widest ${isPaid ? 'text-emerald-500' : 'text-orange-500'}`}>
                {isPaid ? 'Vuelto' : 'Falta por Pagar'}
            </p>
            <div className="flex items-baseline gap-2 mt-1">
                <span className={`text-2xl font-black ${isPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                    ${(isPaid ? changeUsd : remainingUsd).toFixed(2)}
                </span>
                <span className="text-xs font-bold text-slate-400">
                    Bs {formatBs(isPaid ? changeBs : remainingBs)}
                </span>
            </div>
        </div>
    </div>

    {/* Saldo a Favor */}
    {availableFavor > 0.01 && (remainingUsd > 0.01 || usableFavor > 0) && (
        <div className="px-3 py-1">
            <button
                onClick={handleSaldoFavor}
                className="w-full min-h-[44px] py-2.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2"
            >
                <Wallet size={16} /> Usar Saldo a Favor (${availableFavor.toFixed(2)})
            </button>
        </div>
    )}
        </>
    );
}
