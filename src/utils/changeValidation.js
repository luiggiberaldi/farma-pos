import { round2, sumR } from './dinero.js';

// Both fields represent physically delivered money, never display equivalents.
// A positive change requires an explicit allocation; no currency is assumed.
export function validateChangeBreakdown(changeUsd, breakdown = {}, rate = 0) {
    const fail = error => ({ valid: false, error });
    if (!Number.isFinite(changeUsd) || changeUsd < 0) return fail('El vuelto calculado no es válido.');
    const due = round2(changeUsd);
    const rawUsd = breakdown?.changeUsdGiven;
    const rawBs = breakdown?.changeBsGiven;
    const isBlank = value => value == null || (typeof value === 'string' && value.trim() === '');
    if (due > 0 && isBlank(rawUsd) && isBlank(rawBs)) return fail('Indica cómo entregarás el vuelto: Todo $, Todo Bs o un reparto.');
    const parse = value => isBlank(value) ? 0 : (typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN);
    const usd = parse(rawUsd);
    const bs = parse(rawBs);
    if (!Number.isFinite(usd) || !Number.isFinite(bs) || usd < 0 || bs < 0) return fail('Los importes del vuelto deben ser números finitos y no negativos.');
    if (bs > 0 && (!Number.isFinite(rate) || rate <= 0)) return fail('Se necesita una tasa válida para entregar vuelto en Bs.');
    const changeUsdGiven = round2(usd);
    const changeBsGiven = round2(bs);
    const bsInUsd = changeBsGiven > 0 ? changeBsGiven / rate : 0;
    if (![due, changeUsdGiven, changeBsGiven, bsInUsd].every(value => Number.isFinite(value) && Number.isSafeInteger(Math.round(value * 100)))) {
        return fail('Los importes del vuelto exceden la precisión admitida.');
    }
    const delivered = sumR(changeUsdGiven, bsInUsd);
    if (!Number.isSafeInteger(Math.round(delivered * 100))) return fail('El total del vuelto excede la precisión admitida.');
    // Compare at USD cent precision. A whole extra cent is not a rounding
    // tolerance: it would permit doubling a one-cent change.
    if (Math.round(delivered * 100) !== Math.round(due * 100)) return fail('El reparto del vuelto no coincide con el vuelto de la venta.');
    return { valid: true, changeUsdGiven, changeBsGiven, deliveredUsd: delivered };
}
