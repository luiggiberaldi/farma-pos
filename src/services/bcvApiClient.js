import { parseSafeFloat, validateMagnitude } from '../utils/rateResolver.js';

// BCV Today republishes the values published by bcv.org.ve and exposes the
// effective business date, unlike market feeds that can already contain the
// next day's rate.
export const DEFAULT_BCV_API_URL = 'https://bcv.today/api/v1/rate.json';

function firstDefined(...values) {
    return values.find(value => value !== null && value !== undefined && value !== '') ?? null;
}

function readNestedValue(value, keys) {
    if (!value || typeof value !== 'object') return null;
    return firstDefined(...keys.map(key => value[key]));
}

export class BcvApiClient {
    constructor(baseUrl = DEFAULT_BCV_API_URL, timeoutMs = 5000) {
        this.baseUrl = String(baseUrl || DEFAULT_BCV_API_URL).replace(/\/$/, '');
        this.timeoutMs = timeoutMs;
    }

    async getRaw() {
        if (!this.baseUrl) return null;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
        let response;
        try {
            response = await fetch(this.baseUrl, {
                signal: controller.signal,
                headers: { Accept: 'application/json' },
                cache: 'no-store',
            });
        } finally {
            clearTimeout(timeoutId);
        }

        if (!response.ok) throw new Error(`BCV API respondió ${response.status}`);

        const data = await response.json();
        const bcv = data?.bcv || data?.usd || data?.dolar || data;
        const euro = data?.euro || data?.eur || data;

        // BCV Today uses uppercase USD/EUR keys. The other aliases keep this
        // client compatible with existing configured endpoints.
        const rawUsd = firstDefined(
            data?.USD,
            data?.usd,
            readNestedValue(bcv, ['price', 'tasa', 'promedio', 'value', 'valor']),
            data?.tasa,
            data?.valor
        );
        const rawEuro = firstDefined(
            data?.EUR,
            data?.eur,
            readNestedValue(euro, ['price', 'tasa', 'promedio', 'value', 'valor'])
        );

        const tasa = validateMagnitude(rawUsd);
        const euroPrice = validateMagnitude(rawEuro);
        if (tasa <= 0 && euroPrice <= 0) return null;

        const validDate = firstDefined(
            data?.effective_date,
            data?.effectiveDate,
            data?.validDate,
            data?.fechaVigencia,
            data?.date,
            data?.fecha,
            data?.fechaActualizacion,
            bcv?.validDate,
            bcv?.fechaVigencia,
            bcv?.fechaActualizacion,
            bcv?.fecha
        );
        const observedAt = firstDefined(
            data?.updated_at,
            data?.updatedAt,
            data?.observedAt,
            data?.timestamp,
            new Date().toISOString()
        );
        const source = firstDefined(
            data?.source,
            data?.fuente,
            this.baseUrl === DEFAULT_BCV_API_URL ? 'BCV oficial (BCV Today)' : 'BcvApiClient'
        );

        return {
            ok: true,
            tasa,
            euro: euroPrice,
            source,
            validDate,
            observedAt,
            change: parseSafeFloat(data?.change ?? bcv?.change),
            euroChange: parseSafeFloat(data?.euroChange ?? euro?.change),
        };
    }
}
