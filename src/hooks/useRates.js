import { useState, useEffect, useCallback, useRef } from 'react';

const DEFAULT_RATES = {
    bcv: { price: 36.35, source: 'BCV Oficial', change: 0.05 },
    euro: { price: 39.80, source: 'Euro BCV', change: -0.02 },
    lastUpdate: new Date().toISOString()
};

const EXCHANGERATE_KEY = 'F1a3af26247a97a33ee5ad90';
const DEFAULT_EUR_USD_RATIO = 1.18;
const UPDATE_INTERVAL = 15 * 60 * 1000; // 15 minutos

const GOOGLE_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbx0N47Hg6XebPBhgSLnfkaFyR4ez9_UWFTCS0mcb978i5r-iraxcM5svMJao2HMtrtiAA/exec?token=Lvbp1994';

export function useRates() {
    const [rates, setRates] = useState(() => {
        try {
            const saved = JSON.parse(localStorage.getItem('monitor_rates_v12'));
            if (saved) {
                // Migrar datos guardados: eliminar usdt si existe
                if (saved.usdt) delete saved.usdt;
                return saved;
            }
            return null;
        }
        catch { return null; }
    });

    const [loading, setLoading] = useState(false);
    const [isOffline, setIsOffline] = useState(false);
    const [logs, setLogs] = useState([]);

    const ratesRef = useRef(rates);

    useEffect(() => {
        ratesRef.current = rates;
        if (rates) localStorage.setItem('monitor_rates_v12', JSON.stringify(rates));
    }, [rates]);

    const addLog = useCallback((msg, type = 'info') => {
        const time = new Date().toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
        setLogs(prev => [...prev.slice(-49), { time, msg, type }]);
    }, []);

    const parseSafeFloat = (val) => {
        if (!val) return 0;
        if (typeof val === 'number') return val;
        if (typeof val === 'string') {
            const clean = val.replace(/[^\d.,]/g, '');
            const lastDot = clean.lastIndexOf('.');
            const lastComma = clean.lastIndexOf(',');
            const lastSep = Math.max(lastDot, lastComma);

            if (lastSep === -1) return parseFloat(clean) || 0;

            const integer = clean.slice(0, lastSep).replace(/[.,]/g, '');
            const decimals = clean.slice(lastSep + 1);
            return parseFloat(`${integer}.${decimals}`) || 0;
        }
        return 0;
    };

    const updateData = useCallback(async (isAutoUpdate = false) => {
        if (!isAutoUpdate) setLoading(true);

        const log = (msg, type) => !isAutoUpdate && addLog(msg, type);

        log(isAutoUpdate ? "--- Auto-Update ---" : "--- Actualización Manual ---");

        const fetchGeneric = async (url, retries = 1) => {
            for (let i = 0; i <= retries; i++) {
                const controller = new AbortController();
                const id = setTimeout(() => controller.abort(), 8000);
                try {
                    const res = await fetch(url, { signal: controller.signal });
                    clearTimeout(id);
                    if (!res.ok) {
                        if (i < retries) continue;
                        return null;
                    }
                    return await res.json();
                } catch (e) {
                    clearTimeout(id);
                    if (i < retries) {
                        await new Promise(r => setTimeout(r, 1000)); // Esperar 1 segundo antes de reintentar
                        continue;
                    }
                    return null;
                }
            }
            return null;
        };

        const getExternalRatesFallback = async () => {
            try {
                const data = await fetchGeneric(`https://v6.exchangerate-api.com/v6/${EXCHANGERATE_KEY}/latest/USD`);
                if (data?.result === "success") {
                    return {
                        eur: data.conversion_rates?.EUR ? 1 / data.conversion_rates.EUR : DEFAULT_EUR_USD_RATIO,
                        cop: data.conversion_rates?.COP || null
                    };
                }
            } catch (e) { }
            return { eur: DEFAULT_EUR_USD_RATIO, cop: null };
        };

        const getMeta = (newP, oldP, oldChange = 0, apiChange = null) => {
            let p = parseSafeFloat(newP);
            const o = parseSafeFloat(oldP);

            if (apiChange !== null && apiChange !== undefined && apiChange !== 0) {
                return { price: p, change: parseSafeFloat(apiChange) };
            }

            if (p === o) return { price: p, change: oldChange };
            return { price: p, change: (p > 0 && o > 0) ? ((p - o) / o) * 100 : 0 };
        };

        try {
            // Fetch en paralelo: datos privados (Google Script), dolarapi fallback, y external rates (Euro, COP)
            const taskPrivate = fetchGeneric(GOOGLE_SCRIPT_URL);
            const taskDolarApi = fetchGeneric('https://ve.dolarapi.com/v1/dolares');
            const taskExternal = getExternalRatesFallback();

            const [privateData, bcvFallbackData, externalRates] = await Promise.all([
                taskPrivate.catch(() => null),
                taskDolarApi.catch(() => null),
                taskExternal.catch(() => ({ eur: DEFAULT_EUR_USD_RATIO, cop: null }))
            ]);
            
            const euroFactor = externalRates.eur;

            if (privateData) log("✅ Datos Privados Recibidos", "success");

            let newRates = { ...(ratesRef.current || DEFAULT_RATES) };

            let newBcvPrice = 0;
            let newEuroPrice = 0;
            let newUsdtPrice = 0;

            // Extraer USDT de privateData o DolarApi
            if (privateData && privateData.usdt) {
                newUsdtPrice = parseSafeFloat(typeof privateData.usdt === 'object' ? privateData.usdt.price : privateData.usdt);
            }
            if (!newUsdtPrice && bcvFallbackData) {
                const usdtData = Array.isArray(bcvFallbackData) ? bcvFallbackData.find(d => d.nombre?.toLowerCase() === 'binance' || d.fuente === 'binance' || d.casa === 'binance') || bcvFallbackData.find(d => d.nombre?.toLowerCase() === 'paralelo' || d.fuente === 'paralelo' || d.casa === 'paralelo') : null;
                if (usdtData?.promedio > 0) newUsdtPrice = parseSafeFloat(usdtData.promedio);
            }

            // Procesar BCV/Euro desde datos privados (Google Script)
            if (privateData) {
                const rawBcv = privateData.bcv || privateData.usd;
                const rawEuro = privateData.euro || privateData.eur;

                let bcvP = parseSafeFloat(typeof rawBcv === 'object' ? rawBcv.price : rawBcv);
                let euroP = parseSafeFloat(typeof rawEuro === 'object' ? rawEuro.price : rawEuro);

                let apiBcvChange = typeof rawBcv === 'object' ? rawBcv.change : null;
                let apiEuroChange = typeof rawEuro === 'object' ? rawEuro.change : null;

                // Validación de magnitud: si el precio es irrazonablemente bajo o alto, corregir
                const validateMagnitude = (val) => {
                    if (!val || val <= 0) return val;
                    if (val >= 10 && val <= 200) return val;
                    if (val < 1) {
                        const factor = Math.pow(10, Math.ceil(-Math.log10(val) + 1));
                        return val * factor;
                    }
                    if (val > 1000) {
                        const factor = Math.pow(10, Math.floor(Math.log10(val) - 2));
                        return val / factor;
                    }
                    return val;
                };

                newBcvPrice = validateMagnitude(bcvP);
                newEuroPrice = validateMagnitude(euroP);

                if (newBcvPrice > 0) {
                    const meta = getMeta(newBcvPrice, newRates.bcv.price, newRates.bcv.change, apiBcvChange);
                    newRates.bcv = { ...newRates.bcv, ...meta, source: 'BCV Oficial' };
                }
                if (newEuroPrice > 0) {
                    const meta = getMeta(newEuroPrice, newRates.euro.price, newRates.euro.change, apiEuroChange);
                    newRates.euro = { ...newRates.euro, ...meta, source: 'Euro BCV' };
                }

            } else if (bcvFallbackData) {
                // Fallback: DolarApi
                const oficial = Array.isArray(bcvFallbackData) ? bcvFallbackData.find(d => d.fuente === 'oficial' || d.nombre === 'Oficial') : null;

                if (oficial?.promedio > 0) {
                    let bcvP = parseSafeFloat(oficial.promedio);
                    newBcvPrice = bcvP;
                    const meta = getMeta(newBcvPrice, newRates.bcv.price, newRates.bcv.change);
                    newRates.bcv = { ...newRates.bcv, ...meta, source: 'BCV Oficial (Respaldo)' };

                    if (euroFactor) {
                        newEuroPrice = newBcvPrice * euroFactor;
                        const metaEur = getMeta(newEuroPrice, newRates.euro.price, newRates.euro.change);
                        newRates.euro = { ...newRates.euro, ...metaEur, source: 'Euro BCV (Triangulado)' };
                    }
                }
            }

            // Integrar cálculo AutoCOP con TRM y USDT
            if (externalRates.cop > 0) {
                // El usuario espera que 1 USD del sistema equivalga a 1 USDT real en COP (~TRM / Binance P2P)
                let calcCop = externalRates.cop;
                newRates.autoCopRate = { 
                    price: calcCop, 
                    source: 'Binance USDT / TRM', 
                    rawTrm: externalRates.cop, 
                    rawUsdt: newUsdtPrice 
                };
            }

            newRates.lastUpdate = new Date().toISOString();
            setRates(newRates);
            if (!isAutoUpdate) addLog("Actualización completada", 'success');

        } catch (e) {
            console.error(e);
            log("Error actualización", 'error');
            setIsOffline(true);
        } finally {
            setLoading(false);
        }
    }, [addLog]);

    useEffect(() => {
        updateData(false);
        const intervalId = setInterval(() => { updateData(true); }, UPDATE_INTERVAL);
        return () => clearInterval(intervalId);
    }, [updateData]);

    const currentRates = rates || DEFAULT_RATES;
    return { rates: currentRates, loading, isOffline, logs, updateData };
}
