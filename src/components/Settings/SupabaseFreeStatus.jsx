import { useState } from 'react';
import { Cloud, RefreshCw, ShieldCheck, AlertTriangle } from 'lucide-react';
import { SectionCard } from '../SettingsShared';
import { useAuthStore } from '../../hooks/store/useAuthStore.js';
import { SUPABASE_FREE_LIMITS, SUPABASE_FREE_PROFILE } from '../../config/supabaseFreeTier.js';
import { REMOTE_OPERATIONS_PAUSED } from '../../config/operationSafety.js';
import { getSyncMetricSummary } from '../../utils/syncMetrics.js';

function bytesLabel(bytes) {
    if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
    if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${bytes} B`;
}

export default function SupabaseFreeStatus() {
    const role = useAuthStore(state => state.usuarioActivo?.rol);
    const [metrics, setMetrics] = useState(getSyncMetricSummary);
    if (role !== 'DUENO') return null;
    return (
        <SectionCard icon={Cloud} title="Supabase Free" subtitle="Perfil de bajo consumo · diagnóstico local" iconColor="text-emerald-600">
            <div data-testid="supabase-free-status" className="space-y-4">
                <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                    <ShieldCheck size={20} className="shrink-0 mt-0.5" />
                    <div>
                        <p className="text-sm font-bold">{REMOTE_OPERATIONS_PAUSED ? 'Sincronización operativa pausada' : 'Perfil gratuito configurado'}</p>
                        <p className="mt-1 text-xs leading-relaxed">{REMOTE_OPERATIONS_PAUSED
                            ? 'Ventas y pendientes siguen en este equipo. Falta validar el contrato de operador/sede y las transacciones del servidor antes de habilitar la nube.'
                            : 'El perfil reduce consumo, pero no garantiza cuotas disponibles ni sustituye los controles del servidor.'}</p>
                    </div>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {[
                        ['500 MB', 'Base de datos por proyecto'], ['1 GB', 'Archivos Storage por organización'],
                        ['5 GB', 'Salida no cacheada por ciclo'], ['5 GB', 'Salida cacheada independiente'],
                        ['50.000', 'Usuarios activos al mes'], ['2 proyectos', 'Máximo Free por propietario/admin'],
                    ].map(([value, label]) => (
                        <div key={label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                            <p className="font-black text-lg text-slate-800 dark:text-slate-100">{value}</p>
                            <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">{label}</p>
                        </div>
                    ))}
                </div>
                <p className="text-xs text-slate-600 dark:text-slate-300">Un proyecto para las tres sedes, no uno por farmacia. Los 5 GB cacheados no amplían la cuota de consultas a la base de datos.</p>
                <div className="rounded-xl border border-slate-200 p-3 dark:border-slate-700">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">Tráfico HTTP observado en este navegador</h3>
                        <button type="button" onClick={() => setMetrics(getSyncMetricSummary())} className="flex min-h-11 items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800 hover:bg-emerald-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600 dark:border-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-200">
                            <RefreshCw size={14} /> Actualizar diagnóstico
                        </button>
                    </div>
                    <dl className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-3" aria-live="polite">
                        {[
                            ['Solicitudes HTTP', metrics.requests], ['Enviado estimado', bytesLabel(metrics.sdkBytesUploaded)],
                            ['Recibido conocido', bytesLabel(metrics.sdkBytesDownloaded)], ['Bloqueadas por pausa', metrics.blocked],
                            ['Cargas sobredimensionadas', metrics.oversized], ['Respuestas sin tamaño', metrics.responsesWithoutSize],
                        ].map(([label, value]) => <div key={label}><dt className="text-slate-500 dark:text-slate-400">{label}</dt><dd className="mt-1 font-bold text-slate-800 dark:text-slate-100">{value}</dd></div>)}
                    </dl>
                    <p className="mt-3 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">Últimos {SUPABASE_FREE_PROFILE.metricsDays} días UTC, todas las sesiones de este navegador. No es el consumo de la organización ni una medición de facturación. Las respuestas sin Content-Length, otros equipos y tráfico fuera del cliente no se suman. Los contadores no guardan contraseñas, tokens ni datos de ventas.</p>
                </div>
                <div className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <p className="font-bold text-slate-800 dark:text-slate-100">Perfil preparado para el contrato seguro</p>
                    <ul className="mt-2 list-disc pl-4 space-y-1">
                        <li>Realtime y consultas periódicas de salud desactivados.</li>
                        <li>Agrupación de documentos pesados: 30 minutos. Consulta de cambios: 60 minutos y solo visible.</li>
                        <li>Aviso desde 250 KiB; rechazo de cargas de más de 1 MiB, sin borrar datos locales.</li>
                        <li>Backups cloud automáticos desactivados; se conserva el respaldo local.</li>
                    </ul>
                    {REMOTE_OPERATIONS_PAUSED && <p className="mt-2 font-semibold">Los intervalos de sincronización todavía no generan envíos: la pausa de seguridad sigue activa.</p>}
                </div>
                <div className="flex items-start gap-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-600" />
                    <p>Free puede pausar proyectos con poca actividad durante 7 días y no incluye backups automáticos descargables ni recuperación a un instante. Guarda copias fuera de Supabase y comprueba las cuotas reales en su panel.</p>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Referencias consultadas el {SUPABASE_FREE_LIMITS.verifiedOn}: <a href="https://supabase.com/pricing" target="_blank" rel="noreferrer" className="underline underline-offset-2">planes oficiales</a> · <a href="https://supabase.com/docs/guides/platform/manage-your-usage/egress" target="_blank" rel="noreferrer" className="underline underline-offset-2">cuotas de transferencia</a>.</p>
            </div>
        </SectionCard>
    );
}
