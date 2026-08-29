import React, { useState } from 'react';
import {
    Users, Lock, Rocket, Clock, Timer
} from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';
import UsersManager from '../UsersManager';
import CloudAuthModal from '../../security/CloudAuthModal';

// ─── CONTROL DE PRÓXIMAMENTE ────────────────────────────────────────────────
const SHOW_COMING_SOON = false;
// ────────────────────────────────────────────────────────────────────────────

const LOCK_PRESETS = [
    { val: '1', label: '1m' },
    { val: '2', label: '2m' },
    { val: '3', label: '3m' },
    { val: '5', label: '5m' },
    { val: '10', label: '10m' },
    { val: '15', label: '15m' },
    { val: '30', label: '30m' },
];

function AutoLockSelector({ autoLockMinutes, setAutoLockMinutes, triggerHaptic }) {
    const isCustom = !LOCK_PRESETS.some(p => p.val === autoLockMinutes);
    const [customVal, setCustomVal] = useState(isCustom ? autoLockMinutes : '');

    const applyMinutes = (val) => {
        const n = parseInt(val, 10);
        if (isNaN(n) || n < 1) return;
        const str = String(n);
        setAutoLockMinutes(str);
        localStorage.setItem('admin_auto_lock_minutes', str);
        triggerHaptic?.();
    };

    return (
        <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5 flex items-center gap-1.5">
                <Timer size={11} /> Bloqueo Automático
            </label>
            <p className="text-[10px] text-slate-400 mb-3">Sesión bloqueada tras minutos de inactividad.</p>
            <div className="grid grid-cols-4 gap-2 mb-2">
                {LOCK_PRESETS.map(opt => (
                    <button
                        key={opt.val}
                        onClick={() => { setCustomVal(''); applyMinutes(opt.val); }}
                        className={`py-2 text-xs font-bold rounded-xl transition-all border ${autoLockMinutes === opt.val && !isCustom
                            ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-400 text-rose-700 dark:text-rose-300 shadow-sm'
                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                    >
                        {opt.label}
                    </button>
                ))}
                <button
                    onClick={() => document.getElementById('auto-lock-custom-input')?.focus()}
                    className={`py-2 text-xs font-bold rounded-xl transition-all border col-span-4 ${isCustom
                        ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-400 text-rose-700 dark:text-rose-300'
                        : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-400'
                    }`}
                >
                    {isCustom ? `${autoLockMinutes} min (personalizado)` : 'Personalizado'}
                </button>
            </div>
            <div className="flex items-center gap-2">
                <input
                    id="auto-lock-custom-input"
                    type="number"
                    min="1"
                    max="120"
                    placeholder="Ej: 20"
                    value={customVal}
                    onChange={e => setCustomVal(e.target.value)}
                    onBlur={() => { if (customVal) applyMinutes(customVal); }}
                    onKeyDown={e => { if (e.key === 'Enter' && customVal) { applyMinutes(customVal); e.target.blur(); } }}
                    className="flex-1 px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-200 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-rose-300 dark:focus:ring-rose-900 font-bold"
                />
                <span className="text-[10px] text-slate-400 font-bold">min</span>
            </div>
        </div>
    );
}

function ComingSoonOverlay() {
    return (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-slate-50/95 dark:bg-slate-950/95 backdrop-blur-sm rounded-2xl">
            <div className="flex flex-col items-center gap-4 px-8 text-center max-w-xs">
                <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-indigo-500 to-violet-600 flex items-center justify-center shadow-xl shadow-indigo-500/30">
                    <Rocket size={36} className="text-white" strokeWidth={1.5} />
                </div>
                <div>
                    <h2 className="text-xl font-black text-slate-800 dark:text-white tracking-tight">Próximamente</h2>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1 leading-snug">
                        Esta sección está en desarrollo y estará disponible muy pronto.
                    </p>
                </div>
                <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-700 rounded-full px-4 py-2">
                    <Clock size={13} className="text-indigo-500" />
                    <span className="text-[11px] font-bold text-indigo-600 dark:text-indigo-400 tracking-wide uppercase">En desarrollo</span>
                </div>
            </div>
        </div>
    );
}

function CloudLicenseViewer() {
    // Eliminado en la transformación a Farmacia César: el sistema de licencias
    // cloud (cloud_licenses / account_devices) fue desmontado.
    return null;
}

export default function SettingsTabUsuarios({
    isCloudConfigured, adminEmail,
    requireLogin, setRequireLogin,
    autoLockMinutes, setAutoLockMinutes,
    setAdminCredentials, showToast, triggerHaptic,
}) {
    const [isCloudModalOpen, setIsCloudModalOpen] = useState(false);

    return (
        <div className="relative">
            {SHOW_COMING_SOON && <ComingSoonOverlay />}
            {isCloudConfigured && (
                <SectionCard icon={Users} title="Usuarios y Roles" subtitle="Gestiona quien opera la app" iconColor="text-indigo-500">
                    <UsersManager triggerHaptic={triggerHaptic} />
                </SectionCard>
            )}

            <SectionCard icon={Lock} title="Seguridad Local" subtitle="Protección física del dispositivo" iconColor="text-rose-500">
                <div className="flex items-center justify-between mb-4 border-b border-slate-100 dark:border-slate-800 pb-4">
                    <div>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Pedir PIN al iniciar</p>
                        <p className="text-[10px] text-slate-400 mt-0.5">Si se desactiva, entrará directo como Administrador.</p>
                    </div>
                    <Toggle
                        enabled={requireLogin}
                        color="rose"
                        onChange={() => {
                            const newVal = !requireLogin;
                            if (setRequireLogin) setRequireLogin(newVal);
                            triggerHaptic?.();
                            showToast(newVal ? 'PIN activado para inicio' : 'Acceso directo activado', 'success');
                        }}
                    />
                </div>

                {/* Bloqueo por inactividad — solo visible si PIN está activo */}
                {requireLogin && (
                    <AutoLockSelector
                        autoLockMinutes={autoLockMinutes}
                        setAutoLockMinutes={setAutoLockMinutes}
                        triggerHaptic={triggerHaptic}
                    />
                )}
            </SectionCard>
        </div>
    );
}

