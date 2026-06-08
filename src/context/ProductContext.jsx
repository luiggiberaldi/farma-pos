import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { storageService } from '../utils/storageService';
import { BODEGA_CATEGORIES } from '../config/categories';

const ProductContext = createContext();

export function ProductProvider({ children, rates }) {
    const [products, setProducts] = useState([]);
    const [categories, setCategories] = useState(BODEGA_CATEGORIES);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);

    // Guard ref: prevents infinite loop when auto-save fires app_storage_update
    const savingRef = useRef(false);
    // Max-wait ref: tracks last save time for debounce ceiling
    const lastSaveRef = useRef(Date.now());

    // MARKET LOGIC - Street Rate
    const [streetRate, setStreetRate] = useState(() => {
        const saved = localStorage.getItem('street_rate_bs');
        return saved ? parseFloat(saved) : 0;
    });

    // GLOBAL RATE LOGIC (Sync with SalesView)
    const [rateMode, setRateMode] = useState(() => {
        const savedMode = localStorage.getItem('bodega_rate_mode');
        if (savedMode) return savedMode;
        
        // Retrocompatibilidad
        const savedAuto = localStorage.getItem('bodega_use_auto_rate');
        if (savedAuto !== null) {
            return JSON.parse(savedAuto) ? 'bcv' : 'manual';
        }
        return 'bcv';
    });
    const [customRate, setCustomRate] = useState(() => {
        const saved = localStorage.getItem('bodega_custom_rate');
        return saved && parseFloat(saved) > 0 ? saved : '';
    });

    // AUTO COP LOGIC
    const [copEnabled, setCopEnabled] = useState(() => {
        return localStorage.getItem('cop_enabled') === 'true';
    });
    const [autoCopEnabled, setAutoCopEnabled] = useState(() => {
        return localStorage.getItem('auto_cop_enabled') === 'true';
    });
    const [tasaCopManual, setTasaCopManual] = useState(() => {
        return localStorage.getItem('tasa_cop') || '';
    });

    const useAutoRate = rateMode === 'bcv' || rateMode === 'euro';
    const setUseAutoRate = (val) => {
        const nextMode = val ? 'bcv' : 'manual';
        setRateMode(nextMode);
    };

    const bcvPrice = rates?.bcv?.price || 0;
    const euroPrice = rates?.euro?.price || 0;
    
    let effectiveRate = bcvPrice;
    if (rateMode === 'bcv') {
        effectiveRate = bcvPrice;
    } else if (rateMode === 'euro') {
        effectiveRate = euroPrice;
    } else if (rateMode === 'manual') {
        effectiveRate = parseFloat(customRate) > 0 ? parseFloat(customRate) : bcvPrice;
    }
    
    // Calcula el COP efectivo. rates.autoCopRate es calculado en useRates basado en TRM y la Brecha USDT/BCV.
    const tasaCop = autoCopEnabled && rates.autoCopRate?.price 
        ? rates.autoCopRate.price 
        : (parseFloat(tasaCopManual) > 0 ? parseFloat(tasaCopManual) : 4150);

    // Initial Load
    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            try {
                const savedProducts = await storageService.getItem('bodega_products_v1', []);
                const savedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
                if (isMounted) {
                    setProducts(savedProducts);
                    setCategories(savedCategories);
                }
            } catch (err) {
                console.error('[ProductContext] Error loading initial data:', err);
            } finally {
                if (isMounted) setIsLoadingProducts(false);
            }
        };
        loadData();
        return () => { isMounted = false; };
    }, []);

    // Set Initial Street Rate (from BCV)
    useEffect(() => {
        if (!streetRate && rates.bcv?.price > 0 && !localStorage.getItem('street_rate_bs')) {
            setStreetRate(rates.bcv.price);
        }
    }, [rates.bcv?.price, streetRate]);

    // Auto-save products and categories with Debounce (Performance Fix)
    useEffect(() => {
        if (!isLoadingProducts) {
            savingRef.current = true;
            const elapsed = Date.now() - lastSaveRef.current;
            const delay = elapsed > 10000 ? 0 : 1000;
            const timer = setTimeout(() => {
                lastSaveRef.current = Date.now();
                const savePromises = [];
                if (products.length > 0) {
                    savePromises.push(storageService.setItem('bodega_products_v1', products));
                } else {
                    // Guardar array vacío explícitamente (en vez de removeItem) 
                    // para que la nube sincronice el borrado correctamente
                    savePromises.push(storageService.setItem('bodega_products_v1', []));
                }
                savePromises.push(storageService.setItem('my_categories_v1', categories));
                Promise.all(savePromises).finally(() => {
                    // Reset guard after microtask queue flushes
                    setTimeout(() => { savingRef.current = false; }, 50);
                });
            }, delay); // debounce with max-wait of 10s

            return () => clearTimeout(timer);
        }
    }, [products, categories, isLoadingProducts]);

    useEffect(() => {
        if (streetRate > 0) localStorage.setItem('street_rate_bs', streetRate.toString());
    }, [streetRate]);

    useEffect(() => {
        localStorage.setItem('bodega_rate_mode', rateMode);
        localStorage.setItem('bodega_use_auto_rate', JSON.stringify(rateMode === 'bcv' || rateMode === 'euro'));
        if (customRate) localStorage.setItem('bodega_custom_rate', customRate.toString());
    }, [rateMode, customRate]);

    // Listener para actualizar si cambia en otra pestaña/componente
    useEffect(() => {
        const handleStorageChange = (e) => {
            if (e.key === 'bodega_custom_rate') {
                setCustomRate(e.newValue);
            }
            if (e.key === 'bodega_rate_mode') {
                setRateMode(e.newValue);
            }
            if (e.key === 'bodega_use_auto_rate') {
                const isAuto = !!JSON.parse(e.newValue);
                setRateMode(isAuto ? 'bcv' : 'manual');
            }
            if (e.key === 'cop_enabled') {
                setCopEnabled(e.newValue === 'true');
            }
            if (e.key === 'auto_cop_enabled') {
                setAutoCopEnabled(e.newValue === 'true');
            }
            if (e.key === 'tasa_cop') {
                setTasaCopManual(e.newValue);
            }
            if (e.key === 'bodega_products_v1') {
                // If modified in another tab, fetch it
                storageService.getItem('bodega_products_v1', []).then(updatedProducts => setProducts(updatedProducts));
            }
            if (e.key === 'my_categories_v1') {
                storageService.getItem('my_categories_v1', BODEGA_CATEGORIES).then(updatedCategories => setCategories(updatedCategories));
            }
        };

        // Mantener app_storage_update por si algún componente viejo sigue usándolo para sincronizar
        // aunque ahora ProductContext centraliza todo.
        const handleAppStorageUpdate = async (e) => {
            if (savingRef.current) return;

            if (e.detail?.key === 'bodega_products_v1') {
                const updatedProducts = await storageService.getItem('bodega_products_v1', []);
                setProducts(updatedProducts);
            }
            if (e.detail?.key === 'my_categories_v1') {
                const updatedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES);
                setCategories(updatedCategories);
            }
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('app_storage_update', handleAppStorageUpdate);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('app_storage_update', handleAppStorageUpdate);
        };
    }, []);

    const adjustStock = (productId, delta) => {
        setProducts(prevProducts => {
            const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
            const updated = prevProducts.map(p => {
                if (p.id === productId) {
                    const newStock = (p.stock ?? 0) + delta;
                    return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
                }
                return p;
            });
            // Persistir inmediatamente para no depender del debounce (evita pérdida al cambiar pestaña rápido)
            storageService.setItem('bodega_products_v1', updated).catch(() => {});
            return updated;
        });
    };

    return (
        <ProductContext.Provider value={{
            products,
            setProducts,
            categories,
            setCategories,
            isLoadingProducts,
            streetRate,
            setStreetRate,
            useAutoRate,
            setUseAutoRate,
            customRate,
            setCustomRate,
            effectiveRate,
            copEnabled,
            setCopEnabled,
            autoCopEnabled,
            setAutoCopEnabled,
            tasaCopManual,
            setTasaCopManual,
            tasaCop,
            adjustStock,
            rateMode,
            setRateMode
        }}>
            {children}
        </ProductContext.Provider>
    );
}

export const useProductContext = () => {
    const context = useContext(ProductContext);
    if (!context) {
        throw new Error("useProductContext must be used within a ProductProvider");
    }
    return context;
};
