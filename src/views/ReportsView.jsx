import { useState, useEffect, useMemo } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { BarChart3, Calendar, Download, TrendingUp, ShoppingBag, DollarSign, Package, ChevronDown, ChevronUp, Clock, Send, Ban, Shuffle, Receipt, Search, X, Filter, Recycle, LockIcon } from 'lucide-react';
import { storageService } from '../utils/storageService';
import { formatBs, formatVzlaPhone } from '../utils/calculatorUtils';
import { getPaymentLabel, getPaymentMethod, PAYMENT_ICONS, toTitleCase, getPaymentIcon } from '../config/paymentMethods';
import { generateTicketPDF } from '../utils/ticketGenerator';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import EmptyState from '../components/EmptyState';
import ConfirmModal from '../components/ConfirmModal';
import { getLocalISODate, getDateRange } from '../utils/dateHelpers';
import { calculateReportsData, groupSalesByCierreId } from '../utils/reportsProcessor';
import { processVoidSale } from '../utils/voidSaleProcessor';
import CierreHistoryCard from '../components/Reports/CierreHistoryCard';
import CasheaIcon from '../components/CasheaIcon';

const SALES_KEY = 'bodega_sales_v1';

const RANGE_OPTIONS = [
    { id: 'today', label: 'Hoy' },
    { id: 'week', label: 'Esta Semana' },
    { id: 'month', label: 'Este Mes' },
    { id: 'lastMonth', label: 'Mes Anterior' },
    { id: 'custom', label: 'Personalizado' },
];


