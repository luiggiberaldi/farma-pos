export default function StatCard({ icon: Icon, label, value, sub, color }) {
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
            <p className="text-xs font-bold text-slate-600 dark:text-slate-300 uppercase">{label}</p>
            <p className="text-lg md:text-xl font-black text-slate-800 dark:text-white mt-0.5">{value}</p>
            {sub && <p className="text-xs font-semibold text-slate-600 dark:text-slate-300 mt-0.5">{sub}</p>}
        </div>
    );
}
