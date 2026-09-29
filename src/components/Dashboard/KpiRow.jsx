import { TrendingUp, ArrowUpRight } from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { formatOfficialRate } from '../../utils/rateResolver';

export default function KpiRow({ isAdmin, todayProfit, bcvRate }) {
    return (
        <div className={`grid gap-3 ${isAdmin ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {isAdmin && (
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm relative overflow-hidden">
                <div className="absolute -right-3 -top-3 w-14 h-14 bg-emerald-50 rounded-full blur-xl" />
                <div className="relative z-10">
                    <div className="w-9 h-9 bg-emerald-100 rounded-xl flex items-center justify-center mb-2.5">
                        <TrendingUp size={18} className="text-emerald-600" strokeWidth={2.5} />
                    </div>
                    <p className={`text-xl font-black leading-none ${todayProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                        {todayProfit >= 0 ? '+' : ''}${bcvRate > 0 ? (todayProfit / bcvRate).toFixed(2) : '0.00'}
                    </p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{formatBs(todayProfit)} Bs</p>
                    <p className="text-[10px] text-slate-400 mt-1.5 font-medium">Ganancia est.</p>
                </div>
            </div>
            )}
            <div className="bg-white rounded-2xl p-4 border border-slate-100 shadow-sm relative overflow-hidden">
                <div className="absolute -right-3 -top-3 w-14 h-14 bg-sky-50 rounded-full blur-xl" />
                <div className="relative z-10">
                    <div className="w-9 h-9 bg-sky-100 rounded-xl flex items-center justify-center mb-2.5">
                        <ArrowUpRight size={18} className="text-sky-600" strokeWidth={2.5} />
                    </div>
                    <p className="text-xl font-black text-slate-800 leading-none">{formatOfficialRate(bcvRate)}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Bs por dólar</p>
                    <p className="text-[10px] text-sky-500 mt-1.5 font-bold uppercase tracking-wider">Tasa BCV</p>
                </div>
            </div>
        </div>
    );
}
