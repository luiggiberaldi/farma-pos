import React, { useState, useEffect } from 'react';
import { Eye, Store, DollarSign, ShoppingCart, AlertTriangle, Ban, TrendingUp, LogOut, RefreshCw, ChevronRight } from 'lucide-react';
import { fetchBranchSnapshots } from '../../services/monitorSyncService';
import { getLocalISODate } from '../../utils/dateHelpers';

/**
 * Dashboard del modo Monitor — solo lectura para el dueño.
 * Muestra resumen general multi-sede y detalle por sede.
 */
export default function MonitorDashboard({ onExit }) {
    const [snapshots, setSnapshots] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedBranch, setSelectedBranch] = useState(null);
    const [lastUpdate, setLastUpdate] = useState(null);

    const loadData = async () => {
        setLoading(true);
        // Intentar subir snapshot local antes de leer (si hay datos locales)
        try {
            const { uploadBranchSnapshot } = await import('../../services/monitorSyncService');
            await uploadBranchSnapshot();
        } catch { /* silencioso: la lectura no depende de la subida */ }
        const data = await fetchBranchSnapshots();
        setSnapshots(data);
        setLastUpdate(new Date());
        setLoading(false);
    };

    useEffect(() => {
        loadData();
        // Actualizar cada 2 minutos
        const timer = setInterval(loadData, 2 * 60 * 1000);
        return () => clearInterval(timer);
    }, []);

    // Totales consolidados
    const totals = snapshots.reduce((acc, s) => ({
        salesUsd: acc.salesUsd + (Number(s.total_sales_usd) || 0),
        salesBs: acc.salesBs + (Number(s.total_sales_bs) || 0),
        transactions: acc.transactions + (Number(s.transaction_count) || 0),
        voids: acc.voids + (Number(s.voids_count) || 0),
    }), { salesUsd: 0, salesBs: 0, transactions: 0, voids: 0 });

    const openBranches = snapshots.filter(s => s.cash_register_open).length;

    if (selectedBranch) {
        return <MonitorBranchDetail branch={selectedBranch} onBack={() => setSelectedBranch(null)} />;
    }

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-8 overflow-y-auto">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-4 sm:py-6 shadow-lg">
                <div className="flex items-center justify-between max-w-4xl mx-auto gap-2">
                    <div className="flex items-center gap-3 min-w-0">
                        <div className="bg-white/20 p-2.5 rounded-2xl shrink-0">
                            <Eye size={24} />
                        </div>
                        <div className="min-w-0">
                            <h1 className="text-lg sm:text-xl font-black truncate">Monitor de Supervisión</h1>
                            <p className="text-xs text-white/70">Solo lectura · {getLocalISODate(new Date())}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                        <button onClick={loadData} className="p-2.5 bg-white/20 rounded-xl hover:bg-white/30 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center" title="Actualizar" aria-label="Actualizar datos">
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={onExit} className="p-2.5 bg-white/20 rounded-xl hover:bg-white/30 transition-all min-w-[44px] min-h-[44px] flex items-center justify-center" title="Salir" aria-label="Salir del monitor">
                            <LogOut size={18} />
                        </button>
                    </div>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 -mt-4">
                {/* Resumen general */}
                <div className="grid grid-cols-2 gap-3 mb-6">
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2 mb-1">
                            <DollarSign size={16} className="text-emerald-500" />
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ventas hoy</p>
                        </div>
                        <p className="text-2xl font-black text-slate-800 dark:text-white">${totals.salesUsd.toFixed(2)}</p>
                        <p className="text-xs text-slate-400">Bs {totals.salesBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                    </div>
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800">
                        <div className="flex items-center gap-2 mb-1">
                            <ShoppingCart size={16} className="text-sky-500" />
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Transacciones</p>
                        </div>
                        <p className="text-2xl font-black text-slate-800 dark:text-white">{totals.transactions}</p>
                        <p className="text-xs text-slate-400">{openBranches} de {snapshots.length} cajas abiertas</p>
                    </div>
                </div>

                {/* Alertas */}
                {totals.voids > 0 && (
                    <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl p-4 mb-6 flex items-start gap-3">
                        <AlertTriangle size={20} className="text-amber-500 shrink-0 mt-0.5" />
                        <div>
                            <p className="text-sm font-bold text-amber-700 dark:text-amber-300">{totals.voids} anulaciones hoy</p>
                            <p className="text-xs text-amber-600 dark:text-amber-400">Revisa el detalle por sede para ver quién anuló.</p>
                        </div>
                    </div>
                )}

                {/* Sedes */}
                <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Sedes</p>
                {loading && snapshots.length === 0 ? (
                    <div className="text-center py-12">
                        <div className="w-8 h-8 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin mx-auto mb-3" />
                        <p className="text-sm text-slate-400">Cargando datos...</p>
                    </div>
                ) : (
                    <div className="space-y-3">
                        {snapshots.map(branch => (
                            <button
                                key={branch.branch_id}
                                onClick={() => setSelectedBranch(branch)}
                                className="w-full bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between gap-2 hover:shadow-md transition-all active:scale-[0.99] text-left min-h-[44px]"
                            >
                                <div className="flex items-center gap-3 min-w-0 flex-1">
                                    <div className={`p-3 rounded-2xl shrink-0 ${branch.cash_register_open ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                        <Store size={20} className={branch.cash_register_open ? 'text-emerald-600' : 'text-slate-400'} />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="font-bold text-slate-800 dark:text-white truncate">{branch.branch_name}</p>
                                        <p className="text-xs text-slate-400 truncate">
                                            {branch.cash_register_open ? (
                                                <span className="text-emerald-600 font-bold">● Caja abierta</span>
                                            ) : (
                                                <span>○ Caja cerrada</span>
                                            )}
                                            {branch.cashier_name && ` · ${branch.cashier_name}`}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                                    <div className="text-right">
                                        <p className="font-black text-slate-800 dark:text-white whitespace-nowrap">${Number(branch.total_sales_usd || 0).toFixed(2)}</p>
                                        <p className="text-[10px] text-slate-400 whitespace-nowrap">{branch.transaction_count || 0} ventas</p>
                                    </div>
                                    <ChevronRight size={18} className="text-slate-300 shrink-0" />
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {lastUpdate && (
                    <p className="text-center text-[10px] text-slate-400 mt-6">
                        Actualizado: {lastUpdate.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                )}
            </div>
        </div>
    );
}

/**
 * Detalle por sede.
 */
function MonitorBranchDetail({ branch, onBack }) {
    // Desglose dinámico de métodos de pago
    const breakdown = branch.payment_breakdown || {};

    // Etiquetas legibles para métodos conocidos
    const methodLabels = {
        efectivo_usd: 'Efectivo USD',
        efectivo_bs: 'Efectivo Bs',
        pago_movil: 'Pago Móvil',
        punto_venta: 'Punto de Venta',
        efectivo_cop: 'Efectivo COP',
        transferencia_cop: 'Transferencia COP',
        fiado: 'Fiado',
    };
    const methodLabel = (id) => methodLabels[id] || id.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

    // Formatear monto según moneda del método
    const formatMethodAmount = (id, data) => {
        const usd = Number(data.usd) || 0;
        const bs = Number(data.bs) || 0;
        if (id.includes('bs') || id === 'pago_movil' || id === 'punto_venta') {
            return `Bs ${bs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
        }
        if (id.includes('cop')) {
            return `$${usd.toFixed(2)} + COP ${bs.toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;
        }
        if (usd > 0 && bs > 0) return `$${usd.toFixed(2)} / Bs ${bs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
        if (bs > 0) return `Bs ${bs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}`;
        return `$${usd.toFixed(2)}`;
    };

    // Efectivo esperado = fondo inicial + ventas en efectivo
    const cashUsdSales = Number(breakdown.efectivo_usd?.usd) || 0;
    const cashBsSales = Number(breakdown.efectivo_bs?.bs) || 0;
    const openingUsd = Number(branch.opening_usd) || 0;
    const openingBs = Number(branch.opening_bs) || 0;
    const expectedUsd = openingUsd + cashUsdSales;
    const expectedBs = openingBs + cashBsSales;
    const hasCashData = branch.cash_register_open || openingUsd > 0 || openingBs > 0 || cashUsdSales > 0 || cashBsSales > 0;

    const methodIds = Object.keys(breakdown).sort();

    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-8 overflow-y-auto">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-4 sm:py-6">
                <div className="max-w-4xl mx-auto">
                    <button onClick={onBack} className="text-xs text-white/70 hover:text-white mb-3 flex items-center gap-1 min-h-[44px]" aria-label="Volver al resumen">
                        ← Volver al resumen
                    </button>
                    <h1 className="text-lg sm:text-xl font-black truncate">{branch.branch_name}</h1>
                    <p className="text-xs text-white/70 truncate">
                        {branch.cash_register_open ? '● Caja abierta' : '○ Caja cerrada'}
                        {branch.cashier_name && ` · Cajero: ${branch.cashier_name}`}
                    </p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 -mt-4 space-y-3">
                {/* Efectivo esperado en vivo */}
                {hasCashData && (
                    <div className="bg-emerald-50 dark:bg-emerald-900/20 border-2 border-emerald-200 dark:border-emerald-800 rounded-2xl p-5 shadow-sm">
                        <p className="text-xs font-black uppercase tracking-wider text-emerald-600 dark:text-emerald-400 mb-3">💵 Efectivo esperado en caja</p>
                        <div className="grid grid-cols-2 gap-4">
                            <div>
                                <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">${expectedUsd.toFixed(2)}</p>
                                <p className="text-xs text-emerald-600/70">USD (fondo ${openingUsd.toFixed(2)} + ventas ${cashUsdSales.toFixed(2)})</p>
                            </div>
                            <div>
                                <p className="text-2xl font-black text-emerald-700 dark:text-emerald-300">Bs {expectedBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                                <p className="text-xs text-emerald-600/70">Bs (fondo {openingBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })} + ventas {cashBsSales.toLocaleString('es-VE', { minimumFractionDigits: 2 })})</p>
                            </div>
                        </div>
                    </div>
                )}

                {/* Fondo de apertura */}
                {(openingUsd > 0 || openingBs > 0) && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-800">
                        <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Fondo de apertura</p>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Efectivo USD</span>
                            <span className="font-bold text-slate-800 dark:text-white">${openingUsd.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm mt-2">
                            <span className="text-slate-500">Efectivo Bs</span>
                            <span className="font-bold text-slate-800 dark:text-white">Bs {openingBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
                        </div>
                    </div>
                )}

                {/* Ventas */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Ventas de hoy</p>
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <p className="text-2xl font-black text-slate-800 dark:text-white">${Number(branch.total_sales_usd || 0).toFixed(2)}</p>
                            <p className="text-xs text-slate-400">Total USD</p>
                        </div>
                        <div>
                            <p className="text-2xl font-black text-slate-800 dark:text-white">{branch.transaction_count || 0}</p>
                            <p className="text-xs text-slate-400">Transacciones</p>
                        </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800">
                        <p className="text-xs text-slate-400 mb-2">Bs {Number(branch.total_sales_bs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</p>
                    </div>
                </div>

                {/* Métodos de pago (todos los registrados) */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Métodos de pago</p>
                    {methodIds.length === 0 ? (
                        <p className="text-sm text-slate-400">Sin movimientos hoy</p>
                    ) : (
                        <div className="space-y-2">
                            {methodIds.map(id => (
                                <div key={id} className="flex justify-between text-sm gap-2">
                                    <span className="text-slate-500 truncate">{methodLabel(id)} <span className="text-slate-300">({breakdown[id].count})</span></span>
                                    <span className="font-bold text-slate-800 dark:text-white whitespace-nowrap">{formatMethodAmount(id, breakdown[id])}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Anulaciones y descuentos */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Control</p>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500 flex items-center gap-1.5"><Ban size={14} className="text-red-400" /> Anulaciones</span>
                            <span className="font-bold text-slate-800 dark:text-white">{branch.voids_count || 0} (${Number(branch.voids_total_usd || 0).toFixed(2)})</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500 flex items-center gap-1.5"><TrendingUp size={14} className="text-amber-400" /> Descuentos</span>
                            <span className="font-bold text-slate-800 dark:text-white">${Number(branch.discounts_total_usd || 0).toFixed(2)}</span>
                        </div>
                    </div>
                </div>

                <p className="text-center text-[10px] text-slate-400">
                    Última actualización: {branch.updated_at ? new Date(branch.updated_at).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '—'}
                </p>
            </div>
        </div>
    );
}
