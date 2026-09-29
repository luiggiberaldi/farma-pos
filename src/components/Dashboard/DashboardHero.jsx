import { ShoppingBag } from 'lucide-react';
import AnimatedCounter from '../AnimatedCounter';
import { formatBs } from '../../utils/calculatorUtils';

export default function DashboardHero({ activeCashSession, operatingDate, todayTotalUsd, todayTotalBs, todaySales, todayItemsSold, usuarioActivo }) {
    const mias = todaySales.filter(s => s.huella?.usuarioId === usuarioActivo?.id);
    const miasUsd = mias.reduce((sum, s) => sum + (s.totalUsd || 0), 0);
    return (
        <>
            <div className="relative rounded-[1.5rem] overflow-hidden" style={{ background: 'linear-gradient(135deg, #0B8D63 0%, #06B6D4 50%, #6FD9B8 100%)' }}>
                <div className="absolute -right-10 -top-10 w-48 h-48 rounded-full bg-white/10" />
                <div className="absolute -left-8 -bottom-8 w-36 h-36 rounded-full bg-white/5" />
                <div className="relative z-10 p-5 lg:p-4">
                    <div className="flex items-start justify-between mb-3 lg:mb-2">
                        <span className="text-white/70 text-[10px] font-bold uppercase tracking-widest">{activeCashSession ? 'Ingresos del turno' : 'Ingresos del día'}</span>
                        <span className="text-[10px] font-black uppercase tracking-wider bg-white/20 text-white px-2.5 py-1 rounded-full backdrop-blur-sm">
                            {(() => { const d = new Date(`${operatingDate}T12:00:00`); const days = ['DOM','LUN','MAR','MIÉ','JUE','VIE','SÁB']; const months = ['ENE','FEB','MAR','ABR','MAY','JUN','JUL','AGO','SEP','OCT','NOV','DIC']; return `${days[d.getDay()]} ${d.getDate()} ${months[d.getMonth()]}`; })()}
                        </span>
                    </div>
                    <div className="flex items-end justify-between">
                        <div>
                            <div className="flex items-baseline gap-0.5">
                                <span className="text-white/80 text-xl font-black">$</span>
                                <span className="text-[2.6rem] font-black text-white tracking-tight leading-none"><AnimatedCounter value={todayTotalUsd} /></span>
                            </div>
                            <p className="text-white/60 text-xs font-semibold mt-1.5">{formatBs(todayTotalBs)} Bs</p>
                        </div>
                        <div className="text-right">
                            <div className="bg-white/20 backdrop-blur-sm rounded-2xl px-4 py-2.5 mb-1.5">
                                <p className="text-2xl font-black text-white leading-none"><AnimatedCounter value={todaySales.length} /></p>
                                <p className="text-white/70 text-[10px] font-bold mt-0.5">{todaySales.length === 1 ? 'VENTA' : 'VENTAS'}</p>
                            </div>
                            <p className="text-white/60 text-[10px] font-semibold"><AnimatedCounter value={todayItemsSold} /> artículos</p>
                        </div>
                    </div>
                </div>
            </div>

            {usuarioActivo?.rol === 'CAJERO' && (
                <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm flex items-center justify-between">
                    <div>
                        <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider">Mi turno</p>
                        <p className="text-lg font-black text-slate-700">${miasUsd.toFixed(2)} <span className="text-xs font-bold text-slate-400">· {mias.length} venta{mias.length !== 1 ? 's' : ''}</span></p>
                    </div>
                    <div className="w-9 h-9 bg-teal-100 rounded-xl flex items-center justify-center">
                        <ShoppingBag size={18} className="text-teal-600" strokeWidth={2.5} />
                    </div>
                </div>
            )}
        </>
    );
}
