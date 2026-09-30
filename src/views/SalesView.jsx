import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { bindStorageContext } from '../utils/scopedStorage.js';
import { round2, divR } from '../utils/dinero';
import { useSounds } from '../hooks/useSounds';
import { useVoiceSearch } from '../hooks/useVoiceSearch';
import { useNotifications } from '../hooks/useNotifications';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { useCartActions } from '../hooks/useCartActions';
import { useCheckout } from '../hooks/useCheckout';
import { useSalesHelpers } from '../hooks/useSalesHelpers';
import { getActivePaymentMethods } from '../config/paymentMethods';
import { showToast } from '../components/Toast';

import { useCart } from '../context/CartContext';
import { useProductContext } from '../context/ProductContext';
import { useAuthStore } from '../hooks/store/useAuthStore';

// Components
import SalesHeader from '../components/Sales/SalesHeader';
import CartPanel from '../components/Sales/CartPanel';
import MobileCartSheet from '../components/Sales/MobileCartSheet';
import SalesProductColumn from '../components/Sales/SalesProductColumn';
import SalesModals from '../components/Sales/SalesModals';
import CajaCerradaOverlay from '../components/Sales/CajaCerradaOverlay';
import { getLocalISODate } from '../utils/dateHelpers';
import { getCashSessionMovements, getOpenCashSession } from '../utils/closureLogic';

import { useSalesKeyboard } from '../hooks/useSalesKeyboard';
import { isStorageContextActive } from '../config/storageScope.js';
import { beginLocalOperation } from '../services/localOperationGuard.js';
import { ledgerRecords, ledgerAudit, movementStamp, pendingOperation } from '../utils/localLedger.js';

const SALES_KEY = 'bodega_sales_v1';

