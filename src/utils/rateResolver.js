export const DEFAULT_EUR_USD_RATIO = 1.18;
export const RATE_DISCREPANCY_THRESHOLD_PERCENT = 0.25;

export function parseSafeFloat(value) {
    if (value === null || value === undefined || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (typeof value !== 'string') return 0;

    const clean = value.replace(/[^\d.,-]/g, '');
    if (!clean) return 0;

    const lastDot = clean.lastIndexOf('.');
    const lastComma = clean.lastIndexOf(',');
    const lastSeparator = Math.max(lastDot, lastComma);

    if (lastSeparator === -1) return parseFloat(clean) || 0;

    const integer = clean.slice(0, lastSeparator).replace(/[.,]/g, '');
    const decimals = clean.slice(lastSeparator + 1).replace(/[.,]/g, '');
    return parseFloat(`${integer || '0'}.${decimals || '0'}`) || 0;
}

export function validateMagnitude(value, min = 10, max = 5000) {
    const parsed = parseSafeFloat(value);
    if (!parsed || parsed <= 0) return 0;

    let normalized = parsed;
    let guard = 0;
    while (normalized < min && guard < 6) {
        normalized *= 10;
        guard += 1;
    }
    guard = 0;
    while (normalized > max && guard < 6) {
        normalized /= 10;
        guard += 1;
    }
    return normalized >= min && normalized <= max ? normalized : 0;
}

export function localDateKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function bcvDateKey(date = new Date()) {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return null;

    try {
        const parts = new Intl.DateTimeFormat('en-CA', {
            timeZone: 'America/Caracas',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
        }).formatToParts(d);
        const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
        return `${values.year}-${values.month}-${values.day}`;
    } catch {
        return localDateKey(d);
    }
}

export function normalizeRateDate(value) {
    if (!value) return null;
    if (value instanceof Date) return localDateKey(value);
    if (typeof value === 'number') return localDateKey(new Date(value));

    const text = String(value).trim();
    if (!text) return null;
    // Date-only ISO strings must remain business dates. Parsing them with
    // new Date() would interpret midnight UTC and can shift them in Venezuela.
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

    // The Google Script currently returns dates like "8/12/2026" (M/D/YYYY).
    const slashDate = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (slashDate) {
        const first = Number(slashDate[1]);
        const second = Number(slashDate[2]);
        const year = Number(slashDate[3]);
        const month = first > 12 ? second : first;
        const day = first > 12 ? first : second;
        return localDateKey(new Date(year, month - 1, day, 12));
    }

    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : localDateKey(parsed);
}

export function makeRateCandidate({
    value,
    source,
    priority = 0,
    validDate = null,
    observedAt = null,
    kind = 'bcv',
}) {
    const normalizedValue = validateMagnitude(value);
    if (normalizedValue <= 0) return null;

    return {
        val: normalizedValue,
        source,
        priority,
        validDate: normalizeRateDate(validDate),
        observedAt: observedAt || null,
        kind,
    };
}

export function selectRateCandidate(candidates, { today = localDateKey(new Date()) } = {}) {
    const valid = (candidates || []).filter(Boolean).filter(candidate => {
        if (!candidate.validDate) return true;
        return !today || candidate.validDate <= today;
    });

    if (!valid.length) return null;

    // A value without effective date is only an unknown-date fallback. It must
    // never override an official value whose business date is known.
    const dated = valid.filter(candidate => candidate.validDate);
    const datedToday = dated.filter(candidate => candidate.validDate === today);
    const pool = datedToday.length ? datedToday : dated.length ? dated : valid;

    return [...pool].sort((a, b) => {
        if ((b.validDate || '') !== (a.validDate || '')) return (b.validDate || '').localeCompare(a.validDate || '');
        if (b.priority !== a.priority) return b.priority - a.priority;
        return b.val - a.val;
    })[0];
}

export function getRateDiscrepancy(candidates, threshold = RATE_DISCREPANCY_THRESHOLD_PERCENT) {
    const valid = (candidates || []).filter(Boolean);
    if (valid.length < 2) return null;

    const highest = valid.reduce((best, candidate) => candidate.val > best.val ? candidate : best, valid[0]);
    const lowest = valid.reduce((best, candidate) => candidate.val < best.val ? candidate : best, valid[0]);
    if (!lowest.val) return null;

    const diffPercent = ((highest.val - lowest.val) / lowest.val) * 100;
    if (diffPercent <= threshold) return null;

    return {
        highest: highest.val,
        lowest: lowest.val,
        highestSource: highest.source,
        lowestSource: lowest.source,
        diff: diffPercent,
    };
}

export function formatOfficialRate(value) {
    const parsed = parseSafeFloat(value);
    return new Intl.NumberFormat('es-VE', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    }).format(parsed);
}
