import { useState, useEffect, useCallback, useRef } from 'react';
import { BcvApiClient, DEFAULT_BCV_API_URL } from '../services/bcvApiClient';
import {
    DEFAULT_EUR_USD_RATIO,
    bcvDateKey,
    getRateDiscrepancy,
    makeRateCandidate,
    parseSafeFloat,
    selectRateCandidate,
    validateMagnitude,
} from '../utils/rateResolver';

const BCV_API_URL = import.meta.env.VITE_BCV_API_URL || DEFAULT_BCV_API_URL;
// En desarrollo el Worker local puede no tener configuradas sus variables; la
// fuente directa y DolarApi ya cubren ese caso sin repetir errores de /api/rates.
const BCV_CACHE_API_URL = import.meta.env.VITE_BCV_CACHE_API_URL
    || (import.meta.env.PROD ? '/api/rates' : '');
const EXCHANGERATE_KEY = import.meta.env.VITE_EXCHANGERATE_KEY || '';
const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_RATES_URL || import.meta.env.VITE_GOOGLE_SCRIPT_URL || '';
// Este endpoint devuelve solo la cotización oficial, no el listado de mercado.
const DOLAR_API_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';

// No usar una tasa histórica como valor de emergencia. Si no hay una tasa válida,
// el POS recibe 0 y debe permanecer en modo de actualización/offline controlado.
const DEFAULT_RATES = {
    bcv: { price: 0, source: 'Sin tasa BCV válida', change: 0 },
    euro: { price: 0, source: 'Sin tasa Euro válida', change: 0 },
    lastUpdate: null,
};

const UPDATE_INTERVAL = 15 * 60 * 1000;
const CACHE_MAX_AGE_MS = 14 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 5000;
const CACHE_API_TIMEOUT_MS = 3500;

const SOURCE_PRIORITY = {
    'BCV oficial (BCV Today)': 500,
    'BCV Oficial': 500,
    'BCV (datos bcv.org.ve)': 500,
    BcvApiClient: 490,
    '/api/rates': 350,
    'DolarApi Oficial': 320,
    'Google Script (VITE_GOOGLE_SCRIPT_URL)': 280,
    'Google Script': 280,
    'Euro BCV (Triangulado)': 180,
    Cache: 100,
};

async function fetchWithBackoff(url, maxRetries = 1, timeoutMs = REQUEST_TIMEOUT_MS) {
    if (!url) return null;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetch(url, {
                signal: controller.signal,
                cache: 'no-store',
                headers: { Accept: 'application/json' },
            });
            clearTimeout(timeoutId);
            if (response.ok) {
                try {
                    return await response.json();
                } catch {
                    return null;
                }
            }
            // A missing/invalid endpoint will not become valid after retries.
            // Only transient server/rate-limit responses are retried.
            if (response.status >= 400 && response.status < 500 && response.status !== 429) return null;
            if (attempt >= maxRetries) return null;
        } catch {
            clearTimeout(timeoutId);
            if (attempt >= maxRetries) return null;
        }

        const baseDelay = Math.pow(2, attempt) * 1000;
        const jitter = Math.floor(Math.random() * 300);
        await new Promise(resolve => setTimeout(resolve, baseDelay + jitter));
    }
    return null;
}

async function getExternalRatesFallback() {
    if (!EXCHANGERATE_KEY) {
        return { eur: DEFAULT_EUR_USD_RATIO, cop: null, source: 'Default', fresh: false };
    }

    const data = await fetchWithBackoff(`https://v6.exchangerate-api.com/v6/${EXCHANGERATE_KEY}/latest/USD`, 1, REQUEST_TIMEOUT_MS);
    if (data?.result === 'success') {
        return {
            eur: data.conversion_rates?.EUR ? 1 / data.conversion_rates.EUR : DEFAULT_EUR_USD_RATIO,
            cop: data.conversion_rates?.COP || null,
            source: 'ExchangeRate API',
            fresh: true,
        };
    }
    return { eur: DEFAULT_EUR_USD_RATIO, cop: null, source: 'Default', fresh: false };
}