export default function SalesView({ rates, triggerHaptic, onNavigate, isActive }) {
    const [storageService] = useState(bindStorageContext);
    const { playAdd, playRemove, playCheckout, playError } = useSounds();
    const { notifySaleComplete, notifyLowStock } = useNotifications();

    // ── Global Context ──────────────────────────────────────
    const { products, adoptCommittedProducts, isLoadingProducts, useAutoRate, setUseAutoRate, customRate, setCustomRate, effectiveRate, copEnabled, tasaCop, rateMode, setRateMode } = useProductContext();
    const { usuarioActivo } = useAuthStore();

    // ── State ──────────────────────────────────────
    const [customers, setCustomers] = useState([]);
    const [paymentMethods, setPaymentMethods] = useState([]);
    const [isLoadingLocal, setIsLoadingLocal] = useState(true);
    const isLoading = isLoadingProducts || isLoadingLocal;
    const [showConfetti, setShowConfetti] = useState(false);
    const [showClearCartConfirm, setShowClearCartConfirm] = useState(false);
    const [showCustomAmountModal, setShowCustomAmountModal] = useState(false);
    const [showKeyboardHelp, setShowKeyboardHelp] = useState(false); // Keyboard shortcuts modal state

    // Apertura Caja
    const [isAperturaOpen, setIsAperturaOpen] = useState(false);
    const [todayAperturaData, setTodayAperturaData] = useState(null);

    // Cart (from global context)
    const { cart, setCart, cartRef, pendingNavigate, setPendingNavigate, discount, setDiscount, operationId, checkpointCheckout, storageContext } = useCart();
    const [showDiscountModal, setShowDiscountModal] = useState(false);

    // Search
    const searchInputRef = useRef(null);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [selectedCategory, setSelectedCategory] = useState('todos');

    // Modals
    const [showCheckout, setShowCheckout] = useState(false);
    const [showReceipt, setShowReceipt] = useState(null);
    const [hierarchyPending, setHierarchyPending] = useState(null);
    const [weightPending, setWeightPending] = useState(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState('');

    // Rate config
    const [showRateConfig, setShowRateConfig] = useState(false);

    const [isCartSheetOpen, setIsCartSheetOpen] = useState(false);

    // Cart Navigation State
    const [cartSelectedIndex, setCartSelectedIndex] = useState(-1);

    // Auto-select last item when cart length changes (if user was already interacting with the cart)
    useEffect(() => {
        if (cart.length > 0 && cartSelectedIndex !== -1) {
            setCartSelectedIndex(Math.min(cartSelectedIndex, cart.length - 1));
        } else if (cart.length === 0) {
            setCartSelectedIndex(-1);
        }
    }, [cart.length]);

    // Voice
    const handleSetSearchTerm = (text) => { setSearchTerm(text); setSelectedIndex(0); };
    const { isRecording, isProcessingAudio, startRecording, stopRecording } = useVoiceSearch({
        onResult: (text) => { 
            if (!text) return;
            const normalizedTerm = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            const bestMatches = products.filter(p => {
                const normalizedName = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
                return normalizedName.includes(normalizedTerm);
            });

            if (bestMatches.length > 0) {
                // Auto-agregar la primera (mejor) coincidencia
                addToCart(bestMatches[0]);
                handleSetSearchTerm('');
            } else {
                playError();
                showToast(`No encontré ningún producto parecido a "${text}"`, 'warning');
                // Al menos dejamos el texto en el buscador por si el usuario quiere corregirlo manualmente
                handleSetSearchTerm(text);
                searchInputRef.current?.focus();
            }
        },
        triggerHaptic,
    });

    // Barcode Scanner Global
    useBarcodeScanner({
        onScan: (barcode) => {
            if (showCheckout || showReceipt || showClearCartConfirm) return;

            // Pesa electrónica con PLU
            if (barcode.startsWith('21') && barcode.length >= 13) {
                const pluCode = parseInt(barcode.substring(2, 7), 10).toString();
                const weightKg = parseInt(barcode.substring(7, 12), 10) / 1000;
                const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(barcode.substring(0, 7)));
                if (p) { addToCart({ ...p, isWeight: true }, weightKg); return; }
            }

            // Producto regular
            const product = products.find(p => p.barcode === barcode || p.id === barcode);
            if (product) {
                addToCart(product);
            } else {
                playError();
                showToast(`Producto no encontrado (${barcode})`, 'warning');
            }
        },
        enabled: !isLoading && isActive && !!todayAperturaData
    });

    // Paste Barcode Handler (Para cuando el usuario hace Ctrl+V en la barra de búsqueda)
    const handlePasteBarcode = (pastedText) => {
        // Ignoramos si hay popups activos
        if (showCheckout || showReceipt || showClearCartConfirm) return;

        // Intentar Pesa Electrónica
        if (pastedText.startsWith('21') && pastedText.length >= 13) {
            const pluCode = parseInt(pastedText.substring(2, 7), 10).toString();
            const weightKg = parseInt(pastedText.substring(7, 12), 10) / 1000;
            const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(pastedText.substring(0, 7)));
            if (p) { 
                addToCart({ ...p, isWeight: true }, weightKg); 
                // Limpiamos el texto que se acaba de pegar
                setTimeout(() => setSearchTerm(''), 10);
                return; 
            }
        }

        // Buscar producto regular por código de barras o ID exactamente
        const product = products.find(p => p.barcode === pastedText || p.id === pastedText);
        if (product) {
            addToCart(product);
            // Limpiamos la barra tras pegarse
            setTimeout(() => setSearchTerm(''), 10);
        }
        // Si no es un código exacto, no hacemos nada extra, el navegador lo pegará como texto normal para buscar.
    };

    // ── Derived (memos) ───────────────────────────
    const deferredSearchTerm = useDeferredValue(searchTerm);

    const searchResults = useMemo(() => {
        if (deferredSearchTerm.length < 1) return [];
        const normalizedTerm = deferredSearchTerm.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        
        return products.filter(p => {
            if (p.barcode?.includes(deferredSearchTerm)) return true;
            const normalizedName = p.name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
            return normalizedName.includes(normalizedTerm);
        }).slice(0, 6);
    }, [deferredSearchTerm, products]);

    const filteredByCategory = useMemo(() => selectedCategory === 'todos'
        ? products
        : products.filter(p => p.category === selectedCategory), [selectedCategory, products]);

    const { 
        subtotalUsd: cartSubtotalUsd, 
        subtotalBs: cartSubtotalBs,
        discountAmountUsd, 
        discountAmountBs, 
        totalUsd: cartTotalUsd, 
        totalBs: cartTotalBs 
    } = useMemo(() => 
        FinancialEngine.buildCartTotals(cart, discount, effectiveRate, copEnabled ? tasaCop : 0)
    , [cart, discount, effectiveRate, copEnabled, tasaCop]);
    
    // Variables estáticas para pasar a los componentes hijos
    const discountData = {
        active: discount?.value > 0,
        amountUsd: discountAmountUsd,
        amountBs: discountAmountBs,
        type: discount?.type,
        value: discount?.value,
        approvalId: discount?.approvalId || null,
    };

    // ── Current cash float (for soft change warning in CheckoutModal) ──
    const [salesData, setSalesData] = useState([]);
    const currentFloat = useMemo(() => {
        const todayStr = getLocalISODate(new Date());
        const openSession = getOpenCashSession(salesData);
        const todayOpen = openSession
            ? getCashSessionMovements(salesData, openSession)
            : salesData.filter(s => {
                if (s.cajaCerrada) return false;
                const saleDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : todayStr;
                return saleDay === todayStr;
            });
        const bd = FinancialEngine.calculatePaymentBreakdown(todayOpen);
        return {
            usd: bd['efectivo_usd']?.total ?? 0,
            bs:  bd['efectivo_bs']?.total  ?? 0,
        };
    }, [salesData]);

    const cartItemCount = cart.reduce((sum, item) => sum + item.qty, 0);

    const formatBs = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

    // Search Deferred Value for Performance (moved to top of memos)

    // CartProvider owns a synchronous branch-scoped v2 draft. Legacy v1
    // drafts remain untouched for explicit origin reconciliation.

    // Load data
    useEffect(() => {
        let mounted = true;
        const load = async () => {
            const [savedCustomers, methods, savedSales] = await Promise.all([
                storageService.getItem('bodega_customers_v1', [], storageContext),
                getActivePaymentMethods(storageContext),
                storageService.getItem(SALES_KEY, [], storageContext)
            ]);
            if (mounted) { setSalesData(savedSales); }
            if (mounted) {
                setCustomers(savedCustomers);
                setPaymentMethods(methods);
                
                // A cash session remains open across midnight until an
                // explicit closure is confirmed by the operator.
                const openSession = getOpenCashSession(savedSales);
                setTodayAperturaData(openSession?.apertura || null);
                
                setIsLoadingLocal(false);

            }
        };
        load();
        return () => { mounted = false; };
    }, []);

    // Handle pending navigation from recycled cart (replaces old localStorage approach)
    useEffect(() => {
        if (pendingNavigate && cart.length > 0 && isActive) {
            setPendingNavigate(null);
        }
    }, [pendingNavigate, cart, isActive, setPendingNavigate]);

    // Auto-focus search
    useEffect(() => { if (!isLoading && searchInputRef.current) searchInputRef.current.focus(); }, [isLoading]);

    // Refresh products, payment methods, and customers when tab becomes active (consolidates window focus + isActive)
    const handleReloadContent = useCallback(() => {
        if (!isActive) return;
        Promise.all([
            getActivePaymentMethods(storageContext),
            storageService.getItem('bodega_customers_v1', [], storageContext),
            storageService.getItem(SALES_KEY, [], storageContext)
        ]).then(([methods, savedCustomers, savedSales]) => {
            if (!isStorageContextActive(storageContext)) return;
            setPaymentMethods(methods);
            setCustomers(savedCustomers);
            setSalesData(savedSales);
            
            // Recalculate the active session without tying it to the
            // calendar date (important when the app resumes after 00:00).
            const openSession = getOpenCashSession(savedSales);
            setTodayAperturaData(openSession?.apertura || null);
        });
    }, [isActive, storageContext, storageService]);

    useEffect(() => {
        handleReloadContent();
    }, [handleReloadContent]);

    // Recargar cuando la app vuelve desde el background en móviles (PWA) o cuando hay un cambio en el storage
    useEffect(() => {
        const onVisibilityChange = () => {
            if (document.visibilityState === 'visible') {
                handleReloadContent();
            }
        };

        const onStorageUpdate = (e) => {
            if (e.detail && e.detail.key === SALES_KEY) {
                // Pequeño timeout para dar margen a que IndexedDB haya persistido los datos
                setTimeout(handleReloadContent, 50);
            }
        };

        document.addEventListener('visibilitychange', onVisibilityChange);
        window.addEventListener('focus', handleReloadContent);
        window.addEventListener('app_storage_update', onStorageUpdate);
        
        return () => {
            document.removeEventListener('visibilitychange', onVisibilityChange);
            window.removeEventListener('focus', handleReloadContent);
            window.removeEventListener('app_storage_update', onStorageUpdate);
        };
    }, [handleReloadContent]);

    // Return focus after closing modals
    useEffect(() => { if (!showCheckout && !showReceipt && searchInputRef.current) searchInputRef.current.focus(); }, [showCheckout, showReceipt]);

    // Global keybinds (F9 = checkout, Escape = close modals)
    useEffect(() => {
        const handler = (e) => {
            if (e.key === 'F9') { e.preventDefault(); if (cart.length > 0 && !showCheckout && !showReceipt) setShowCheckout(true); }
            if (e.key === 'Escape') {
                if (showCheckout) { setShowCheckout(false); setSelectedCustomerId(''); }
                if (showReceipt) { setShowReceipt(null); setSelectedCustomerId(''); }
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [cart, showCheckout, showReceipt]);

    // ── Callbacks ─────────────────────────────────
    // ── Callbacks ─────────────────────────────────
    const { addToCart, updateQty, removeFromCart } = useCartActions({
        triggerHaptic, playAdd, playError, playRemove,
        cart, setCart, setCartSelectedIndex,
        setHierarchyPending, setWeightPending,
        searchInputRef, effectiveRate,
        cartRef, products, handleSetSearchTerm,
    });

    const handleSearchKeyDown = (e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); setSelectedIndex(prev => Math.min(prev + 1, searchResults.length - 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); setSelectedIndex(prev => Math.max(prev - 1, 0)); }
        else if (e.key === 'ArrowRight') {
            // Jump to cart navigation if items exist
            if (cart.length > 0) {
                e.preventDefault();
                searchInputRef.current?.blur();
            }
        }
        else if (e.key === 'Enter') {
            e.preventDefault();
            // Barcode scanner (prefix 21)
            if (searchTerm.startsWith('21') && searchTerm.length >= 13) {
                const pluCode = parseInt(searchTerm.substring(2, 7), 10).toString();
                const weightKg = parseInt(searchTerm.substring(7, 12), 10) / 1000;
                const p = products.find(p => p.id === pluCode || p.barcode?.includes(pluCode) || p.barcode?.includes(searchTerm.substring(0, 7)));
                if (p) { addToCart({ ...p, isWeight: true }, weightKg); handleSetSearchTerm(''); return; }
            }
            if (searchResults[selectedIndex]) addToCart(searchResults[selectedIndex]);
            else if (searchResults.length === 1) addToCart(searchResults[0]);
            else if (searchTerm.length >= 3 && searchResults.length === 0) {
                const exactMatch = products.find(p => p.barcode === searchTerm);
                if (exactMatch) addToCart(exactMatch);
            }
        }
    };



    const [isProcessingSale, setIsProcessingSale] = useState(false);
    // B6: la alerta de sobrepago usa ConfirmModal en vez de window.confirm.
    const [overpayAlert, setOverpayAlert] = useState(null);
    const checkoutInFlight = useRef(false);
    const handleCheckout = useCheckout({
        checkoutInFlight, setIsProcessingSale, triggerHaptic,
        cartTotalUsd, cartTotalBs, effectiveRate, cart, cartSubtotalUsd,
        playCheckout, playError, setCart, setCartSelectedIndex,
        setCustomers, setSalesData, setSelectedCustomerId,
        setShowCheckout, setShowConfetti, setShowReceipt, setOverpayAlert,
        selectedCustomerId, discountData, usuarioActivo, bcvRate: effectiveRate,
        customers, products, storageService, tasaCop, copEnabled,
        useAutoRate, rateMode, storageContext, todayAperturaData,
        checkpointCheckout, adoptCommittedProducts, notifyLowStock,
    });
    const { handleCreateCustomer, handleAddCustomAmount } = useSalesHelpers({
        storageService, setCustomers,
        tasaCop, effectiveRate, addToCart, setShowCustomAmountModal,
    });

    // ==========================================
    // KEYBOARD SHORTCUTS (LISTO POS Port)
    // ==========================================
    useSalesKeyboard({
        todayAperturaData, showCheckout, showReceipt, hierarchyPending, weightPending, 
        showClearCartConfirm, showCustomAmountModal, showRateConfig, showKeyboardHelp, 
        showDiscountModal, searchInputRef, setCartSelectedIndex, setShowClearCartConfirm, 
        cartRef, setShowCheckout, cartSelectedIndex, updateQty, removeFromCart
    });

    // ── Loading ───────────────────────────────────
    if (isLoading) {
        return (
            <div className="flex-1 flex flex-col items-center justify-center">
                <div className="w-8 h-8 rounded-full border-4 border-slate-200 dark:border-slate-800 border-t-emerald-500 animate-spin" />
            </div>
        );
    }
    const handleSaveApertura = async (data) => {
        let release;
        // Una sola caja por sede: si ya hay un turno abierto, la transacción
        // lo reutiliza (idempotente) y aquí lo informamos en vez de fingir éxito.
        let reusedExisting = false;
        try {
            storageService.assertActive();
            release = beginLocalOperation('OPEN_CASH', storageContext);
            const openedAt = new Date();
            const aperturaRecord = {
                id: `apertura_${Date.now()}`,
                tipo: 'APERTURA_CAJA',
                openingUsd: data.openingUsd,
                openingBs: data.openingBs,
                timestamp: openedAt.toISOString(),
                fechaComercial: getLocalISODate(openedAt),
                horaComercial: `${String(openedAt.getHours()).padStart(2, '0')}:${String(openedAt.getMinutes()).padStart(2, '0')}`,
                cajaCerrada: false,
                cajeroId: usuarioActivo?.id ?? null,
                cajeroNombre: usuarioActivo?.nombre ?? 'Desconocido',
            };

            if (![data.openingUsd, data.openingBs].every(value => Number.isFinite(value) && value >= 0 && value === round2(value))) throw new Error('El fondo inicial debe ser finito, no negativo y con dos decimales.');
            const opening = await storageService.transaction(ledgerRecords(['sales', 'queue', 'audit'], storageContext), current => {
                storageService.assertActive();
                const existing = getOpenCashSession(current.sales);
                if (existing) { reusedExisting = true; return { writes: {}, result: existing.apertura }; }
                const actor = useAuthStore.getState().usuarioActivo;
                const mayOpen = actor?.rol === 'DUENO' || actor?.rol === 'CAJERO' && actor.sedeId === storageContext.sedeId && localStorage.getItem('cajero_puede_abrir_caja') !== 'false';
                if (!mayOpen) throw new Error('No tienes permiso para abrir esta caja.');
                const id = `apertura_${crypto.randomUUID()}`;
                const record = { ...aperturaRecord, id, operationId: id, schemaVersion: 3, sedeId: storageContext.sedeId, accountId: storageContext.accountId,
                    huella: movementStamp('APERTURA_CAJA', id, storageContext, actor, openedAt.toISOString()) };
                return { writes: { sales: [...current.sales, record],
                    queue: [...current.queue, pendingOperation(id, 'OPEN_CASH', record, storageContext, actor, openedAt.toISOString())],
                    audit: [ledgerAudit(id, 'APERTURA_CAJA', storageContext, actor, openedAt.toISOString(), { openingUsd: data.openingUsd, openingBs: data.openingBs }), ...current.audit] }, result: record };
            });
            storageService.assertActive();
            setTodayAperturaData(opening);
            setIsAperturaOpen(false);
            if (reusedExisting) {
                showToast('Ya existe una caja abierta en esta sede. Se mantiene el turno actual.', 'info');
            } else {
                showToast('Caja abierta exitosamente', 'success');
            }
            if (triggerHaptic) triggerHaptic();

        } catch (error) {
            console.error('Error al guardar apertura:', error);
            showToast(error.message || 'Error al abrir la caja', 'error');
            if (playError) playError();
        } finally { release?.(); }
    };

    // ── Render ─────────────────────────────────────
    return (
        <div className="flex-1 min-h-0 flex flex-col dark:bg-slate-950 p-2 sm:p-4 lg:p-3 sm:pb-4 lg:pb-2 overflow-hidden relative">

            <SalesHeader
                effectiveRate={effectiveRate}
                useAutoRate={useAutoRate} setUseAutoRate={setUseAutoRate}
                customRate={customRate} setCustomRate={setCustomRate}
                showRateConfig={showRateConfig} setShowRateConfig={setShowRateConfig}
                setShowKeyboardHelp={setShowKeyboardHelp}
                triggerHaptic={triggerHaptic}
                rates={rates}
                rateMode={rateMode}
                setRateMode={setRateMode}
            />

            {!todayAperturaData ? (
                <CajaCerradaOverlay
                    cartCount={cartRef.current.length}
                    onOpenApertura={() => setIsAperturaOpen(true)}
                    canOpen={
                        !usuarioActivo ||
                        usuarioActivo.rol === 'DUENO' ||
                        localStorage.getItem('cajero_puede_abrir_caja') !== 'false'
                    }
                />
            ) : (
                <>
                    {/* ── APERTURA DE CAJA BANNER (Ocultado a petición del usuario) ── */}

                    {/* ── Split Layout: Products (left) + Cart Sidebar (right) on tablet+ ── */}
                    <div className="flex-1 min-h-0 flex flex-col md:flex-row md:gap-4">

                        {/* ── Left Column: Search + Categories ── */}
                        <SalesProductColumn
                            searchInputRef={searchInputRef}
                            searchTerm={searchTerm}
                            handleSetSearchTerm={handleSetSearchTerm}
                            handleSearchKeyDown={handleSearchKeyDown}
                            handlePasteBarcode={handlePasteBarcode}
                            searchResults={searchResults}
                            selectedIndex={selectedIndex}
                            setSelectedIndex={setSelectedIndex}
                            effectiveRate={effectiveRate}
                            addToCart={addToCart}
                            isRecording={isRecording}
                            isProcessingAudio={isProcessingAudio}
                            startRecording={startRecording}
                            stopRecording={stopRecording}
                            hierarchyPending={hierarchyPending}
                            setHierarchyPending={setHierarchyPending}
                            weightPending={weightPending}
                            setWeightPending={setWeightPending}
                            showCheckout={showCheckout}
                            showReceipt={showReceipt}
                            selectedCategory={selectedCategory}
                            setSelectedCategory={setSelectedCategory}
                            filteredByCategory={filteredByCategory}
                            triggerHaptic={triggerHaptic}
                            setShowCustomAmountModal={setShowCustomAmountModal}
                            products={products}
                        />

                {/* ── Right Column: Cart Sidebar — tablet+ ── */}
                <div className="hidden md:flex md:w-[300px] md:shrink-0 md:flex-col lg:w-[340px] xl:w-[380px]">
                    <CartPanel
                        cart={cart} effectiveRate={effectiveRate}
                        cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
                        cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} cartItemCount={cartItemCount}
                        discountData={discountData} onOpenDiscount={() => setShowDiscountModal(true)}
                        updateQty={updateQty} removeFromCart={removeFromCart}
                        onCheckout={() => { triggerHaptic && triggerHaptic(); setShowCheckout(true); }}
                        onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                        triggerHaptic={triggerHaptic}
                        cartSelectedIndex={cartSelectedIndex}
                        copEnabled={copEnabled}
                        tasaCop={tasaCop}
                    />
                </div>

            </div>

            {/* ── Mobile Cart FAB & Bottom Sheet (md:hidden) ── */}
            <MobileCartSheet
                cart={cart}
                cartItemCount={cartItemCount}
                cartTotalUsd={cartTotalUsd}
                cartTotalBs={cartTotalBs}
                isCartSheetOpen={isCartSheetOpen}
                setIsCartSheetOpen={setIsCartSheetOpen}
                showCheckout={showCheckout}
                showReceipt={showReceipt}
                cartSubtotalUsd={cartSubtotalUsd}
                cartSubtotalBs={cartSubtotalBs}
                effectiveRate={effectiveRate}
                discountData={discountData}
                setShowDiscountModal={setShowDiscountModal}
                updateQty={updateQty}
                removeFromCart={removeFromCart}
                setShowCheckout={setShowCheckout}
                setShowClearCartConfirm={setShowClearCartConfirm}
                triggerHaptic={triggerHaptic}
                cartSelectedIndex={cartSelectedIndex}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
            />
            </>
            )}
            {/* Modals */}
            <SalesModals
                showCheckout={showCheckout}
                setShowCheckout={setShowCheckout}
                cartSubtotalUsd={cartSubtotalUsd}
                cartSubtotalBs={cartSubtotalBs}
                cartTotalUsd={cartTotalUsd}
                cartTotalBs={cartTotalBs}
                discountData={discountData}
                effectiveRate={effectiveRate}
                customers={customers}
                selectedCustomerId={selectedCustomerId}
                setSelectedCustomerId={setSelectedCustomerId}
                paymentMethods={paymentMethods}
                handleCheckout={handleCheckout}
                handleCreateCustomer={handleCreateCustomer}
                isProcessingSale={isProcessingSale}
                cart={cart}
                products={products}
                triggerHaptic={triggerHaptic}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                useAutoRate={useAutoRate}
                currentFloat={currentFloat}
                showReceipt={showReceipt}
                setShowReceipt={setShowReceipt}
                showCustomAmountModal={showCustomAmountModal}
                setShowCustomAmountModal={setShowCustomAmountModal}
                handleAddCustomAmount={handleAddCustomAmount}
                showClearCartConfirm={showClearCartConfirm}
                setShowClearCartConfirm={setShowClearCartConfirm}
                setCart={setCart}
                setDiscount={setDiscount}
                setCartSelectedIndex={setCartSelectedIndex}
                overpayAlert={overpayAlert}
                setOverpayAlert={setOverpayAlert}
                showDiscountModal={showDiscountModal}
                setShowDiscountModal={setShowDiscountModal}
                discount={discount}
                showConfetti={showConfetti}
                setShowConfetti={setShowConfetti}
                showKeyboardHelp={showKeyboardHelp}
                setShowKeyboardHelp={setShowKeyboardHelp}
                isAperturaOpen={isAperturaOpen}
                setIsAperturaOpen={setIsAperturaOpen}
                handleSaveApertura={handleSaveApertura}
            />
        </div>
    );
}
