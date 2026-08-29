import React, { useState, useRef, useEffect, useCallback } from 'react';
import { X, Delete, Loader2, ShieldAlert, Clock } from 'lucide-react';
import LoginAvatar from './LoginAvatar';
import { logEvent } from '../../services/auditService';
import { createNotification, NOTIF_TYPES } from '../../services/notificationService';

const getPinLength = (rol) => rol === 'ADMIN' || rol === 'DUENO' ? 6 : 4;

const LOCKOUT_SECONDS = 30;
const MAX_ATTEMPTS = 3;

const lockoutKey = (userId) => `pin_lockout_${userId}`;

function getLockout(userId) {
    try {
        const raw = sessionStorage.getItem(lockoutKey(userId));
        if (!raw) return null;
        return JSON.parse(raw);
    } catch { return null; }
}

function setLockout(userId, data) {
    sessionStorage.setItem(lockoutKey(userId), JSON.stringify(data));
}

function clearLockout(userId) {
    sessionStorage.removeItem(lockoutKey(userId));
}

export default function LoginPinModal({ isOpen, onClose, user, onSubmit }) {
  const PIN_LENGTH = getPinLength(user?.rol);
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const inputRef = useRef(null);
  const countdownRef = useRef(null);

  const isTouchDevice = () => window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  const checkLockout = useCallback(() => {
    if (!user?.id) return;
    const data = getLockout(user.id);
    if (data?.lockedUntil && Date.now() < data.lockedUntil) {
      setLockedUntil(data.lockedUntil);
      setAttempts(data.attempts || MAX_ATTEMPTS);
    } else {
      if (data?.lockedUntil) clearLockout(user.id);
      setLockedUntil(null);
      setAttempts(data?.lockedUntil ? 0 : (data?.attempts || 0));
    }
  }, [user?.id]);

  useEffect(() => {
    if (isOpen) {
      setPin('');
      setError(false);
      checkLockout();
      if (!isTouchDevice()) setTimeout(() => inputRef.current?.focus(), 100);
    } else {
      if (countdownRef.current) clearInterval(countdownRef.current);
    }
  }, [isOpen, checkLockout]);

  // Countdown
  useEffect(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (!lockedUntil) { setSecondsLeft(0); return; }

    const tick = () => {
      const left = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (left <= 0) {
        clearInterval(countdownRef.current);
        clearLockout(user?.id);
        setLockedUntil(null);
        setAttempts(0);
        setSecondsLeft(0);
        if (!isTouchDevice()) setTimeout(() => inputRef.current?.focus(), 100);
      } else {
        setSecondsLeft(left);
      }
    };
    tick();
    countdownRef.current = setInterval(tick, 500);
    return () => clearInterval(countdownRef.current);
  }, [lockedUntil, user?.id]);

  useEffect(() => {
    if (pin.length === PIN_LENGTH && !processing && !lockedUntil) {
      handleSubmit();
    }
  }, [pin]);

  const handleSubmit = async () => {
    if (pin.length !== PIN_LENGTH || processing || lockedUntil) return;
    setProcessing(true);

    const success = await onSubmit(pin, user?.id);

    if (!success) {
      const newAttempts = attempts + 1;
      setAttempts(newAttempts);
      setError(true);
      setPin('');
      setProcessing(false);
      setTimeout(() => setError(false), 600);

      if (newAttempts >= MAX_ATTEMPTS) {
        const until = Date.now() + LOCKOUT_SECONDS * 1000;
        setLockout(user.id, { lockedUntil: until, attempts: newAttempts });
        setLockedUntil(until);
        logEvent('AUTH', 'PIN_BLOQUEADO', `${MAX_ATTEMPTS} intentos fallidos para "${user?.nombre}". Bloqueado ${LOCKOUT_SECONDS}s.`, null);
        createNotification(
            NOTIF_TYPES.PIN_BLOQUEADO,
            'PIN bloqueado',
            `${MAX_ATTEMPTS} intentos fallidos para "${user?.nombre}". Acceso bloqueado ${LOCKOUT_SECONDS}s.`,
            { userId: user?.id, userName: user?.nombre, rol: user?.rol }
        );
      } else {
        setLockout(user.id, { attempts: newAttempts, lockedUntil: null });
        logEvent('AUTH', 'PIN_FALLIDO', `Intento ${newAttempts}/${MAX_ATTEMPTS} fallido para "${user?.nombre}"`, null);
        if (!isTouchDevice()) setTimeout(() => inputRef.current?.focus(), 100);
      }
    } else {
      clearLockout(user?.id);
    }
  };

  const handlePadPress = (digit) => {
    if (pin.length >= PIN_LENGTH || processing || lockedUntil) return;
    setPin(prev => prev + digit);
  };

  const handleDelete = () => {
    if (processing || lockedUntil) return;
    setPin(prev => prev.slice(0, -1));
  };

  if (!isOpen || !user) return null;

  const isLocked = Boolean(lockedUntil);
  const userName = (user.nombre || 'Usuario').split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={isLocked ? undefined : onClose}
    >
      <div
        className="relative bg-white rounded-3xl p-8 w-full max-w-sm mx-4 shadow-2xl border border-slate-200 animate-in zoom-in-95 duration-300"
        onClick={e => e.stopPropagation()}
      >
        {!isLocked && (
          <button onClick={onClose} className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-700 transition-colors rounded-full hover:bg-slate-100">
            <X size={20} />
          </button>
        )}

        <div className="flex flex-col items-center mb-8">
          <div className="mb-4"><LoginAvatar user={user} /></div>
          <h2 className="text-xl font-bold text-slate-800">{userName}</h2>
          <p className="text-xs text-slate-500 mt-1">Ingresa tu PIN de {PIN_LENGTH} dígitos</p>
        </div>

        {isLocked ? (
          <div className="flex flex-col items-center gap-4 py-2">
            <div className="w-20 h-20 rounded-full bg-red-50 border-4 border-red-100 flex items-center justify-center">
              <ShieldAlert size={36} className="text-red-500" />
            </div>
            <div className="text-center">
              <p className="text-sm font-black text-slate-700">Acceso bloqueado</p>
              <p className="text-xs text-slate-400 mt-1">{MAX_ATTEMPTS} intentos fallidos consecutivos</p>
            </div>
            <div className="flex items-center gap-2 px-6 py-3 bg-red-50 border border-red-200 rounded-2xl">
              <Clock size={18} className="text-red-500 shrink-0" />
              <span className="text-2xl font-black text-red-600 tabular-nums w-8 text-center">{secondsLeft}</span>
              <span className="text-sm font-bold text-red-500">segundos restantes</span>
            </div>
            <p className="text-[11px] text-slate-400 text-center">Espera para volver a intentarlo</p>
          </div>
        ) : (
          <>
            {attempts > 0 && (
              <div className="mb-4 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-xl">
                <ShieldAlert size={14} className="text-amber-500 shrink-0" />
                <p className="text-[11px] font-bold text-amber-600">
                  {attempts}/{MAX_ATTEMPTS} intentos fallidos — bloqueo al 3er intento
                </p>
              </div>
            )}

            <div className={`flex justify-center gap-3 mb-8 ${error ? 'animate-shake' : ''}`}>
              {Array.from({ length: PIN_LENGTH }).map((_, i) => (
                <div
                  key={i}
                  className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                    error
                      ? 'bg-red-500 border-red-500 shadow-[0_0_10px_rgba(239,68,68,0.5)]'
                      : i < pin.length
                        ? 'bg-sky-500 border-sky-500 shadow-[0_0_10px_rgba(14,165,233,0.4)] scale-110'
                        : 'bg-transparent border-slate-300'
                  }`}
                />
              ))}
            </div>

            <input
              ref={inputRef}
              type="tel"
              maxLength={PIN_LENGTH}
              value={pin}
              onChange={e => {
                const val = e.target.value.replace(/\D/g, '').slice(0, PIN_LENGTH);
                setPin(val);
              }}
              className="absolute opacity-0 w-0 h-0"
              autoComplete="off"
              inputMode="numeric"
              readOnly={isTouchDevice()}
            />

            <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => (
                <button
                  key={n}
                  onClick={() => handlePadPress(String(n))}
                  className="h-14 rounded-xl bg-slate-50 text-slate-800 text-xl font-bold hover:bg-slate-100 active:scale-95 active:bg-sky-50 transition-all duration-150 border border-slate-200 shadow-sm"
                >
                  {n}
                </button>
              ))}
              <div />
              <button
                onClick={() => handlePadPress('0')}
                className="h-14 rounded-xl bg-slate-50 text-slate-800 text-xl font-bold hover:bg-slate-100 active:scale-95 active:bg-sky-50 transition-all duration-150 border border-slate-200 shadow-sm"
              >
                0
              </button>
              <button
                onClick={handleDelete}
                className="h-14 rounded-xl bg-slate-50 text-slate-400 flex items-center justify-center hover:bg-red-50 hover:text-red-500 active:scale-95 transition-all duration-150 border border-slate-200 shadow-sm"
              >
                <Delete size={22} />
              </button>
            </div>
          </>
        )}

        {processing && (
          <div className="absolute inset-0 bg-white/80 backdrop-blur-sm rounded-3xl flex items-center justify-center">
            <Loader2 className="animate-spin text-sky-500" size={32} />
          </div>
        )}
      </div>

      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          20% { transform: translateX(-10px); }
          40% { transform: translateX(10px); }
          60% { transform: translateX(-6px); }
          80% { transform: translateX(6px); }
        }
        .animate-shake { animation: shake 0.4s ease-in-out; }
      `}</style>
    </div>
  );
}
