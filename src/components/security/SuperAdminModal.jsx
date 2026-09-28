import React, { useState } from 'react';
import { ShieldAlert, X, Loader2, Eye, EyeOff, KeyRound } from 'lucide-react';
import { supabaseCloud, isCloudConfigured } from '../../config/supabaseCloud.js';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { showToast } from '../Toast';

const PIN_LENGTH = 6;

function PinBoxes({ value, onChange, idPrefix, label, onSubmit }) {
    const digits = (value || '').padEnd(PIN_LENGTH, '').slice(0, PIN_LENGTH).split('');
    const focusAt = index => document.getElementById(`${idPrefix}-${index}`)?.focus();
    const handleChange = (index, digit) => {
        if (!/^\d?$/.test(digit)) return;
        const next = [...digits];
        next[index] = digit;
        onChange(next.join('').replace(/ /g, ''));
        if (digit && index < PIN_LENGTH - 1) focusAt(index + 1);
    };
    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            e.preventDefault();
            focusAt(index - 1);
        }
        if (e.key === 'Enter' && onSubmit) {
            e.preventDefault();
            onSubmit();
        }
    };
    // Ctrl/Cmd+V en cualquier casilla pega el PIN completo.
    const handlePaste = e => {
        e.preventDefault();
        const pasted = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, PIN_LENGTH);
        if (!pasted) return;
        onChange(pasted);
        focusAt(Math.min(pasted.length, PIN_LENGTH - 1));
    };
    return (
        <div>
            <p className="text-[10px] uppercase font-bold text-slate-400 mb-1.5">{label}</p>
            <div className="flex gap-2 justify-center" role="group" aria-label={label} onPaste={handlePaste}>
                {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                    <input
                        key={i}
                        id={`${idPrefix}-${i}`}
                        aria-label={`${label}: dígito ${i + 1}`}
                        type="password"
                        inputMode="numeric"
                        autoComplete={i === 0 ? 'one-time-code' : 'off'}
                        maxLength={1}
                        autoFocus={i === 0}
                        value={digits[i]?.trim() || ''}
                        onChange={e => handleChange(i, e.target.value)}
                        onKeyDown={e => handleKeyDown(i, e)}
                        className="w-10 sm:w-11 h-12 sm:h-13 text-center text-xl font-black bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/30 outline-none text-slate-800 dark:text-white transition-all"
                    />
                ))}
            </div>
        </div>
    );
}

