import React, { useState, useEffect, useRef } from 'react';
import ProfessionalSelect from '../ProfessionalSelect';
import { discountAuthorizationDetails } from '../../utils/discountAuthorization.js';
import { X, Percent, DollarSign, Calculator, ShieldAlert, KeyRound } from 'lucide-react';
import { useAuthStore } from '../../hooks/store/useAuthStore';

export default function DiscountModal({
    currentDiscount,
    onApply,
    onClose,
    cartSubtotalUsd,
    cart = [],
    effectiveRate,
    tasaCop,
    copEnabled
}) {
    const { usuarioActivo, usuarios, issueApproval, checkApproval } = useAuthStore();
    const isCajero = usuarioActivo?.rol === 'CAJERO';
    const approvers = usuarios.filter(user => user.rol === 'DUENO' && user.pin);
    const [approverId, setApproverId] = useState(() => approvers[0]?.id ?? null);

    const [type, setType] = useState(currentDiscount?.type || 'percentage');
    const [value, setValue] = useState(currentDiscount?.value ? currentDiscount.value.toString() : '');
    const [adminPin, setAdminPin] = useState('');
    const [pinError, setPinError] = useState(false);
    const [pinChecking, setPinChecking] = useState(false);
    const [approval, setApproval] = useState(null);
    const inputRef = useRef(null);
    const pinRef = useRef(null);

    useEffect(() => {
        const timer = setTimeout(() => inputRef.current?.focus(), 150);
        return () => { clearTimeout(timer); };
    }, []);

    const numValue = parseFloat(value) || 0;

    let approvalDetails = null;
    try { approvalDetails = discountAuthorizationDetails({ type, value: numValue, cartSubtotalUsd, cart }); } catch { /* Invalid amount stays disabled. */ }
    const overrideGranted = Boolean(approval && approvalDetails && checkApproval(approval.id, 'DISCOUNT', approvalDetails));
    const needsOverride = isCajero && !overrideGranted && numValue > 0;

    let discountAmountUsd = 0;
    if (type === 'percentage') {
        discountAmountUsd = cartSubtotalUsd * (numValue / 100);
    } else {
        discountAmountUsd = numValue;
    }
    if (discountAmountUsd > cartSubtotalUsd) discountAmountUsd = cartSubtotalUsd;

    const newTotalUsd = cartSubtotalUsd - discountAmountUsd;
    const newTotalBs = newTotalUsd * effectiveRate;

    const formatBs = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    const handleSubmit = (e) => {
        e?.preventDefault();
        if (needsOverride) {
            pinRef.current?.focus();
            return;
        }
        if (!approvalDetails || !usuarioActivo) return;
        onApply({ type, value: numValue, approvalId: overrideGranted ? approval.id : null });
    };

    const handleClear = () => {
        onApply({ type: 'percentage', value: 0 });
    };

    const handleAdminOverride = async enteredPin => {
        if (enteredPin.length !== 6 || pinChecking || !approvalDetails) return;
        const approver = approvers.find(user => String(user.id) === String(approverId));
        if (!approver) return;
        setPinChecking(true);
        try {
            const proof = await issueApproval(enteredPin, approver.id, { action: 'DISCOUNT', details: approvalDetails });
            setApproval(proof);
            setPinError(!proof);
        } catch {
            setPinError(true);
        } finally {
            setAdminPin('');
            setPinChecking(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div
                className="bg-white dark:bg-slate-900 w-full max-w-sm mx-4 sm:mx-6 md:mx-auto rounded-3xl shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-200 border border-slate-100 dark:border-slate-800"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
                    <h3 className="font-black text-slate-800 dark:text-white text-lg flex items-center gap-2">
                        <Calculator size={20} className="text-blue-500" />
                        Descuento
                    </h3>
                    <button onClick={onClose} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors active:scale-95">
                        <X size={18} />
                    </button>
                </div>

                {/* Body */}
                <form onSubmit={handleSubmit} className="p-4 sm:p-5 flex flex-col gap-5">

                    {/* Toggle Type */}
                    <div className="flex bg-slate-100 dark:bg-slate-950 p-1.5 rounded-2xl shadow-inner">
                        <button
                            type="button"
                            onClick={() => { setType('percentage'); setValue(''); setApproval(null); inputRef.current?.focus(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${type === 'percentage' ? 'bg-white dark:bg-slate-900 shadow-sm text-blue-600 dark:text-blue-400 scale-100 ring-1 ring-slate-900/5 dark:ring-white/10' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 scale-95 hover:scale-100'}`}
                        >
                            <Percent size={16} /> Porcentaje
                        </button>
                        <button
                            type="button"
                            onClick={() => { setType('fixed'); setValue(''); setApproval(null); inputRef.current?.focus(); }}
                            className={`flex flex-1 items-center justify-center gap-2 py-2.5 text-sm font-bold rounded-xl transition-all duration-300 ${type === 'fixed' ? 'bg-white dark:bg-slate-900 shadow-sm text-emerald-600 dark:text-emerald-400 scale-100 ring-1 ring-slate-900/5 dark:ring-white/10' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 scale-95 hover:scale-100'}`}
                        >
                            <DollarSign size={16} /> Monto ($)
                        </button>
                    </div>

                    {/* Input Area */}
                    <div>
                        <div className="relative group">
                            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                                {type === 'percentage' ? (
                                    <Percent size={20} className="text-slate-400 group-focus-within:text-blue-500 transition-colors" />
                                ) : (
                                    <DollarSign size={20} className="text-slate-400 group-focus-within:text-emerald-500 transition-colors" />
                                )}
                            </div>
                            <input
                                ref={inputRef}
                                type="number"
                                aria-label="Valor del descuento"
                                inputMode="decimal"
                                step="any"
                                min="0"
                                value={value}
                                onChange={(e) => {
                                    let val = e.target.value;
                                    if (type === 'percentage' && parseFloat(val) > 100) val = '100';
                                    setValue(val);
                                    setApproval(null);
                                }}
                                className="w-full bg-white dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-800 rounded-2xl py-4 pl-12 pr-4 text-2xl font-black text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all text-center"
                                placeholder={type === 'percentage' ? "0%" : "0.00"}
                                autoFocus
                            />
                        </div>
                        {isCajero && (
                            <p className="text-[10px] text-slate-400 text-center mt-1.5">
                                Todo descuento requiere autorización con PIN de Administrador
                            </p>
                        )}
                    </div>

                    {/* Admin PIN override — shown when cajero exceeds limit */}
                    {needsOverride && (
                        <div className="flex flex-col gap-2 p-3 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-2xl">
                            <div className="flex items-center gap-2">
                                <ShieldAlert size={14} className="text-amber-500 shrink-0" />
                                <p className="text-xs font-bold text-amber-700 dark:text-amber-300">
                                    Se requiere PIN de Administrador para autorizar este descuento.
                                </p>
                            </div>
                            <ProfessionalSelect ariaLabel="Aprobador del descuento" value={String(approverId ?? '')}
                                options={approvers.map(user => ({ value: String(user.id), label: user.nombre }))}
                                onChange={id => { setApproverId(id); setApproval(null); setAdminPin(''); }} />
                            {pinError && <p role="alert" className="text-xs font-bold text-red-700">PIN inválido, bloqueado o autorización vencida.</p>}
                            <div className="relative">
                                <KeyRound size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-amber-400" />
                                <input
                                    ref={pinRef}
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={adminPin}
                                    aria-label="PIN administrativo para descuento"
                                    onChange={e => {
                                        const entered = e.target.value.replace(/\D/g, '').slice(0, 6);
                                        setAdminPin(entered);
                                        if (entered.length === 6) void handleAdminOverride(entered);
                                    }}
                                    placeholder="PIN Admin (6 dígitos)"
                                    className={`w-full pl-9 pr-4 py-2.5 text-sm font-bold rounded-xl border-2 bg-white dark:bg-slate-900 focus:outline-none transition-all text-center tracking-widest ${pinError
                                        ? 'border-red-400 text-red-600 animate-shake'
                                        : 'border-amber-200 dark:border-amber-800 focus:border-amber-400 text-slate-700 dark:text-slate-200'
                                    }`}
                                    disabled={pinChecking}
                                />
                            </div>
                            {pinChecking && <p className="text-[10px] text-amber-500 text-center font-bold animate-pulse">Verificando...</p>}
                        </div>
                    )}

                    {overrideGranted && (
                        <div className="flex items-center gap-2 p-2 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 rounded-xl">
                            <ShieldAlert size={13} className="text-emerald-500 shrink-0" />
                            <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-300">Autorizado por {approval?.approver?.nombre} para esta cesta</p>
                        </div>
                    )}

                    {/* Preview Area */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-500 font-medium">Subtotal:</span>
                            <span className="text-slate-700 dark:text-slate-300 font-bold">${cartSubtotalUsd.toFixed(2)}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-red-500 font-medium tracking-tight">Descuento aplicado:</span>
                            <span className="text-red-500 font-black">-${discountAmountUsd.toFixed(2)}</span>
                        </div>
                        <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-700 flex justify-between items-end">
                            <span className="text-sm font-bold text-slate-600 dark:text-slate-400">Total Final:</span>
                            <div className="text-right">
                                <span className="text-xl font-black text-emerald-600 dark:text-emerald-400 leading-none block">${newTotalUsd.toFixed(2)}</span>
                                <span className="text-xs font-bold text-slate-400">Bs {formatBs(newTotalBs)}</span>
                                {copEnabled && tasaCop > 0 && (
                                    <span className="text-[10px] font-bold text-slate-400 block">
                                        {(newTotalUsd * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP
                                    </span>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClear}
                            className="py-3.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold rounded-xl active:scale-95 transition-all outline-none"
                        >
                            Quitar
                        </button>
                        <button
                            type="submit"
                            disabled={pinChecking || !approvalDetails || !usuarioActivo}
                            className="py-3.5 disabled:opacity-50 bg-blue-500 hover:bg-blue-600 text-white font-bold rounded-xl active:scale-95 transition-all outline-none shadow-lg shadow-blue-500/30"
                        >
                            Aplicar
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
