import { useState, useEffect, useMemo } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { BarChart3, Calendar, Download, TrendingUp, ShoppingBag, DollarSign, Package, ChevronDown, ChevronUp, Clock, Send, Ban, Shuffle, Receipt, Search, X, Filter, Recycle, LockIcon } from 'lucide-react';
import { bindStorageContext } from '../utils/scopedStorage.js';
import { formatBs, formatVzlaPhone } from '../utils/calculatorUtils';
import { formatOfficialRate } from '../utils/rateResolver';
import { getPaymentLabel, getPaymentMethod, PAYMENT_ICONS, toTitleCase, getPaymentIcon } from '../config/paymentMethods';
import { generateTicketPDF } from '../utils/ticketGenerator';
import { useProductContext } from '../context/ProductContext';
import { useCart } from '../context/CartContext';
import EmptyState from '../components/EmptyState';
import { useConfirm } from '../hooks/confirmState';
import { getLocalISODate, getDateRange } from '../utils/dateHelpers';
import { calculateReportsData, groupSalesByCierreId } from '../utils/reportsProcessor';
import { processVoidSale } from '../utils/voidSaleProcessor';
import { loadClosures } from '../utils/closureService';
import { readSalesForSede } from '../utils/localRetention';
import { SEDES } from '../config/sedes';
import { canSeeConsolidatedReports } from '../config/permissionsFarmacia';
import { useSedeStore } from '../hooks/store/useSedeStore';
import { useAuthStore } from '../hooks/store/useAuthStore';
import CierreHistoryCard from '../components/Reports/CierreHistoryCard';
import StatCard from '../components/Reports/StatCard';
import TransactionRow from '../components/Reports/TransactionRow';
import PaymentBreakdown from '../components/Reports/PaymentBreakdown';
import CasheaIcon from '../components/CasheaIcon';
import { showToast } from '../components/Toast';


const RANGE_OPTIONS = [
    { id: 'today', label: 'Hoy' },
    { id: 'week', label: 'Esta Semana' },
    { id: 'month', label: 'Este Mes' },
    { id: 'lastMonth', label: 'Mes Anterior' },
    { id: 'custom', label: 'Personalizado' },
];


