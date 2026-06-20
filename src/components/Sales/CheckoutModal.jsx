import React, { useState, useCallback, useMemo } from 'react';
import { X, Users, Receipt, ChevronDown, Wallet, Zap, UserPlus, Check, ArrowLeftRight, AlertTriangle, Smartphone, Lock } from 'lucide-react';
import CasheaIcon from '../CasheaIcon';
import { BsIcon, UsdIcon } from '../CurrencyIcons';
import { formatBs } from '../../utils/calculatorUtils';
import { PAYMENT_ICONS, ICON_COMPONENTS } from '../../config/paymentMethods';
import { round2, mulR, divR, subR, sumR } from '../../utils/dinero';

/**
 * CheckoutModal — Zona de Cobro con Barras de Pago (Estilo Listo POS)
 * Cada método de pago tiene su propia barra con input + botón TOTAL.
 */
export default function CheckoutModal({
    onClose,
    cartSubtotalUsd,
    cartSubtotalBs,
    cartTotalUsd,
    cartTotalBs,
    discountData,
    effectiveRate,
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    paymentMethods,
    onConfirmSale,
    isProcessingSale = false,
    onUseSaldoFavor,
    triggerHaptic,
    onCreateCustomer,
    copEnabled,
    tasaCop,
    currentFloatUsd = 0,
    currentFloatBs = 0,
    useAutoRate = false
}) {
    // -- State: un valor por barra --
    const [barValues, setBarValues] = useState({});

    // -- Cashea --
    const casheaEnabled = localStorage.getItem('cashea_enabled') === 'true';
    const casheaMinAmount = parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0;
    const casheaMeetsMinimum = casheaMinAmount <= 0 || cartTotalUsd >= casheaMinAmount;
    const [casheaActive, setCasheaActive] = useState(false);
    const [casheaPercent, setCasheaPercent] = useState(60);
    const CASHEA_PERCENTS = [10, 20, 30, 40, 50, 60, 70, 80];
    const CASHEA_LEVEL_MAP = { 1: 60, 2: 50, 3: 40, 4: 30, 5: 20, 6: 10 };

    const [showCustomerPicker, setShowCustomerPicker] = useState(false);
    const [showCustomerSheet, setShowCustomerSheet] = useState(false);
    const [customerSearch, setCustomerSearch] = useState('');
    const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
    const [newClientName, setNewClientName] = useState('');
    const [newClientDocument, setNewClientDocument] = useState('');
    const [newClientPhone, setNewClientPhone] = useState('');
    const [savingClient, setSavingClient] = useState(false);
    const [changeUsdGiven, setChangeUsdGiven] = useState('');
    const [changeBsGiven, setChangeBsGiven] = useState('');
    const [confirmFiar, setConfirmFiar] = useState(false);

    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    const filteredCustomers = useMemo(() => {
        if (!customerSearch.trim()) return customers;
        const q = customerSearch.toLowerCase();
        return customers.filter(c =>
            c.name.toLowerCase().includes(q) ||
            (c.documentId && c.documentId.toLowerCase().includes(q))
        );
    }, [customers, customerSearch]);

    const closeCustomerSheet = () => {
        setShowCustomerSheet(false);
        setShowNewCustomerForm(false);
        setCustomerSearch('');
    };
    // -- Cálculos bimoneda (con precisión dinero.js) --
    const totalPaidUsd = useMemo(() => {
        const amounts = paymentMethods.map(m => {
            const val = parseFloat(barValues[m.id]) || 0;
            if (val === 0) return 0;
            if (m.currency === 'USD') return round2(val);
            if (m.currency === 'COP') return divR(val, tasaCop);
            return divR(val, effectiveRate);
        });
        return sumR(amounts);
    }, [barValues, paymentMethods, effectiveRate, tasaCop]);

    // Monto que Cashea cubre (virtual, se agrega como pago al confirmar)
    const casheaAmountUsd = useMemo(() => {
        if (!casheaActive) return 0;
        return round2(mulR(cartTotalUsd, (100 - casheaPercent) / 100));
    }, [casheaActive, casheaPercent, cartTotalUsd]);

    // Total efectivo pagado + porción Cashea
    const totalPaidWithCasheaUsd = round2(totalPaidUsd + casheaAmountUsd);

    const totalPaidBs = useMemo(() => {
        const amounts = paymentMethods.map(m => {
            const val = parseFloat(barValues[m.id]) || 0;
            if (val === 0) return 0;
            if (m.currency === 'BS') return round2(val);
            if (m.currency === 'COP') return mulR(divR(val, tasaCop), effectiveRate);
            return mulR(val, effectiveRate);
        });
        return sumR(amounts);
    }, [barValues, paymentMethods, effectiveRate, tasaCop]);

    const remainingUsd = round2(Math.max(0, subR(cartTotalUsd, totalPaidWithCasheaUsd)));
    const remainingBs = round2(Math.max(0, subR(cartTotalBs, totalPaidBs + mulR(casheaAmountUsd, effectiveRate))));

    const changeUsd = round2(Math.max(0, subR(totalPaidWithCasheaUsd, cartTotalUsd)));
    const changeBs = round2(Math.max(0, subR(totalPaidBs + mulR(casheaAmountUsd, effectiveRate), cartTotalBs)));
    const PAYMENT_TOLERANCE = 0.01;
    const isPaid = remainingUsd < PAYMENT_TOLERANCE;
    // Cashea: el cajero debe haber ingresado el monto del cliente antes de poder registrar.
    // casheaConfirmReady = true cuando el pago manual cubre la porción del cliente (totalPaidUsd >= cartTotal - casheaAmount).
    const casheaConfirmReady = !casheaActive || isPaid || totalPaidUsd >= round2(cartTotalUsd - casheaAmountUsd) - PAYMENT_TOLERANCE;

    // -- Handlers --
    const handleBarChange = useCallback((methodId, value) => {
        // Solo números y punto decimal
        let v = value.replace(',', '.');
        if (!/^[0-9.]*$/.test(v)) return;
        const dots = v.match(/\./g);
        if (dots && dots.length > 1) return;
        setBarValues(prev => ({ ...prev, [methodId]: v }));
    }, []);

    const fillBar = useCallback((methodId, currency) => {
        triggerHaptic && triggerHaptic();
        let val;
        if (currency === 'USD') {
            val = remainingUsd > 0 ? round2(remainingUsd).toString() : null;
        } else if (currency === 'COP') {
            val = remainingUsd > 0 ? mulR(remainingUsd, tasaCop).toString() : null;
        } else {
            val = remainingBs > 0 ? round2(remainingBs).toString() : null;
        }
        if (val) {
            setBarValues(prev => ({ ...prev, [methodId]: val }));
        }
    }, [remainingUsd, remainingBs, triggerHaptic, tasaCop]);

    // Construir payments[] desde barValues al confirmar
    const handleConfirm = useCallback(() => {
        triggerHaptic && triggerHaptic();
        const payments = paymentMethods
            .filter(m => parseFloat(barValues[m.id]) > 0)
            .map(m => {
                const amount = round2(parseFloat(barValues[m.id]));
                return {
                    id: crypto.randomUUID(),
                    methodId: m.id,
                    methodLabel: m.label,
                    currency: m.currency,
                    amountInput: amount,
                    amountInputCurrency: m.currency,
                    amountUsd: m.currency === 'USD' ? amount : m.currency === 'COP' ? divR(amount, tasaCop) : divR(amount, effectiveRate),
                    amountBs: m.currency === 'BS' ? amount : m.currency === 'COP' ? mulR(divR(amount, tasaCop), effectiveRate) : mulR(amount, effectiveRate),
                };
            });

        // Agregar pago virtual de Cashea si está activo
        if (casheaActive && casheaAmountUsd > 0) {
            payments.push({
                id: crypto.randomUUID(),
                methodId: 'cashea',
                methodLabel: 'Cashea',
                currency: 'USD',
                amountInput: casheaAmountUsd,
                amountInputCurrency: 'USD',
                amountUsd: casheaAmountUsd,
                amountBs: mulR(casheaAmountUsd, effectiveRate),
                isCashea: true,
                casheaPercent: 100 - casheaPercent,
            });
        }

        const defaultUsdChange = (!changeUsdGiven && !changeBsGiven) ? changeUsd : round2(parseFloat(changeUsdGiven) || 0);
        const defaultBsChange = (!changeUsdGiven && !changeBsGiven) ? round2(mulR(changeUsd, effectiveRate)) : round2(parseFloat(changeBsGiven) || 0);

        onConfirmSale(payments, {
            changeUsdGiven: round2(Math.min(defaultUsdChange, changeUsd)),
            changeBsGiven: round2(Math.min(defaultBsChange, mulR(changeUsd, effectiveRate))),
        });
    }, [barValues, paymentMethods, effectiveRate, onConfirmSale, triggerHaptic, changeUsdGiven, changeBsGiven, changeUsd, casheaActive, casheaAmountUsd, casheaPercent, tasaCop]);

    // Saldo a favor
    const handleSaldoFavor = useCallback(() => {
        triggerHaptic && triggerHaptic();
        if (onUseSaldoFavor) onUseSaldoFavor();
    }, [onUseSaldoFavor, triggerHaptic]);

    // Crear cliente inline
    const handleCreateClient = async () => {
        if (!newClientName.trim() || !onCreateCustomer) return;
        setSavingClient(true);
        try {
            const newCustomer = await onCreateCustomer(newClientName.trim(), newClientDocument.trim(), newClientPhone.trim());
            setSelectedCustomerId(newCustomer.id);
            setNewClientName('');
            setNewClientDocument('');
            setNewClientPhone('');
            closeCustomerSheet();
        } finally {
            setSavingClient(false);
        }
    };

    const handleSelectCustomer = (customerId) => {
        setSelectedCustomerId(customerId);
        if (customerId && casheaEnabled) {
            const c = customers.find(x => x.id === customerId);
            if (c?.casheaLevel && CASHEA_LEVEL_MAP[c.casheaLevel]) {
                setCasheaActive(true);
                setCasheaPercent(CASHEA_LEVEL_MAP[c.casheaLevel]);
            }
        }
        closeCustomerSheet();
    };

    // Agrupar métodos por moneda
    const methodsUsd = paymentMethods.filter(m => m.currency === 'USD');
    const methodsBs = paymentMethods.filter(m => m.currency === 'BS');
    const methodsCop = paymentMethods.filter(m => m.currency === 'COP');

    // -- Estilos de barra por moneda --
    const sectionStyles = {
        USD: {
            bg: 'bg-emerald-50/50 dark:bg-emerald-950/20',
            border: 'border-emerald-100 dark:border-emerald-900/50',
            title: 'text-emerald-800 dark:text-emerald-300',
            titleBg: 'bg-emerald-100 dark:bg-emerald-900/50',
            titleIcon: 'text-emerald-600 dark:text-emerald-400',
            inputBorder: 'border-emerald-200 dark:border-emerald-800 focus:border-emerald-500 focus:ring-emerald-500/20',
            inputActive: 'border-emerald-400 dark:border-emerald-600 bg-emerald-50 dark:bg-emerald-950/30',
            btnBg: 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 active:bg-emerald-300',
        },
        BS: {
            bg: 'bg-blue-50/50 dark:bg-blue-950/20',
            border: 'border-blue-100 dark:border-blue-900/50',
            title: 'text-blue-800 dark:text-blue-300',
            titleBg: 'bg-blue-100 dark:bg-blue-900/50',
            titleIcon: 'text-blue-600 dark:text-blue-400',
            inputBorder: 'border-blue-200 dark:border-blue-800 focus:border-blue-500 focus:ring-blue-500/20',
            inputActive: 'border-blue-400 dark:border-blue-600 bg-blue-50 dark:bg-blue-950/30',
            btnBg: 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 active:bg-blue-300',
        },
        COP: {
            bg: 'bg-amber-50/50 dark:bg-amber-950/20',
            border: 'border-amber-100 dark:border-amber-900/50',
            title: 'text-amber-800 dark:text-amber-300',
            titleBg: 'bg-amber-100 dark:bg-amber-900/50',
            titleIcon: 'text-amber-600 dark:text-amber-400',
            inputBorder: 'border-amber-200 dark:border-amber-800 focus:border-amber-500 focus:ring-amber-500/20',
            inputActive: 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-950/30',
            btnBg: 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 hover:bg-amber-200 active:bg-amber-300',
        },
    };

    const renderPaymentBar = (method, styles) => {
        const val = barValues[method.id] || '';
        const hasValue = parseFloat(val) > 0;
        const equivUsd = method.currency === 'BS' && hasValue
            ? (parseFloat(val) / effectiveRate).toFixed(2)
            : method.currency === 'COP' && hasValue
            ? (parseFloat(val) / tasaCop).toFixed(2)
            : null;

        return (
            <div key={method.id} className="mb-3 last:mb-0">
                <div className="flex items-center gap-2 mb-1 ml-0.5">
                    {(() => { const MIcon = method.Icon || PAYMENT_ICONS[method.id] || ICON_COMPONENTS[method.icon]; return MIcon ? <MIcon size={16} className={hasValue ? '' : 'text-slate-400'} /> : <span className="text-base">{method.icon}</span>; })()}
                    <span className={`text-[11px] font-bold uppercase tracking-wide ${hasValue ? styles.title : 'text-slate-400 dark:text-slate-500'}`}>
                        {method.label}
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <div className="relative flex-1">
                        <input
                            type="text"
                            inputMode="decimal"
                            value={val}
                            onChange={e => handleBarChange(method.id, e.target.value)}
                            placeholder="0.00"
                            className={`w-full py-3 px-4 pr-14 rounded-xl border-2 text-lg font-bold outline-none transition-all ${hasValue
                                ? styles.inputActive
                                : `bg-white dark:bg-slate-900 ${styles.inputBorder}`
                                } text-slate-800 dark:text-white placeholder:text-slate-300 dark:placeholder:text-slate-700 focus:ring-4`}
                        />
                        <span className="absolute right-2 top-1/2 -translate-y-1/2">
                            {method.currency === 'USD' ? <UsdIcon size={22} /> : method.currency === 'COP' ? <span className="text-xs font-black px-2 py-0.5 rounded-md border bg-slate-100 dark:bg-slate-800 text-slate-400 border-slate-200 dark:border-slate-700">COP</span> : <BsIcon size={22} />}
                        </span>
                    </div>
                    <button
                        onClick={() => fillBar(method.id, method.currency)}
                        className={`shrink-0 py-3 px-3.5 rounded-xl font-black text-xs transition-all active:scale-95 flex items-center gap-1 ${styles.btnBg}`}
                    >
                        <Zap size={14} fill="currentColor" /> Total
                    </button>
                </div>
                {equivUsd && (
                    <p className="text-[11px] font-bold text-blue-500 dark:text-blue-400 mt-1 ml-1">
                        ≈ ${equivUsd}
                    </p>
                )}
            </div>
        );
    };

    return (
        <div className="fixed inset-0 z-50 bg-white dark:bg-slate-950 flex flex-col overflow-hidden">

            {/* --- HEADER --- */}
            <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950">
                <button onClick={onClose} className="p-2 -ml-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                    <X size={22} />
                </button>
                <h2 className="text-base font-black text-slate-800 dark:text-white tracking-wide font-sans">COBRAR</h2>
                <span className="text-[11px] font-bold text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-900 px-2.5 py-1 rounded-lg">
                    {formatBs(effectiveRate)} Bs/$
                </span>
            </div>

            {/* --- TOTAL BIMONEDA (FIJO) --- */}
            <div className="shrink-0 px-4 py-2.5 bg-gradient-to-b from-slate-50 to-slate-100/50 dark:from-slate-900 dark:to-slate-950/80 border-b border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center">
                {discountData?.active && (
                    <div className="flex items-center gap-2 mb-1 text-xs">
                        <span className="font-bold text-slate-400 dark:text-slate-500">Subtotal: ${cartSubtotalUsd.toFixed(2)} / Bs {formatBs(cartSubtotalBs)}</span>
                        <span className="font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-0.5 rounded">
                            Desc: -${discountData.amountUsd.toFixed(2)}
                        </span>
                    </div>
                )}
                <div className="flex items-baseline justify-center gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 self-center">
                        {discountData?.active ? 'Total Final:' : 'Total a Pagar:'}
                    </span>
                    <span className={`text-3xl font-black ${discountData?.active ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-900 dark:text-white'}`}>
                        ${cartTotalUsd.toFixed(2)}
                    </span>
                    <span className="text-sm font-extrabold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/30 px-2.5 py-0.5 rounded-lg border border-emerald-100 dark:border-emerald-900/40">
                        Bs {formatBs(cartTotalBs)}
                    </span>
                    {copEnabled && (
                        <span className="text-xs font-extrabold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-0.5 rounded-lg border border-amber-100 dark:border-amber-900/40">
                            COP {mulR(cartTotalUsd, tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                        </span>
                    )}
                </div>
            </div>

            {/* --- SCROLLABLE BODY --- */}
            <div className="flex-1 overflow-y-auto overscroll-contain pb-28">

                {/* -- SECCION DOLARES ($) -- */}
                {methodsUsd.length > 0 && (
                    <div className={`mx-3 mb-3 rounded-2xl border ${sectionStyles.USD.bg} ${sectionStyles.USD.border} p-3`}>
                        <h3 className={`text-[11px] font-black uppercase tracking-widest mb-3 flex items-center gap-2 ${sectionStyles.USD.title}`}>
                            <span className={`p-0.5 rounded-lg ${sectionStyles.USD.titleBg}`}><UsdIcon size={20} /></span>
                            Dólares ($)
                        </h3>
                        {methodsUsd.map(m => renderPaymentBar(m, sectionStyles.USD))}
                    </div>
                )}

                {/* -- SECCION BOLIVARES (Bs) -- */}
                {methodsBs.length > 0 && (
                    <div className={`mx-3 mb-3 rounded-2xl border ${sectionStyles.BS.bg} ${sectionStyles.BS.border} p-3`}>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${sectionStyles.BS.title}`}>
                                <span className={`p-0.5 rounded-lg ${sectionStyles.BS.titleBg}`}><BsIcon size={20} /></span>
                                Bolívares (Bs)
                            </h3>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${sectionStyles.BS.titleBg} ${sectionStyles.BS.title}`}>
                                Tasa: {formatBs(effectiveRate)}
                            </span>
                        </div>
                        {methodsBs.map(m => renderPaymentBar(m, sectionStyles.BS))}
                    </div>
                )}

                {/* -- SECCION PESOS (COP) -- */}
                {copEnabled && methodsCop.length > 0 && (
                    <div className={`mx-3 mb-3 rounded-2xl border ${sectionStyles.COP.bg} ${sectionStyles.COP.border} p-3`}>
                        <div className="flex items-center justify-between mb-3">
                            <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${sectionStyles.COP.title}`}>
                                <span className={`p-1 rounded-lg ${sectionStyles.COP.titleBg}`}>🟡</span>
                                Pesos (COP)
                            </h3>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg ${sectionStyles.COP.titleBg} ${sectionStyles.COP.title}`}>
                                Tasa: {formatBs(tasaCop)}
                            </span>
                        </div>
                        {methodsCop.map(m => renderPaymentBar(m, sectionStyles.COP))}
                    </div>
                )}

                {/* -- SECCION CASHEA -- */}
                {casheaEnabled && (
                    !useAutoRate ? (
                        <div className="mx-3 mb-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-3 flex items-center gap-3 opacity-60">
                            <CasheaIcon size={28} />
                            <div>
                                <p className="text-xs font-black text-slate-400 uppercase tracking-widest flex items-center gap-1.5"><Lock size={11} /> Cashea no disponible</p>
                                <p className="text-[10px] text-slate-400">Requiere tasa BCV automática</p>
                            </div>
                        </div>
                    ) : !casheaMeetsMinimum ? (
                        <div className="mx-3 mb-3 rounded-2xl border border-dashed border-purple-200 dark:border-purple-800/40 p-3 flex items-center gap-3 opacity-60">
                            <CasheaIcon size={28} />
                            <div>
                                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Cashea</p>
                                <p className="text-[10px] text-slate-400">Mínimo ${casheaMinAmount.toFixed(2)} para activar Cashea</p>
                            </div>
                        </div>
                    ) : !selectedCustomer ? (
                        <div className="mx-3 mb-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-700 p-3 flex items-center gap-3">
                            <CasheaIcon size={28} />
                            <div>
                                <p className="text-xs font-black text-slate-400 uppercase tracking-widest">Cashea</p>
                                <p className="text-[10px] text-slate-400">Selecciona un cliente para usar Cashea</p>
                            </div>
                        </div>
                    ) : (
                    <div className={`mx-3 mb-3 rounded-2xl border transition-all ${casheaActive
                        ? 'bg-purple-50/80 dark:bg-purple-950/30 border-purple-200 dark:border-purple-800/60'
                        : 'bg-slate-50/50 dark:bg-slate-900/30 border-slate-200 dark:border-slate-800'}`}>
                        {/* Header toggle */}
                        <button
                            onClick={() => { setCasheaActive(v => !v); triggerHaptic?.(); }}
                            className="w-full flex items-center justify-between p-3"
                        >
                            <h3 className={`text-[11px] font-black uppercase tracking-widest flex items-center gap-2 ${casheaActive ? 'text-purple-700 dark:text-purple-300' : 'text-slate-400 dark:text-slate-500'}`}>
                                <span className={`p-1 rounded-lg ${casheaActive ? 'bg-purple-100 dark:bg-purple-900/50' : 'bg-slate-100 dark:bg-slate-800'}`}>
                                    <Smartphone size={12} className={casheaActive ? 'text-purple-600 dark:text-purple-400' : 'text-slate-400'} />
                                </span>
                                Cashea
                            </h3>
                            <div className={`w-9 h-5 rounded-full transition-colors relative ${casheaActive ? 'bg-purple-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${casheaActive ? 'left-4' : 'left-0.5'}`} />
                            </div>
                        </button>

                        {casheaActive && (
                            <div className="px-3 pb-3 space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
                                {/* % selector */}
                                <div>
                                    <p className="text-[10px] font-bold text-purple-600 dark:text-purple-400 uppercase tracking-widest mb-1.5">% Pago Inicial (Cliente paga hoy)</p>
                                    <div className="flex flex-wrap gap-1.5">
                                        {CASHEA_PERCENTS.map(p => (
                                            <button
                                                key={p}
                                                onClick={() => { setCasheaPercent(p); triggerHaptic?.(); }}
                                                className={`px-2.5 py-1.5 rounded-lg text-xs font-black transition-all active:scale-95 ${casheaPercent === p
                                                    ? 'bg-purple-500 text-white shadow-md shadow-purple-500/30'
                                                    : 'bg-purple-100 dark:bg-purple-900/30 text-purple-700 dark:text-purple-300 hover:bg-purple-200'}`}
                                            >
                                                {p}%
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Desglose */}
                                <div className="bg-white dark:bg-slate-900 rounded-xl border border-purple-200 dark:border-purple-800/50 divide-y divide-purple-100 dark:divide-purple-900/50">
                                    <div className="flex items-center justify-between px-3 py-2">
                                        <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Cliente paga ahora:</span>
                                        <div className="text-right">
                                            <span className="text-sm font-black text-slate-800 dark:text-white block">
                                                ${round2(cartTotalUsd - casheaAmountUsd).toFixed(2)}
                                            </span>
                                            <span className="text-[10px] font-bold text-slate-400">
                                                {formatBs(mulR(round2(cartTotalUsd - casheaAmountUsd), effectiveRate))} Bs
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between px-3 py-2 bg-purple-50/50 dark:bg-purple-900/10">
                                        <span className="text-xs font-bold text-purple-600 dark:text-purple-400">Cashea financia ({100 - casheaPercent}%):</span>
                                        <div className="text-right">
                                            <span className="text-sm font-black text-purple-700 dark:text-purple-300 block">
                                                ${casheaAmountUsd.toFixed(2)}
                                            </span>
                                            <span className="text-[10px] font-bold text-purple-400">
                                                {formatBs(mulR(casheaAmountUsd, effectiveRate))} Bs
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                <p className="text-[10px] text-purple-500 dark:text-purple-400 font-medium leading-relaxed flex items-center gap-1.5">
                                    <CasheaIcon size={14} /> La venta queda completada. Los ${casheaAmountUsd.toFixed(2)} de Cashea se registran como cuenta por cobrar.
                                </p>
                            </div>
                        )}
                    </div>
                    )
                )}



                {/* -- CLIENTE -- */}
                <div className="px-3 py-2">
                    <button
                        onClick={() => setShowCustomerSheet(true)}
                        className={`w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 active:scale-[0.98] transition-all ${
                            selectedCustomer
                                ? 'border-indigo-200 dark:border-indigo-800/60 bg-indigo-50/50 dark:bg-indigo-950/20'
                                : 'border-dashed border-slate-200 dark:border-slate-700 hover:border-slate-300 dark:hover:border-slate-600'
                        }`}
                    >
                        {selectedCustomer ? (
                            <>
                                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-base font-black text-indigo-600 dark:text-indigo-400 shrink-0">
                                    {selectedCustomer.name.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex-1 text-left min-w-0">
                                    <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Cliente</p>
                                    <p className="text-sm font-black text-indigo-700 dark:text-indigo-300 truncate">{selectedCustomer.name}</p>
                                    {selectedCustomer.customerDocument && (
                                        <p className="text-[10px] text-indigo-400 font-medium">{selectedCustomer.customerDocument}</p>
                                    )}
                                </div>
                                {selectedCustomer.deuda > 0.01 && (
                                    <span className="text-[11px] font-black text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-1 rounded-lg border border-red-200 dark:border-red-800 shrink-0">
                                        Debe ${selectedCustomer.deuda.toFixed(2)}
                                    </span>
                                )}
                                {selectedCustomer.deuda < -0.01 && (
                                    <span className="text-[11px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-1 rounded-lg border border-emerald-200 dark:border-emerald-800 shrink-0">
                                        Favor ${Math.abs(selectedCustomer.deuda).toFixed(2)}
                                    </span>
                                )}
                                <ChevronDown size={15} className="text-indigo-400 shrink-0" />
                            </>
                        ) : (
                            <>
                                <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                                    <Users size={18} className="text-slate-400" />
                                </div>
                                <div className="flex-1 text-left">
                                    <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Cliente</p>
                                    <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Consumidor Final</p>
                                </div>
                                <ChevronDown size={15} className="text-slate-400" />
                            </>
                        )}
                    </button>
                </div>

                {/* Saldo a Favor */}
                {selectedCustomer?.deuda < -0.01 && remainingUsd > 0.01 && (
                    <div className="px-3 py-1">
                        <button
                            onClick={handleSaldoFavor}
                            className="w-full py-2.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 font-bold text-sm rounded-xl transition-all flex items-center justify-center gap-2"
                        >
                            <Wallet size={16} /> Usar Saldo a Favor (${Math.abs(selectedCustomer.deuda).toFixed(2)})
                        </button>
                    </div>
                )}
            </div>

            {/* --- BOTON CTA FIJO --- */}
            <div className="shrink-0 px-4 py-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-950 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-3">
                {/* -- BANNER VUELTO / RESTANTE -- */}
                <div className={`p-3 rounded-xl border-2 transition-all ${isPaid
                    ? 'bg-emerald-50 border-emerald-200 dark:bg-emerald-950/20 dark:border-emerald-800'
                    : 'bg-orange-50 border-orange-200 dark:bg-orange-950/20 dark:border-orange-800'
                    }`}>
                    <p className={`text-[10px] font-black uppercase tracking-widest mb-1 ${isPaid ? 'text-emerald-500' : 'text-orange-500'}`}>
                        {isPaid ? 'Vuelto' : 'Resta por Cobrar'}
                    </p>
                    <div className="flex items-end justify-between">
                        <div className="flex flex-col">
                            <span className={`text-2xl font-black ${isPaid ? 'text-emerald-600 dark:text-emerald-400' : 'text-orange-600 dark:text-orange-400'}`}>
                                ${isPaid ? changeUsd.toFixed(2) : remainingUsd.toFixed(2)}
                            </span>
                        </div>
                        <div className="flex flex-col text-right">
                            <span className={`text-sm font-bold ${isPaid ? 'text-emerald-500' : 'text-orange-500'}`}>
                                Bs {formatBs(isPaid ? changeBs : remainingBs)}
                            </span>
                            {copEnabled && (
                                <span className={`text-sm font-bold ${isPaid ? 'text-emerald-500' : 'text-orange-500'}`}>
                                    COP {isPaid ? mulR(changeUsd, tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : mulR(remainingUsd, tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                                </span>
                            )}
                        </div>
                    </div>

                    {/* DESGLOSE DE VUELTO — solo visible cuando hay vuelto */}
                    {isPaid && changeUsd > 0.009 && (
                        <div className="mt-2.5 pt-2.5 border-t border-emerald-200 dark:border-emerald-800 space-y-2">
                            <p className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-widest flex items-center gap-1">
                                <ArrowLeftRight size={10} />
                                Desglosar vuelto
                            </p>

                            {/* Fila: input USD + input Bs */}
                            <div className="flex items-center gap-2">
                                {/* Input USD */}
                                <div className="relative flex-1">
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        placeholder="0.00"
                                        value={changeUsdGiven}
                                        onChange={e => {
                                            const v = e.target.value;
                                            const usd = Math.min(Math.max(0, parseFloat(v) || 0), changeUsd);
                                            setChangeUsdGiven(v);
                                            setChangeBsGiven(Math.max(0, mulR(subR(changeUsd, usd), effectiveRate)).toFixed(0));
                                        }}
                                        className="w-full py-1.5 px-2.5 pr-10 rounded-lg border-2 border-emerald-200 dark:border-emerald-700 bg-white dark:bg-slate-900 font-black text-xs text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
                                    />
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[8px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1 py-0.5 rounded">USD</span>
                                </div>

                                <span className="text-slate-400 font-black text-xs shrink-0">+</span>

                                {/* Input Bs */}
                                <div className="relative flex-1">
                                    <input
                                        type="number"
                                        inputMode="decimal"
                                        placeholder="0"
                                        value={changeBsGiven}
                                        onChange={e => {
                                            const v = e.target.value;
                                            const bsTotal = changeUsd * effectiveRate;
                                            const bs = Math.min(Math.max(0, parseFloat(v) || 0), bsTotal);
                                            setChangeBsGiven(v);
                                            setChangeUsdGiven(Math.max(0, changeUsd - bs / effectiveRate).toFixed(2));
                                        }}
                                        className="w-full py-1.5 px-2.5 pr-8 rounded-lg border-2 border-blue-200 dark:border-blue-700 bg-white dark:bg-slate-900 font-black text-xs text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30"
                                    />
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2"><BsIcon size={20} /></span>
                                </div>
                            </div>

                            <div className="flex gap-2">
                                <button
                                    onClick={() => { setChangeUsdGiven(changeUsd.toFixed(2)); setChangeBsGiven('0'); }}
                                    className="flex-1 py-1 rounded-lg text-[8px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 active:scale-95 transition-all border border-emerald-200 dark:border-emerald-800"
                                >
                                    Todo $
                                </button>
                                <button
                                    onClick={() => { setChangeUsdGiven('0'); setChangeBsGiven((changeUsd * effectiveRate).toFixed(0)); }}
                                    className="flex-1 py-1 rounded-lg text-[8px] font-black bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 hover:bg-blue-200 active:scale-95 transition-all border border-blue-200 dark:border-blue-800"
                                >
                                    Todo Bs
                                </button>
                            </div>

                            {/* FLOAT WARNINGS */}
                            {(parseFloat(changeUsdGiven) > currentFloatUsd + 0.05 || parseFloat(changeBsGiven) > currentFloatBs + 1) && (
                                <div className="mt-1.5 p-1.5 rounded-lg bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800 flex items-start gap-1">
                                    <AlertTriangle size={10} className="text-orange-500 shrink-0 mt-0.5" />
                                    <div className="flex-1">
                                        <p className="text-[9px] font-bold text-orange-600 dark:text-orange-400 leading-tight">
                                            Vuelto excede el fondo de caja.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <button
                    onClick={() => {
                        if (!isPaid && selectedCustomerId && remainingUsd > 0.01 && casheaConfirmReady) {
                            triggerHaptic && triggerHaptic();
                            setConfirmFiar(true);
                        } else if (casheaConfirmReady || isPaid) {
                            handleConfirm();
                        }
                    }}
                    disabled={isProcessingSale || (!selectedCustomerId && remainingUsd > 0.01) || (casheaActive && !isPaid && !casheaConfirmReady)}
                    className={`w-full py-3.5 font-black text-base rounded-2xl shadow-lg transition-all tracking-wide flex items-center justify-center gap-2 ${isProcessingSale
                        ? 'bg-slate-300 dark:bg-slate-800 text-slate-500 shadow-none cursor-not-allowed opacity-70'
                        : isPaid
                        ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25 active:scale-[0.98] text-white'
                        : selectedCustomerId
                            ? casheaActive
                                ? casheaConfirmReady
                                    ? 'bg-purple-500 hover:bg-purple-600 shadow-purple-500/25 active:scale-[0.98] text-white'
                                    : 'bg-amber-50 dark:bg-amber-900/20 border-2 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-300 shadow-none cursor-not-allowed'
                                : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/25 active:scale-[0.98] text-white'
                            : 'bg-slate-300 dark:bg-slate-800 text-slate-500 shadow-none cursor-not-allowed'
                        }`}
                >
                    {isProcessingSale ? (
                        <><Receipt size={18} className="animate-pulse" /> PROCESANDO...</>
                    ) : isPaid ? (
                        <><Receipt size={18} /> CONFIRMAR VENTA</>
                    ) : selectedCustomerId ? (
                        casheaActive
                            ? casheaConfirmReady
                                ? <><CasheaIcon size={18} /> REGISTRAR CON CASHEA · PAGA AHORA ${remainingUsd.toFixed(2)}</>
                                : <><Lock size={16} /> CASHEA — INGRESA ${remainingUsd.toFixed(2)} DEL CLIENTE</>
                            : <><Users size={18} /> FIAR RESTANTE (${remainingUsd.toFixed(2)})</>
                    ) : (
                        <><Receipt size={18} /> INGRESA LOS PAGOS</>
                    )}
                </button>
            </div>

            {/* --- MODAL CONFIRMACION FIAR --- */}
            {confirmFiar && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={() => setConfirmFiar(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 max-w-sm sm:max-w-md w-full shadow-2xl border border-slate-200 dark:border-slate-800" onClick={e => e.stopPropagation()}>
                        
                        {/* Header */}
                        <div className="flex items-center gap-4 mb-5">
                            <div className={`w-12 h-12 sm:w-14 sm:h-14 rounded-2xl flex items-center justify-center shrink-0 ${casheaActive ? 'bg-yellow-100 dark:bg-yellow-900/30' : 'bg-amber-100 dark:bg-amber-900/30'}`}>
                                {casheaActive
                                    ? <CasheaIcon size={32} />
                                    : <AlertTriangle size={24} className="text-amber-600 sm:w-7 sm:h-7" />}
                            </div>
                            <div>
                                <h3 className="text-lg sm:text-xl font-black text-slate-800 dark:text-white">
                                    {casheaActive ? 'Confirmar con Cashea' : 'Confirmar Fiado'}
                                </h3>
                                <p className="text-xs sm:text-sm text-slate-400 mt-0.5">Revisa los detalles antes de continuar</p>
                            </div>
                        </div>

                        {/* Monto destacado */}
                        <div className={`border rounded-2xl p-4 sm:p-5 mb-5 ${casheaActive ? 'bg-purple-50 dark:bg-purple-900/10 border-purple-200 dark:border-purple-800/30' : 'bg-amber-50 dark:bg-amber-900/10 border-amber-200 dark:border-amber-800/30'}`}>
                            <div className="text-center mb-3">
                                <p className={`text-[11px] sm:text-xs font-bold uppercase tracking-widest mb-1 ${casheaActive ? 'text-purple-500' : 'text-amber-500'}`}>
                                    {casheaActive ? 'Monto pendiente Cashea' : 'Monto a fiar'}
                                </p>
                                <p className={`text-3xl sm:text-4xl font-black ${casheaActive ? 'text-purple-600' : 'text-amber-600'}`}>${(casheaActive ? casheaAmountUsd : remainingUsd).toFixed(2)}</p>
                                <p className={`text-sm sm:text-base font-bold mt-0.5 ${casheaActive ? 'text-purple-500/70' : 'text-amber-500/70'}`}>{formatBs(casheaActive ? mulR(casheaAmountUsd, effectiveRate) : remainingBs)} Bs</p>
                            </div>
                            <div className={`border-t pt-3 space-y-2 ${casheaActive ? 'border-purple-200/50 dark:border-purple-800/20' : 'border-amber-200/50 dark:border-amber-800/20'}`}>
                                <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-300">
                                    {casheaActive
                                        ? <>Cashea cobrará <span className="font-black text-slate-800 dark:text-white">${casheaAmountUsd.toFixed(2)}</span> a <span className="font-black text-slate-800 dark:text-white">{selectedCustomer?.name}</span>. Se registrará como deuda Cashea.</>
                                        : <>Se registrara como deuda a nombre de <span className="font-black text-slate-800 dark:text-white">{selectedCustomer?.name}</span>.</>
                                    }
                                </p>
                                {totalPaidUsd > 0.01 && (
                                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                        El cliente abona <span className="font-bold text-emerald-600">${totalPaidUsd.toFixed(2)}</span> ahora y el restante queda pendiente.
                                    </p>
                                )}
                                {totalPaidUsd <= 0.01 && !casheaActive && (
                                    <p className="text-[11px] sm:text-xs text-slate-500 dark:text-slate-400">
                                        El monto total de la venta quedara como deuda del cliente.
                                    </p>
                                )}
                                {selectedCustomer && (selectedCustomer.deuda || 0) > 0.01 && (
                                    <div className="bg-red-50 dark:bg-red-900/10 border border-red-200 dark:border-red-800/30 rounded-lg p-2.5 mt-2">
                                        <p className="text-[11px] sm:text-xs font-bold text-red-600 dark:text-red-400">
                                            {casheaActive
                                                ? <>Este cliente tiene <span className="font-black">${(selectedCustomer.deuda || 0).toFixed(2)}</span> de fiado pendiente (independiente de Cashea).</>
                                                : <>Este cliente ya tiene una deuda de ${(selectedCustomer.deuda || 0).toFixed(2)}. La deuda total pasara a ser ${((selectedCustomer.deuda || 0) + remainingUsd).toFixed(2)}.</>
                                            }
                                        </p>
                                    </div>
                                )}
                                {selectedCustomer && casheaActive && (selectedCustomer.casheaDeuda || 0) > 0.01 && (
                                    <div className="bg-purple-50 dark:bg-purple-900/10 border border-purple-200 dark:border-purple-800/30 rounded-lg p-2.5 mt-2">
                                        <p className="text-[11px] sm:text-xs font-bold text-purple-600 dark:text-purple-400">
                                            Ya tiene ${(selectedCustomer.casheaDeuda || 0).toFixed(2)} pendiente con Cashea. El total Cashea pasará a ${((selectedCustomer.casheaDeuda || 0) + casheaAmountUsd).toFixed(2)}.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Botones */}
                        <div className="flex gap-3">
                            <button
                                onClick={() => setConfirmFiar(false)}
                                className="flex-1 py-3.5 sm:py-4 font-bold text-sm sm:text-base text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={() => { setConfirmFiar(false); handleConfirm(); }}
                                className={`flex-1 py-3.5 sm:py-4 font-black text-sm sm:text-base text-white rounded-xl shadow-lg active:scale-95 transition-all ${casheaActive ? 'bg-purple-500 hover:bg-purple-600 shadow-purple-500/25' : 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/25'}`}
                            >
                                {casheaActive ? 'Confirmar Cashea' : 'Confirmar fiado'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ══════════ CUSTOMER BOTTOM SHEET ══════════ */}
            {showCustomerSheet && (
                <div
                    className="absolute inset-0 z-20 flex flex-col justify-end bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
                    onClick={closeCustomerSheet}
                >
                    <div
                        className="bg-white dark:bg-slate-900 rounded-t-3xl flex flex-col shadow-2xl animate-in slide-in-from-bottom duration-300"
                        style={{ maxHeight: '85%' }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Handle */}
                        <div className="flex justify-center pt-3 pb-1 shrink-0">
                            <div className="w-10 h-1 bg-slate-300 dark:bg-slate-600 rounded-full" />
                        </div>

                        {!showNewCustomerForm ? (
                            <>
                                {/* Header */}
                                <div className="px-5 pt-2 pb-3 shrink-0">
                                    <h3 className="text-lg font-black text-slate-800 dark:text-white">Seleccionar Cliente</h3>
                                    <p className="text-xs text-slate-400 mt-0.5">{customers.length} clientes registrados</p>
                                </div>

                                {/* Search */}
                                <div className="px-4 pb-3 shrink-0">
                                    <div className="relative">
                                        <Users size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Buscar por nombre o cédula..."
                                            value={customerSearch}
                                            onChange={e => setCustomerSearch(e.target.value)}
                                            className="w-full pl-9 pr-4 py-3 rounded-2xl bg-slate-100 dark:bg-slate-800 border-2 border-transparent focus:border-indigo-400 dark:focus:border-indigo-600 text-sm font-medium text-slate-700 dark:text-slate-200 outline-none transition-all placeholder:text-slate-400"
                                        />
                                        {customerSearch && (
                                            <button onClick={() => setCustomerSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                                <X size={15} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* List */}
                                <div className="flex-1 overflow-y-auto px-4 pb-3 space-y-2 min-h-0">
                                    {/* Consumidor Final */}
                                    <button
                                        onClick={() => { setSelectedCustomerId(''); setCasheaActive(false); closeCustomerSheet(); }}
                                        className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all active:scale-[0.98] ${!selectedCustomerId
                                            ? 'border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-900/20'
                                            : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                        }`}
                                    >
                                        <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                                            <Users size={18} className="text-slate-400" />
                                        </div>
                                        <div className="flex-1 text-left">
                                            <p className="text-sm font-black text-slate-700 dark:text-slate-200">Consumidor Final</p>
                                            <p className="text-[10px] text-slate-400">Sin registro de cliente</p>
                                        </div>
                                        {!selectedCustomerId && <Check size={16} className="text-emerald-500 shrink-0" />}
                                    </button>

                                    {/* Customers */}
                                    {filteredCustomers.map(c => (
                                        <button
                                            key={c.id}
                                            onClick={() => handleSelectCustomer(c.id)}
                                            className={`w-full flex items-center gap-3 p-3 rounded-2xl border-2 transition-all active:scale-[0.98] ${selectedCustomerId === c.id
                                                ? 'border-indigo-300 dark:border-indigo-700 bg-indigo-50 dark:bg-indigo-900/20'
                                                : 'border-slate-100 dark:border-slate-800 hover:border-slate-200 dark:hover:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                            }`}
                                        >
                                            <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/40 flex items-center justify-center text-sm font-black text-indigo-600 dark:text-indigo-400 shrink-0">
                                                {c.name.charAt(0).toUpperCase()}
                                            </div>
                                            <div className="flex-1 text-left min-w-0">
                                                <p className="text-sm font-black text-slate-800 dark:text-white truncate">{c.name}</p>
                                                {c.documentId && <p className="text-[10px] text-slate-400 font-medium">{c.documentId}</p>}
                                                {c.phone && !c.documentId && <p className="text-[10px] text-slate-400">{c.phone}</p>}
                                            </div>
                                            <div className="flex flex-col items-end gap-1 shrink-0">
                                                {c.deuda > 0.01 && (
                                                    <span className="text-[10px] font-black text-red-500 bg-red-50 dark:bg-red-900/20 px-2 py-0.5 rounded-lg">
                                                        Debe ${c.deuda.toFixed(2)}
                                                    </span>
                                                )}
                                                {c.deuda < -0.01 && (
                                                    <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/20 px-2 py-0.5 rounded-lg">
                                                        Favor ${Math.abs(c.deuda).toFixed(2)}
                                                    </span>
                                                )}
                                                {selectedCustomerId === c.id && <Check size={15} className="text-indigo-500" />}
                                            </div>
                                        </button>
                                    ))}

                                    {customers.length === 0 && (
                                        <div className="text-center py-10">
                                            <Users size={32} className="text-slate-300 mx-auto mb-2" />
                                            <p className="text-sm font-bold text-slate-400">No hay clientes registrados</p>
                                            <p className="text-xs text-slate-300 mt-1">Crea el primero con el botón de abajo</p>
                                        </div>
                                    )}
                                    {customers.length > 0 && filteredCustomers.length === 0 && (
                                        <div className="text-center py-8">
                                            <p className="text-sm font-bold text-slate-400">Sin resultados para "{customerSearch}"</p>
                                        </div>
                                    )}
                                </div>

                                {/* New customer CTA */}
                                <div className="px-4 pt-3 pb-[max(1.5rem,env(safe-area-inset-bottom))] border-t border-slate-100 dark:border-slate-800 shrink-0">
                                    <button
                                        onClick={() => setShowNewCustomerForm(true)}
                                        className="w-full py-3.5 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-2xl shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                    >
                                        <UserPlus size={18} /> Nuevo Cliente
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                {/* New Customer Form */}
                                <div className="px-5 pt-2 pb-3 flex items-center gap-3 shrink-0 border-b border-slate-100 dark:border-slate-800">
                                    <button
                                        onClick={() => { setShowNewCustomerForm(false); setNewClientName(''); setNewClientDocument(''); setNewClientPhone(''); }}
                                        className="p-2 -ml-1 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                    <div>
                                        <h3 className="text-base font-black text-slate-800 dark:text-white">Nuevo Cliente</h3>
                                        <p className="text-[10px] text-slate-400">Solo el nombre es obligatorio</p>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">
                                    {/* Nombre */}
                                    <div>
                                        <label className="block text-xs font-black text-slate-600 dark:text-slate-300 uppercase tracking-widest mb-2">
                                            Nombre <span className="text-emerald-500">*</span>
                                        </label>
                                        <input
                                            autoFocus
                                            type="text"
                                            placeholder="Ej: Juan Pérez"
                                            value={newClientName}
                                            onChange={e => setNewClientName(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                            className="w-full py-3.5 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-base font-bold text-slate-800 dark:text-white outline-none focus:border-emerald-400 dark:focus:border-emerald-600 focus:ring-4 focus:ring-emerald-500/10 transition-all placeholder:text-slate-300"
                                        />
                                    </div>

                                    {/* Cédula */}
                                    <div>
                                        <label className="block text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                                            Cédula / RIF <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                                        </label>
                                        <input
                                            type="text"
                                            placeholder="Ej: V-12345678"
                                            value={newClientDocument}
                                            onChange={e => setNewClientDocument(e.target.value.toUpperCase())}
                                            onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                            className="w-full py-3.5 px-4 rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-base font-bold text-slate-800 dark:text-white outline-none focus:border-indigo-400 dark:focus:border-indigo-600 focus:ring-4 focus:ring-indigo-500/10 transition-all placeholder:text-slate-300 uppercase"
                                        />
                                    </div>

                                    {/* Teléfono */}
                                    <div>
                                        <label className="block text-xs font-black text-slate-500 dark:text-slate-400 uppercase tracking-widest mb-2">
                                            Teléfono <span className="text-slate-300 font-normal normal-case tracking-normal">(opcional)</span>
                                        </label>
                                        <div className="flex rounded-2xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 overflow-hidden focus-within:border-indigo-400 dark:focus-within:border-indigo-600 focus-within:ring-4 focus-within:ring-indigo-500/10 transition-all">
                                            <span className="px-4 py-3.5 text-sm font-black text-blue-500 border-r border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900 shrink-0 select-none">+58</span>
                                            <input
                                                type="tel"
                                                placeholder="0412 123 4567"
                                                value={newClientPhone}
                                                onChange={e => setNewClientPhone(e.target.value.replace(/^\+?58/, ''))}
                                                onKeyDown={e => e.key === 'Enter' && handleCreateClient()}
                                                className="flex-1 px-4 py-3.5 text-base font-bold text-slate-800 dark:text-white bg-transparent outline-none placeholder:text-slate-300"
                                            />
                                        </div>
                                    </div>
                                </div>

                                {/* Submit */}
                                <div className="px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-3 border-t border-slate-100 dark:border-slate-800 shrink-0">
                                    <button
                                        onClick={handleCreateClient}
                                        disabled={!newClientName.trim() || savingClient}
                                        className="w-full py-4 bg-emerald-500 hover:bg-emerald-600 disabled:bg-slate-200 dark:disabled:bg-slate-800 disabled:text-slate-400 text-white font-black text-base rounded-2xl shadow-lg shadow-emerald-500/20 disabled:shadow-none active:scale-[0.98] transition-all flex items-center justify-center gap-2"
                                    >
                                        <Check size={20} />
                                        {savingClient ? 'Guardando...' : 'Crear y Seleccionar'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}

        </div>
    );
}
