import React, { useState } from 'react';
import {
    Mail, Key, Phone, ArrowRight, ShieldCheck,
    Smartphone, Database, AlertCircle, X, Download, Eye, EyeOff, Store
} from 'lucide-react';
import { useCloudAuthLogic } from '../../hooks/useCloudAuthLogic';
import { useConfirm } from '../../hooks/useConfirm.jsx';

// ─── Constantes de color del brand ──────────────────────────────────
const C = {
    primary:      '#0EA5E9', // sky-500
    primaryHover: '#0284C7', // sky-600
    primaryLight: '#E0F2FE', // sky-100
    surface:      '#FFFFFF',
    surfaceSub:   '#F8FAFC',
    border:       '#E2E8F0',
    textMain:     '#334155',
    textSub:      '#64748B',
};

export default function CloudAuthModal({ 
    isOpen, 
    onClose, 
    forceLogin = false,
    installPrompt,
    onInstall,
    showIOSButton,
    onShowIOSInstall
}) {
    const authLogic = useCloudAuthLogic();
    const {
        inputEmail, setInputEmail,
        inputPassword, setInputPassword,
        inputConfirmPassword, setInputConfirmPassword,
        inputBusinessName, setInputBusinessName,
        inputPhone, setInputPhone,
        isCloudLogin, setIsCloudLogin,
        emailError, setEmailError,
        passwordError, setPasswordError,
        isRecoveringPassword, setIsRecoveringPassword,
        deviceLimitError, setDeviceLimitError,
        blockedDevices, setBlockedDevices,
        dataConflictPending,
        importStatus,
        statusMessage,
        localDeviceAlias, setLocalDeviceAlias,
        handleDataConflictChoice,
        handleUnlinkSpecificDevice,
        handleSaveCloudAccount,
        handleResetPasswordRequest
    } = authLogic;

    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const confirm = useConfirm();

    if (!isOpen && !forceLogin) return null;

    // ── Vista: Conflicto de Datos ────────────────────────────────────
    if (dataConflictPending) {
        return (
            <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 pb-8 sm:pb-4 animate-in fade-in">
                <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-100">
                    <div className="bg-amber-500 px-6 py-5 text-white">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="p-2 bg-white/20 rounded-xl"><AlertCircle size={24} /></div>
                            <span className="font-black text-lg">Conflicto de Datos</span>
                        </div>
                        <p className="text-sm text-white/90 mt-2">Detectamos datos locales Y en la nube. ¿Con cuáles te quedas?</p>
                    </div>
                    <div className="p-6 space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            <button
                                onClick={async () => {
                                    const ok = await confirm({ title: 'Restaurar desde la nube', message: 'Se perderán los datos locales no sincronizados. ¿Continuar?', confirmText: 'Sí, restaurar', cancelText: 'Cancelar', variant: 'warning' });
                                    if (ok) handleDataConflictChoice('cloud');
                                }}
                                className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-sky-200 bg-sky-50 text-sky-700 hover:border-sky-400 hover:bg-sky-100 active:scale-95 transition-all"
                            >
                                <Database size={32} />
                                <span className="text-sm font-black text-center leading-tight">Restaurar Nube</span>
                                <span className="text-[10px] text-sky-500 text-center font-medium">Baja los datos de tu cuenta</span>
                            </button>
                            <button
                                onClick={async () => {
                                    const ok = await confirm({ title: '¡Peligro! Sobreescribir Nube', message: 'Eliminarás TODO el inventario en la nube para esta cuenta. ¿Estás seguro?', confirmText: 'Sí, sobreescribir', cancelText: 'Cancelar', variant: 'danger' });
                                    if (ok) handleDataConflictChoice('local');
                                }}
                                className="flex flex-col items-center gap-3 p-5 rounded-2xl border-2 border-red-200 bg-red-50 text-red-700 hover:border-red-400 hover:bg-red-100 active:scale-95 transition-all"
                            >
                                <Download size={32} />
                                <span className="text-sm font-black text-center leading-tight">Subir Local</span>
                                <span className="text-[10px] text-red-500 text-center font-bold">Sobreescribe la nube</span>
                            </button>
                        </div>
                        <div className="bg-red-50 p-3 rounded-xl border border-red-200 flex items-center gap-2">
                            <AlertCircle size={16} className="text-red-500 shrink-0" />
                            <p className="text-[11px] text-red-600 font-bold">Subir Local eliminará TODO el inventario almacenado en la nube.</p>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    // ── Vista: Límite de Dispositivos ────────────────────────────────
    if (deviceLimitError) {
        return (
            <div className="fixed inset-0 z-[200] flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4 pb-8 sm:pb-4 animate-in fade-in">
                <div className="w-full max-w-md bg-white rounded-[2rem] shadow-2xl overflow-hidden border border-slate-100">
                    <div className="bg-red-500 px-6 py-5 text-white">
                        <div className="flex items-center gap-3 mb-1">
                            <div className="p-2 bg-white/20 rounded-xl"><Smartphone size={24} /></div>
                            <span className="font-black text-lg">Límite de Dispositivos</span>
                        </div>
                        <p className="text-sm text-white/90 mt-2">Esta cuenta permite <strong>{deviceLimitError.limit || 1} dispositivo(s)</strong> simultáneo(s).</p>
                    </div>
                    <div className="p-6">
                        <p className="text-sm font-bold text-slate-800 mb-3">Sesiones activas ({blockedDevices.length} / {deviceLimitError.limit || 1}):</p>
                        <div className="space-y-2 mb-6 max-h-[40vh] overflow-y-auto pr-1">
                            {blockedDevices.map((d, i) => {
                                const isCurrent = d.device_id === deviceLimitError.currentId;
                                return (
                                    <div key={d.device_id} className={`flex items-center justify-between gap-3 p-3 rounded-xl border ${isCurrent ? 'bg-sky-50 border-sky-200' : 'bg-slate-50 border-slate-100'}`}>
                                        <div className="flex items-center gap-3 overflow-hidden">
                                            <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${isCurrent ? 'bg-sky-100 text-sky-600' : 'bg-white text-slate-500 border border-slate-200'}`}>
                                                <Smartphone size={18} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className={`text-sm font-bold truncate flex items-center gap-2 ${isCurrent ? 'text-sky-700' : 'text-slate-700'}`}>
                                                    {d.device_alias || `Caja ${i + 1}`}
                                                    {isCurrent && <span className="px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-black bg-sky-500 text-white shrink-0">Este equipo</span>}
                                                </p>
                                                <p className="text-[10px] text-slate-400">Visto: {new Date(d.last_seen).toLocaleDateString('es-VE')}</p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={async () => {
                                                const ok = await confirm({ title: 'Expulsar equipo', message: `¿Desconectar "${d.device_alias || `Caja ${i + 1}`}"?`, confirmText: 'Sí, expulsar', cancelText: 'Cancelar', variant: 'danger' });
                                                if (ok) handleUnlinkSpecificDevice(d.device_id);
                                            }}
                                            disabled={importStatus === 'loading'}
                                            className="px-3 py-1.5 border border-red-300 text-red-500 hover:bg-red-50 rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                                        >
                                            Expulsar
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        <button
                            onClick={() => { setDeviceLimitError(null); setBlockedDevices([]); if (onClose) onClose(); }}
                            className="w-full py-3 bg-slate-800 hover:bg-slate-700 text-white text-sm font-black rounded-xl transition-all shadow-md"
                        >
                            Cancelar y volver
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ── Vista Principal: Login / Registro ───────────────────────────
    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 backdrop-blur-md p-4 animate-in fade-in duration-300">
            <div className="w-full max-w-sm bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden relative">

                {/* Destellos decorativos del brand (sky/teal) */}
                <div className="absolute top-0 right-0 -mr-12 -mt-12 w-40 h-40 rounded-full blur-3xl pointer-events-none" style={{ background: 'rgba(125,211,252,0.2)' }} />
                <div className="absolute bottom-0 left-0 -ml-12 -mb-12 w-40 h-40 rounded-full blur-3xl pointer-events-none" style={{ background: 'rgba(94,234,212,0.15)' }} />

                {/* Botón cerrar */}
                {!forceLogin && (
                    <button onClick={onClose} className="absolute top-4 right-4 p-2 bg-slate-50 hover:bg-slate-100 rounded-full text-slate-400 hover:text-slate-600 transition-colors z-20">
                        <X size={18} />
                    </button>
                )}

                <div className="p-6 relative z-10">
                    {/* Logo */}
                    <div className="flex flex-col items-center justify-center mt-2 mb-6">
                        <img
                            src="/logo.png"
                            alt="Listo POS Lite"
                            className="h-28 sm:h-32 w-auto object-contain select-none"
                            draggable={false}
                        />
                        <p className="text-slate-400 text-xs mt-3 font-medium text-center">

                        </p>
                    </div>

                    {/* Tabs Login / Registro */}
                    {!isRecoveringPassword && (
                        <div className="flex p-1 bg-slate-100 rounded-xl mb-5">
                            <button
                                onClick={() => { setIsCloudLogin(true); setEmailError(''); setPasswordError(''); }}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${isCloudLogin ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Entrar
                            </button>
                            <button
                                onClick={() => { setIsCloudLogin(false); setEmailError(''); setPasswordError(''); }}
                                className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all ${!isCloudLogin ? 'bg-white text-sky-600 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                            >
                                Registro
                            </button>
                        </div>
                    )}

                    <div className="space-y-3">
                        {isRecoveringPassword ? (
                            <>
                                <div className="relative">
                                    <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"><Mail size={16} className="text-slate-400" /></div>
                                    <input
                                        type="email" value={inputEmail} onChange={e => setInputEmail(e.target.value)}
                                        className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                                        placeholder="Tu correo de cuenta"
                                    />
                                </div>
                                {emailError && <p className="text-xs text-red-500 font-medium ml-1">{emailError}</p>}
                                <button
                                    onClick={handleResetPasswordRequest} disabled={importStatus === 'loading'}
                                    className="w-full py-3.5 text-white text-sm font-black rounded-xl transition-all shadow-lg active:scale-[0.98] flex items-center justify-center gap-2"
                                    style={{ background: `linear-gradient(135deg, ${C.primary}, #5EEAD4)` }}
                                >
                                    {importStatus === 'loading' ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Enviar correo de recuperación'}
                                </button>
                                <button onClick={() => setIsRecoveringPassword(false)} className="w-full py-2 text-sm font-bold text-slate-500 hover:text-slate-800 transition-colors">
                                    Volver al login
                                </button>
                            </>
                        ) : (
                            <>
                                {/* Email */}
                                <div>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"><Mail size={16} className="text-slate-400" /></div>
                                        <input
                                            type="email" value={inputEmail} onChange={e => setInputEmail(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                                            placeholder="Correo electrónico"
                                        />
                                    </div>
                                    {emailError && <p className="text-[11px] text-red-500 font-bold mt-1 ml-1">{emailError}</p>}
                                </div>

                                {/* Nombre del negocio (solo registro) */}
                                {!isCloudLogin && (
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"><Store size={16} className="text-slate-400" /></div>
                                        <input
                                            type="text" value={inputBusinessName} onChange={e => setInputBusinessName(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                                            placeholder="Nombre del negocio"
                                        />
                                    </div>
                                )}

                                {/* Teléfono (solo registro) */}
                                {!isCloudLogin && (
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"><Phone size={16} className="text-slate-400" /></div>
                                        <input
                                            type="tel" value={inputPhone} onChange={e => setInputPhone(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                                            placeholder="WhatsApp del negocio"
                                        />
                                    </div>
                                )}

                                {/* Contraseña */}
                                <div>
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"><Key size={16} className="text-slate-400" /></div>
                                        <input
                                            type={showPassword ? 'text' : 'password'} value={inputPassword} onChange={e => setInputPassword(e.target.value)}
                                            className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                                            placeholder="Contraseña"
                                        />
                                        <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-sky-500 transition-colors">
                                            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                    {passwordError && <p className="text-[11px] text-red-500 font-bold mt-1 ml-1">{passwordError}</p>}
                                </div>

                                {/* Confirmar contraseña (solo registro) */}
                                {!isCloudLogin && (
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"><Key size={16} className="text-slate-400" /></div>
                                        <input
                                            type={showConfirmPassword ? 'text' : 'password'} value={inputConfirmPassword} onChange={e => setInputConfirmPassword(e.target.value)}
                                            className="w-full pl-10 pr-10 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                                            placeholder="Confirmar contraseña"
                                        />
                                        <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)} className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-sky-500 transition-colors">
                                            {showConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                                        </button>
                                    </div>
                                )}

                                {/* Alias del equipo (solo login) */}
                                {isCloudLogin && (
                                    <div className="relative">
                                        <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none"><Smartphone size={16} className="text-slate-400" /></div>
                                        <input
                                            type="text" value={localDeviceAlias} onChange={e => setLocalDeviceAlias(e.target.value)}
                                            className="w-full pl-10 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-sm font-medium focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500 outline-none transition-all"
                                            placeholder="Nombre de esta PC (ej. Mostrador 1)"
                                        />
                                    </div>
                                )}

                                {/* Olvidé contraseña */}
                                {isCloudLogin && (
                                    <div className="flex justify-end">
                                        <button onClick={() => setIsRecoveringPassword(true)} className="text-[11px] font-bold text-sky-600 hover:underline">
                                            ¿Olvidaste tu contraseña?
                                        </button>
                                    </div>
                                )}

                                {/* Mensaje de estado */}
                                {statusMessage && importStatus !== 'error' && (
                                    <div className="text-xs text-center font-bold animate-pulse py-1" style={{ color: C.primary }}>
                                        {statusMessage}
                                    </div>
                                )}

                                {/* CTA Principal */}
                                <button
                                    onClick={handleSaveCloudAccount}
                                    disabled={importStatus === 'loading'}
                                    className="w-full py-3.5 text-white text-sm font-black rounded-xl transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-70"
                                    style={{ background: `linear-gradient(135deg, ${C.primary} 0%, #5EEAD4 100%)` }}
                                >
                                    {importStatus === 'loading' ? (
                                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    ) : (
                                        <>
                                            {isCloudLogin ? 'Conectar Estación' : 'Crear Cuenta Segura'}
                                            <ArrowRight size={16} strokeWidth={3} />
                                        </>
                                    )}
                                </button>

                                {/* Botón de Instalar PWA */}
                                {installPrompt && (
                                    <button
                                        onClick={onInstall}
                                        type="button"
                                        className="w-full py-2.5 mt-2 bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 border border-slate-200"
                                    >
                                        <Download size={14} />
                                        Instalar App en este equipo
                                    </button>
                                )}
                                {showIOSButton && (
                                    <button
                                        onClick={onShowIOSInstall}
                                        type="button"
                                        className="w-full py-2.5 mt-2 bg-slate-50 hover:bg-slate-100 active:scale-95 text-slate-700 text-xs font-bold rounded-xl transition-all flex items-center justify-center gap-2 border border-slate-200"
                                    >
                                        <Download size={14} />
                                        Instalar App (iOS)
                                    </button>
                                )}

                                {!isCloudLogin && (
                                    <p className="text-[10px] text-center text-slate-400 mt-1 flex items-center justify-center gap-1">
                                        <ShieldCheck size={11} />
                                        Conexión encriptada. 7 días de prueba gratuita.
                                    </p>
                                )}
                            </>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
