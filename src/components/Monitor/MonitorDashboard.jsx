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
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-8">
            {/* Header */}
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-6 shadow-lg">
                <div className="flex items-center justify-between max-w-4xl mx-auto">
                    <div className="flex items-center gap-3">
                        <div className="bg-white/20 p-2.5 rounded-2xl">
                            <Eye size={24} />
                        </div>
                        <div>
                            <h1 className="text-xl font-black">Monitor de Supervisión</h1>
                            <p className="text-xs text-white/70">Solo lectura · {getLocalISODate(new Date())}</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button onClick={loadData} className="p-2 bg-white/20 rounded-xl hover:bg-white/30 transition-all" title="Actualizar">
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </button>
                        <button onClick={onExit} className="p-2 bg-white/20 rounded-xl hover:bg-white/30 transition-all" title="Salir">
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
                                className="w-full bg-white dark:bg-slate-900 rounded-2xl p-4 shadow-sm border border-slate-100 dark:border-slate-800 flex items-center justify-between hover:shadow-md transition-all active:scale-[0.99] text-left"
                            >
                                <div className="flex items-center gap-3">
                                    <div className={`p-3 rounded-2xl ${branch.cash_register_open ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                        <Store size={20} className={branch.cash_register_open ? 'text-emerald-600' : 'text-slate-400'} />
                                    </div>
                                    <div>
                                        <p className="font-bold text-slate-800 dark:text-white">{branch.branch_name}</p>
                                        <p className="text-xs text-slate-400">
                                            {branch.cash_register_open ? (
                                                <span className="text-emerald-600 font-bold">● Caja abierta</span>
                                            ) : (
                                                <span>○ Caja cerrada</span>
                                            )}
                                            {branch.cashier_name && ` · ${branch.cashier_name}`}
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="text-right">
                                        <p className="font-black text-slate-800 dark:text-white">${Number(branch.total_sales_usd || 0).toFixed(2)}</p>
                                        <p className="text-[10px] text-slate-400">{branch.transaction_count || 0} ventas</p>
                                    </div>
                                    <ChevronRight size={18} className="text-slate-300" />
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
    return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 pb-8">
            <div className="bg-gradient-to-r from-indigo-600 to-violet-600 text-white px-4 py-6">
                <div className="max-w-4xl mx-auto">
                    <button onClick={onBack} className="text-xs text-white/70 hover:text-white mb-3 flex items-center gap-1">
                        ← Volver al resumen
                    </button>
                    <h1 className="text-xl font-black">{branch.branch_name}</h1>
                    <p className="text-xs text-white/70">
                        {branch.cash_register_open ? '● Caja abierta' : '○ Caja cerrada'}
                        {branch.cashier_name && ` · Cajero: ${branch.cashier_name}`}
                    </p>
                </div>
            </div>

            <div className="max-w-4xl mx-auto px-4 -mt-4 space-y-3">
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

                {/* Métodos de pago */}
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-5 shadow-sm border border-slate-100 dark:border-slate-800">
                    <p className="text-xs font-black uppercase tracking-wider text-slate-400 mb-3">Métodos de pago</p>
                    <div className="space-y-2">
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Efectivo USD</span>
                            <span className="font-bold text-slate-800 dark:text-white">${Number(branch.cash_usd || 0).toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Punto de venta (Bs)</span>
                            <span className="font-bold text-slate-800 dark:text-white">Bs {Number(branch.pos_bs || 0).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                            <span className="text-slate-500">Fiado (USD)</span>
                            <span className="font-bold text-slate-800 dark:text-white">${Number(branch.credit_usd || 0).toFixed(2)}</span>
                        </div>
                    </div>
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
                        {branch.opening_usd != null && (
                            <div className="flex justify-between text-sm">
                                <span className="text-slate-500">Fondo inicial</span>
                                <span className="font-bold text-slate-800 dark:text-white">${Number(branch.opening_usd).toFixed(2)}</span>
                            </div>
                        )}
                    </div>
                </div>

                <p className="text-center text-[10px] text-slate-400">
                    Última actualización: {branch.updated_at ? new Date(branch.updated_at).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' }) : '—'}
                </p>
            </div>
        </div>
    );
}
