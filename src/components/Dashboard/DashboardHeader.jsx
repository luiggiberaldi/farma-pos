import { Bell, LogOut, Lock } from 'lucide-react';
import BrandLogo from '../BrandLogo';
import SyncStatus from '../SyncStatus';
import { signOutCloudAccount } from '../../services/cloudSessionLifecycle.js';
import { supabaseCloud } from '../../config/supabaseCloud';
import { showToast } from '../Toast';

export default function DashboardHeader({ requireLogin, isCloudConfigured, usuarioActivo, triggerHaptic, authLogout, isAdmin, showAlerts, setShowAlerts, alertCount, markAlertsRead, adminAlerts, clearAlerts, confirm }) {
    return (
    <div className="flex items-center justify-between px-3 sm:px-6 pt-3 sm:pt-4 lg:pt-3 pb-2 sm:pb-3 lg:pb-2 transition-all z-10 relative min-h-[96px] sm:min-h-[135px] lg:min-h-[130px]">
        
        {/* ====== LATERAL IZQUIERDO: Píldoras (PC/Móvil) ====== */}
        <div className="flex items-center justify-start gap-2 sm:gap-3 z-20">
            {/* Píldoras de Estado */}
            <SyncStatus />
            
            {/* User Profile Pill */}
            {requireLogin && isCloudConfigured && usuarioActivo && (
                <div className="flex items-center gap-1.5 bg-teal-50 border-teal-100/50 border rounded-full pl-2 pr-1 sm:pl-3 sm:pr-1.5 py-1 sm:py-1.5 shadow-sm">
                    <div className="relative flex h-2 w-2 ml-1 sm:ml-0">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-teal-400"></span>
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                    </div>
                    <span className="hidden sm:block text-xs font-black sm:max-w-[120px] truncate text-teal-800">
                        {usuarioActivo.nombre.split(' ')[0]}
                    </span>
                    <button onClick={() => { triggerHaptic?.(); authLogout(); }} className="p-1.5 ml-0.5 transition-all rounded-full active:scale-90 text-teal-500 hover:bg-teal-100 hover:text-teal-700">
                        <Lock size={14} strokeWidth={2.5} />
                    </button>
                </div>
            )}
        </div>

        {/* ====== LOGO CENTRADO ====== */}
        <div className="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none z-0">
            <BrandLogo className="h-20 sm:h-28 lg:h-32 max-h-[95%] w-auto drop-shadow-md pointer-events-auto transition-transform hover:scale-105 duration-200 object-contain" />
        </div>

        {/* ====== LATERAL DERECHO: Notificaciones + Botones de Salir ====== */}
        <div className="flex items-center justify-end gap-2 z-20">
            {/* Notification Bell — admin only */}
            {isAdmin && (
                <div className="relative" data-alerts-dropdown>
                    <button
                        onClick={() => { setShowAlerts(v => !v); if (alertCount > 0) markAlertsRead(); }}
                        className="relative p-2 rounded-full bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                    >
                        <Bell size={16} className="text-slate-500 dark:text-slate-400" />
                        {alertCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 animate-bounce">
                                {alertCount > 9 ? '9+' : alertCount}
                            </span>
                        )}
                    </button>

                    {/* Alerts dropdown */}
                    {showAlerts && (
                        <div className="absolute right-0 top-10 w-72 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-100 dark:border-slate-800 z-50 overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 uppercase tracking-wider">Alertas</p>
                                {adminAlerts.length > 0 && (
                                    <button onClick={() => { clearAlerts(); setShowAlerts(false); }} className="text-[10px] font-bold text-slate-400 hover:text-rose-500 transition-colors">
                                        Limpiar todo
                                    </button>
                                )}
                            </div>
                            <div className="max-h-64 overflow-y-auto">
                                {adminAlerts.length === 0 ? (
                                    <p className="text-xs text-slate-400 text-center py-6">Sin alertas recientes</p>
                                ) : (
                                    adminAlerts.slice(0, 20).map(n => (
                                        <div key={n.id} className="px-4 py-3 border-b border-slate-50 dark:border-slate-800/60 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/40 transition-colors">
                                            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{n.title}</p>
                                            <p className="text-[10px] text-slate-400 mt-0.5 leading-snug">{n.body}</p>
                                            <p className="text-[9px] text-slate-300 dark:text-slate-600 mt-1">{new Date(n.ts).toLocaleString('es-VE', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}</p>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Cambiar usuario / salir */}
            <button
                onClick={() => { triggerHaptic?.(); authLogout(); }}
                className="p-2 sm:px-4 sm:py-2 flex items-center gap-1.5 bg-slate-100 border border-slate-200 text-slate-500 rounded-full shadow-sm hover:bg-slate-200 hover:text-slate-700 active:scale-95 transition-all"
                title="Cambiar usuario"
            >
                <LogOut size={16} strokeWidth={2.5} />
                <span className="hidden sm:block text-xs font-bold uppercase tracking-wider">Cambiar usuario</span>
            </button>
            {isAdmin && (
                <button
                    onClick={async () => {
                        const ok = await confirm({ title: 'Cerrar sesión', message: 'Se cerrará tu acceso a la nube.', confirmText: 'Cerrar sesión', cancelText: 'Cancelar', variant: 'logout' });
                        if (!ok) return;
                        try {
                            await signOutCloudAccount(supabaseCloud);
                        } catch (error) {
                            showToast(error?.message || 'La sesión local se cerró; no se pudo confirmar la salida cloud.', 'warning');
                        } finally {
                            window.location.reload();
                        }
                    }}
                    className="p-2 sm:px-4 sm:py-2 flex items-center gap-1.5 bg-rose-50 border border-rose-100 text-rose-500 rounded-full shadow-sm hover:bg-rose-100 hover:text-rose-600 active:scale-95 transition-all"
                    title="Cerrar sesión cloud"
                >
                    <span className="hidden sm:block text-xs font-bold uppercase tracking-wider">Salir cloud</span>
                </button>
            )}
        </div>
    </div>
    );
}
