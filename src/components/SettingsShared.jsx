// Shared primitive components used across all Settings tabs.
// Extracted from SettingsView.jsx to avoid duplication.

export function Toggle({ enabled, onChange, color = 'emerald', label = 'Activar opción', labelledBy }) {
    const colors = {
        emerald: enabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-600',
        amber: enabled ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600',
        indigo: enabled ? 'bg-indigo-500' : 'bg-slate-300 dark:bg-slate-600',
        rose: enabled ? 'bg-rose-500' : 'bg-slate-300 dark:bg-slate-600',
    };
    return (
        <button
            type="button" role="switch" aria-checked={Boolean(enabled)} aria-label={labelledBy ? undefined : label} aria-labelledby={labelledBy}
            onClick={onChange}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary ${colors[color] || colors.emerald}`}
        >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
    );
}

export function SectionCard({ icon: Icon, title, subtitle, iconColor = 'text-slate-500', children }) {
    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-50 dark:border-slate-800/50 flex items-center gap-3">
                <div className={`w-9 h-9 rounded-xl bg-slate-50 dark:bg-slate-800 flex items-center justify-center ${iconColor}`}>
                    <Icon size={18} />
                </div>
                <div>
                    <h3 className="text-sm font-black text-slate-800 dark:text-white">{title}</h3>
                    {subtitle && <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{subtitle}</p>}
                </div>
            </div>
            <div className="p-5 space-y-4">{children}</div>
        </div>
    );
}
