import { Download, ArrowUpRight, Package, Lock as LockIcon, CheckCircle2 } from 'lucide-react';
import AnimatedCounter from '../AnimatedCounter';

export default function DashboardActions({ installPrompt, showIOSButton, triggerHaptic, onInstall, onShowIOSInstall, isAdmin, todayExpensesUsd, todayExpenses, todayCashFlow, todaySales, canCloseCash, handleDailyClose, todayTotalUsd }) {
    return (
        <>
            {(installPrompt || showIOSButton) && (
                <button
                    onClick={() => { triggerHaptic(); installPrompt ? onInstall() : onShowIOSInstall(); }}
                    className="w-full flex items-center gap-3 bg-gradient-to-r from-[#0B8D63] to-[#0AA577] text-white rounded-2xl p-3 shadow-md active:scale-[0.98] transition-all"
                >
                    <div className="bg-white/20 rounded-xl p-2.5">
                        <Download size={20} strokeWidth={2.5} />
                    </div>
                    <div className="flex-1 text-left">
                        <p className="text-[13px] font-black">Instalar Farma POS</p>
                        <p className="text-[10px] text-white/80">Acceso rápido desde tu pantalla de inicio</p>
                    </div>
                    <ArrowUpRight size={18} className="text-white/60" />
                </button>
            )}
            
            {isAdmin && todayExpensesUsd > 0 && (
                <div className="bg-white rounded-2xl p-4 border border-orange-100 shadow-sm flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center"><Package size={18} className="text-orange-500" /></div>
                        <div>
                            <p className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">Egresos del día</p>
                            <p className="text-lg font-black text-orange-600">-$<AnimatedCounter value={todayExpensesUsd} /></p>
                        </div>
                    </div>
                    <span className="text-xs font-bold text-orange-500 bg-orange-50 px-2.5 py-1 rounded-lg">
                        {todayExpenses.length} {todayExpenses.length === 1 ? 'pago' : 'pagos'}
                    </span>
                </div>
            )}
            
            {(todayCashFlow.length > 0 || todaySales.length > 0) ? (
                canCloseCash ? (
                <button onClick={handleDailyClose}
                    className="w-full rounded-2xl p-4 flex items-center justify-between active:scale-[0.98] transition-all group"
                    style={{ background: 'linear-gradient(135deg, #F97316, #EF4444)', boxShadow: '0 6px 20px rgba(239,68,68,0.25)' }}>
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                            <LockIcon size={22} className="text-white" />
                        </div>
                        <div className="text-left">
                            <p className="text-sm font-black text-white">Cerrar Caja</p>
                            <p className="text-[11px] text-white/70 font-medium">${todayTotalUsd.toFixed(2)} · {todaySales.length} {todaySales.length === 1 ? 'venta' : 'ventas'}</p>
                        </div>
                    </div>
                    <div className="w-9 h-9 bg-white/20 rounded-xl flex items-center justify-center group-hover:translate-x-0.5 transition-transform">
                        <ArrowUpRight size={18} className="text-white" />
                    </div>
                </button>
                ) : null
            ) : (
                <div className="w-full bg-white rounded-2xl p-4 border border-emerald-100 shadow-sm flex items-center gap-3">
                    <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center">
                        <CheckCircle2 size={20} className="text-emerald-500" />
                    </div>
                    <div>
                        <p className="text-sm font-bold text-slate-600">Sin ventas pendientes</p>
                        <p className="text-[11px] text-slate-400">La caja está limpia</p>
                    </div>
                </div>
            )}
            
        </>
    );
}
