import React, { useState, useRef, useEffect } from 'react';
import { X, Delete, Loader2, ShieldAlert } from 'lucide-react';
import LoginAvatar from './LoginAvatar';
import { useAuthStore } from '../../hooks/store/useAuthStore.js';
import { canUsePinlessAccess } from '../../utils/operatorSession.js';
import { isFactoryPin } from '../../config/userProvisioning.js';
import { captureStorageContext } from '../../config/storageScope.js';
import { useEscapeToClose } from '../../hooks/useEscapeToClose';

export default function LoginPinModal({ isOpen, onClose, user, onSubmit, forcePin = false, purpose = 'login' }) {
    if (!isOpen || !user) return null;
    return <PinEntry key={`${user.id}:${purpose}`} isOpen={isOpen} user={user} onClose={onClose} onSubmit={onSubmit} forcePin={forcePin} purpose={purpose} />;
}

function PinEntry({ isOpen, user, onClose, onSubmit, forcePin, purpose }) {
    const requireLogin = useAuthStore(s => s.requireLogin);
    const pinLength = user.rol === 'DUENO' ? 6 : 4;
    const pinless = !forcePin && canUsePinlessAccess(user, captureStorageContext(), requireLogin);
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [processing, setProcessing] = useState(false);
    const [pinlessAttempted, setPinlessAttempted] = useState(false);
    const [shakeKey, setShakeKey] = useState(0);
    const inputRef = useRef(null);
    const pinRef = useRef('');
    const processingRef = useRef(false);
    const mounted = useRef(true);
    const onSubmitRef = useRef(onSubmit);
    useEffect(() => { onSubmitRef.current = onSubmit; }, [onSubmit]);

    const submit = async (value, direct = false) => {
        if (processingRef.current || (!direct && value.length !== pinLength)) return;
        processingRef.current = true;
        if (direct) setPinlessAttempted(true);
        setProcessing(true);
        setError('');
        try {
            const success = await onSubmitRef.current(value, user.id);
            if (mounted.current && !success) {
                setError(useAuthStore.getState().lastAuthError || 'PIN incorrecto o acceso temporalmente bloqueado.');
                setShakeKey(k => k + 1);
                pinRef.current = '';
                setPin('');
            }
        } catch (err) {
            if (mounted.current) {
                setError(err.message || 'No se pudo verificar el acceso.');
                setShakeKey(k => k + 1);
                pinRef.current = '';
                setPin('');
            }
        } finally {
            processingRef.current = false;
            if (mounted.current) setProcessing(false);
        }
    };
    const submitRef = useRef(submit);
    useEffect(() => { submitRef.current = submit; });
    useEffect(() => {
        mounted.current = true;
        const timer = setTimeout(() => {
            if (pinless) void submitRef.current('', true);
            else inputRef.current?.focus();
        }, 0);
        return () => {
            clearTimeout(timer);
            mounted.current = false;
            useAuthStore.getState().cancelPendingAuthentication();
        };
    }, [pinless]);

    const changePin = value => {
        if (processingRef.current) return;
        const next = value.replace(/\D/g, '').slice(0, pinLength);
        pinRef.current = next;
        setPin(next);
        setError('');
        if (next.length === pinLength) void submit(next);
    };
    const close = () => {
        useAuthStore.getState().cancelPendingAuthentication();
        onClose();
    };
    useEscapeToClose(() => { if (onClose && !forcePin) close(); }, isOpen);

    return (
        <div role="dialog" aria-modal="true" aria-labelledby="pin-dialog-title" className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4" onClick={close}>
            <form onSubmit={event => { event.preventDefault(); void submit(pinRef.current); }} onClick={event => event.stopPropagation()}
                className="relative bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-700">
                <button type="button" onClick={close} aria-label="Cancelar verificación de PIN" className="absolute top-3 right-3 p-3 text-slate-500 hover:bg-slate-100 rounded-full"><X size={20} /></button>
                <div className="flex flex-col items-center mb-6">
                    <LoginAvatar user={user} />
                    <h2 id="pin-dialog-title" className="mt-4 text-xl font-bold text-slate-800 dark:text-white">{user.nombre || 'Usuario'}</h2>
                    <p className="mt-2 text-xs text-center text-slate-500">{purpose === 'sede' ? 'Autoriza el cambio de sede sin cambiar de usuario' : pinless ? 'Acceso local limitado a la sede asignada' : `Ingresa tu PIN de ${pinLength} dígitos`}</p>
                </div>
                {!user.pin && !pinless && <p role="alert" className="text-sm text-amber-800 bg-amber-50 rounded-xl p-3 mb-4">El dueño debe configurar un PIN para este usuario. El acceso cloud no permite saltar el PIN.</p>}
                {user.pin && !user.pinHashed && isFactoryPin(user.pin) && <p role="alert" className="text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-xl p-3 mb-4">Estás usando el PIN de fábrica. Cámbialo cuanto antes en Ajustes → Usuarios: cualquiera que conozca la app puede entrar con él.</p>}
                {error && <p role="alert" className="flex items-start gap-2 mb-4 p-3 text-sm font-semibold text-red-700 bg-red-50 rounded-xl"><ShieldAlert size={18} className="shrink-0" />{error}</p>}
                {pinless && pinlessAttempted && error && <button type="button" disabled={processing} onClick={() => void submit('', true)} className="w-full py-3 rounded-xl bg-emerald-600 text-white font-bold">Reintentar acceso local</button>}
                {!pinless && <>
                    <label className="block text-xs font-bold text-slate-500 mb-2" htmlFor="operator-pin">PIN de {pinLength} dígitos</label>
                    <input id="operator-pin" aria-label={`PIN de ${pinLength} dígitos`} ref={inputRef} type="password" inputMode="numeric" autoComplete="off" maxLength={pinLength}
                        value={pin} onChange={event => changePin(event.target.value)} disabled={processing}
                        className="w-full mb-4 p-3 border-2 border-slate-200 dark:border-slate-700 rounded-xl text-center text-xl tracking-[0.5em] text-slate-800 dark:text-white bg-white dark:bg-slate-800 focus:border-emerald-500 outline-none" />
                    {/* Puntos de progreso del PIN */}
                    <div className="flex justify-center gap-2.5 mb-5" aria-hidden="true">
                        {Array.from({ length: pinLength }).map((_, i) => (
                            <span key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${i < pin.length ? 'bg-emerald-500 border-emerald-500 scale-110' : 'border-slate-300 dark:border-slate-600'}`} />
                        ))}
                    </div>
                    <div key={shakeKey} className={`grid grid-cols-3 gap-2 ${shakeKey > 0 ? 'animate-shake' : ''}`}>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => <button type="button" key={n} disabled={processing} onClick={() => changePin(pinRef.current + n)}
                            className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-white text-xl font-bold border border-slate-200 dark:border-slate-700 active:scale-95">{n}</button>)}
                        <button type="button" disabled={processing} aria-label="Limpiar PIN" onClick={() => changePin('')}
                            className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-lg font-black border border-slate-200 dark:border-slate-700 active:scale-95">C</button>
                        <button type="button" disabled={processing} onClick={() => changePin(pinRef.current + '0')} className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800 text-xl font-bold text-slate-800 dark:text-white border border-slate-200 dark:border-slate-700">0</button>
                        <button type="button" disabled={processing} aria-label="Borrar último dígito" onClick={() => changePin(pinRef.current.slice(0, -1))} className="h-14 rounded-xl bg-slate-50 dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700 flex justify-center items-center"><Delete size={22} /></button>
                    </div>
                </>}
                {processing && <p role="status" className="flex justify-center gap-2 mt-4 text-sm text-emerald-700"><Loader2 size={18} className="animate-spin" />Verificando...</p>}
            </form>
        </div>
    );
}
