import { TrendingUp } from 'lucide-react';

export default function TopProductsCard({ topProducts }) {
    if (topProducts.length === 0) return null;
    return (
        <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm">
            <h3 className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-4 flex items-center gap-1.5"><TrendingUp size={14} /> Más Vendidos</h3>
            <div className="space-y-3">
                {topProducts.map((p, i) => (
                    <div key={p.name} className="flex items-center justify-between">
                        <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] font-black w-4 text-center shrink-0 ${i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-400' : 'text-slate-300'}`}>{i + 1}</span>
                            <p className="text-xs font-bold text-slate-700 truncate">{p.name}</p>
                        </div>
                        <div className="flex flex-col items-end shrink-0 pl-2">
                            <span className="text-xs font-black text-[#0B8D63]">{p.qty} u</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>

    );
}
