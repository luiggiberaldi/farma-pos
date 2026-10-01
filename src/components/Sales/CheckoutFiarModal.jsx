import { AlertTriangle } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { formatBs } from '../../utils/calculatorUtils';
import { mulR } from '../../utils/dinero';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

export default function CheckoutFiarModal(props) {
    const {
        confirmFiar, setConfirmFiar, casheaActive,
        casheaAmountUsd, remainingUsd, remainingBs, effectiveRate,
        selectedCustomer, totalPaidUsd, handleConfirm,
    } = props;
    useEscapeToClose(() => setConfirmFiar(false), !!confirmFiar);
    if (!confirmFiar) return null;
    return (

        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setConfirmFiar(false)}>
            <div role="dialog" aria-modal="true" aria-label="Confirmar venta fiada" className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-sm sm:max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>

                {/* Header */}
                <div className="flex items-center gap-4 mb-5">
                    <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0 ${casheaActive ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                        {casheaActive
                            ? <CasheaIcon size={32} />
                            : <AlertTriangle size={24} className="text-amber-600 sm:w-7 sm:h-7" />}
                    </div>
                    <div>
                        <h3 className="text-lg sm:text-xl font-black text-slate-800 dark:text-white">
                            {casheaActive ? 'Confirmar con Cashea' : 'Confirmar Fiado'}
                        </h3>
                        <p className="text-xs sm:text-sm text-slate-400 mt-0.5">Revisa los detalles antes de continuar</p>
                    </div>
                </div>

                {/* Monto destacado */}
                <div className={`border rounded-2xl p-4 sm:p-5 mb-5 ${casheaActive ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800/30' : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'}`}>
                    <div className="text-center mb-3">
                        <p className={`text-[11px] sm:text-xs font-bold uppercase tracking-widest mb-1 ${casheaActive ? 'text-purple-500' : 'text-amber-500'}`}>
                            {casheaActive ? 'Monto pendiente Cashea' : 'Monto a fiar'}
                        </p>
                        <p className={`text-3xl sm:text-4xl font-black ${casheaActive ? 'text-purple-600' : 'text-amber-600'}`}>${(casheaActive ? casheaAmountUsd : remainingUsd).toFixed(2)}</p>
                        <p className={`text-sm sm:text-base font-bold mt-0.5 ${casheaActive ? 'text-purple-500/70' : 'text-amber-500/70'}`}>{formatBs(casheaActive ? mulR(casheaAmountUsd, effectiveRate) : remainingBs)} Bs</p>
                    </div>
                    <div className={`border-t pt-3 space-y-2 ${casheaActive ? 'border-purple-200/50 dark:border-purple-800/20' : 'border-amber-200/50 dark:border-amber-800/20'}`}>
                        <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                            {casheaActive
                                ? <>Cashea cobrará <span className="font-black text-slate-800 dark:text-white">${casheaAmountUsd.toFixed(2)}</span> a <span className="font-black text-slate-800 dark:text-white">{selectedCustomer?.name}</span>. Se registrará como deuda Cashea.</>
                                : <>Se registrara como deuda a nombre de <span className="font-black text-slate-800 dark:text-white">{selectedCustomer?.name}</span>.</>
                            }
                        </p>
                        {totalPaidUsd > 0.01 && (
                            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                El cliente abona <span className="font-bold text-emerald-600">${totalPaidUsd.toFixed(2)}</span> ahora y el restante queda pendiente.
                            </p>
                        )}
                        {totalPaidUsd <= 0.01 && !casheaActive && (
                            <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                El monto total de la venta quedara como deuda del cliente.
                            </p>
                        )}
                        {selectedCustomer && (selectedCustomer.deuda || 0) > 0.01 && (
                            <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 rounded-lg p-2.5 mt-2">
                                <p className="text-[11px] sm:text-xs font-bold text-red-600 dark:text-red-400">
                                    {casheaActive
                                        ? <>Este cliente tiene <span className="font-black">${(selectedCustomer.deuda || 0).toFixed(2)}</span> de fiado pendiente (independiente de Cashea).</>
                                        : <>Este cliente ya tiene una deuda de ${(selectedCustomer.deuda || 0).toFixed(2)}. La deuda total pasara a ser ${((selectedCustomer.deuda || 0) + remainingUsd).toFixed(2)}.</>
                                    }
                                </p>
                            </div>
                        )}
                        {selectedCustomer && casheaActive && (selectedCustomer.casheaDeuda || 0) > 0.01 && (
                            <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800/30 rounded-lg p-2.5 mt-2">
                                <p className="text-[11px] sm:text-xs font-bold text-purple-600 dark:text-purple-400">
                                    Ya tiene ${(selectedCustomer.casheaDeuda || 0).toFixed(2)} pendiente con Cashea. El total Cashea pasará a ${((selectedCustomer.casheaDeuda || 0) + casheaAmountUsd).toFixed(2)}.
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                {/* Botones */}
                <div className="flex gap-3">
                    <button
                        onClick={() => setConfirmFiar(false)}
                        className="flex-1 py-3.5 sm:py-4 font-bold text-sm sm:text-base text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={() => { setConfirmFiar(false); handleConfirm(); }}
                        className={`flex-1 py-3.5 sm:py-4 font-black text-sm sm:text-base text-white rounded-xl shadow-lg active:scale-95 transition-all ${casheaActive ? 'bg-purple-500 hover:bg-purple-600 shadow-purple-500/25' : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/25'}`}
                    >
                        {casheaActive ? 'Confirmar Cashea' : 'Confirmar fiado'}
                    </button>
                </div>
            </div>
        </div>

    );
}
