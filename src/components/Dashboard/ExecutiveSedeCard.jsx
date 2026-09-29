import { BarChart3, Search } from 'lucide-react';

export default function ExecutiveSedeCard({ isDueno, sedeStats, bcvRate, triggerHaptic, sedeActivaId, setSedePinTarget, setIsAuditorOpen }) {
    if (!isDueno || sedeStats.length === 0) return null;
        const grupoHoyUsd = sedeStats.reduce((sum, s) => sum + s.totalUsd, 0);
        const grupoHoyCount = sedeStats.reduce((sum, s) => sum + s.count, 0);
        const grupoSemanaUsd = sedeStats.reduce((sum, s) => sum + s.semanaUsd, 0);
        const gananciaHoy = sedeStats.reduce((sum, s) => sum + s.gananciaHoy, 0);
        const ticketPromedio = grupoHoyCount > 0 ? grupoHoyUsd / grupoHoyCount : 0;
    return (
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <BarChart3 size={14} className="text-emerald-600" /> Consolidado multi-sede
                    </p>
                    <button
                        onClick={() => { triggerHaptic?.(); setIsAuditorOpen(true); }}
                        className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-2.5 py-1.5 rounded-full active:scale-95 transition-all">
                        <Search size={12} strokeWidth={2.5} /> Auditoría
                    </button>
                </div>
                {/* KPIs del grupo */}
                <div className="grid grid-cols-4 gap-2 mb-3">
                    <div className="bg-slate-50 rounded-xl p-2 text-center">
                        <p className="text-[8px] font-black text-slate-400 uppercase">Hoy</p>
                        <p className="text-sm font-black text-slate-700">${grupoHoyUsd.toFixed(2)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-2 text-center">
                        <p className="text-[8px] font-black text-slate-400 uppercase">7 días</p>
                        <p className="text-sm font-black text-slate-700">${grupoSemanaUsd.toFixed(2)}</p>
                    </div>
                    <div className="bg-slate-50 rounded-xl p-2 text-center">
                        <p className="text-[8px] font-black text-slate-400 uppercase">Ticket prom.</p>
                        <p className="text-sm font-black text-slate-700">${ticketPromedio.toFixed(2)}</p>
                    </div>
                    <div className={`rounded-xl p-2 text-center ${gananciaHoy >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                        <p className="text-[8px] font-black text-slate-400 uppercase">Ganancia hoy</p>
                        <p className={`text-sm font-black ${gananciaHoy >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                            ${bcvRate > 0 ? (gananciaHoy / bcvRate).toFixed(2) : '0.00'}
                        </p>
                    </div>
                </div>
                {/* Por sede + alertas consolidadas */}
                <div className="grid grid-cols-3 gap-2">
                    {sedeStats.map(s => (
                        <div key={s.id} className="rounded-xl p-2.5 text-left" style={{ background: `${s.color}15`, border: `1px solid ${s.color}30` }}>
                            <div className="flex items-center justify-between">
                                <p className="text-[9px] font-black uppercase tracking-wider" style={{ color: s.color }}>{s.nombre}</p>
                                <button
                                    onClick={() => {
                                        triggerHaptic?.();
                                        if (s.id === sedeActivaId) return;
                                        setSedePinTarget(s.id);
                                    }}
                                    className="text-[8px] font-black text-slate-400 hover:text-slate-600 active:scale-90 transition-all"
                                    title={`Abrir ${s.nombre}`}>
                                    Abrir
                                </button>
                            </div>
                            <p className="text-sm font-black text-slate-700 mt-1">${s.totalUsd.toFixed(2)}</p>
                            <p className="text-[9px] text-slate-400 font-bold">{s.count} venta{s.count !== 1 ? 's' : ''} hoy · {s.semanaCount} en 7d</p>
                            <div className="flex gap-1.5 mt-1.5 flex-wrap">
                                {s.vencidos > 0 && <span className="text-[8px] font-black bg-rose-100 text-rose-600 px-1.5 py-0.5 rounded">Vencidos · {s.vencidos}</span>}
                                {s.criticos > 0 && <span className="text-[8px] font-black bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded">Críticos · {s.criticos}</span>}
                                {s.pendientes > 0 && <span className="text-[8px] font-black bg-teal-100 text-teal-600 px-1.5 py-0.5 rounded">Pendientes · {s.pendientes}</span>}
                                {s.vencidos === 0 && s.criticos === 0 && s.pendientes === 0 && (
                                    <span className="text-[8px] font-bold text-slate-300">Todo en orden</span>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
    );
}
