import { AlertTriangle } from 'lucide-react';

export default function LowStockCard({ lowStockProducts }) {
    if (lowStockProducts.length === 0) return null;
    return (
        <div className="bg-white rounded-2xl p-4 border border-amber-100 shadow-sm">
            <h3 className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mb-3 flex items-center gap-1.5"><AlertTriangle size={14} /> Bajo Stock</h3>
            <div className="flex flex-wrap gap-2">
                {lowStockProducts.map(p => (
                    <div key={p.id} className="flex items-center gap-2 bg-slate-50 border border-slate-100 px-3 py-1.5 rounded-xl">
                        <span className={`w-2 h-2 rounded-full ${(p.stock ?? 0) === 0 ? 'bg-red-500' : 'bg-amber-400'}`} />
                        <span className="text-xs font-bold text-slate-700 truncate max-w-[120px]">{p.name}</span>
                        <span className="text-[10px] font-black text-slate-400 ml-1">{p.stock ?? 0} {p.unit === 'kg' ? 'kg' : p.unit === 'litro' ? 'lt' : 'u'}</span>
                    </div>
                ))}
            </div>
        </div>

    );
}