// Recuperación de acceso: la identidad se verifica con la cuenta cloud del
// correo administrador (o una sesión cloud vigente del mismo dispositivo).
// Nunca existe clave maestra incrustada ni reinicio masivo de PIN.
export default function SuperAdminModal({ isOpen, onClose }) {
    const requestOwnerPinReset = useAuthStore(s => s.requestOwnerPinReset);
    const confirmOwnerPinReset = useAuthStore(s => s.confirmOwnerPinReset);
    const cancelOwnerPinReset = useAuthStore(s => s.cancelOwnerPinReset);

    const [step, setStep] = useState('identity'); // identity | newpin
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState('');
    const [grant, setGrant] = useState(null);
    const [newPin, setNewPin] = useState('');
    const [confirmPin, setConfirmPin] = useState('');
    const [saving, setSaving] = useState(false);

    if (!isOpen) return null;

    const handleError = err => {
        setError(err?.message || 'No se pudo completar la recuperación.');
        setChecking(false);
        setSaving(false);
    };

    const requestGrant = async (cloudUserId, cloudEmail) => {
        const result = await requestOwnerPinReset(cloudUserId, cloudEmail);
        setGrant(result);
        setStep('newpin');
        setNewPin('');
        setConfirmPin('');
        setError('');
        setChecking(false);
    };

    const handleVerifyIdentity = async event => {
        event.preventDefault();
        setError('');
        if (!isCloudConfigured) {
            setError('La recuperación requiere la cuenta cloud configurada en este dispositivo.');
            return;
        }
        setChecking(true);
        try {
            // Sesión cloud vigente en este dispositivo: no hace falta re-tipear.
            const { data: sessionData } = await supabaseCloud.auth.getSession();
            const current = sessionData?.session?.user;
            if (current?.id) {
                await requestGrant(current.id, current.email);
                return;
            }
            const { data, error: signInError } = await supabaseCloud.auth.signInWithPassword({
                email: email.trim().toLowerCase(),
                password,
            });
            if (signInError || !data?.session?.user) {
                setError(signInError?.message || 'Cuenta o contraseña incorrecta.');
                setChecking(false);
                return;
            }
            await requestGrant(data.session.user.id, data.session.user.email);
        } catch (err) {
            handleError(err);
        }
    };

    const handleSavePin = async () => {
        setError('');
        if (newPin.length !== PIN_LENGTH) { setError(`El PIN debe tener ${PIN_LENGTH} dígitos.`); return; }
        if (confirmPin.length !== PIN_LENGTH) { setError('Confirma el nuevo PIN.'); return; }
        if (newPin !== confirmPin) { setError('Los PIN no coinciden.'); return; }
        setSaving(true);
        try {
            const ok = await confirmOwnerPinReset(grant.token, newPin);
            if (ok) {
                showToast('PIN del dueño restablecido. Ingresa con tu nuevo PIN.', 'success');
                onClose();
            }
        } catch (err) {
            handleError(err);
        }
    };

    const handleClose = () => {
        if (step === 'identity' || grant) cancelOwnerPinReset();
        onClose();
    };

    const canSubmit = saving || newPin.length !== PIN_LENGTH || confirmPin.length !== PIN_LENGTH;

    return (
        <div role="dialog" aria-modal="true" aria-labelledby="recovery-title" className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-slate-900/60" onClick={handleClose}>
            <div className="relative max-w-sm w-full p-6 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-700 shadow-xl" onClick={event => event.stopPropagation()}>
                <button onClick={handleClose} aria-label="Cerrar recuperación" className="absolute top-3 right-3 p-2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors"><X size={20} /></button>
                <ShieldAlert size={28} className="text-amber-600 mb-3" />
                <h2 id="recovery-title" className="text-lg font-bold text-slate-800 dark:text-white">Recuperación de acceso</h2>

                {step === 'identity' && (
                    <>
                        <p className="text-sm text-slate-600 dark:text-slate-300 mt-3">Verifica tu identidad con la cuenta cloud del dueño para fijar un nuevo PIN. Esta verificación no inicia sesión de operador ni cambia otros usuarios.</p>
                        {!isCloudConfigured && (
                            <p className="mt-3 text-xs font-bold text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/40 rounded-xl p-3">La recuperación requiere conexión con la cuenta cloud. Los datos no se borran.</p>
                        )}
                        <form onSubmit={handleVerifyIdentity} className="mt-4 space-y-3">
                            <div>
                                <label htmlFor="recovery-email" className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Correo del dueño</label>
                                <input
                                    id="recovery-email"
                                    type="email"
                                    autoComplete="username"
                                    value={email}
                                    onChange={e => setEmail(e.target.value)}
                                    placeholder="correo@empresa.com"
                                    className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                                />
                            </div>
                            <div>
                                <label htmlFor="recovery-password" className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Contraseña de la cuenta</label>
                                <div className="relative">
                                    <input
                                        id="recovery-password"
                                        type={showPass ? 'text' : 'password'}
                                        autoComplete="current-password"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        placeholder="••••••••"
                                        className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 pr-10 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all"
                                    />
                                    <button type="button" onClick={() => setShowPass(!showPass)} aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300">
                                        {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                                    </button>
                                </div>
                            </div>
                            {error && <p className="text-xs font-bold text-rose-500 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 rounded-xl p-3">{error}</p>}
                            <button type="submit" disabled={checking || !email.trim() || !password}
                                className="mt-1 w-full p-3 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 active:scale-[0.98] transition-all">
                                {checking ? <Loader2 size={16} className="animate-spin" /> : <ShieldAlert size={16} />}
                                {checking ? 'Verificando…' : 'Verificar identidad'}
                            </button>
                            <p className="text-[10px] text-slate-400 leading-relaxed">Si no conoces la contraseña de la cuenta, usa «Olvidé mi contraseña» desde el acceso cloud. Los datos no se borran.</p>
                        </form>
                    </>
                )}

                {step === 'newpin' && grant && (
                    <div className="mt-3">
                        <p className="text-sm text-slate-600 dark:text-slate-300">Identidad verificada para <strong className="text-slate-800 dark:text-white">{grant.ownerName}</strong>. Define el nuevo PIN de {PIN_LENGTH} dígitos. Se cerrará la sesión activa del dueño.</p>
                        <div className="mt-4 space-y-3">
                            <PinBoxes value={newPin} onChange={setNewPin} idPrefix="recovery-new-pin" label="Nuevo PIN" />
                            <PinBoxes value={confirmPin} onChange={setConfirmPin} idPrefix="recovery-confirm-pin" label="Confirmar PIN" />
                            {error && <p className="text-xs font-bold text-rose-500 bg-rose-50 dark:bg-rose-900/20 border border-rose-200 dark:border-rose-800/40 rounded-xl p-3 text-center">{error}</p>}
                            <button onClick={() => void handleSavePin()} disabled={canSubmit}
                                className="w-full p-3 rounded-xl bg-emerald-600 text-white font-bold flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-emerald-700 active:scale-[0.98] transition-all">
                                {saving ? <Loader2 size={16} className="animate-spin" /> : <KeyRound size={16} />}
                                {saving ? 'Guardando…' : 'Restablecer PIN'}
                            </button>
                            <button onClick={() => { cancelOwnerPinReset(); setGrant(null); setNewPin(''); setConfirmPin(''); setStep('identity'); }}
                                className="w-full p-2 text-xs font-bold text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors">
                                Cancelar recuperación
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
