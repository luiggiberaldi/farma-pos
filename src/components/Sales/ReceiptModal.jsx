import React from 'react';
import { CheckCircle, Wallet, Send, X, Printer } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { formatBs } from '../../utils/calculatorUtils';
import { printThermalTicket } from '../../utils/ticketGenerator';
import { PrinterSerial } from '../../services/PrinterSerial';

export default function ReceiptModal({ receipt, onClose, onShareWhatsApp, currentRate }) {
    if (!receipt) return null;

    return (
        <div className="fixed inset-0 z-[60] bg-slate-900/80 backdrop-blur-md flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="bg-white w-full sm:max-w-sm sm:rounded-[2rem] rounded-t-[2rem] shadow-2xl animate-in zoom-in-95 duration-300 overflow-hidden relative flex flex-col max-h-[95vh] sm:max-h-[90vh]">

                {/* Botón X cerrar — siempre visible */}
                <button
                    onClick={onClose}
                    className="absolute top-4 right-4 z-30 w-8 h-8 bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-700 rounded-full flex items-center justify-center transition-all active:scale-90"
                    title="Cerrar"
                >
                    <X size={18} />
                </button>

                {/* Contenido scrollable */}
                <div className="flex-1 overflow-y-auto overscroll-contain">
                    {/* Bordes serrados efecto ticket */}
                    <div className="h-4 bg-white shrink-0" style={{ backgroundImage: 'radial-gradient(circle at 10px 0, transparent 10px, white 10px)', backgroundSize: '20px 20px' }}></div>

                    <div className="p-6 sm:p-8 pt-8 sm:pt-10 text-center bg-white border-b-2 border-dashed border-slate-200">
                        <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 relative">
                            <CheckCircle size={36} className="text-emerald-500 relative z-10" />
                            <div className="absolute inset-0 bg-emerald-400 rounded-full animate-ping opacity-20"></div>
                        </div>
                        <h3 className="text-2xl font-black text-slate-800 tracking-tight mb-1">Orden #{(receipt.id.substring(0, 6)).toUpperCase()}</h3>
                        {receipt.customerName && <p className="text-sm font-bold text-slate-500 mb-0 uppercase tracking-tight">{receipt.customerName}</p>}
                        {receipt.customerDocument && (
                            <p className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wide">
                                C.I/RIF: {receipt.customerDocument}
                            </p>
                        )}
                        <p className="text-4xl font-black text-slate-900 mb-1 tracking-tighter">${receipt.totalUsd.toFixed(2)}</p>
                        <p className="text-lg font-bold text-slate-500 mb-2">{formatBs(receipt.totalBs)} Bs</p>
                        {receipt.copEnabled && receipt.tasaCop > 0 && (
                            <p className="text-base font-bold text-amber-500 mb-2">{(receipt.totalCop || (receipt.totalUsd * receipt.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</p>
                        )}

                        <div className="inline-flex items-center flex-wrap justify-center gap-1.5 px-3 py-1 bg-slate-100 rounded-full text-xs font-bold text-slate-600 mt-2">
                            {receipt.payments && receipt.payments.map((p, i) => (
                                <span key={p.id} className="flex items-center gap-1">
                                    <Wallet size={12} /> {p.methodLabel} {i < receipt.payments.length - 1 ? ' • ' : ''}
                                </span>
                            ))}
                        </div>
                    </div>

                    <div className="bg-slate-50 px-6 sm:px-8 py-6">
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Detalle de Consumo</p>
                        <div className="space-y-3">
                            {receipt.items.map((item, i) => (
                                <div key={i} className="flex justify-between items-start text-sm border-b border-slate-200/50 pb-2 last:border-0 last:pb-0">
                                    <div className="flex-1 pr-4">
                                        <span className="font-bold text-slate-700 block leading-tight">{item.name}</span>
                                        <span className="text-xs text-slate-400">{item.isWeight ? `${item.qty.toFixed(3)} Kg` : `${item.qty} u`} × ${item.priceUsd.toFixed(2)}</span>
                                    </div>
                                    <span className="font-black text-slate-900">${(item.priceUsd * item.qty).toFixed(2)}</span>
                                </div>
                            ))}
                        </div>

                        {receipt.payments && receipt.payments.length > 0 && (
                            <div className="mt-4 pt-4 border-t border-slate-200 text-sm">
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2">Pagos Recibidos</p>
                                {receipt.payments.filter(p => p.methodId !== 'cashea').map(p => (
                                    <div key={p.id} className="flex justify-between text-slate-600 mb-1">
                                        <span>{p.methodLabel}:</span>
                                        <span className="font-bold">{p.amountInputCurrency === 'USD' ? '$' : p.amountInputCurrency === 'COP' ? 'COP' : 'Bs'} {p.amountInput}</span>
                                    </div>
                                ))}

                                {/* Cashea financing row */}
                                {receipt.payments.some(p => p.methodId === 'cashea') && (() => {
                                    const casheaP = receipt.payments.find(p => p.methodId === 'cashea');
                                    return (
                                        <div className="flex justify-between text-purple-600 font-bold mt-2 pt-2 border-t border-slate-200">
                                            <span className="flex items-center gap-1.5"><CasheaIcon size={16} /> Financiado por Cashea ({casheaP.casheaPercent}%):</span>
                                            <span>${casheaP.amountUsd.toFixed(2)}</span>
                                        </div>
                                    );
                                })()}

                                {receipt.changeUsd > 0 && (
                                    <div className="flex justify-between text-emerald-600 font-bold mt-2 pt-2 border-t border-slate-200">
                                        <span>Vuelto Emitido:</span>
                                        <span>${receipt.changeUsd.toFixed(2)} / {formatBs(receipt.changeBs)} Bs</span>
                                    </div>
                                )}

                                {receipt.fiadoUsd > 0 && (
                                    <div className="flex justify-between text-amber-600 font-bold mt-2 pt-2 border-t border-slate-200">
                                        <span>Pendiente (Fiado):</span>
                                        <span>${receipt.fiadoUsd.toFixed(2)} / {formatBs(receipt.fiadoUsd * (currentRate || receipt.rate))} Bs</span>
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="mt-6 flex flex-col items-center gap-1">
                            <p className="text-center text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                                Tasa BCV Aplicada: {formatBs(receipt.rate)} Bs/$
                            </p>
                            {receipt.tasaCop > 0 && (
                                <p className="text-center text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                                    Tasa COP Aplicada: {receipt.tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP/$
                                </p>
                            )}
                            <p className="text-center text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                                {new Date(receipt.timestamp).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Botones de acción — diseño premium */}
                <div className="p-3 sm:p-5 bg-white flex gap-2 relative z-20 shrink-0 border-t border-slate-100">
                    {/* Imprimir */}
                    <button onClick={async () => {
                        const isCarta = (localStorage.getItem('printer_mode') || 'thermal') === 'inkjet_carta';
                        if (!isCarta && PrinterSerial.isConnected()) {
                            await PrinterSerial.printTicket(receipt, currentRate || receipt.rate);
                        } else {
                            printThermalTicket(receipt, currentRate || receipt.rate);
                        }
                    }}
                        className="flex-1 py-3 bg-gradient-to-b from-slate-700 to-slate-800 text-white font-bold rounded-2xl hover:from-slate-600 hover:to-slate-700 transition-all shadow-lg shadow-slate-800/20 hover:shadow-xl hover:shadow-slate-800/30 text-xs sm:text-sm px-1.5 sm:px-3 whitespace-nowrap flex items-center justify-center gap-1.5 focus:outline-none active:scale-[0.97] hover:-translate-y-0.5">
                        <Printer className="w-3.5 h-3.5 sm:w-[17px] sm:h-[17px] shrink-0" strokeWidth={2.5} /> Imprimir
                    </button>

                    {/* WhatsApp */}
                    <button onClick={() => onShareWhatsApp(receipt)}
                        className="flex-1 py-3 bg-gradient-to-b from-emerald-500 to-emerald-600 text-white font-bold rounded-2xl hover:from-emerald-400 hover:to-emerald-500 transition-all shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/35 text-xs sm:text-sm px-1.5 sm:px-3 whitespace-nowrap flex items-center justify-center gap-1.5 focus:outline-none active:scale-[0.97] hover:-translate-y-0.5">
                        <Send className="w-3.5 h-3.5 sm:w-[17px] sm:h-[17px] shrink-0" strokeWidth={2.5} /> WhatsApp
                    </button>

                    {/* Nueva Venta — Primary CTA */}
                    <button onClick={onClose}
                        className="flex-[1.2] py-3 bg-gradient-to-b from-blue-500 to-blue-600 text-white font-extrabold rounded-2xl hover:from-blue-400 hover:to-blue-500 transition-all shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/35 text-xs sm:text-sm px-1.5 sm:px-3 whitespace-nowrap flex items-center justify-center gap-1.5 focus:outline-none active:scale-[0.97] hover:-translate-y-0.5 ring-2 ring-blue-400/30 ring-offset-2 ring-offset-white">
                        Nueva Venta
                    </button>
                </div>
            </div>
        </div>
    );
}
