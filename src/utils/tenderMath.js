import { round2, mulR, divR, sumR } from './dinero.js';

const cents = value => Number.isFinite(value) && value >= 0 && Number.isSafeInteger(Math.round(value * 100)) && Math.abs(value - round2(value)) < 1e-8;
export function normalizeTender(payment, rate, copRate = 0) {
    if (!payment || typeof payment.methodId !== 'string' || !payment.methodId || !Number.isFinite(rate) || rate <= 0) throw new Error('Pago o tasa inválidos.');
    const currency = payment.currency || (payment.methodId.endsWith('_bs') || ['pago_movil', 'punto_venta'].includes(payment.methodId) ? 'BS'
        : payment.methodId.endsWith('_cop') ? 'COP' : 'USD');
    if (!['BS', 'USD', 'COP'].includes(currency)) throw new Error('Moneda no disponible para cobros.');
    if (currency === 'COP' && (!Number.isFinite(copRate) || copRate <= 0)) throw new Error('Tasa COP no disponible para cobros.');
    const supplied = payment.amountInput ?? payment.amount ?? (currency === 'BS' ? payment.amountBs : currency === 'COP' ? payment.amountCop : payment.amountUsd);
    const native = supplied == null && currency === 'BS' && Number.isFinite(payment.amountUsd) ? mulR(payment.amountUsd, rate)
        : supplied == null && currency === 'COP' && Number.isFinite(payment.amountUsd) ? mulR(payment.amountUsd, copRate)
        : Number(supplied);
    if (!cents(native)) throw new Error('El pago debe ser finito, no negativo y tener como máximo dos decimales.');
    const amountUsd = currency === 'USD' ? native : currency === 'COP' ? divR(native, copRate) : divR(native, rate);
    const amountBs = currency === 'BS' ? native : mulR(amountUsd, rate);
    const amountCop = currency === 'COP' ? native : mulR(amountUsd, copRate);
    if (payment.amountUsd != null && (!Number.isFinite(payment.amountUsd) || Math.abs(payment.amountUsd - amountUsd) > 0.010001)) throw new Error('La equivalencia del pago no coincide con su moneda y tasa.');
    if (payment.amountInputCurrency && payment.amountInputCurrency !== currency) throw new Error('Moneda de pago incompatible.');
    return { ...payment, currency, amount: native, amountInput: native, amountInputCurrency: currency, amountUsd, amountBs, amountCop };
}

export function tenderBalance(payments, totalBs, rate) {
    if (!Number.isFinite(totalBs) || totalBs < 0 || !Number.isFinite(rate) || rate <= 0) throw new Error('Total de cobro inválido.');
    const paidBs = sumR(payments.map(payment => payment.amountBs));
    // Tolerancia de 1 centavo para diferencias de redondeo (ej: 1.80*859.06)
    let remainingBs = round2(Math.max(0, totalBs - paidBs));
    if (remainingBs <= 0.01) remainingBs = 0;
    const changeBs = round2(Math.max(0, paidBs - totalBs));
    return { paidBs, remainingBs, changeBs, remainingUsd: divR(remainingBs, rate), changeUsd: divR(changeBs, rate) };
}

export function validateChangeInBs(dueBs, breakdown, rate) {
    const fail = error => ({ valid: false, error });
    if (!cents(dueBs) || !Number.isFinite(rate) || rate <= 0) return fail('El vuelto o la tasa no son válidos.');
    const blank = value => value == null || typeof value === 'string' && value.trim() === '';
    if (dueBs > 0 && blank(breakdown?.changeUsdGiven) && blank(breakdown?.changeBsGiven)) return fail('Indica cómo entregarás el vuelto: Todo $, Todo Bs o un reparto.');
    const usd = blank(breakdown?.changeUsdGiven) ? 0 : Number(breakdown.changeUsdGiven);
    const bs = blank(breakdown?.changeBsGiven) ? 0 : Number(breakdown.changeBsGiven);
    if (!cents(usd) || !cents(bs)) return fail('El vuelto debe contener importes finitos, no negativos y con dos decimales.');
    const deliveredBs = sumR(mulR(usd, rate), bs);
    if (Math.round(deliveredBs * 100) !== Math.round(dueBs * 100)) return fail('El reparto del vuelto no coincide con el dinero recibido. Ajusta el remanente en Bs.');
    return { valid: true, changeUsdGiven: usd, changeBsGiven: bs, deliveredBs, deliveredUsd: divR(deliveredBs, rate) };
}
