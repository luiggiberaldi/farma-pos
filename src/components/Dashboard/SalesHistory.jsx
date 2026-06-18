import React, { useState } from 'react';
import { Clock, Send, Ban, ChevronDown, ChevronUp, Trash2, Shuffle, Recycle, Receipt, Printer, LockIcon } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { getPaymentLabel, getPaymentMethod, PAYMENT_ICONS, getPaymentIcon, toTitleCase } from '../../config/paymentMethods';
import EmptyState from '../EmptyState';
import CasheaIcon from '../CasheaIcon';

export default function SalesHistory({
    sales,
    recentSales,
    bcvRate,
    totalSalesCount,
    onVoidSale,
    onShareWhatsApp,
    onDownloadPDF,
    onOpenDeleteModal,
    onRequestClientForTicket,
    onRecycleSale,
    onPrintTicket,
    isAdmin
}) {
    const [expandedSaleId, setExpandedSaleId] = useState(null);

    if (recentSales.length === 0) {
        return (
            <div className="mb-20 mt-4">
                <EmptyState
                    icon={Receipt}
                    title="Aún no hay ventas"
                    description="Las ventas recientes aparecerán aquí una vez que comiences a facturar."
                />
            </div>
        );
    }

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm mb-20">
            <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1">
                    <Clock size={12} /> Últimas 7 Ventas
                </h3>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-full">{totalSalesCount} histórico</span>
                    {isAdmin && (
                        <button
                            onClick={onOpenDeleteModal}
                            className="text-slate-300 hover:text-red-500 transition-colors bg-slate-50 hover:bg-red-50 p-1.5 rounded-lg"
                            title="Borrar historial"
                        >
                            <Trash2 size={14} />
                        </button>
                    )}
                </div>
            </div>
            <div className="space-y-3">
                {recentSales.map(s => {
                    const d = new Date(s.timestamp);
                    let methodLabel = 'Efectivo';
                    let PayMethodIcon = PAYMENT_ICONS['efectivo_bs'];

                    if (s.tipo === 'ANULACION_VENTA') {
                        methodLabel = 'Reverso';
                        PayMethodIcon = Ban;
                    } else if (s.tipo === 'VENTA_FIADA') {
                        methodLabel = 'Por Cobrar';
                        PayMethodIcon = Clock;
                    } else if (s.tipo === 'VENTA_CASHEA') {
                        const realPayment = s.payments && s.payments.find(p => p.methodId !== 'cashea');
                        if (realPayment) {
                            methodLabel = toTitleCase(realPayment.methodLabel || realPayment.methodId);
                            const m = getPaymentMethod(realPayment.methodId);
                            if (m) PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                        } else {
                            methodLabel = 'Cashea';
                        }
                    } else if (s.payments && s.payments.length === 1) {
                        methodLabel = toTitleCase(s.payments[0].methodLabel);
                        const m = getPaymentMethod(s.payments[0].methodId);
                        if (m) PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                    } else if (s.payments && s.payments.length > 1) {
                        methodLabel = 'Pago Mixto';
                        PayMethodIcon = Shuffle;
                    } else if (s.paymentMethod) {
                        const m = getPaymentMethod(s.paymentMethod);
                        if (m) {
                            methodLabel = toTitleCase(m.label);
                            PayMethodIcon = getPaymentIcon(m.id) || m.Icon || null;
                        }
                    }

                    const isCanceled = s.status === 'ANULADA' || !!s.relatedVoidId || s.tipo === 'ANULACION_VENTA';
                    const isExpanded = expandedSaleId === s.id;

                    return (
                        <div key={s.id} className={`rounded-xl border transition-all ${isCanceled ? 'bg-red-50/50 border-red-100/50 dark:bg-red-900/10 dark:border-red-900/20' : 'bg-slate-50 dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/60'} overflow-hidden`}>
                            <div
                                className="flex items-center gap-3 p-3 cursor-pointer select-none active:bg-slate-100 dark:active:bg-slate-800"
                                onClick={() => setExpandedSaleId(isExpanded ? null : s.id)}
                            >
                                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isCanceled ? 'bg-red-100 opacity-50' : 'bg-white dark:bg-slate-700 shadow-sm'}`}>
                                    {isCanceled ? <Ban size={20} className="text-red-400" /> : (PayMethodIcon ? <PayMethodIcon size={20} className="text-slate-500" /> : <span className="text-xl">💵</span>)}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm font-bold flex items-center gap-1.5 truncate ${isCanceled ? 'line-through text-slate-400' : 'text-slate-800 dark:text-slate-200'}`}>
                                        {s.tipo === 'ANULACION_VENTA'
                                            ? `Reverso: ${s.customerName || 'Consumidor Final'}`
                                            : (s.customerName || 'Consumidor Final')}
                                        {s.tipo === 'VENTA_FIADA' && <span className="text-[9px] bg-amber-100 text-amber-600 px-1 rounded uppercase">Fiado</span>}
                                        {s.tipo === 'VENTA_CASHEA' && <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded flex items-center gap-0.5 uppercase font-black"><CasheaIcon size={8} />Cashea</span>}
                                        {isCanceled && s.tipo !== 'ANULACION_VENTA' && <span className="text-[9px] bg-red-100 text-red-500 px-1 rounded uppercase">Anulada</span>}
                                        {s.tipo === 'ANULACION_VENTA' && <span className="text-[9px] bg-red-100 text-red-600 px-1 rounded uppercase">Reverso</span>}
                                    </p>
                                    <p className="text-[11px] text-slate-500 flex items-center gap-1 flex-wrap">
                                        {s.saleNumber && <span className="font-bold text-indigo-400">#{String(s.saleNumber).padStart(7, '0')}</span>}
                                        {s.saleNumber && <span>·</span>}
                                        <span>{d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' })}</span> ·
                                        <span>{d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span> ·
                                        <span>{methodLabel}</span>
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className={`text-sm font-black ${isCanceled ? 'text-slate-400' : 'text-slate-800 dark:text-white'}`}>
                                        {s.totalUsd < 0 ? `-$${Math.abs(s.totalUsd).toFixed(2)}` : `$${(s.totalUsd || 0).toFixed(2)}`}
                                    </p>
                                    <p className="text-[10px] text-slate-400 font-medium">{(() => {
                                        const bs = s.totalBs;
                                        const safeRate = s.rate || bcvRate || 0;
                                        const isNegative = bs < 0 || (s.totalUsd < 0);
                                        const absBs = Math.abs(typeof bs === 'number' && !isNaN(bs) ? bs : (s.totalUsd || 0) * safeRate);
                                        return `${isNegative ? '-' : ''}${formatBs(absBs)}`;
                                    })()} Bs</p>
                                    <div className="flex justify-end mt-0.5">
                                        {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                    </div>
                                </div>
                            </div>

                            {/* Expanded details */}
                            {isExpanded && (
                                <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700/50 text-sm animate-in fade-in slide-in-from-top-1">

                                    {/* Productos */}
                                    {s.items && s.items.length > 0 ? (
                                        <div className="pt-2 mb-3">
                                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1.5">Productos ({s.items.length})</p>
                                            <div className="space-y-1">
                                                {s.items.map((item, i) => (
                                                    <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'}`}>
                                                        <span className="truncate pr-2">{item.isWeight ? `${item.qty.toFixed(3)} kg` : `${item.qty}u`} · {item.name}</span>
                                                        <span className="font-semibold shrink-0">${(item.priceUsd * item.qty).toFixed(2)}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ) : (
                                        <p className="text-xs text-slate-400 mb-3 pt-2">Pago de Deudas (Sin productos)</p>
                                    )}

                                    {/* Resumen de cobro */}
                                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-2.5 mb-3 space-y-1.5">
                                        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2">Resumen de cobro</p>

                                        {/* Total en Bs */}
                                        <div className="flex justify-between items-center text-[11px]">
                                            <span className="text-slate-500">Total en Bs</span>
                                            <span className="font-bold text-slate-700 dark:text-slate-200">{formatBs(s.totalBs)} Bs</span>
                                        </div>

                                        {/* Tasa aplicada */}
                                        <div className="flex justify-between items-center text-[11px]">
                                            <span className="text-slate-400">Tasa BCV aplicada</span>
                                            <span className="text-slate-400">{formatBs(s.rate || bcvRate)} Bs/$</span>
                                        </div>

                                        {/* COP si aplica */}
                                        {s.tasaCop > 0 && (
                                            <div className="flex justify-between items-center text-[11px]">
                                                <span className="text-slate-500">Total en COP</span>
                                                <span className="font-bold text-amber-600">{(s.totalCop || (s.totalUsd * s.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</span>
                                            </div>
                                        )}

                                        {/* Pagos */}
                                        {s.payments && s.payments.length > 0 && (
                                            <>
                                                <div className="border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">
                                                    <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Pagos recibidos</p>
                                                    {s.payments.map((p, i) => {
                                                        const isCop = p.currency === 'COP';
                                                        const isBs = !isCop && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
                                                        const val = isCop
                                                            ? `${(p.amountBs || (p.amountUsd * (s.tasaCop || 1))).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP`
                                                            : isBs
                                                            ? `${formatBs(p.amountBs || (p.amountUsd * (s.rate || bcvRate)))} Bs`
                                                            : `$${(p.amountUsd || 0).toFixed(2)}`;
                                                        return (
                                                            <div key={i} className="flex justify-between items-center text-[11px]">
                                                                <span className="text-slate-500">{p.methodLabel || 'Pago'}</span>
                                                                <span className="font-semibold text-slate-700 dark:text-slate-200">{val}</span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </>
                                        )}

                                        {/* Fiado */}
                                        {s.fiadoUsd > 0 && (
                                            <div className="flex justify-between items-center text-[11px] border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">
                                                <span className="text-amber-600 font-bold">Pendiente (fiado)</span>
                                                <div className="text-right">
                                                    <div className="font-bold text-amber-600">${s.fiadoUsd.toFixed(2)}</div>
                                                    <div className="text-amber-500 text-[10px]">{formatBs(s.fiadoUsd * (s.rate || bcvRate))} Bs</div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Cashea */}
                                        {s.casheaUsd > 0 && (
                                            <div className="flex justify-between items-center text-[11px] border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">
                                                <span className="text-purple-600 font-bold flex items-center gap-1"><CasheaIcon size={11} />Cashea (por cobrar)</span>
                                                <div className="text-right">
                                                    <div className="font-bold text-purple-600">${s.casheaUsd.toFixed(2)}</div>
                                                    <div className="text-purple-400 text-[10px]">{formatBs(s.casheaUsd * (s.rate || bcvRate))} Bs</div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Cambio */}
                                        {(s.changeUsd > 0 || s.changeBs > 0) && (
                                            <div className="flex justify-between items-center text-[11px] border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">
                                                <span className="text-emerald-600 font-bold">Cambio entregado</span>
                                                <div className="text-right">
                                                    {s.changeUsd > 0 && <div className="font-bold text-emerald-600">${s.changeUsd.toFixed(2)}</div>}
                                                    <div className="text-emerald-500 text-[10px]">{formatBs(s.changeBs || s.changeUsd * (s.rate || bcvRate))} Bs</div>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Botones */}
                                    <div className="flex flex-wrap items-center gap-2 mt-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                if (!s.customerName || s.customerName === 'Consumidor Final') {
                                                    onRequestClientForTicket(s);
                                                } else {
                                                    onShareWhatsApp(s);
                                                }
                                            }}
                                            className="flex-1 min-w-[120px] whitespace-nowrap py-2 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 hover:dark:bg-emerald-900/50 active:scale-95">
                                            <Send size={14} /> Enviar Ticket
                                        </button>
                                        {onDownloadPDF && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDownloadPDF(s); }}
                                                className="py-2 px-3 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 hover:dark:bg-blue-900/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm">
                                                PDF
                                            </button>
                                        )}
                                        {onPrintTicket && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onPrintTicket(s); }}
                                                className="py-2 px-3 bg-violet-100 dark:bg-violet-900/30 text-violet-700 dark:text-violet-400 hover:bg-violet-200 hover:dark:bg-violet-900/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                                                title="Imprimir ticket"
                                            >
                                                <Printer size={14} />
                                            </button>
                                        )}
                                        {isAdmin && !isCanceled && (!s.cajaCerrada || localStorage.getItem('allow_void_after_cierre') === 'true') && s.tipo !== 'ANULACION_VENTA' && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onVoidSale(s); }}
                                                className="py-2 px-3 bg-slate-100 dark:bg-slate-900 text-red-600 dark:text-red-400 hover:bg-red-50 hover:dark:bg-red-900/30 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-800 shadow-sm active:scale-95">
                                                <Ban size={14} /> Anular
                                            </button>
                                        )}
                                        {!isCanceled && s.cajaCerrada && localStorage.getItem('allow_void_after_cierre') !== 'true' && s.tipo !== 'ANULACION_VENTA' && (
                                            <div title="Venta protegida por Cierre de Caja" className="py-2 px-3 bg-slate-50 dark:bg-slate-900 text-slate-400 font-bold rounded-lg flex justify-center items-center gap-1.5 text-[10px] uppercase border border-slate-100 dark:border-slate-800 tracking-wider cursor-not-allowed">
                                                <LockIcon size={12} /> Cerrada
                                            </div>
                                        )}
                                        {s.items && s.items.length > 0 && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onRecycleSale(s); }}
                                                className="py-2 px-3 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200 hover:dark:bg-indigo-900/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95">
                                                <Recycle size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </div>
    );
}
