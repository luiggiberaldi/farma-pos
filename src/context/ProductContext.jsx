import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ProductContext } from './productState.js';
import { captureStorageContext, isStorageContextActive } from '../config/storageScope.js';
import { beginLocalOperation, registerContextBlocker, assertLocalOperationAllowed } from '../services/localOperationGuard.js';
import { showToast } from '../components/Toast';
import { enqueueSnapshotWrite, drainSnapshotWrites } from '../services/localSnapshotQueue.js';
import { storageService } from '../utils/storageService';
import { seedPharmacyInventoryIfEmpty, upgradePharmacyCatalogIfNeeded } from '../config/pharmacySeed.js';
import { BODEGA_CATEGORIES } from '../config/categories.js';


export function ProductProvider({ children, rates }) {
    const [storageContext] = useState(captureStorageContext);
    const [products, updateProducts] = useState([]);
    const [categories, updateCategories] = useState(BODEGA_CATEGORIES);
    const productsRef = useRef([]);
    const categoriesRef = useRef(BODEGA_CATEGORIES);
    const mountedRef = useRef(false);
    const dirtyRef = useRef(false);
    const confirmedProducts = useRef([]);
    const confirmedCategories = useRef(BODEGA_CATEGORIES);
    const writeRevision = useRef(0);
    const savingRef = useRef(false);
    const [saveError, setSaveError] = useState(null);
    const queueSnapshot = useCallback((productSnapshot, categorySnapshot, revision) => {
        const savedProducts = structuredClone(productSnapshot);
        const savedCategories = structuredClone(categorySnapshot);
        const expectedProducts = JSON.stringify(dirtyRef.current && !savingRef.current ? confirmedProducts.current : productsRef.current);
        const expectedCategories = JSON.stringify(dirtyRef.current && !savingRef.current ? confirmedCategories.current : categoriesRef.current);
        const release = beginLocalOperation('SAVE_PRODUCTS', storageContext);
        savingRef.current = true;
        return enqueueSnapshotWrite(storageContext, async () => {
            await storageService.transaction([
                { name: 'products', key: 'bodega_products_v1', fallback: [] },
                { name: 'categories', key: 'my_categories_v1', fallback: BODEGA_CATEGORIES },
                { name: 'lots', key: 'farmacia_lotes_v1', fallback: [] },
            ], current => {
                if (JSON.stringify(current.products) !== expectedProducts || JSON.stringify(current.categories) !== expectedCategories) {
                    throw new Error('El inventario cambió en otra operación o pestaña. Recarga antes de editar; tus datos no se sobrescribieron.');
                }
                if (!Array.isArray(current.lots)) throw new Error('Los lotes guardados necesitan revisión.');
                for (const product of current.products) {
                    const next = savedProducts.find(item => item.id === product.id);
                    const quantity = current.lots.filter(lot => String(lot.productoId) === String(product.id)).reduce((sum, lot) => sum + lot.cantidad, 0);
                    if (!Number.isFinite(quantity) || quantity < 0) throw new Error('Cantidad de lotes inválida.');
                    if (quantity > 0 && (!next || Number(next.stock) < quantity)) throw new Error('No puedes eliminar ni reducir stock por debajo de sus lotes. Concilia los lotes primero.');
                    if (next && (Number(product.stock) > 0 || quantity > 0) && ((product.unit || 'unidad') !== (next.unit || 'unidad') || Number(product.unitsPerPackage || 1) !== Number(next.unitsPerPackage || 1))) throw new Error('No cambies la presentación con stock existente; requiere conciliación de unidades.');
                }
                return { writes: { products: savedProducts, categories: savedCategories } };
            }, storageContext);
            confirmedProducts.current = savedProducts;
            confirmedCategories.current = savedCategories;
            if (writeRevision.current === revision) {
                dirtyRef.current = false;
                if (mountedRef.current) setSaveError(null);
            }
        }).catch(error => {
            if (mountedRef.current) setSaveError(error.message || 'No se pudo guardar el inventario.');
            console.error('[ProductContext] No se pudo guardar:', error);
            showToast(error.message || 'No se guardó el inventario. Revisa el almacenamiento.', 'error');
            throw error;
        }).finally(() => {
            if (writeRevision.current === revision) savingRef.current = false;
            release();
        });
    }, [storageContext]);
    const setProducts = useCallback(value => {
        if (!mountedRef.current || !isStorageContextActive(storageContext)) return;
        assertLocalOperationAllowed();
        const next = typeof value === 'function' ? value(productsRef.current) : value;
        const unchanged = JSON.stringify(next) === JSON.stringify(productsRef.current);
        if (unchanged && (!dirtyRef.current || savingRef.current)) return;
        const revision = writeRevision.current + 1;
        // Reserve/clone before changing refs: a rejected operation must leave
        // the visible state and dirty flag untouched. Identical failed saves retry.
        const saving = queueSnapshot(next, categoriesRef.current, revision);
        void saving.catch(() => {});
        writeRevision.current = revision;
        productsRef.current = next;
        dirtyRef.current = true;
        updateProducts(next);
        return saving;
    }, [storageContext, queueSnapshot]);
    const setCategories = useCallback(value => {
        if (!mountedRef.current || !isStorageContextActive(storageContext)) return;
        assertLocalOperationAllowed();
        const next = typeof value === 'function' ? value(categoriesRef.current) : value;
        const unchanged = JSON.stringify(next) === JSON.stringify(categoriesRef.current);
        if (unchanged && (!dirtyRef.current || savingRef.current)) return;
        const revision = writeRevision.current + 1;
        const saving = queueSnapshot(productsRef.current, next, revision);
        void saving.catch(() => {});
        writeRevision.current = revision;
        categoriesRef.current = next;
        dirtyRef.current = true;
        updateCategories(next);
        return saving;
    }, [storageContext, queueSnapshot]);
    const adoptCommittedProducts = useCallback(value => {
        if (!mountedRef.current || !isStorageContextActive(storageContext)) return;
        if (dirtyRef.current) {
            setSaveError('El inventario guardado cambió mientras había un borrador pendiente. Conserva el borrador y recarga antes de continuar.');
            return;
        }
        writeRevision.current += 1;
        productsRef.current = structuredClone(value);
        confirmedProducts.current = productsRef.current;
        dirtyRef.current = false;
        savingRef.current = false;
        updateProducts(productsRef.current);
    }, [storageContext]);
    const retryProductSave = useCallback(() => setProducts(productsRef.current), [setProducts]);
    const recoverCommittedInventory = useCallback(async () => {
        assertLocalOperationAllowed();
        const release = beginLocalOperation('RECOVER_INVENTORY', storageContext);
        try {
            await drainSnapshotWrites(storageContext);
            if (!mountedRef.current || !isStorageContextActive(storageContext)) throw new Error('La vista ya no está activa.');
            const recovery = { products: structuredClone(productsRef.current), categories: structuredClone(categoriesRef.current), savedAt: new Date().toISOString(), context: storageContext };
            const restored = await storageService.transaction([
                { name: 'products', key: 'bodega_products_v1', fallback: [] },
                { name: 'categories', key: 'my_categories_v1', fallback: BODEGA_CATEGORIES },
                { name: 'recovery', key: `inventory_recovery_${crypto.randomUUID()}`, fallback: null },
            ], values => {
                if (!Array.isArray(values.products) || !Array.isArray(values.categories)) throw new Error('Inventario guardado inválido. No se reemplazó el borrador.');
                return { writes: { recovery }, result: { products: values.products, categories: values.categories } };
            }, storageContext);
            if (!mountedRef.current || !isStorageContextActive(storageContext)) return;
            writeRevision.current++;
            productsRef.current = restored.products; confirmedProducts.current = restored.products;
            categoriesRef.current = restored.categories; confirmedCategories.current = restored.categories;
            dirtyRef.current = false; savingRef.current = false;
            updateProducts(restored.products); updateCategories(restored.categories); setSaveError(null);
            showToast('Inventario recargado. Se conservó una copia local del borrador pendiente.', 'success');
        } finally { release(); }
    }, [storageContext]);
    useEffect(() => {
        mountedRef.current = true;
        const unregister = registerContextBlocker(() => dirtyRef.current ? 'Hay cambios de inventario pendientes de guardar.' : null);
        return () => { mountedRef.current = false; unregister(); };
    }, []);
    const [isLoadingProducts, setIsLoadingProducts] = useState(true);


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
    const [copEnabled, setCopEnabled] = useState(false);
    const [autoCopEnabled, setAutoCopEnabled] = useState(false);
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

    // A payment calculation must never run with zero or an invalid rate.
    // Keep the configured manual rate when available; otherwise expose zero so
    // the UI can require a rate update instead of producing false amounts.
    if (!Number.isFinite(effectiveRate) || effectiveRate < 0) effectiveRate = 0;
    
    // Calcula el COP efectivo. rates.autoCopRate es calculado en useRates basado en TRM y la Brecha USDT/BCV.
    const tasaCop = autoCopEnabled && rates.autoCopRate?.price 
        ? rates.autoCopRate.price 
        : (parseFloat(tasaCopManual) > 0 ? parseFloat(tasaCopManual) : 4150);

    // Initial Load
    useEffect(() => {
        let isMounted = true;
        const loadData = async () => {
            try {
                await drainSnapshotWrites(storageContext);
                if (!isMounted) return;
                // Semilla de farmacia y migración de catálogo a fotos reales de estudio.
                try { 
                    await seedPharmacyInventoryIfEmpty(storageService, storageContext); 
                    await upgradePharmacyCatalogIfNeeded(storageService, storageContext);
                } catch (err) { console.error('[ProductContext] Semilla/Migración omitida:', err); }
                const revision = writeRevision.current;
                const savedProducts = await storageService.getItem('bodega_products_v1', [], storageContext);
                const savedCategories = await storageService.getItem('my_categories_v1', BODEGA_CATEGORIES, storageContext);
                if (isMounted && !dirtyRef.current && revision === writeRevision.current && isStorageContextActive(storageContext)) {
                    productsRef.current = savedProducts;
                    categoriesRef.current = savedCategories;
                    confirmedProducts.current = savedProducts;
                    confirmedCategories.current = savedCategories;
                    updateProducts(savedProducts);
                    updateCategories(savedCategories);
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

    // Setters queue captured snapshots immediately; no abandoned debounce can
    // later write old inventory into a newly selected account/branch.

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
        const acceptSnapshot = async (key, fallback, apply, ref) => {
            if (dirtyRef.current || !isStorageContextActive(storageContext)) return;
            const revision = writeRevision.current;
            const snapshot = await storageService.getItem(key, fallback, storageContext);
            // A save can finish while this older read is suspended. The dirty
            // flag alone cannot distinguish that read from a current snapshot.
            if (!mountedRef.current || dirtyRef.current || revision !== writeRevision.current || !isStorageContextActive(storageContext)) return;
            ref.current = snapshot;
            if (key === 'bodega_products_v1') confirmedProducts.current = snapshot;
            if (key === 'my_categories_v1') confirmedCategories.current = snapshot;
            apply(snapshot);
        };
        const handleStorageChange = (e) => {
            if (e.key === 'farmapos_storage_change') {
                try { const note = JSON.parse(e.newValue); if (note.context?.accountId === storageContext.accountId && note.context?.sedeId === storageContext.sedeId) {
                    if (note.key === 'bodega_products_v1') void acceptSnapshot(note.key, [], updateProducts, productsRef);
                    if (note.key === 'my_categories_v1') void acceptSnapshot(note.key, BODEGA_CATEGORIES, updateCategories, categoriesRef);
                } } catch { /* Invalid external notification ignored. */ }
            }
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
                void acceptSnapshot('bodega_products_v1', [], updateProducts, productsRef);
            }
            if (e.key === 'my_categories_v1') {
                void acceptSnapshot('my_categories_v1', BODEGA_CATEGORIES, updateCategories, categoriesRef);
            }
        };

        // Mantener app_storage_update por si algún componente viejo sigue usándolo para sincronizar
        // aunque ahora ProductContext centraliza todo.
        const handleAppStorageUpdate = async (e) => {
            // Un pull de nube tiene prioridad sobre el auto-save local que pudo
            // arrancar mientras se hidrataba la cuenta.
            if (savingRef.current || dirtyRef.current || !isStorageContextActive(storageContext)) return;
            if (e.detail?.context && (e.detail.context.accountId !== storageContext.accountId || e.detail.context.sedeId !== storageContext.sedeId)) return;

            if (e.detail?.key === 'bodega_products_v1') {
                await acceptSnapshot('bodega_products_v1', [], updateProducts, productsRef);
            }
            if (e.detail?.key === 'my_categories_v1') {
                await acceptSnapshot('my_categories_v1', BODEGA_CATEGORIES, updateCategories, categoriesRef);
            }
        };

        window.addEventListener('storage', handleStorageChange);
        window.addEventListener('app_storage_update', handleAppStorageUpdate);
        return () => {
            window.removeEventListener('storage', handleStorageChange);
            window.removeEventListener('app_storage_update', handleAppStorageUpdate);
        };
    }, []);


    return (
        <ProductContext.Provider value={{
            products,
            setProducts,
            adoptCommittedProducts,
            saveError, retryProductSave, recoverCommittedInventory,
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
            rateMode,
            setRateMode
        }}>
            {children}
        </ProductContext.Provider>
    );
}