function readSavedRates() {
    try {
        const saved = JSON.parse(localStorage.getItem('monitor_rates_v12'));
        if (!saved || typeof saved !== 'object') return null;
        const savedEuro = saved.euro || {};
        const trustedEuro = isTrustedOfficialEuro(savedEuro.source, savedEuro.validDate);
        return {
            ...DEFAULT_RATES,
            ...saved,
            bcv: { ...DEFAULT_RATES.bcv, ...(saved.bcv || {}) },
            euro: trustedEuro ? { ...DEFAULT_RATES.euro, ...savedEuro } : { ...DEFAULT_RATES.euro },
        };
    } catch {
        return null;
    }
}

function sourcePriority(source, fallback = 0) {
    if (SOURCE_PRIORITY[source] !== undefined) return SOURCE_PRIORITY[source];
    const normalized = String(source || '');
    if (normalized.includes('BCV Today') || normalized.includes('bcv.org.ve') || normalized.includes('BCV oficial') || normalized.includes('BCV Oficial')) {
        return SOURCE_PRIORITY['BCV oficial (BCV Today)'];
    }
    if (normalized.includes('BcvApiClient')) return SOURCE_PRIORITY.BcvApiClient;
    if (normalized.includes('DolarApi')) return SOURCE_PRIORITY['DolarApi Oficial'];
    if (normalized.includes('Google Script')) return SOURCE_PRIORITY['Google Script'];
    if (normalized.includes('/api/rates')) return SOURCE_PRIORITY['/api/rates'];
    return fallback;
}

function getChange(candidate, previous, previousChange = 0) {
    if (candidate?.change !== null && candidate?.change !== undefined && candidate.change !== 0) {
        return parseSafeFloat(candidate.change);
    }
    const oldPrice = parseSafeFloat(previous);
    if (!oldPrice || !candidate?.val) return previousChange || 0;
    return ((candidate.val - oldPrice) / oldPrice) * 100;
}

function getRateValue(raw) {
    if (!raw) return 0;
    if (typeof raw === 'object') {
        return validateMagnitude(raw.price ?? raw.tasa ?? raw.promedio ?? raw.value ?? raw.valor ?? raw.USD ?? raw.usd);
    }
    return validateMagnitude(raw);
}

function getValidDate(raw, parent = null) {
    const readDate = value => {
        if (!value || typeof value !== 'object') return null;
        // lastUpdate/observedAt describe when a cache was fetched, not necessarily
        // the BCV business date. Only accept fields that identify rate validity.
        return value.effective_date
            || value.effectiveDate
            || value.validDate
            || value.fechaVigencia
            || value.fechaActualizacion
            || value.last_update
            || value.fecha
            || value.date
            || null;
    };
    return readDate(raw) || readDate(parent);
}

function getOfficialDolarApiEntry(data) {
    if (Array.isArray(data)) {
        return data.find(item => {
            const source = String(item?.fuente || '').toLowerCase();
            const name = String(item?.nombre || '').toLowerCase();
            return source === 'oficial' || source === 'official' || name === 'oficial' || name === 'dólar';
        }) || null;
    }

    if (!data || typeof data !== 'object') return null;
    const source = String(data.fuente || data.source || '').toLowerCase();
    const name = String(data.nombre || data.name || '').toLowerCase();
    return source === 'oficial' || source === 'official' || name === 'oficial' || name === 'dólar' ? data : data;
}

function isTrustedOfficialEuro(source, validDate) {
    if (!validDate) return false;
    const normalized = String(source || '').toLowerCase();
    if (normalized.includes('triangul') || normalized.includes('google') || normalized.includes('exchange')) return false;
    return normalized.includes('bcv') || normalized === '/api/rates';
}

