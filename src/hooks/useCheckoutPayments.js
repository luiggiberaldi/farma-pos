import { useState, useCallback, useMemo } from 'react';
import { round2, mulR, divR, subR, sumR } from '../utils/dinero';
import { validateChangeInBs } from '../utils/tenderMath.js';
import { customerCredit } from '../utils/salePlan.js';

const CASHEA_PERCENTS = [10, 20, 30, 40, 50, 60, 70, 80];
const CASHEA_LEVEL_MAP = { 1: 60, 2: 50, 3: 40, 4: 30, 5: 20, 6: 10 };
const USD_QUICK = [1, 5, 10, 20, 50, 100];
const BS_QUICK = [100, 500, 1000, 5000];

export function useCheckoutPayments(props) {
    const {
        cartTotalUsd, cartTotalBs, effectiveRate, customers = [],
        selectedCustomerId, setSelectedCustomerId, paymentMethods,
        onConfirmSale, requiresPrescription, triggerHaptic,
        onCreateCustomer, tasaCop, isProcessingSale,
    } = props;

// -- State: un valor por barra --
const [barValues, setBarValues] = useState({});

// -- Cashea --
const casheaEnabled = localStorage.getItem('cashea_enabled') === 'true';
const casheaMinAmount = parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0;
const casheaMeetsMinimum = casheaMinAmount <= 0 || cartTotalUsd >= casheaMinAmount;
const [casheaActive, setCasheaActive] = useState(false);
const [casheaPercent, setCasheaPercent] = useState(60);

// -- Modo de cobro: Contado vs Fiado (interruptor del encabezado) --
const [payMode, setPayMode] = useState('contado');

// -- Chips rápidos táctiles: suman al restante con un toque --
const addQuick = (methodId, amount) => {
    triggerHaptic && triggerHaptic();
    const cur = parseFloat(barValues[methodId]) || 0;
    setChangeSelection(null);
    setBarValues(prev => ({ ...prev, [methodId]: round2(cur + amount).toString() }));
};

const [showCustomerPicker, setShowCustomerPicker] = useState(false);
const [showCustomerSheet, setShowCustomerSheet] = useState(false);
const [customerSearch, setCustomerSearch] = useState('');
const [showNewCustomerForm, setShowNewCustomerForm] = useState(false);
const [newClientName, setNewClientName] = useState('');
const [newClientDocument, setNewClientDocument] = useState('');
const [newClientPhone, setNewClientPhone] = useState('');
const [savingClient, setSavingClient] = useState(false);
const [changeSelection, setChangeSelection] = useState(null);
const [confirmFiar, setConfirmFiar] = useState(false);
const [prescription, setPrescription] = useState({ reference: '', prescriber: '', confirmed: false });
const [favorAmount, setFavorAmount] = useState(0);
const selectedCustomer = customers.find(c => c.id === selectedCustomerId);
let availableFavor = 0;
try { availableFavor = selectedCustomer ? customerCredit(selectedCustomer) : 0; } catch { /* Invalid balances fail in processor. */ }
const usableFavor = Math.min(favorAmount, availableFavor);
const prescriptionReady = !requiresPrescription || (Boolean(selectedCustomer?.documentId?.trim()) && prescription.reference.trim().length > 0 && prescription.prescriber.trim().length > 0 && prescription.confirmed);

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
const totalPaidWithCasheaUsd = round2(totalPaidUsd + casheaAmountUsd + usableFavor);

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

const netTenderBs = sumR(totalPaidBs, mulR(casheaAmountUsd + usableFavor, effectiveRate));
const remainingBs = round2(Math.max(0, subR(cartTotalBs, netTenderBs)));
const remainingUsd = divR(remainingBs, effectiveRate);
const changeBs = round2(Math.max(0, subR(netTenderBs, cartTotalBs)));
const changeUsd = divR(changeBs, effectiveRate);
const PAYMENT_TOLERANCE = 0.01;
const isPaid = remainingBs === 0;
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
    setChangeSelection(null);
    setBarValues(prev => ({ ...prev, [methodId]: v }));
}, []);

