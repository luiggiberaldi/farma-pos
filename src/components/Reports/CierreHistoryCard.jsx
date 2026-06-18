import React, { useState } from 'react';
import { ChevronDown, ChevronUp, LockIcon, Printer, DollarSign, Clock, CheckCircle2, AlertTriangle } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { getPaymentLabel, getPaymentIcon, toTitleCase, PAYMENT_ICONS } from '../../config/paymentMethods';
import { generateDailyClosePDF } from '../../utils/dailyCloseGenerator';
import { FinancialEngine } from '../../core/FinancialEngine';

export default function CierreHistoryCard({ cierre, bcvRate, products }) {
    const [isExpanded, setIsExpanded] = useState(false);

    const dateLabel = new Date(cierre.cierreId).toLocaleString('es-VE', { 
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit' 
    });

    const handlePrintPDF = (e) => {
        e.stopPropagation();
        
        // Filtrar ANULACION_VENTA para top-productos y profit:
        // tienen items con qty negativa que distorsionarían el ranking y el margen.
        const netSalesForStats = cierre.salesForStats.filter(s => s.tipo !== 'ANULACION_VENTA');

        const todayProductMap = {};
        netSalesForStats.forEach(s => {
            if (s.items) {
                s.items.forEach(item => {
                    if (!todayProductMap[item.name]) todayProductMap[item.name] = { name: item.name, qty: 0, revenue: 0 };
                    todayProductMap[item.name].qty += item.qty;
                    todayProductMap[item.name].revenue += item.priceUsd * item.qty;
                });
            }
        });
        const todayTopProducts = Object.values(todayProductMap).sort((a, b) => b.qty - a.qty).slice(0, 10);
        const todayProfit = FinancialEngine.calculateAggregateProfit(netSalesForStats, bcvRate, products);

        generateDailyClosePDF({
            sales: cierre.salesForCashFlow.filter(s => s.tipo !== 'APERTURA_CAJA'),
            allSales: cierre.salesForStats,
            bcvRate,
            paymentBreakdown: cierre.paymentBreakdown,
            topProducts: todayTopProducts,
            todayTotalUsd: cierre.totalUsd,
            todayTotalBs: cierre.totalBs,
            todayProfit,
            todayItemsSold: cierre.totalItems,
            reconData: null,
            apertura: cierre.apertura,
            isReprint: true
        });
    };

    const hasApertura = !!cierre.apertura;
    const fondoInicial = hasApertura ? (cierre.apertura.totalUsd || 0) : 0;
    const fondoInicialBs = hasApertura ? (cierre.apertura.totalBs || 0) : 0;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden mb-3 transition-all active:scale-[0.99] cursor-pointer" onClick={() => setIsExpanded(!isExpanded)}>
            <div className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                        <LockIcon size={20} className="text-slate-500" />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-800 dark:text-white flex items-center gap-2">
                            Cierre de Caja
                            <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded uppercase font-black">{cierre.salesCount} ops</span>
                        </p>
                        <p className="text-[11px] text-slate-400 capitalize">{dateLabel}</p>
                    </div>
                </div>
                <div className="text-right flex items-center gap-3">
                    <div>
                        <p className="text-sm font-black text-emerald-600 dark:text-emerald-400">${cierre.totalUsd.toFixed(2)}</p>
                        <p className="text-[10px] text-slate-400 font-medium">{formatBs(cierre.totalBs)} Bs</p>
                    </div>
                    {isExpanded ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                </div>
            </div>

            {isExpanded && (
                <div className="px-4 pb-4 border-t border-slate-100 dark:border-slate-800/50 cursor-auto animate-in fade-in slide-in-from-top-1" onClick={e => e.stopPropagation()}>
                    
                    {hasApertura && (
                        <div className="flex justify-between items-center py-3 border-b border-slate-100 dark:border-slate-800/50">
                            <span className="text-xs font-bold text-slate-500 uppercase flex items-center gap-1.5"><DollarSign size={14}/> Fondo de Apertura</span>
                            <span className="text-sm font-black text-slate-700 dark:text-slate-300">${fondoInicial.toFixed(2)} <span className="text-[10px] text-slate-400 ml-1">({formatBs(fondoInicialBs)} Bs)</span></span>
                        </div>
                    )}

                    <div className="py-3 space-y-2">
                        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2">Desglose de Ingresos</p>
                        {Object.keys(cierre.paymentBreakdown).length === 0 && (
                            <p className="text-xs text-slate-400">Sin movimientos</p>
                        )}
                        {Object.entries(cierre.paymentBreakdown).map(([method, data]) => {
                            const PayIcon = getPaymentIcon(method) || PAYMENT_ICONS[method] || CheckCircle2;
                            const label = toTitleCase(getPaymentLabel(method, data.label));
                            let displayAmount = `${formatBs(data.total)} Bs`;
                            if (data.currency === 'FIADO' || data.currency === 'USD') {
                                displayAmount = `$ ${data.total.toFixed(2)}`;
                            } else if (data.currency === 'COP') {
                                displayAmount = `${data.total.toLocaleString('es-CO')} COP`;
                            }
                            return (
                                <div key={method} className="flex justify-between items-center text-xs">
                                    <span className="text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                                        <PayIcon size={12} className="text-slate-400" /> {label}
                                    </span>
                                    <span className="font-bold text-slate-700 dark:text-slate-200">{displayAmount}</span>
                                </div>
                            );
                        })}
                    </div>

                    <div className="pt-3 mt-1 flex gap-2">
                        <button 
                            onClick={handlePrintPDF}
                            className="flex-1 py-2.5 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-100 font-bold rounded-xl text-xs flex items-center justify-center gap-1.5 transition-colors active:scale-95"
                        >
                            <Printer size={16} /> Re-imprimir PDF
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