export default function ReportsView({ rates, triggerHaptic, onNavigate, isActive }) {
    const [storageService] = useState(bindStorageContext);
    const { products, adoptCommittedProducts: setProducts, effectiveRate: bcvRate, copEnabled, tasaCop } = useProductContext();
    const { loadCart } = useCart();
    const [allSales, setAllSales] = useState([]);
    const [closures, setClosures] = useState([]);
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
    const [recycleOffer, setRecycleOffer] = useState(null);
    const [openPaySections, setOpenPaySections] = useState({});

    // ── F3.10: فلتر السيدات (dueño/admin فقط) ──
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);
    const confirm = useConfirm();
    const canConsolidate = canSeeConsolidatedReports(usuarioActivo);
    const sedeActivaId = useSedeStore(s => s.sedeActivaId);
    const [sedeFilter, setSedeFilter] = useState(canConsolidate ? sedeActivaId : sedeActivaId);
    const effectiveSedeFilter = canConsolidate ? sedeFilter : sedeActivaId;
    const isMerged = canConsolidate && effectiveSedeFilter === 'todas';
    const canVoidHere = !isMerged && effectiveSedeFilter === sedeActivaId && usuarioActivo?.rol === 'DUENO';

    // ── Void Sale Handler ──
    const handleVoidSale = async (sale) => {
        if (!sale) return;
        const ok = await confirm({
            title: `Anular venta #${sale.id?.substring(0, 6).toUpperCase() || ''}`,
            message: 'Esta acción:\n- Marcará la venta como ANULADA\n- Devolverá el stock a la bodega\n- Revertirá deudas o saldos a favor\n\nEsta acción no se puede deshacer.',
            confirmText: 'Sí, anular',
            variant: 'danger',
        });
        if (!ok) return;
        if (!canVoidHere || (sale.huella?.sedeId || sale.sedeId) !== sedeActivaId) {
            showToast('Activa la sede de origen antes de anular esta venta.', 'error');
            return;
        }
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
            showToast(error.message || 'No se pudo anular la venta.', 'error');
        }
    };

    useEffect(() => {
        if (isActive === false) return; // Si es explicitamente false, abortamos
        let mounted = true;
        const load = async () => {
            setIsLoading(true);
            let merged = [];
            // readSalesForSede incluye el archivo de retención: los reportes
            // de rangos largos deben ver ventas viejas (utils/localRetention).
            if (canConsolidate && sedeFilter === 'todas') {
                const lists = await Promise.all(SEDES.map(s => readSalesForSede(storageService, s.id)));
                merged = lists.flat();
            } else if (canConsolidate && sedeFilter !== 'activa') {
                merged = await readSalesForSede(storageService, sedeFilter);
            } else {
                merged = await readSalesForSede(storageService, effectiveSedeFilter);
            }
            // Cierres: solo en modo sede activa (son datos sede-scoped)
            const savedClosures = effectiveSedeFilter !== 'todas'
                ? (await loadClosures({ ...storageService.context, sedeId: effectiveSedeFilter })).map(item => ({ ...item, sedeId: effectiveSedeFilter }))
                : (await Promise.all(SEDES.map(async sede => (await loadClosures({ ...storageService.context, sedeId: sede.id })).map(item => ({ ...item, sedeId: sede.id }))))).flat();
            if (mounted) {
                setAllSales(merged);
                setClosures(savedClosures);
                setIsLoading(false);
            }
        };
        load();
        return () => { mounted = false; };
    }, [isActive, sedeFilter, sedeActivaId, effectiveSedeFilter, canConsolidate]);

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
        salesCount, rateFallbackUsed, missingRateSaleIds,
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
            return groupSalesByCierreId(allSales, from, to, closures);
        }
        return [];
    }, [allSales, closures, from, to, activeTab]);

    const maxDayTotal = Math.max(...salesByDay.map(d => d.total), 1);

    // ── PDF Export ──
    const handleExportPDF = async () => {
        triggerHaptic && triggerHaptic();
        try {
            const { generateDailyCloseLetterPDF } = await import('../utils/dailyCloseGenerator');
            await generateDailyCloseLetterPDF({
                sales: salesForCashFlow,
                allSales: salesForStats,
                bcvRate,
                paymentBreakdown,
                topProducts,
                todayTotalUsd: totalUsd,
                todayTotalBs: totalBs,
                todayProfit: profit,
                todayItemsSold: totalItems,
                products,
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
                <div className="flex flex-wrap items-center gap-2">
                    <button
                        onClick={handleExportPDF}
                        disabled={salesForStats.length === 0 && salesForCashFlow.length === 0}
                        className="flex items-center gap-2 px-4 py-2.5 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold rounded-xl text-sm shadow-md shadow-indigo-500/20 active:scale-95 transition-all"
                    >
                        <Download size={16} /> Descargar PDF
                    </button>
                </div>
            </div>

            {missingRateSaleIds.length > 0 && <p role="status" className="rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/30 p-3 text-sm text-amber-900 dark:text-amber-100">
                {missingRateSaleIds.length} movimientos no tienen tasa histórica válida. {rateFallbackUsed ? 'La ganancia usa una tasa de referencia actual; no es una reconstrucción histórica exacta.' : 'No puede verificarse su ganancia en bolívares.'}
            </p>}
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

            {/* Filtro de sedes (solo dueño/admin) */}
            {canConsolidate && (
                <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1">
                    <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider shrink-0 flex items-center gap-1">
                        <Filter size={12} /> Sede:
                    </span>
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); setSedeFilter(sedeActivaId); }}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors active:scale-95 ${sedeFilter === sedeActivaId
                            ? 'bg-emerald-500 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                            }`}>
                        Sede activa
                    </button>
                    {SEDES.map(s => (
                        <button
                            key={s.id}
                            onClick={() => { triggerHaptic && triggerHaptic(); setSedeFilter(s.id); }}
                            className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors active:scale-95 ${sedeFilter === s.id
                                ? 'text-white shadow-sm'
                                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                                }`}
                            style={sedeFilter === s.id ? { backgroundColor: s.color } : {}}
                        >
                            {s.nombre}
                        </button>
                    ))}
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); setSedeFilter('todas'); }}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-colors active:scale-95 ${sedeFilter === 'todas'
                            ? 'bg-indigo-500 text-white shadow-sm'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800'
                            }`}>
                        Todas las sedes
                    </button>
                </div>
            )}

            {/* Custom Date Range */}
            {selectedRange === 'custom' && (
                <div className="flex flex-col sm:flex-row gap-3 bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800">
                    <div className="flex-1">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1 block">Desde</label>
                        <input
                            type="date"
                            value={customFrom}
                            onChange={e => setCustomFrom(e.target.value)}
                            className="w-full p-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-indigo-500/30"
                        />
                    </div>
                    <div className="flex-1">
                        <label className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase mb-1 block">Hasta</label>
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
                        <StatCard icon={ShoppingBag} label="Ventas" value={salesCount} color="emerald" />
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
            <PaymentBreakdown
                paymentBreakdown={paymentBreakdown}
                bcvRate={bcvRate}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                totalBs={totalBs}
                openPaySections={openPaySections}
                setOpenPaySections={setOpenPaySections}
            />

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
                                    <p className="text-xs text-slate-600 dark:text-slate-300">{p.qty} vendidos</p>
                                </div>
                                <span className="text-xs font-black text-indigo-600 dark:text-indigo-400">${p.revenue.toFixed(2)}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Transaction List Toggle */}
            {historySales.length > 0 && (() => {
                // Helper: una venta es "anulada" si tiene relatedVoidId (venta original)
                // o si es una transacción de reverso (ANULACION_VENTA).
                // En producción, status nunca llega a ser 'ANULADA'.
                const isVoidedOrReverso = (s) => !!s.relatedVoidId || s.tipo === 'ANULACION_VENTA';

                const searchedSales = historySales.filter(s => {
                    const matchesFilter = historyFilter === 'all'
                        || (historyFilter === 'completed' && !isVoidedOrReverso(s))
                        || (historyFilter === 'voided' && isVoidedOrReverso(s));
                    if (!matchesFilter) return false;
                    if (!historySearch.trim()) return true;
                    const q = historySearch.toLowerCase().replace(/^#/, '');
                    if ((s.customerName || 'consumidor final').toLowerCase().includes(q)) return true;
                    if (s.items && s.items.some(i => i.name.toLowerCase().includes(q))) return true;
                    if (s.id.toLowerCase().includes(q)) return true;
                    if (s.saleNumber && String(s.saleNumber).includes(q)) return true;
                    return false;
                });
                const completedInList = searchedSales.filter(s => !isVoidedOrReverso(s));
                const voidedInList = searchedSales.filter(s => isVoidedOrReverso(s));
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
                                        // En modo consolidado (todas las sedes) se desactiva anular:
                                        // la anulación solo toca el inventario de la sede activa.
                                        onVoidSale={canVoidHere ? handleVoidSale : null}
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
                            <CierreHistoryCard key={cierre.groupKey || cierre.cierreId} cierre={cierre} bcvRate={bcvRate} products={products} />
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


        </div>
    );
}

