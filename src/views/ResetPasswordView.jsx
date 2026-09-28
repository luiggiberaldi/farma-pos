import React, { useState, useEffect } from 'react';
import { Lock, EyeOff, Eye, CheckCircle, ShieldCheck, AlertTriangle, Loader2, Mail, LogIn } from 'lucide-react';
import { supabaseCloud } from '../config/supabaseCloud';
import { signOutCloudAccount, beginCloudLogin, applyCloudSession } from '../services/cloudSessionLifecycle.js';
import { useAuthStore } from '../hooks/store/useAuthStore';

// ─── Pantalla: Elegir nueva contraseña ────────────────────────────────────────
function ChangePasswordScreen({ onPasswordChanged }) {
    const [password, setPassword] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [status, setStatus] = useState('idle');
    const [errorMsg, setErrorMsg] = useState('');
    const [sessionReady, setSessionReady] = useState(false);

    useEffect(() => {
        const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange(
            async (event, session) => {
                if ((event === 'PASSWORD_RECOVERY' || event === 'SIGNED_IN') && session) {
                    setSessionReady(true);
                }
            }
        );
        return () => subscription.unsubscribe();
    }, []);

    const strength = (() => {
        if (!password) return 0;
        let s = 0;
        if (password.length >= 6) s++;
        if (password.length >= 10) s++;
        if (/[A-Z]/.test(password)) s++;
        if (/[0-9]/.test(password)) s++;
        if (/[^A-Za-z0-9]/.test(password)) s++;
        return s;
    })();

    const strengthLabel = ['', 'Muy débil', 'Débil', 'Regular', 'Fuerte', 'Muy fuerte'][strength];
    const strengthColor = ['', 'bg-red-500', 'bg-orange-400', 'bg-yellow-400', 'bg-emerald-400', 'bg-emerald-500'][strength];

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        if (password.length < 6) { setErrorMsg('Mínimo 6 caracteres.'); return; }
        if (password !== confirm) { setErrorMsg('Las contraseñas no coinciden.'); return; }

        setStatus('loading');
        try {
            const { error } = await supabaseCloud.auth.updateUser({ password });
            if (error) throw error;

            // Cerrar la sesión de recuperación para que el usuario haga login manual
            await signOutCloudAccount(supabaseCloud);
            onPasswordChanged();
        } catch (err) {
            setErrorMsg(err.message || 'Error al actualizar la contraseña.');
            setStatus('idle');
        }
    };

    return (
        <>
            <div className="w-16 h-16 bg-gradient-to-br from-sky-500 to-teal-500 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-sky-500/20">
                <ShieldCheck size={30} className="text-white" />
            </div>
            <h1 className="text-2xl font-black text-slate-800 text-center mb-1">Nueva contraseña</h1>
            <p className="text-slate-500 text-sm text-center mb-8">Elige una contraseña segura para tu cuenta.</p>

            {!sessionReady && (
                <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl flex items-center gap-2">
                    <Loader2 size={14} className="text-amber-400 animate-spin shrink-0" />
                    <p className="text-xs text-amber-300">Verificando enlace de recuperación...</p>
                </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
                {/* Nueva contraseña */}
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Nueva contraseña</label>
                    <div className="relative">
                        <input
                            type={showPass ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Mínimo 6 caracteres"
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-11 py-3.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all"
                            autoFocus
                            disabled={!sessionReady || status === 'loading'}
                        />
                        <Lock size={16} className="absolute left-4 top-4 text-slate-500" />
                        <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300 transition-colors">
                            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    {password.length > 0 && (
                        <div className="px-1 animate-in fade-in duration-200">
                            <div className="flex gap-1 mt-2">
                                {[1, 2, 3, 4, 5].map(i => (
                                    <div key={i} className={`h-1 flex-1 rounded-full transition-all duration-300 ${i <= strength ? strengthColor : 'bg-slate-700'}`} />
                                ))}
                            </div>
                            <p className={`text-[10px] font-bold mt-1.5 ${['', 'text-red-400', 'text-orange-400', 'text-yellow-400', 'text-emerald-400', 'text-emerald-400'][strength]}`}>
                                {strengthLabel}
                            </p>
                        </div>
                    )}
                </div>

                {/* Confirmar */}
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Confirmar contraseña</label>
                    <div className="relative">
                        <input
                            type={showConfirm ? 'text' : 'password'}
                            value={confirm}
                            onChange={e => setConfirm(e.target.value)}
                            placeholder="Repite la contraseña"
                            className={`w-full bg-slate-50 border rounded-2xl pl-11 pr-11 py-3.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 transition-all ${
                                confirm && confirm !== password ? 'border-red-500/50 focus:ring-red-500/30'
                                : confirm && confirm === password ? 'border-emerald-500/50 focus:ring-emerald-500/30'
                                : 'border-slate-200 focus:ring-sky-500/50 focus:border-sky-500'
                            }`}
                            disabled={!sessionReady || status === 'loading'}
                        />
                        <Lock size={16} className="absolute left-4 top-4 text-slate-500" />
                        <button type="button" onClick={() => setShowConfirm(p => !p)} className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300 transition-colors">
                            {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                    {confirm && confirm === password && (
                        <p className="text-[10px] text-emerald-400 font-bold ml-1 flex items-center gap-1 animate-in fade-in">
                            <CheckCircle size={10} /> Las contraseñas coinciden
                        </p>
                    )}
                    {confirm && confirm !== password && (
                        <p className="text-[10px] text-red-400 font-bold ml-1 animate-in fade-in">Las contraseñas no coinciden</p>
                    )}
                </div>

                {errorMsg && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 animate-in fade-in">
                        <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-red-300">{errorMsg}</p>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={!sessionReady || status === 'loading' || !password || password !== confirm}
                    className="w-full py-3.5 bg-sky-500 hover:bg-sky-600 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 mt-2"
                >
                    {status === 'loading' ? (
                        <><Loader2 size={16} className="animate-spin" /> Guardando...</>
                    ) : (
                        <><ShieldCheck size={16} /> Guardar nueva contraseña</>
                    )}
                </button>
            </form>
        </>
    );
}

// ─── Pantalla: Login tras reseteo ─────────────────────────────────────────────
function LoginAfterResetScreen({ onDone }) {
    const setAdminCredentials = useAuthStore(s => s.setAdminCredentials);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [status, setStatus] = useState('idle');
    const [errorMsg, setErrorMsg] = useState('');

    const handleLogin = async (e) => {
        e.preventDefault();
        setErrorMsg('');
        if (!email.includes('@')) { setErrorMsg('Ingresa un correo válido.'); return; }
        if (password.length < 6) { setErrorMsg('La contraseña debe tener al menos 6 caracteres.'); return; }

        setStatus('loading');
        beginCloudLogin();
        try {
            const { data, error } = await supabaseCloud.auth.signInWithPassword({
                email: email.trim().toLowerCase(),
                password,
            });
            if (error) throw error;

            // A recovered cloud session still requires a separate operator PIN.
            if (!data?.session) throw new Error('No se confirmó la sesión cloud.');
            applyCloudSession(data.session, { explicit: true });
            setAdminCredentials(email.trim().toLowerCase());
            setPassword('');
            onDone();
        } catch (err) {
            setErrorMsg(err.message || 'Correo o contraseña incorrectos.');
            setStatus('idle');
        }
    };

    return (
        <>
            {/* Icon */}
            <div className="w-16 h-16 bg-emerald-50 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-500/10">
                <CheckCircle size={32} className="text-emerald-500" />
            </div>
            <h1 className="text-2xl font-black text-slate-800 text-center mb-1">Contraseña actualizada</h1>
            <p className="text-slate-500 text-sm text-center mb-8 leading-relaxed">
                Ingresa tu correo y tu nueva contraseña para iniciar sesión.
            </p>

            <form onSubmit={handleLogin} className="space-y-4">
                {/* Email */}
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Correo electrónico</label>
                    <div className="relative">
                        <input
                            type="email"
                            value={email}
                            onChange={e => setEmail(e.target.value)}
                            placeholder="tu@correo.com"
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-4 py-3.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all"
                            autoFocus
                            disabled={status === 'loading'}
                        />
                        <Mail size={16} className="absolute left-4 top-4 text-slate-500" />
                    </div>
                </div>

                {/* Password */}
                <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-400 uppercase tracking-wider ml-1">Nueva contraseña</label>
                    <div className="relative">
                        <input
                            type={showPass ? 'text' : 'password'}
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            placeholder="Tu nueva contraseña"
                            className="w-full bg-slate-50 border border-slate-200 rounded-2xl pl-11 pr-11 py-3.5 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all"
                            disabled={status === 'loading'}
                        />
                        <Lock size={16} className="absolute left-4 top-4 text-slate-500" />
                        <button type="button" onClick={() => setShowPass(p => !p)} className="absolute right-4 top-3.5 text-slate-500 hover:text-slate-300 transition-colors">
                            {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                    </div>
                </div>

                {errorMsg && (
                    <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl flex items-start gap-2 animate-in fade-in">
                        <AlertTriangle size={14} className="text-red-400 mt-0.5 shrink-0" />
                        <p className="text-xs text-red-300">{errorMsg}</p>
                    </div>
                )}

                <button
                    type="submit"
                    disabled={status === 'loading'}
                    className="w-full py-3.5 bg-sky-500 hover:bg-sky-600 disabled:bg-slate-100 disabled:text-slate-400 text-white font-bold rounded-2xl transition-all active:scale-95 shadow-lg shadow-sky-500/20 flex items-center justify-center gap-2 mt-2"
                >
                    {status === 'loading' ? (
                        <><Loader2 size={16} className="animate-spin" /> Iniciando sesión...</>
                    ) : (
                        <><LogIn size={16} /> Entrar y Sincronizar</>
                    )}
                </button>
            </form>
        </>
    );
}

// ─── Componente Raíz ──────────────────────────────────────────────────────────
export default function ResetPasswordView({ onDone }) {
    const [step, setStep] = useState('change'); // 'change' | 'login'

    return (
        <div className="fixed inset-0 z-[300] bg-white flex items-center justify-center p-6 font-sans">
            {/* Background glow */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-sky-500/10 rounded-full blur-[100px]" />
                <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-teal-400/10 rounded-full blur-[100px]" />
            </div>

            <div className="relative w-full max-w-sm animate-in slide-in-from-bottom-6 duration-300">
                {step === 'change' ? (
                    <ChangePasswordScreen onPasswordChanged={() => setStep('login')} />
                ) : (
                    <LoginAfterResetScreen onDone={onDone} />
                )}
            </div>
        </div>
    );
}