export default function ReportsView({ rates, triggerHaptic, onNavigate, isActive }) {
    const { products, setProducts, effectiveRate: bcvRate, copEnabled, tasaCop } = useProductContext();
    const { loadCart } = useCart();
    const [allSales, setAllSales] = useState([]);
    const [activeTab, setActiveTab] = useState('metrics');
    const [selectedRange, setSelectedRange] = useState('week');
    const [customFrom, setCustomFrom] = useState('');
    const [customTo, setCustomTo] = useState('');
    const [isLoading, setIsLoading] = useState(true);
    const [showHistory, setShowHistory] = useState(false);
    const [expandedSaleId, setExpandedSaleId] = useState(null);
    const [visibleCount, setVisibleCount] = useState(30);
    const [historySearch, setHistorySearch] = useState('');
    const [historyFilter, setHistoryFilter] = useState('all'); // all, completed, voided
    const [voidSaleTarget, setVoidSaleTarget] = useState(null);
    const [recycleOffer, setRecycleOffer] = useState(null);
    const [openPaySections, setOpenPaySections] = useState({});

    // ── Void Sale Handler ──
    const confirmVoidSale = async () => {
        const sale = voidSaleTarget;
        if (!sale) return;
        setVoidSaleTarget(null);
        try {
            const isPostCierre = sale.cajaCerrada;
            const voidOptions = isPostCierre ? {
                skipRestock: localStorage.getItem('void_cierre_restock') !== 'true',
                skipRevertMoney: localStorage.getItem('void_cierre_revert_money') !== 'true',
            } : {};
            const { updatedSales, updatedProducts } = await processVoidSale(sale, allSales, products, voidOptions);
            setProducts(updatedProducts);
            setAllSales(updatedSales);
            setRecycleOffer(sale);
        } catch (error) {
            console.error('Error anulando venta:', error);
        }
    };

    useEffect(() => {
        if (isActive === false) return; // Si es explicitamente false, abortamos
        let mounted = true;
        const load = async () => {
            const saved = await storageService.getItem(SALES_KEY, []);
            if (mounted) {
                setAllSales(saved);
                setIsLoading(false);
            }
        };
        load();
        return () => { mounted = false; };
    }, [isActive]);

    const { from, to } = useMemo(() => {
        if (selectedRange === 'custom') {
            return {
                from: customFrom || getLocalISODate(new Date()),
                to: customTo || getLocalISODate(new Date()),
            };
        }
        return getDateRange(selectedRange);
    }, [selectedRange, customFrom, customTo]);

    const { 
        salesForStats, 
        salesForCashFlow, 
        historySales, 
        totalUsd, 
        totalBs, 
        totalItems, 
        profit, 
        paymentBreakdown, 
        topProducts, 
        salesByDay 
    } = useMemo(() => calculateReportsData(allSales, from, to, bcvRate, products), [allSales, from, to, bcvRate, products]);

    const groupedClosings = useMemo(() => {
        if (activeTab === 'history') {
            return groupSalesByCierreId(allSales, from, to);
        }
        return [];
    }, [allSales, from, to, activeTab]);

    const maxDayTotal = Math.max(...salesByDay.map(d => d.total), 1);

    // ── PDF Export ──
    const handleExportPDF = async () => {
        triggerHaptic && triggerHaptic();
        try {
            const { generateDailyClosePDF } = await import('../utils/dailyCloseGenerator');
            await generateDailyClosePDF({
                sales: salesForCashFlow,
                allSales: salesForStats,
                bcvRate,
                paymentBreakdown,
                topProducts,
                todayTotalUsd: totalUsd,
                todayTotalBs: totalBs,
                todayProfit: profit,
                todayItemsSold: totalItems,
            });
        } catch (e) {
            console.error('Error generando PDF:', e);
        }
    };

    if (isLoading) {
        return (
            <div className="flex-1 p-3 sm:p-4 md:p-6 space-y-4">
                <div className="skeleton h-10 w-32" />
                <div className="flex gap-2">
                    <div className="skeleton h-9 w-20" />
                    <div className="skeleton h-9 w-24" />
                    <div className="skeleton h-9 w-20" />
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <div className="skeleton h-24" />
                    <div className="skeleton h-24" />
                    <div className="skeleton h-24" />
                    <div className="skeleton h-24" />
                </div>
                <div className="skeleton h-40" />
            </div>
        );
    }

    return (
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 md:p-5 space-y-4 md:space-y-4 pb-20 lg:pb-14">
            {/* Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h2 className="text-xl md:text-2xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                    <div className="bg-indigo-500 text-white p-1.5 md:p-2 rounded-xl shadow-lg shadow-indigo-500/30">
                        <BarChart3 size={20} />
                    </div>
                    Reportes
                </h2>
                <button
                    onClick={handleExportPDF}
                    disabled={salesForStats.length === 0 && salesForCashFlow.length === 0}
                    className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold rounded-xl text-sm shadow-md shadow-indigo-500/20 active:scale-95 transition-all"
                >
                    <Download size={16} /> Descargar PDF
                </button>
            </div>

            {/* Tab Selector */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setActiveTab('metrics'); }}
                    className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'metrics' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                >
                    <BarChart3 size={16} className="inline mr-1.5 align-text-bottom"/> Métricas de Ventas
                </button>
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setActiveTab('history'); }}
                    className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${activeTab === 'history' ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400'}`}
                >
                    <LockIcon size={16} className="inline mr-1.5 align-text-bottom"/> Cierres de Caja
                </button>
            </div>

            {/* Range Selector */}
            <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                {RANGE_OPTIONS.map(opt => (
                    <button
                        key={opt.id}
                        onClick={() => { triggerHaptic && triggerHaptic(); setSelectedRange(opt.id); }}
                        className={`px-4 py-1.5 rounded-full text-sm font-bold whitespace-nowrap transition-colors active:scale-95 ${selectedRange === opt.id
                            ? 'bg-indigo-500 text-white shadow-sm shadow-indigo-500/30'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                            }`}
                    >
                        {opt.label}
                    </button>
                ))}
            </div>

            {/* Custom Date Range */}
            {selectedRange === 'custom' && (
                <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
                    <div className="flex-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Desde</label>
                        <input
                            type="date"
                            value={customFrom}
                            onChange={e => setCustomFrom(e.target.value)}
                            className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-[10px] font-bold text-slate-400 uppercase mb-1 block">Hasta</label>
                        <input
                            type="date"
                            value={customTo}
                            onChange={e => setCustomTo(e.target.value)}
                            className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                    </div>
                </div>
            )}

            {activeTab === 'metrics' ? (
                <>
                    {/* Summary Cards — Responsive grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                        <StatCard icon={ShoppingBag} label="Ventas" value={salesForStats.length} color="emerald" />
                        <StatCard icon={DollarSign} label="Ingresos" value={`$${totalUsd.toFixed(2)}`} sub={`${formatBs(totalBs)} Bs`} color="blue" />
                        <StatCard icon={TrendingUp} label="Ganancia" value={bcvRate > 0 ? `$${(profit / bcvRate).toFixed(2)}` : '$0.00'} sub={`${formatBs(profit)} Bs`} color="indigo" />
                        <StatCard icon={Package} label="Artículos" value={totalItems} color="amber" />
                    </div>

                    {/* Mini bar chart per day */}
            {salesByDay.length > 1 && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm mt-4">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-1">
                        <Calendar size={12} /> Ventas por Día
                    </h3>
                    <div className="flex items-end gap-1 h-24">
                        {salesByDay.map((day, i) => {
                            const pct = (day.total / maxDayTotal) * 100;
                            const dayLabel = new Date(day.date + 'T12:00:00').toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });
                            return (
                                <div key={day.date} className="flex-1 flex flex-col items-center gap-0.5">
                                    <span className="text-[8px] font-bold text-slate-400">${day.total.toFixed(0)}</span>
                                    <div className="w-full flex justify-center">
                                        <div
                                            className="w-full max-w-[24px] rounded-t-md bg-gradient-to-t from-indigo-500 to-indigo-400 transition-all duration-500"
                                            style={{ height: `${Math.max(pct, 6)}%`, minHeight: '3px' }}
                                        />
                                    </div>
                                    <span className="text-[8px] text-slate-400 font-medium leading-none">{dayLabel}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* Payment Breakdown */}
            {Object.keys(paymentBreakdown).length > 0 && (() => {
                const entries = Object.entries(paymentBreakdown);
                const fiadoMethods = entries.filter(([, d]) => d.currency === 'FIADO');
                const casheaMethods = entries.filter(([k, d]) => k === 'cashea' && d.total > 0);
                const bsIncomeMethods = entries.filter(([k, d]) => (d.currency === 'BS' || (!d.currency)) && !d.isChange);
                const vueltoMethods = entries.filter(([, d]) => d.isChange === true && d.currency !== 'USD');
                const vueltoUsdMethods = entries.filter(([, d]) => d.isChange === true && d.currency === 'USD');
                const bsMethods = [...bsIncomeMethods, ...vueltoMethods];
                const usdIncomeMethods = entries.filter(([k, d]) => d.currency === 'USD' && !d.isChange && k !== 'cashea');
                const usdMethods = [...usdIncomeMethods, ...vueltoUsdMethods];
                const copMethods = entries.filter(([, d]) => d.currency === 'COP');
                const fmtCop = (v) => v.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                const renderMethod = ([method, data]) => {
                    const label = data.label || toTitleCase(getPaymentLabel(method, data.label));
                    const PayIcon = getPaymentIcon(method) || PAYMENT_ICONS[method];
                    let totalBsEquiv = data.total;
                    let pct = 0;
                    let displayAmount = `${formatBs(data.total)} Bs`;

                    if (data.currency === 'FIADO') {
                        // Fiado saves its total in USD, so equivalent is total * bcvRate
                        totalBsEquiv = data.total * bcvRate;
                        // For fiado, we might not want to include it in the same percentage bar scaling, but if we do:
                        pct = totalBs > 0 ? (totalBsEquiv / totalBs * 100) : 0;
                        displayAmount = `$ ${data.total.toFixed(2)}`;
                    } else if (data.currency === 'USD') {
                        totalBsEquiv = data.total * bcvRate;
                        pct = totalBs > 0 ? (totalBsEquiv / totalBs * 100) : 0;
                        displayAmount = `$ ${data.total.toFixed(2)}`;
                    } else if (data.currency === 'COP') {
                        totalBsEquiv = (data.total / (tasaCop || 1)) * bcvRate;
                        pct = totalBs > 0 ? (totalBsEquiv / totalBs * 100) : 0;
                        displayAmount = `${fmtCop(data.total)} COP`;
                    } else {
                        pct = totalBs > 0 ? (data.total / totalBs * 100) : 0;
                    }

                    const isChange = data.isChange === true;

                    return (
                        <div key={method}>
                            <div className="flex justify-between text-sm mb-1">
                                <span className={`font-medium flex items-center gap-1.5 ${isChange ? 'text-orange-500 dark:text-orange-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                    {PayIcon && <PayIcon size={14} className={isChange ? 'text-orange-400' : 'text-slate-400'} />}
                                    {label}
                                </span>
                                <div className="text-right">
                                    <span className={`font-bold ${isChange ? 'text-orange-500 dark:text-orange-400' : 'text-slate-700 dark:text-white'}`}>
                                        {isChange ? '− ' : ''}{displayAmount}
                                    </span>
                                    {data.currency === 'FIADO' && (
                                        <div className="text-[10px] text-slate-400 font-medium">
                                            {formatBs(totalBsEquiv)} Bs
                                        </div>
                                    )}
                                </div>
                            </div>
                            {!isChange && data.currency !== 'FIADO' && (
                                <div className="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                                    <div className="h-full rounded-full transition-all bg-indigo-500" style={{ width: `${pct}%` }} />
                                </div>
                            )}
                        </div>
                    );
                };

                const netBs = bsIncomeMethods.reduce((s, [,d]) => s + d.total, 0) - vueltoMethods.reduce((s, [,d]) => s + d.total, 0);
                const netUsd = usdIncomeMethods.reduce((s, [,d]) => s + d.total, 0) - vueltoUsdMethods.reduce((s, [,d]) => s + d.total, 0);
                const totalPorCobrar = fiadoMethods.reduce((s, [,d]) => s + d.total, 0) + casheaMethods.reduce((s, [,d]) => s + d.total, 0);
                const totalCop = copMethods.reduce((s, [,d]) => s + d.total, 0);
                const toggleSection = (key) => setOpenPaySections(prev => ({ ...prev, [key]: !prev[key] }));

                const renderSimpleMethod = ([method, data]) => {
                    const label = data.label || toTitleCase(getPaymentLabel(method, data.label));
                    const PayIcon = getPaymentIcon(method) || PAYMENT_ICONS[method];
                    const isChange = data.isChange === true;
                    let displayAmount = `${formatBs(data.total)} Bs`;
                    if (data.currency === 'USD' || data.currency === 'FIADO') displayAmount = `$ ${data.total.toFixed(2)}`;
                    else if (data.currency === 'COP') displayAmount = `${fmtCop(data.total)} COP`;
                    return (
                        <div key={method} className="flex justify-between items-center py-1.5">
                            <span className={`text-xs font-medium flex items-center gap-1.5 ${isChange ? 'text-orange-500 dark:text-orange-400' : 'text-slate-600 dark:text-slate-300'}`}>
                                {PayIcon && <PayIcon size={13} className={isChange ? 'text-orange-400' : 'text-slate-400'} />}
                                {label}
                            </span>
                            <span className={`text-xs font-bold ${isChange ? 'text-orange-500 dark:text-orange-400' : 'text-slate-700 dark:text-white'}`}>
                                {isChange ? '− ' : ''}{displayAmount}
                            </span>
                        </div>
                    );
                };

                const AccordionSection = ({ sectionKey, color, label, netLabel, children }) => {
                    const isOpen = openPaySections[sectionKey];
                    const colors = {
                        blue: { bg: 'bg-blue-50 dark:bg-blue-950/30', border: 'border-blue-200 dark:border-blue-800/40', text: 'text-blue-700 dark:text-blue-300', label: 'text-blue-500' },
                        emerald: { bg: 'bg-emerald-50 dark:bg-emerald-950/30', border: 'border-emerald-200 dark:border-emerald-800/40', text: 'text-emerald-700 dark:text-emerald-300', label: 'text-emerald-500' },
                        amber: { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border-amber-200 dark:border-amber-800/40', text: 'text-amber-700 dark:text-amber-300', label: 'text-amber-500' },
                    }[color];
                    return (
                        <div className={`rounded-xl border ${colors.border} overflow-hidden`}>
                            <button onClick={() => toggleSection(sectionKey)} className={`w-full flex items-center justify-between px-3 py-2.5 ${colors.bg} transition-colors`}>
                                <span className={`text-[10px] font-bold uppercase tracking-wider ${colors.label}`}>{label}</span>
                                <div className="flex items-center gap-2">
                                    <span className={`text-sm font-black ${colors.text}`}>{netLabel}</span>
                                    {isOpen ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                                </div>
                            </button>
                            {isOpen && <div className="px-3 py-2 divide-y divide-slate-100 dark:divide-slate-800">{children}</div>}
                        </div>
                    );
                };

                return (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-1">
                        <DollarSign size={12} /> Desglose por Método de Pago
                    </h3>

                    {/* Summary bar */}
                    <div className="grid grid-cols-2 gap-2 mb-4">
                        {bsMethods.length > 0 && (
                            <div className="bg-blue-50 dark:bg-blue-950/30 rounded-xl px-3 py-2 text-center">
                                <p className="text-[10px] font-bold text-blue-400 uppercase">Bs Neto</p>
                                <p className="text-base font-black text-blue-700 dark:text-blue-300">{formatBs(netBs)}</p>
                            </div>
                        )}
                        {usdMethods.length > 0 && (
                            <div className="bg-emerald-50 dark:bg-emerald-950/30 rounded-xl px-3 py-2 text-center">
                                <p className="text-[10px] font-bold text-emerald-400 uppercase">$ Neto</p>
                                <p className="text-base font-black text-emerald-700 dark:text-emerald-300">${netUsd.toFixed(2)}</p>
                            </div>
                        )}
                        {(fiadoMethods.length > 0 || casheaMethods.length > 0) && (
                            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl px-3 py-2 text-center">
                                <p className="text-[10px] font-bold text-amber-400 uppercase">Por Cobrar</p>
                                <p className="text-base font-black text-amber-700 dark:text-amber-300">${totalPorCobrar.toFixed(2)}</p>
                            </div>
                        )}
                        {copEnabled && copMethods.length > 0 && (
                            <div className="bg-amber-50 dark:bg-amber-950/30 rounded-xl px-3 py-2 text-center">
                                <p className="text-[10px] font-bold text-amber-400 uppercase">COP</p>
                                <p className="text-base font-black text-amber-700 dark:text-amber-300">{fmtCop(totalCop)}</p>
                            </div>
                        )}
                    </div>

                    {/* Accordion sections */}
                    <div className="space-y-2">
                        {bsMethods.length > 0 && (
                            <AccordionSection sectionKey="bs" color="blue" label="Bolívares" netLabel={`${formatBs(netBs)} Bs`}>
                                {bsIncomeMethods.map(renderSimpleMethod)}
                                {vueltoMethods.length > 0 && vueltoMethods.map(renderSimpleMethod)}
                            </AccordionSection>
                        )}
                        {usdMethods.length > 0 && (
                            <AccordionSection sectionKey="usd" color="emerald" label="Dólares" netLabel={`$${netUsd.toFixed(2)}`}>
                                {usdIncomeMethods.map(renderSimpleMethod)}
                                {vueltoUsdMethods.length > 0 && vueltoUsdMethods.map(renderSimpleMethod)}
                            </AccordionSection>
                        )}
                        {(fiadoMethods.length > 0 || casheaMethods.length > 0) && (
                            <AccordionSection sectionKey="cobrar" color="amber" label="Por Cobrar" netLabel={`$${totalPorCobrar.toFixed(2)}`}>
                                {fiadoMethods.map(renderSimpleMethod)}
                                {casheaMethods.map(([method, data]) => (
                                    <div key={method} className="flex justify-between items-center py-1.5">
                                        <span className="text-xs font-medium flex items-center gap-1.5 text-purple-600 dark:text-purple-400">
                                            <CasheaIcon size={13} /> Cashea
                                        </span>
                                        <span className="text-xs font-bold text-purple-600 dark:text-purple-400">$ {data.total.toFixed(2)}</span>
                                    </div>
                                ))}
                            </AccordionSection>
                        )}
                        {copEnabled && copMethods.length > 0 && (
                            <AccordionSection sectionKey="cop" color="amber" label="Pesos Colombianos" netLabel={`${fmtCop(totalCop)} COP`}>
                                {copMethods.map(renderSimpleMethod)}
                            </AccordionSection>
                        )}
                    </div>
                </div>
                );
            })()}

            {/* Top Products */}
            {topProducts.length > 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                    <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-1">
                        <TrendingUp size={12} /> Top Productos
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {topProducts.map((p, i) => (
                            <div key={p.name} className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800 rounded-xl p-2.5">
                                <span className={`w-6 h-6 rounded-lg flex items-center justify-center text-[10px] font-black ${i < 3 ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400' : 'bg-slate-100 dark:bg-slate-700 text-slate-400'
                                    }`}>{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{p.name}</p>
                                    <p className="text-[10px] text-slate-400">{p.qty} vendidos</p>
                                </div>
                                <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">${p.revenue.toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Transaction List Toggle */}
            {historySales.length > 0 && (() => {
                const searchedSales = historySales.filter(s => {
                    const matchesFilter = historyFilter === 'all'
                        || (historyFilter === 'completed' && s.status !== 'ANULADA')
                        || (historyFilter === 'voided' && s.status === 'ANULADA');
                    if (!matchesFilter) return false;
                    if (!historySearch.trim()) return true;
                    const q = historySearch.toLowerCase().replace(/^#/, '');
                    if ((s.customerName || 'consumidor final').toLowerCase().includes(q)) return true;
                    if (s.items && s.items.some(i => i.name.toLowerCase().includes(q))) return true;
                    if (s.id.toLowerCase().includes(q)) return true;
                    if (s.saleNumber && String(s.saleNumber).includes(q)) return true;
                    return false;
                });
                const completedInList = searchedSales.filter(s => s.status !== 'ANULADA');
                const voidedInList = searchedSales.filter(s => s.status === 'ANULADA');
                const sumUsd = completedInList.reduce((a, s) => a + (s.totalUsd || 0), 0);

                return (
                    <div className="mt-2">
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); setShowHistory(h => !h); setVisibleCount(30); setHistorySearch(''); setHistoryFilter('all'); }}
                            className="w-full flex items-center justify-between bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm active:scale-[0.99] transition-all"
                        >
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-indigo-100 dark:bg-indigo-900/30 rounded-lg flex items-center justify-center">
                                    <Clock size={16} className="text-indigo-600 dark:text-indigo-400" />
                                </div>
                                <div className="text-left">
                                    <p className="text-xs font-bold text-slate-700 dark:text-white">Listado de Transacciones</p>
                                    <p className="text-[10px] text-slate-400">{historySales.length} {historySales.length === 1 ? 'transacción' : 'transacciones'} en este periodo</p>
                                </div>
                            </div>
                            {showHistory ? <ChevronUp size={18} className="text-slate-400" /> : <ChevronDown size={18} className="text-slate-400" />}
                        </button>

                        {showHistory && (
                            <div className="mt-3 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                                {/* Search + Filter Bar */}
                                <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-100 dark:border-slate-800 p-3 space-y-2">
                                    <div className="relative">
                                        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                        <input
                                            type="text"
                                            value={historySearch}
                                            onChange={e => { setHistorySearch(e.target.value); setVisibleCount(30); }}
                                            placeholder="Buscar por cliente, producto, #correlativo..."
                                            className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg py-2 pl-9 pr-8 text-xs font-medium text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                                        />
                                        {historySearch && (
                                            <button onClick={() => setHistorySearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        {[{ id: 'all', label: 'Todas' }, { id: 'completed', label: 'Completadas' }, { id: 'voided', label: 'Anuladas' }].map(f => (
                                            <button
                                                key={f.id}
                                                onClick={() => { setHistoryFilter(f.id); setVisibleCount(30); }}
                                                className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${historyFilter === f.id
                                                    ? 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 shadow-sm'
                                                    : 'bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600'}`}
                                            >{f.label}</button>
                                        ))}
                                        <div className="flex-1" />
                                        <span className="text-[10px] font-bold text-slate-400">{searchedSales.length} resultado{searchedSales.length !== 1 ? 's' : ''}</span>
                                    </div>
                                </div>

                                {/* Mini Summary Strip */}
                                {searchedSales.length > 0 && (
                                    <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl px-3 py-2 text-[10px] font-bold text-slate-500">
                                        <span className="flex items-center gap-1"><DollarSign size={12} className="text-emerald-500" /> ${sumUsd.toFixed(2)}</span>
                                        <span className="w-px h-3 bg-slate-300 dark:bg-slate-700" />
                                        <span>{completedInList.length} venta{completedInList.length !== 1 ? 's' : ''}</span>
                                        {voidedInList.length > 0 && (
                                            <><span className="w-px h-3 bg-slate-300 dark:bg-slate-700" /><span className="text-red-400">{voidedInList.length} anulada{voidedInList.length !== 1 ? 's' : ''}</span></>
                                        )}
                                    </div>
                                )}

                                {/* Transaction Rows */}
                                {searchedSales.slice(0, visibleCount).map(s => (
                                    <TransactionRow
                                        key={s.id}
                                        sale={s}
                                        bcvRate={bcvRate}
                                        isExpanded={expandedSaleId === s.id}
                                        onToggle={() => setExpandedSaleId(prev => prev === s.id ? null : s.id)}
                                        onVoidSale={setVoidSaleTarget}
                                        onRecycleSale={setRecycleOffer}
                                    />
                                ))}

                                {searchedSales.length === 0 && (
                                    <div className="text-center py-6">
                                        <Search size={24} className="text-slate-300 mx-auto mb-2" />
                                        <p className="text-xs font-bold text-slate-400">Sin resultados para esta busqueda</p>
                                    </div>
                                )}

                                {visibleCount < searchedSales.length && (
                                    <button
                                        onClick={() => setVisibleCount(c => c + 30)}
                                        className="w-full py-3 text-xs font-bold text-indigo-500 bg-indigo-50 dark:bg-indigo-900/20 rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/30 transition-colors active:scale-[0.98]"
                                    >
                                        Mostrar mas ({searchedSales.length - visibleCount} restantes)
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                );
            })()}

            {/* Empty state */}
            {salesForStats.length === 0 && salesForCashFlow.length === 0 && (
                <div className="mt-8">
                    <EmptyState
                        icon={BarChart3}
                        title="Sin ventas en este periodo"
                        description="Selecciona otro rango de fechas o usa el boton Personalizado para buscar mas atras."
                    />
                </div>
            )}
            </>
            ) : (
                <div className="animate-in fade-in slide-in-from-bottom-2 duration-300">
                    {groupedClosings.length > 0 ? (
                        groupedClosings.map(cierre => (
                            <CierreHistoryCard key={cierre.cierreId} cierre={cierre} bcvRate={bcvRate} products={products} />
                        ))
                    ) : (
                        <div className="mt-8">
                            <EmptyState
                                icon={LockIcon}
                                title="Sin cierres de caja registrados"
                                description="No se encontraron operaciones de cierre en el rango de fechas seleccionado."
                            />
                        </div>
                    )}
                </div>
            )}
            {/* Recycle Offer Modal */}
            {recycleOffer && (
                <div className="fixed inset-0 z-[100] bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
                    onClick={() => setRecycleOffer(null)}>
                    <div className="bg-white dark:bg-slate-900 w-full sm:max-w-xs sm:rounded-2xl rounded-t-[2rem] p-5 shadow-2xl animate-in slide-in-from-bottom-4 duration-200"
                        onClick={e => e.stopPropagation()}>
                        <div className="flex flex-col items-center gap-2 mb-4">
                            <div className="w-12 h-12 bg-indigo-100 dark:bg-indigo-900/30 rounded-full flex items-center justify-center text-indigo-600">
                                <Recycle size={28} />
                            </div>
                            <h3 className="text-sm font-black text-slate-800 dark:text-white">Venta Anulada</h3>
                            <p className="text-[11px] text-slate-400 text-center">Puedes reciclar los productos de esta venta al carrito actual.</p>
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={() => setRecycleOffer(null)}
                                className="flex-1 py-2.5 text-xs font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl transition-all active:scale-95"
                            >Cerrar</button>
                            <button
                                onClick={() => {
                                    loadCart(recycleOffer.items);
                                    setRecycleOffer(null);
                                    if (onNavigate) onNavigate('ventas');
                                }}
                                className="flex-1 py-2.5 text-xs font-bold text-white bg-indigo-600 rounded-xl shadow-md shadow-indigo-500/20 transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            ><Recycle size={16} /> Reciclar</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Void Modal */}
            <ConfirmModal
                isOpen={!!voidSaleTarget}
                onClose={() => setVoidSaleTarget(null)}
                onConfirm={confirmVoidSale}
                title={`Anular venta #${voidSaleTarget?.id?.substring(0, 6).toUpperCase() || ''}`}
                message={'Esta accion:\n- Marcara la venta como ANULADA\n- Devolvera el stock a la bodega\n- Revertira deudas o saldos a favor\n\nEsta accion no se puede deshacer.'}
                confirmText="Si, anular"
            />
        </div>
    );
}

function StatCard({ icon: Icon, label, value, sub, color }) {
    const colors = {
        emerald: 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400',
        blue: 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400',
        indigo: 'bg-indigo-100 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400',
        amber: 'bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400',
    };
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 md:p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center mb-2 ${colors[color]}`}>
                <Icon size={16} />
            </div>
            <p className="text-[10px] font-bold text-slate-400 uppercase">{label}</p>
            <p className="text-lg md:text-xl font-black text-slate-800 dark:text-white mt-0.5">{value}</p>
            {sub && <p className="text-xs font-bold text-slate-400 mt-0.5">{sub}</p>}
        </div>
    );
}

function TransactionRow({ sale: s, bcvRate, isExpanded, onToggle, onVoidSale, onRecycleSale }) {
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
        // Show the client's real payment method (non-cashea payment) as the label
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

    const isCanceled = s.status === 'ANULADA' || !!s.relatedVoidId;
    const dateLabel = d.toLocaleDateString('es-VE', { day: '2-digit', month: 'short' });

    const handleShare = (e) => {
        e.stopPropagation();
        let text = `*COMPROBANTE | LISTO POS LITE*\n`;
        text += `Orden: #${s.id.substring(0, 6).toUpperCase()}\n`;
        text += `Fecha: ${d.toLocaleString('es-VE')}\n`;
        text += `================================\n`;
        if (s.items && s.items.length > 0) {
            s.items.forEach(item => {
                const qty = item.isWeight ? `${item.qty.toFixed(3)}Kg` : `${item.qty} Und`;
                text += `- ${item.name} ${qty} x $${item.priceUsd.toFixed(2)} = *$${(item.priceUsd * item.qty).toFixed(2)}*\n`;
            });
        }
        text += `\n*TOTAL: $${(s.totalUsd || 0).toFixed(2)}*\n`;
        text += `Ref: ${formatBs(s.totalBs || 0)} Bs\n`;
        const encoded = encodeURIComponent(text);
        window.open(`https://wa.me/?text=${encoded}`, '_blank');
    };

    const handlePDF = (e) => {
        e.stopPropagation();
        generateTicketPDF(s, bcvRate);
    };

    return (
        <div className={`rounded-xl border transition-all ${isCanceled ? 'bg-red-50/50 border-red-100/50 dark:bg-red-900/10 dark:border-red-900/20' : 'bg-white dark:bg-slate-800/50 border-slate-200/60 dark:border-slate-700/60'} overflow-hidden`}>
            <div
                className="flex items-center gap-3 p-3 cursor-pointer select-none active:bg-slate-100 dark:active:bg-slate-800"
                onClick={onToggle}
            >
                <div className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${isCanceled ? 'bg-red-100 opacity-50' : 'bg-slate-50 dark:bg-slate-700 shadow-sm'}`}>
                    {isCanceled ? <Ban size={20} className="text-red-400" /> : (PayMethodIcon ? <PayMethodIcon size={20} className="text-slate-500" /> : <span className="text-xl">$</span>)}
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
                        <span>{dateLabel}</span> · <span>{d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</span> · <span>{methodLabel}</span>
                    </p>
                </div>
                <div className="text-right shrink-0">
                    <p className={`text-sm font-black ${isCanceled ? 'text-slate-400' : 'text-slate-800 dark:text-white'}`}>
                        {s.totalUsd < 0 ? `-$${Math.abs(s.totalUsd).toFixed(2)}` : `$${(s.totalUsd || 0).toFixed(2)}`}
                    </p>
                    <p className="text-[10px] text-slate-400 font-medium">
                        {s.totalBs < 0 ? `-${formatBs(Math.abs(s.totalBs))} Bs` : `${formatBs(s.totalBs || (s.totalUsd * (s.rate || bcvRate)))} Bs`}
                    </p>
                    <div className="flex justify-end mt-0.5">
                        {isExpanded ? <ChevronUp size={14} className="text-slate-400" /> : <ChevronDown size={14} className="text-slate-400" />}
                    </div>
                </div>
            </div>

            {isExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-slate-200 dark:border-slate-700/50 text-sm animate-in fade-in slide-in-from-top-1">
                    {s.items && s.items.length > 0 ? (
                        <div className="space-y-1 mb-3 pt-2">
                            <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Productos ({s.items.length})</p>
                            {s.items.map((item, i) => (
                                <div key={i} className={`flex justify-between items-center text-xs ${isCanceled ? 'text-slate-400 line-through' : 'text-slate-600 dark:text-slate-300'}`}>
                                    <span className="truncate pr-2">{item.isWeight ? `${item.qty.toFixed(3)}kg` : `${item.qty}u`} {item.name}</span>
                                    <span className="font-medium">${(item.priceUsd * item.qty).toFixed(2)}</span>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-xs text-slate-400 mb-3 pt-2">Pago de Deudas (Sin productos)</p>
                    )}

                    <div className="bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-xl p-2.5 mb-3 space-y-1.5">
                        <p className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-2">Resumen de cobro</p>

                        <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-500">Total en Bs</span>
                            <span className="font-bold text-slate-700 dark:text-slate-200">{formatBs(s.totalBs)} Bs</span>
                        </div>

                        <div className="flex justify-between items-center text-[11px]">
                            <span className="text-slate-400">Tasa BCV aplicada</span>
                            <span className="text-slate-400">{formatBs(s.rate || bcvRate)} Bs/$</span>
                        </div>

                        {s.tasaCop > 0 && (
                            <div className="flex justify-between items-center text-[11px]">
                                <span className="text-slate-500">Total en COP</span>
                                <span className="font-bold text-amber-600">{(s.totalCop || (s.totalUsd * s.tasaCop)).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP</span>
                            </div>
                        )}

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

                        {s.fiadoUsd > 0 && (
                            <div className="flex justify-between items-center text-[11px] border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">
                                <span className="text-amber-600 font-bold">Pendiente (fiado)</span>
                                <div className="text-right">
                                    <div className="font-bold text-amber-600">${s.fiadoUsd.toFixed(2)}</div>
                                    <div className="text-amber-500 text-[10px]">{formatBs(s.fiadoUsd * (s.rate || bcvRate))} Bs</div>
                                </div>
                            </div>
                        )}

                        {s.casheaUsd > 0 && (
                            <div className="flex justify-between items-center text-[11px] border-t border-slate-100 dark:border-slate-800 pt-1.5 mt-1">
                                <span className="text-purple-600 font-bold flex items-center gap-1"><CasheaIcon size={11} />Cashea (por cobrar)</span>
                                <div className="text-right">
                                    <div className="font-bold text-purple-600">${s.casheaUsd.toFixed(2)}</div>
                                    <div className="text-purple-400 text-[10px]">{formatBs(s.casheaUsd * (s.rate || bcvRate))} Bs</div>
                                </div>
                            </div>
                        )}

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

                    <div className="flex flex-wrap items-center gap-2 mt-2">
                        <button
                            onClick={handleShare}
                            className="flex-1 min-w-[120px] whitespace-nowrap py-2 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 active:scale-95"
                        >
                            <Send size={14} /> Compartir
                        </button>
                        <button
                            onClick={handlePDF}
                            className="py-2 px-3 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 hover:bg-blue-200 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                        >
                            PDF
                        </button>
                        {!isCanceled && onVoidSale && !s.cajaCerrada && s.tipo !== 'ANULACION_VENTA' && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onVoidSale(s); }}
                                className="py-2 px-3 bg-slate-100 dark:bg-slate-900 text-red-600 dark:text-red-400 hover:bg-red-50 hover:dark:bg-red-900/30 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs border border-slate-200 dark:border-slate-800 shadow-sm active:scale-95"
                            >
                                <Ban size={14} /> Anular
                            </button>
                        )}
                        {!isCanceled && s.cajaCerrada && s.tipo !== 'ANULACION_VENTA' && (
                            <div title="Venta protegida por Cierre de Caja" className="py-2 px-3 bg-slate-50 dark:bg-slate-900 text-slate-400 font-bold rounded-lg flex justify-center items-center gap-1.5 text-[10px] uppercase border border-slate-100 dark:border-slate-800 tracking-wider cursor-not-allowed">
                                <LockIcon size={12} /> Cerrada
                            </div>
                        )}
                        {onRecycleSale && s.items && s.items.length > 0 && (
                            <button
                                onClick={(e) => { e.stopPropagation(); onRecycleSale(s); }}
                                className="py-2 px-3 bg-indigo-100 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-400 hover:bg-indigo-200 hover:dark:bg-indigo-900/50 font-bold rounded-lg transition-colors flex justify-center items-center gap-1.5 text-xs shadow-sm active:scale-95"
                            >
                                <Recycle size={14} />
                            </button>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