export function useRates() {
    const [rates, setRates] = useState(readSavedRates);
    const [loading, setLoading] = useState(false);
    const [isOffline, setIsOffline] = useState(false);
    const [logs, setLogs] = useState([]);
    const [rateDiscrepancyWarning, setRateDiscrepancyWarning] = useState(null);

    const ratesRef = useRef(rates);
    useEffect(() => {
        ratesRef.current = rates;
        if (rates) localStorage.setItem('monitor_rates_v12', JSON.stringify(rates));
    }, [rates]);

    const addLog = useCallback((msg, type = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev.slice(-49), { time, msg, type }]);
    }, []);

    const updateData = useCallback(async (isAutoUpdate = false) => {
        if (isAutoUpdate && ratesRef.current?.lastUpdate) {
            const lastUpdate = new Date(ratesRef.current.lastUpdate).getTime();
            if (Number.isFinite(lastUpdate) && Date.now() - lastUpdate < CACHE_MAX_AGE_MS) return;
        }

        if (!isAutoUpdate) setLoading(true);
        const log = (message, type) => !isAutoUpdate && addLog(message, type);
        log(isAutoUpdate ? '--- Auto-Update ---' : '--- Actualización Manual ---');

        try {
            const taskCacheApi = BCV_CACHE_API_URL
                ? fetchWithBackoff(BCV_CACHE_API_URL, 0, CACHE_API_TIMEOUT_MS)
                : Promise.resolve(null);
            const taskPrivate = GOOGLE_SCRIPT_URL
                ? fetchWithBackoff(GOOGLE_SCRIPT_URL, 0, REQUEST_TIMEOUT_MS)
                : Promise.resolve(null);
            const taskDolarApi = fetchWithBackoff(DOLAR_API_URL, 0, REQUEST_TIMEOUT_MS);
            const taskExternal = getExternalRatesFallback();
            // Always consult the dated BCV feed. An optional VITE_BCV_API_URL can
            // replace it for a controlled proxy, but no environment variable is
            // required for the official source to work.
            const taskClient = new BcvApiClient(BCV_API_URL).getRaw().catch(() => null);

            const [cacheApiData, privateData, bcvFallbackData, externalRates, clientData] = await Promise.all([
                taskCacheApi.catch(() => null),
                taskPrivate.catch(() => null),
                taskDolarApi.catch(() => null),
                taskExternal.catch(() => ({ eur: DEFAULT_EUR_USD_RATIO, cop: null, source: 'Default', fresh: false })),
                taskClient,
            ]);

            const observedAt = new Date().toISOString();
            // BCV publishes business dates in Venezuelan time, not the device's
            // timezone. This prevents a UTC/Caracas midnight from selecting the
            // next day's rate.
            const today = bcvDateKey(new Date());
            const bcvCandidates = [];

            // Fuente configurada por backend: solo entra si la tasa es válida.
            // Si no trae fecha, queda por debajo de cualquier candidato fechado.
            const cachedBcv = cacheApiData?.bcv || cacheApiData?.usd || cacheApiData?.dolar;
            const cacheBcvPrice = getRateValue(cachedBcv ?? cacheApiData?.USD ?? cacheApiData?.usd);
            if (cacheBcvPrice > 0) {
                const source = cachedBcv?.source || cacheApiData?.source || '/api/rates';
                bcvCandidates.push(makeRateCandidate({
                    value: cacheBcvPrice,
                    source,
                    priority: sourcePriority(source, SOURCE_PRIORITY['/api/rates']),
                    validDate: getValidDate(cachedBcv, cacheApiData),
                    observedAt,
                }));
            }

            // Fuente principal: valor exacto con fecha efectiva publicada por BCV.
            if (clientData?.ok && clientData.tasa > 0) {
                bcvCandidates.push(makeRateCandidate({
                    value: clientData.tasa,
                    source: clientData.source || 'BCV oficial (BCV Today)',
                    priority: sourcePriority(clientData.source, SOURCE_PRIORITY.BcvApiClient),
                    validDate: clientData.validDate,
                    observedAt: clientData.observedAt || observedAt,
                }));
            }

            // DolarApi es respaldo oficial, no la fuente que decide si también
            // existe una tasa BCV fechada en el feed principal.
            const official = getOfficialDolarApiEntry(bcvFallbackData);
            const officialPrice = getRateValue(official?.promedio ?? official?.price ?? official?.tasa ?? official?.valor ?? official);
            if (officialPrice > 0) {
                bcvCandidates.push(makeRateCandidate({
                    value: officialPrice,
                    source: 'DolarApi Oficial',
                    priority: SOURCE_PRIORITY['DolarApi Oficial'],
                    validDate: getValidDate(official, bcvFallbackData),
                    observedAt,
                }));
            }

            // El Google Script sigue disponible como respaldo, pero ya no gana por
            // tener el valor numérico más alto ni por carecer de fecha.
            if (privateData) {
                const rawBcv = privateData.bcv || privateData.usd || privateData.USD;
                const privatePrice = getRateValue(rawBcv);
                if (privatePrice > 0) {
                    bcvCandidates.push(makeRateCandidate({
                        value: privatePrice,
                        source: 'Google Script (VITE_GOOGLE_SCRIPT_URL)',
                        priority: SOURCE_PRIORITY['Google Script (VITE_GOOGLE_SCRIPT_URL)'],
                        validDate: getValidDate(rawBcv, privateData),
                        observedAt: privateData.timestamp || observedAt,
                    }));
                }
            }

            const eligibleBcvCandidates = bcvCandidates.filter(candidate => candidate && (!candidate.validDate || !today || candidate.validDate <= today));
            const discrepancy = getRateDiscrepancy(eligibleBcvCandidates);
            setRateDiscrepancyWarning(discrepancy);
            if (discrepancy && !isAutoUpdate) {
                addLog(
                    `⚠️ Diferencia BCV ${discrepancy.diff.toFixed(2)}%: ${discrepancy.highest.toFixed(4)} vs ${discrepancy.lowest.toFixed(4)} Bs. Se eligió la fuente BCV fechada.`,
                    'warning'
                );
            }

            const chosenBcv = selectRateCandidate(bcvCandidates, { today });
            const previousRates = ratesRef.current || DEFAULT_RATES;

            if (!chosenBcv) {
                // No falsear lastUpdate: la tasa queda marcada como cache/offline.
                setRateDiscrepancyWarning(null);
                setIsOffline(true);
                if (!isAutoUpdate) addLog('Sin tasa BCV válida; se conserva la última tasa conocida.', 'warning');
                return;
            }

            // Euro: aceptar únicamente el valor EUR publicado por una fuente BCV
            // fechada. No convertir USD con EUR/USD: eso produce una referencia de
            // mercado (por ejemplo ~904) y no la tasa oficial del BCV.
            const euroCandidates = [];
            const clientEuro = getRateValue(clientData?.euro);
            if (clientEuro > 0) {
                euroCandidates.push(makeRateCandidate({
                    value: clientEuro,
                    source: clientData.source || 'BCV oficial (BCV Today)',
                    priority: sourcePriority(clientData.source, SOURCE_PRIORITY.BcvApiClient),
                    validDate: clientData.validDate,
                    observedAt: clientData.observedAt || observedAt,
                    kind: 'euro',
                }));
            }

            const cacheEuro = getRateValue(cacheApiData?.euro);
            const cacheEuroSource = cacheApiData?.euro?.source || '/api/rates';
            const cacheEuroDate = getValidDate(cacheApiData?.euro, cacheApiData);
            if (cacheEuro > 0 && isTrustedOfficialEuro(cacheEuroSource, cacheEuroDate)) {
                euroCandidates.push(makeRateCandidate({
                    value: cacheEuro,
                    source: cacheEuroSource,
                    priority: sourcePriority(cacheEuroSource, SOURCE_PRIORITY['/api/rates']),
                    validDate: cacheEuroDate,
                    observedAt,
                    kind: 'euro',
                }));
            }

            const chosenEuro = selectRateCandidate(euroCandidates, { today });
            const previousEuro = previousRates.euro;
            const previousEuroIsTrusted = isTrustedOfficialEuro(previousEuro?.source, previousEuro?.validDate);
            const previousEuroValue = previousEuroIsTrusted ? validateMagnitude(previousEuro.price) : 0;
            const euroValue = chosenEuro?.val || previousEuroValue;
            const euroSource = chosenEuro?.source || (previousEuroIsTrusted ? previousEuro.source : 'Sin tasa Euro BCV válida');
            if (!chosenEuro && !previousEuroIsTrusted && !isAutoUpdate) {
                addLog('Sin tasa Euro BCV válida; no se muestra una tasa triangulada.', 'warning');
            }

            const newRates = {
                ...previousRates,
                bcv: {
                    ...(previousRates.bcv || {}),
                    price: chosenBcv.val,
                    source: chosenBcv.source,
                    validDate: chosenBcv.validDate || null,
                    observedAt: chosenBcv.observedAt || observedAt,
                    change: getChange(chosenBcv, previousRates.bcv?.price, previousRates.bcv?.change),
                },
                euro: {
                    ...(previousRates.euro || {}),
                    price: euroValue,
                    source: euroSource,
                    validDate: chosenEuro?.validDate || (previousEuroIsTrusted ? previousEuro.validDate : null),
                    observedAt: chosenEuro?.observedAt || (previousEuroIsTrusted ? previousEuro.observedAt : observedAt),
                    change: getChange(chosenEuro, previousRates.euro?.price, previousRates.euro?.change),
                },
                lastUpdate: observedAt,
            };

            const privateUsdt = privateData?.usdt;
            const privateUsdtValue = validateMagnitude(typeof privateUsdt === 'object' ? privateUsdt?.price : privateUsdt);
            if (privateUsdtValue > 0) {
                newRates.usdt = {
                    ...(previousRates.usdt || {}),
                    price: privateUsdtValue,
                    source: 'Google Script',
                    change: getChange({ val: privateUsdtValue }, previousRates.usdt?.price, previousRates.usdt?.change),
                };
            }

            if (externalRates.cop > 0) {
                newRates.autoCopRate = {
                    price: externalRates.cop,
                    source: externalRates.source || 'ExchangeRate API',
                    rawTrm: externalRates.cop,
                    rawUsdt: privateUsdtValue || chosenBcv.val,
                };
            }

            setRates(newRates);
            setIsOffline(false);
            if (!isAutoUpdate) addLog(`Actualización completada: ${chosenBcv.val.toFixed(8)} Bs/USD (${chosenBcv.source})`, 'success');
        } catch (error) {
            console.error('[useRates] Error actualizando tasas:', error);
            setIsOffline(true);
            log('Error actualizando tasas; se conserva la última tasa válida.', 'error');
        } finally {
            setLoading(false);
        }
    }, [addLog]);

    const initialLoadRef = useRef(false);

    useEffect(() => {
        // React StrictMode monta los efectos dos veces en desarrollo; evitar dos
        // tandas de solicitudes simultáneas al iniciar la aplicación.
        if (initialLoadRef.current) return undefined;
        initialLoadRef.current = true;

        updateData(false);
        const intervalId = setInterval(() => updateData(true), UPDATE_INTERVAL);
        return () => clearInterval(intervalId);
    }, [updateData]);

    return {
        rates: rates || DEFAULT_RATES,
        loading,
        isOffline,
        logs,
        updateData,
        rateDiscrepancyWarning,
    };
}
