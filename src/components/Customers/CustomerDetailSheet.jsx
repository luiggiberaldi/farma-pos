import { X, Phone, ArrowRightLeft, CheckCircle2, CreditCard, RefreshCw, Clock, ArrowUpRight, Ban, ShoppingBag, Pencil, Trash2 } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

export default function CustomerDetailSheet({ customer, isOpen, isAdmin, onClose, onAjustar, onReset, onEdit, onDelete, bcvRate, tasaCop, copEnabled, sales, onConvertToCashea, onClearCashea }) {
    useEscapeToClose(onClose, isOpen);
    if (!isOpen || !customer) return null;

    const createdDate = customer.createdAt
        ? new Date(customer.createdAt).toLocaleDateString('es-VE', { month: 'long', year: 'numeric' })
        : null;

    return (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Detalle del cliente"
                className="fixed bottom-0 left-0 right-0 max-w-md mx-auto bg-white dark:bg-slate-900 rounded-t-3xl max-h-[85vh] overflow-y-auto animate-in slide-in-from-bottom duration-300 shadow-2xl"
                onClick={e => e.stopPropagation()}
            >
                {/* Close + Drag Handle */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <div className="w-8" />
                    <div className="w-8 h-1 bg-slate-300 dark:bg-slate-700 rounded-full" />
                    <button onClick={onClose} className="modal-close text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                <div className="px-5 pb-6 space-y-5">
                    {/* Header */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
                            <span className="text-2xl font-black text-blue-600 dark:text-blue-400">
                                {customer.name.charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">{customer.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                {customer.documentId && (
                                    <p className="text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded">
                                        {customer.documentId}
                                    </p>
                                )}
                                {customer.phone && (
                                    <p className="text-xs text-slate-400 flex items-center gap-1">
                                        <Phone size={12} /> {customer.phone}
                                    </p>
                                )}
                            </div>
                            {createdDate && (
                                <p className="text-[10px] text-slate-400 mt-1">Cliente desde {createdDate}</p>
                            )}
                        </div>
                    </div>

                    {/* Saldo */}
                    <div className="space-y-2">
                        {customer.deuda > 0 && customer.casheaDeuda > 0 && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 flex items-center justify-between">
                                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wide">Total deuda</p>
                                <div className="text-right">
                                    <p className="text-base font-black text-slate-700 dark:text-slate-200">-${formatUsd(customer.deuda + customer.casheaDeuda)}</p>
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-slate-400">-{formatBs((customer.deuda + customer.casheaDeuda) * bcvRate)} Bs</p>}
                                </div>
                            </div>
                        )}
                        <div className="flex gap-2">
                            {customer.deuda > 0 && (
                                <div className="flex-1 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-3 py-2.5 text-center relative">
                                    <p className="text-[10px] font-bold text-red-400 uppercase">Fiado</p>
                                    <p className="text-lg font-black text-red-500">-${formatUsd(customer.deuda)}</p>
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-red-400/70">-{formatBs(customer.deuda * bcvRate)} Bs</p>}
                                    {copEnabled && tasaCop > 0 && <p className="text-[10px] font-bold text-red-500/90">-{(customer.deuda * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>}
                                    <button
                                        onClick={onConvertToCashea}
                                        className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[10px] font-bold hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors active:scale-95"
                                        title="Convertir deuda fiado a Cashea"
                                    >
                                        <ArrowRightLeft size={10} /> Pasar a Cashea
                                    </button>
                                </div>
                            )}
                            {customer.casheaDeuda > 0 && (
                                <div className="flex-1 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800/30 rounded-xl px-3 py-2.5 text-center">
                                    <p className="text-[10px] font-bold text-purple-400 uppercase flex items-center gap-1 justify-center"><CasheaIcon size={10} /> Cashea</p>
                                    <p className="text-lg font-black text-purple-500">-${formatUsd(customer.casheaDeuda)}</p>
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-purple-400/70">-{formatBs(customer.casheaDeuda * bcvRate)} Bs</p>}
                                    <button onClick={onClearCashea}
                                        className="mt-1.5 inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400 text-[10px] font-bold hover:bg-purple-200 dark:hover:bg-purple-900/50 transition-colors active:scale-95">
                                        <CheckCircle2 size={10} /> Saldar Cashea
                                    </button>
                                </div>
                            )}
                            {!customer.deuda && !customer.casheaDeuda && customer.favor > 0 && (
                                <div className="flex-1 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/30 rounded-xl px-3 py-2.5 text-center">
                                    <p className="text-[10px] font-bold text-emerald-400 uppercase">A favor</p>
                                    <p className="text-lg font-black text-emerald-500">+${formatUsd(customer.favor)}</p>
                                    {bcvRate > 0 && <p className="text-[10px] font-bold text-emerald-400/70">+{formatBs(customer.favor * bcvRate)} Bs</p>}
                                    {copEnabled && tasaCop > 0 && <p className="text-[10px] font-bold text-emerald-500/90">+{(customer.favor * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>}
                                </div>
                            )}
                            {!customer.deuda && !customer.casheaDeuda && !customer.favor && (
                                <div className="flex-1 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-center">
                                    <p className="text-sm font-black text-slate-400 flex items-center justify-center gap-1">
                                        <CheckCircle2 size={14} className="text-emerald-400" /> Al día
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Acciones */}
                    <div className="grid grid-cols-2 gap-2">
                        <button
                            onClick={onAjustar}
                            className="flex flex-col items-center gap-1.5 py-3 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 rounded-xl text-xs font-bold hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors active:scale-95 col-span-1"
                        >
                            <CreditCard size={18} />
                            <span>Ajustar Cuenta</span>
                        </button>
                        {(customer.deuda !== 0 || customer.favor !== 0) && isAdmin && (
                            <button
                                onClick={onReset}
                                className="flex flex-col items-center gap-1.5 py-3 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95"
                            >
                                <RefreshCw size={18} />
                                <span>Poner en 0</span>
                            </button>
                        )}
                    </div>

                    {/* Historial — solo admin */}
                    {isAdmin && <div>
                        <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5 mb-3">
                            <Clock size={12} /> Historial
                        </h4>
                        {(!sales || sales.length === 0) ? (
                            <p className="text-xs text-slate-400 text-center py-6">Sin registros aún</p>
                        ) : (
                            <div className="space-y-2">
                                {sales.slice(0, 10).map(sale => {
                                    const date = new Date(sale.timestamp);
                                    const dateStr = date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: '2-digit' });
                                    const timeStr = date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
                                    const isCobro = sale.tipo === 'COBRO_DEUDA';
                                    const isFiada = sale.tipo === 'VENTA_FIADA';
                                    const isAnulacion = sale.tipo === 'ANULACION_VENTA';
                                    const isAnulada = sale.status === 'ANULADA' || !!sale.relatedVoidId;
                                    return (
                                        <div key={sale.id} className={`flex items-start gap-2.5 py-2 px-2 bg-slate-50 dark:bg-slate-950 rounded-xl ${isAnulada ? 'opacity-50 grayscale' : ''}`}>
                                            <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 mt-0.5 ${isAnulada ? 'bg-slate-200 dark:bg-slate-800' : isCobro ? 'bg-emerald-100 dark:bg-emerald-900/30' : isFiada ? 'bg-amber-100 dark:bg-amber-900/30' : isAnulacion ? 'bg-red-100 dark:bg-red-900/30' : 'bg-blue-100 dark:bg-blue-900/30'}`}>
                                                {isCobro ? <ArrowUpRight size={14} className={isAnulada ? "text-slate-500" : "text-emerald-500"} /> : isFiada ? <CreditCard size={14} className={isAnulada ? "text-slate-500" : "text-amber-500"} /> : isAnulacion ? <Ban size={14} className="text-red-500" /> : <ShoppingBag size={14} className={isAnulada ? "text-slate-500" : "text-blue-500"} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="flex justify-between items-start">
                                                    <div className="flex flex-col">
                                                        <p className={`text-xs font-bold ${isAnulada ? 'text-slate-500 line-through' : 'text-slate-700 dark:text-slate-200'}`}>
                                                            {isCobro ? 'Abono de deuda' : isFiada ? 'Venta fiada' : isAnulacion ? 'Reverso de venta' : 'Venta'}
                                                        </p>
                                                        {isAnulada && <span className="text-[10px] font-black text-red-500 tracking-wider">ANULADA</span>}
                                                        {isAnulacion && <span className="text-[10px] font-black text-red-500 tracking-wider">REVERSO</span>}
                                                    </div>
                                                    <div className="text-right">
                                                        <p className={`text-xs font-black ${isAnulada ? 'text-slate-400 line-through' : isCobro ? 'text-emerald-500' : isAnulacion ? 'text-red-500' : 'text-slate-700 dark:text-white'}`}>
                                                            {isCobro ? '+' : ''}{sale.totalUsd < 0 ? `-$${Math.abs(sale.totalUsd).toFixed(2)}` : `$${(sale.totalUsd || 0).toFixed(2)}`}
                                                        </p>
                                                        {bcvRate > 0 && !isAnulada && (
                                                            <p className={`text-[9px] font-bold ${isCobro ? 'text-emerald-400/70' : isFiada ? 'text-amber-400/70' : 'text-slate-400'}`}>
                                                                {isCobro ? '+' : ''}{sale.totalBs < 0 ? `-${formatBs(Math.abs(sale.totalBs))} Bs` : `${formatBs(sale.totalBs || (sale.totalUsd || 0) * bcvRate)} Bs`}
                                                            </p>
                                                        )}
                                                    </div>
                                                </div>
                                                {sale.items && sale.items.length > 0 && (
                                                    <p className="text-[10px] text-slate-400 truncate mt-0.5">
                                                        {sale.items.map(i => i.name).join(', ')}
                                                    </p>
                                                )}
                                                {sale.fiadoUsd > 0 && (
                                                    <p className="text-[10px] text-amber-500 font-bold mt-0.5">Deuda: ${formatUsd(sale.fiadoUsd)}</p>
                                                )}
                                                <p className="text-[9px] text-slate-400 mt-0.5">{dateStr} • {timeStr}</p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>}

                    {/* Editar / Eliminar */}
                    <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button
                            onClick={onEdit}
                            className="flex-1 flex items-center justify-center gap-1.5 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors active:scale-95"
                        >
                            <Pencil size={14} /> Editar
                        </button>
                        {isAdmin && (
                            <button
                                onClick={onDelete}
                                className="flex items-center justify-center gap-1.5 py-2.5 px-4 bg-red-50 dark:bg-red-900/20 text-red-500 rounded-xl text-xs font-bold hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors active:scale-95"
                            >
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}