const fillBar = useCallback((methodId, currency) => {
    triggerHaptic && triggerHaptic();
    if (remainingBs <= 0) return;

    const currentVal = parseFloat(barValues[methodId]) || 0;
    let newVal;
    if (currency === 'USD') {
        newVal = round2(currentVal + remainingUsd);
    } else if (currency === 'COP') {
        newVal = round2(currentVal + mulR(remainingUsd, tasaCop));
    } else {
        newVal = round2(currentVal + remainingBs);
    }

    setChangeSelection(null);
    setBarValues(prev => ({ ...prev, [methodId]: newVal.toString() }));
}, [barValues, remainingUsd, remainingBs, triggerHaptic, tasaCop]);

// A choice belongs to this amount and rate. Editing the payment or rate
// invalidates the old allocation without silently choosing a currency.
const hasCurrentChange = changeSelection?.due === changeBs && changeSelection?.rate === effectiveRate;
const changeUsdGiven = hasCurrentChange ? changeSelection.usd : '';
const changeBsGiven = hasCurrentChange ? changeSelection.bs : '';
const selectChange = (usd, bs) => setChangeSelection({ due: changeBs, rate: effectiveRate, usd, bs });
const changeCheck = (casheaActive || usableFavor > 0) && changeBs > 0
    ? { valid: false, error: 'Ajusta Cashea y saldo a favor al total exacto, sin retiro de efectivo.' }
    : validateChangeInBs(changeBs, { changeUsdGiven, changeBsGiven }, effectiveRate);

// Construir payments[] desde barValues al confirmar
const handleConfirm = useCallback(() => {
    if (isProcessingSale || !changeCheck.valid || !prescriptionReady) return;
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

    if (usableFavor > 0) payments.push({ id: crypto.randomUUID(), methodId: 'saldo_favor', methodLabel: 'Saldo a favor', currency: 'USD', amountInput: usableFavor, amountUsd: usableFavor, amountBs: mulR(usableFavor, effectiveRate) });
    onConfirmSale(payments, {
        changeUsdGiven: changeCheck.changeUsdGiven,
        changeBsGiven: changeCheck.changeBsGiven,
    }, requiresPrescription ? prescription : null);
}, [barValues, paymentMethods, effectiveRate, onConfirmSale, triggerHaptic, changeCheck.valid, changeCheck.changeUsdGiven, changeCheck.changeBsGiven, isProcessingSale, casheaActive, casheaAmountUsd, casheaPercent, tasaCop, usableFavor, requiresPrescription, prescription, prescriptionReady]);

// Saldo a favor
const handleSaldoFavor = useCallback(() => {
    triggerHaptic && triggerHaptic();
    setFavorAmount(Math.min(availableFavor, round2(remainingUsd + usableFavor)));
    setChangeSelection(null);
}, [availableFavor, remainingUsd, usableFavor, triggerHaptic]);

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
    setFavorAmount(0);
    setPrescription({ reference: '', prescriber: '', confirmed: false });
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
    return {
        barValues, setBarValues,
        casheaEnabled, casheaMinAmount, casheaMeetsMinimum,
        casheaActive, setCasheaActive, casheaPercent, setCasheaPercent,
        CASHEA_PERCENTS, CASHEA_LEVEL_MAP,
        payMode, setPayMode,
        USD_QUICK, BS_QUICK, addQuick,
        showCustomerPicker, setShowCustomerPicker,
        showCustomerSheet, setShowCustomerSheet,
        customerSearch, setCustomerSearch,
        showNewCustomerForm, setShowNewCustomerForm,
        newClientName, setNewClientName,
        newClientDocument, setNewClientDocument,
        newClientPhone, setNewClientPhone,
        savingClient, setSavingClient,
        changeSelection, setChangeSelection,
        confirmFiar, setConfirmFiar,
        prescription, setPrescription,
        favorAmount, setFavorAmount,
        selectedCustomer, availableFavor, usableFavor, prescriptionReady,
        filteredCustomers, closeCustomerSheet,
        totalPaidUsd, casheaAmountUsd, totalPaidWithCasheaUsd, totalPaidBs,
        netTenderBs, remainingBs, remainingUsd, changeBs, changeUsd,
        PAYMENT_TOLERANCE, isPaid, casheaConfirmReady,
        handleBarChange, fillBar,
        hasCurrentChange, changeUsdGiven, changeBsGiven, selectChange, changeCheck,
        handleConfirm, handleSaldoFavor, handleCreateClient, handleSelectCustomer,
        methodsUsd, methodsBs, methodsCop, sectionStyles,
    };
}
