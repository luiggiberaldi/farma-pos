import { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue } from 'react';
import { FinancialEngine } from '../core/FinancialEngine';
import { storageService } from '../utils/storageService';
import { round2, divR } from '../utils/dinero';
import { useSounds } from '../hooks/useSounds';
import { useVoiceSearch } from '../hooks/useVoiceSearch';
import { useNotifications } from '../hooks/useNotifications';
import { useBarcodeScanner } from '../hooks/useBarcodeScanner';
import { getActivePaymentMethods } from '../config/paymentMethods';
import { showToast } from '../components/Toast';
import { ShoppingCart, X, DollarSign, CheckCircle2 } from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useProductContext } from '../context/ProductContext';
import { useAuthStore } from '../hooks/store/useAuthStore';

// Components
import SalesHeader from '../components/Sales/SalesHeader';
import SearchBar from '../components/Sales/SearchBar';
import CategoryBar from '../components/Sales/CategoryBar';
import CartPanel from '../components/Sales/CartPanel';
import ReceiptModal from '../components/Sales/ReceiptModal';
import CheckoutModal from '../components/Sales/CheckoutModal';
import CustomAmountModal from '../components/Sales/CustomAmountModal';
import KeyboardHelpModal from '../components/Sales/KeyboardHelpModal';
import DiscountModal from '../components/Sales/DiscountModal';
import CajaCerradaOverlay from '../components/Sales/CajaCerradaOverlay';
import { getLocalISODate } from '../utils/dateHelpers';
import { buildReceiptWhatsAppUrl } from '../components/Sales/ReceiptShareHelper';
import AperturaCajaModal from '../components/Dashboard/AperturaCajaModal';

import ConfirmModal from '../components/ConfirmModal';
import Confetti from '../components/Confetti';
import { processSaleTransaction } from '../utils/checkoutProcessor';
import { useSalesKeyboard } from '../hooks/useSalesKeyboard';

const SALES_KEY = 'bodega_sales_v1';

export default function SalesView({ rates, triggerHaptic, onNavigate, isActive }) {
    const { playAdd, playRemove, playCheckout, playError } = useSounds();
    const { notifySaleComplete, notifyLowStock } = useNotifications();

    // ── Global Context ──────────────────────────────────────
    const { products, setProducts, isLoadingProducts, useAutoRate, setUseAutoRate, customRate, setCustomRate, effectiveRate, copEnabled, tasaCop, rateMode, setRateMode } = useProductContext();
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
    const { cart, setCart, cartRef, pendingNavigate, setPendingNavigate, discount, setDiscount } = useCart();
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
        value: discount?.value
    };

    // ── Current cash float (for soft change warning in CheckoutModal) ──
    const [salesData, setSalesData] = useState([]);
    const currentFloat = useMemo(() => {
        const todayStr = getLocalISODate(new Date());
        const todayOpen = salesData.filter(s => {
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

    // Persist cart (With Debounce to avoid blocking UI on rapid scans)
    const isCartInitialized = useRef(false);
    useEffect(() => {
        if (!isCartInitialized.current) { isCartInitialized.current = true; return; }
        const timer = setTimeout(() => {
            if (cart.length > 0) storageService.setItem('bodega_pending_cart_v1', cart);
            else storageService.removeItem('bodega_pending_cart_v1');
        }, 1000);
        return () => clearTimeout(timer);
    }, [cart]);

    // Load data
    useEffect(() => {
        let mounted = true;
        const load = async () => {
            const [savedCustomers, methods, savedCart, savedSales] = await Promise.all([
                storageService.getItem('bodega_customers_v1', []),
                getActivePaymentMethods(),
                storageService.getItem('bodega_pending_cart_v1', []),
                storageService.getItem(SALES_KEY, [])
            ]);
            if (mounted) { setSalesData(savedSales); }
            if (mounted) {
                setCustomers(savedCustomers);
                setPaymentMethods(methods);
                
                // Only set cart if it's currently empty (don't overwrite if user somehow added items before load)
                if (savedCart && savedCart.length > 0 && cartRef.current.length === 0) {
                    setCart(savedCart);
                }

                // Check Apertura (timezone-safe)
                const todayStr = getLocalISODate(new Date());
                const apertura = savedSales.find(s => {
                    if (s.tipo !== 'APERTURA_CAJA' || s.cajaCerrada) return false;
                    const saleDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : todayStr;
                    return saleDay === todayStr;
                });
                setTodayAperturaData(apertura || null);
                
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
            storageService.getItem('bodega_products_v1', []),
            getActivePaymentMethods(),
            storageService.getItem('bodega_customers_v1', []),
            storageService.getItem(SALES_KEY, [])
        ]).then(([savedProducts, methods, savedCustomers, savedSales]) => {
            setProducts(savedProducts);
            setPaymentMethods(methods);
            setCustomers(savedCustomers);
            setSalesData(savedSales);
            
            // Recalculate Apertura (uses imported getLocalISODate)
            const todayStr = getLocalISODate(new Date());
            
            const apertura = savedSales.find(s => {
                if (s.tipo !== 'APERTURA_CAJA' || s.cajaCerrada) return false;
                const saleLocalDay = s.timestamp ? getLocalISODate(new Date(s.timestamp)) : todayStr;
                return saleLocalDay === todayStr;
            });
            setTodayAperturaData(apertura || null);
        });
    }, [isActive, setProducts]);

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
    const addToCart = useCallback((product, qtyOverride = null, forceMode = null) => {
        triggerHaptic && triggerHaptic();

        // Validación temprana: rechazar productos sin precio válido
        if (!product.priceUsdt || isNaN(product.priceUsdt) || product.priceUsdt <= 0) {
            playError();
            showToast('Este producto no tiene precio válido. Edítalo primero.', 'warning');
            return;
        }

        // Validación temprana de stock (si la configuración lo exige)
        const allowNegativeStock = localStorage.getItem('allow_negative_stock') === 'true';
        const currentStock = parseFloat(product.stock) || 0;
        if (!allowNegativeStock && currentStock <= 0) {
            playError();
            showToast(`${product.name}: sin stock`, 'warning');
            return;
        }

        playAdd();

        if (product.sellByUnit && product.unitPriceUsd && !forceMode && !qtyOverride) { setHierarchyPending(product); return; }
        if ((product.unit === 'kg' || product.unit === 'litro') && !qtyOverride) { setWeightPending(product); return; }

        let priceToUse = parseFloat(product.priceUsdt) || 0;
        let cartId = product.id;
        let cartName = product.name;
        let qtyToAdd = qtyOverride || 1;

        if (forceMode === 'unit') {
            priceToUse = product.unitPriceUsd;
            cartId = product.id + '_unit';
            cartName = product.name + ' (Ud.)';
        }

        // Pre-calculate stock check BEFORE setCart to avoid React StrictMode double-firing
        if (!allowNegativeStock) {
            const currentCart = cartRef.current;
            const existingInCart = currentCart.find(i => i.id === cartId && i.priceUsd === priceToUse);
            const addingQty = existingInCart ? (qtyOverride || 1) : qtyToAdd;
            const existingQtyForThis = existingInCart ? existingInCart.qty : 0;
            const newQty = existingQtyForThis + addingQty;
            const stockNeeded = forceMode === 'unit' ? newQty / (product.unitsPerPackage || 1) : newQty;

            const otherCartItems = currentCart.filter(i => (i._originalId || i.id) === product.id && i.id !== cartId);
            const otherStockUsed = otherCartItems.reduce((sum, item) => {
                if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                return sum + item.qty;
            }, 0);

            if (stockNeeded + otherStockUsed > currentStock) {
                playError();
                showToast(`${product.name}: stock maximo alcanzado`, 'warning');
                return;
            }
        }

        // Soft warning when allowNegativeStock is ON but stock just ran out
        if (allowNegativeStock && currentStock > 0) {
            const currentCart = cartRef.current;
            const existingInCart = currentCart.find(i => i.id === cartId && i.priceUsd === priceToUse);
            const existingQtyForThis = existingInCart ? existingInCart.qty : 0;
            const newQty = existingQtyForThis + (qtyOverride || 1);
            const stockNeeded = forceMode === 'unit' ? newQty / (product.unitsPerPackage || 1) : newQty;

            const otherCartItems = currentCart.filter(i => (i._originalId || i.id) === product.id && i.id !== cartId);
            const otherStockUsed = otherCartItems.reduce((sum, item) => {
                if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                return sum + item.qty;
            }, 0);

            if (stockNeeded + otherStockUsed > currentStock) {
                showToast(`${product.name}: stock agotado, vendiendo sin inventario`, 'info');
            }
        }

        setCart(prev => {
            const existing = prev.find(i => i.id === cartId && i.priceUsd === priceToUse);
            if (existing && !qtyOverride) return prev.map(i => i.id === cartId ? { ...i, qty: i.qty + 1 } : i);
            if (existing && qtyOverride) return prev.map(i => i.id === cartId ? { ...i, qty: i.qty + qtyOverride } : i);

            const itemCostBs = product.costBs || (product.costUsd ? product.costUsd * effectiveRate : 0);
            return [{
                ...product, id: cartId, name: cartName, priceUsd: priceToUse,
                exactBs: product.exactBs || null,
                costBs: forceMode === 'unit' ? itemCostBs / (product.unitsPerPackage || 1) : itemCostBs,
                costUsd: forceMode === 'unit' ? (product.costUsd || 0) / (product.unitsPerPackage || 1) : (product.costUsd || 0),
                qty: qtyToAdd, isWeight: !!qtyOverride,
                _originalId: product.id, _mode: forceMode || 'package', _unitsPerPackage: product.unitsPerPackage || 1,
            }, ...prev];
        });
        handleSetSearchTerm('');
        setHierarchyPending(null);
        
        // --- LISTO POS Flow: blur search to enter cart mode and auto-select ---
        setTimeout(() => {
            searchInputRef.current?.blur();
            setCartSelectedIndex(0); // Ensure cart item is selected and ready for + / - 
        }, 50);
    }, [triggerHaptic, effectiveRate]);

    const updateQty = (id, delta) => {
        triggerHaptic && triggerHaptic();
        if (delta < 0) playRemove();

        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';

        // Pre-check stock BEFORE setCart to avoid React StrictMode double toast
        if (!allowNeg && delta > 0) {
            const currentCart = cartRef.current;
            const cartItem = currentCart.find(i => i.id === id);
            if (cartItem) {
                const originalId = cartItem._originalId || cartItem.id;
                const productData = products.find(p => p.id === originalId);
                if (productData) {
                    const availableStock = parseFloat(productData.stock) || 0;
                    const newQty = Math.round((cartItem.qty + delta) * 1000) / 1000;
                    const totalUsed = currentCart.reduce((sum, item) => {
                        if ((item._originalId || item.id) !== originalId) return sum;
                        if (item.id === id) return sum;
                        if (item._mode === 'unit') return sum + (item.qty / (item._unitsPerPackage || 1));
                        return sum + item.qty;
                    }, 0);
                    const thisItemStock = cartItem._mode === 'unit' ? newQty / (cartItem._unitsPerPackage || 1) : newQty;
                    if (totalUsed + thisItemStock > availableStock) {
                        playError();
                        showToast(`${cartItem.name}: stock maximo alcanzado`, 'warning');
                        return;
                    }
                }
            }
        }

        setCart(prev => prev.map(i => {
            if (i.id !== id) return i;
            let newQty = Math.round((i.qty + delta) * 1000) / 1000;
            if (newQty < 0) newQty = 0;
            return newQty === 0 ? null : { ...i, qty: newQty };
        }).filter(Boolean));
    };

    const removeFromCart = (id) => {
        triggerHaptic && triggerHaptic();
        playRemove();
        setCart(prev => prev.filter(i => i.id !== id));
    };

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
    const handleCheckout = async (payments, changeBreakdown) => {
        if (isProcessingSale) return;
        setIsProcessingSale(true);
        triggerHaptic && triggerHaptic();

        // ── Overpayment sanity check (3 layers) ──────────────────────────
        if (cartTotalUsd > 0.5) {
            const totalPaidUsd = payments.reduce((sum, p) => sum + (p.amountUsd || 0), 0);
            const ratio = totalPaidUsd / cartTotalUsd;
            const diff = totalPaidUsd - cartTotalUsd;

            let alertMsg = null;

            // Capa 1: confusión de moneda Bs → USD
            // El cajero ingresó bolívares en un campo de dólares
            if (!alertMsg && effectiveRate > 1) {
                const usdPayments = payments.filter(p => {
                    const label = (p.label || p.method || '').toLowerCase();
                    return label.includes('dólar') || label.includes('dolar') || label.includes('usd') || label === 'efectivo';
                });
                for (const p of usdPayments) {
                    const rawAmount = p.amountUsd || 0;
                    const asUsd = rawAmount / effectiveRate;
                    if (Math.abs(asUsd - cartTotalUsd) / cartTotalUsd < 0.10) {
                        const totalBsExpected = (cartTotalUsd * effectiveRate).toFixed(2);
                        alertMsg = `¿Ingresaste bolívares en el campo de dólares?\n\nMonto ingresado: $${rawAmount.toFixed(2)}\nTotal real en Bs: Bs ${totalBsExpected}\n\nSi pagó en bolívares, el total correcto es Bs ${totalBsExpected}.`;
                        break;
                    }
                }
            }

            // Capa 2: umbral proporcional por tamaño de venta
            if (!alertMsg) {
                let triggerRatio = null;
                let triggerDiff = null;
                if      (cartTotalUsd <= 10)  { triggerRatio = 4;   triggerDiff = 15;  }
                else if (cartTotalUsd <= 50)  { triggerRatio = 3;   triggerDiff = 30;  }
                else if (cartTotalUsd <= 200) { triggerRatio = 2;   triggerDiff = 50;  }
                else                          { triggerRatio = 1.5; triggerDiff = 100; }

                if (ratio > triggerRatio && diff > triggerDiff) {
                    alertMsg = `Monto alto detectado.\n\nPagado: $${totalPaidUsd.toFixed(2)} (${ratio.toFixed(1)}× el total)\nTotal venta: $${cartTotalUsd.toFixed(2)}\n\n¿Estás seguro?`;
                }
            }

            // Capa 3: número redondo sospechoso (termina en 000 o 500) y supera 3× el total
            if (!alertMsg && ratio > 3) {
                const rounded = Math.round(totalPaidUsd);
                if (rounded % 500 === 0 || rounded % 1000 === 0) {
                    alertMsg = `El monto parece un número redondeado por error.\n\nIngresado: $${totalPaidUsd.toFixed(2)}\nTotal venta: $${cartTotalUsd.toFixed(2)}\n\n¿Estás seguro?`;
                }
            }

            if (alertMsg) {
                const ok = window.confirm(alertMsg);
                if (!ok) { setIsProcessingSale(false); return; }
            }
        }

        const opts = {
            cart, cartTotalUsd, cartTotalBs, cartSubtotalUsd, payments, changeBreakdown,
            selectedCustomerId, customers, products, effectiveRate, tasaCop, copEnabled,
            discountData, useAutoRate, rateMode
        };

        const result = await processSaleTransaction(opts);
        
        if (!result.success) {
            console.error('Abortando venta:', result.error);
            showToast(result.error, result.error.includes('No se pueden') ? 'warning' : 'error');
            playError();
            setIsProcessingSale(false);
            return;
        }

        // Apply state updates using the returned optimized datasets
        setProducts(result.updatedProducts);
        
        if (result.updatedCustomers) {
            setCustomers(result.updatedCustomers);
        }

        setSalesData(prev => [result.sale, ...prev]);

        setShowReceipt(result.sale); 
        playCheckout(); 
        setShowConfetti(true);
        notifyLowStock(result.updatedProducts);
        
        setCart([]);
        setShowCheckout(false);
        setSelectedCustomerId('');
        setCartSelectedIndex(-1);
        setIsProcessingSale(false);
    };

    const handleCreateCustomer = async (name, documentId, phone) => {
        const newCustomer = { id: crypto.randomUUID(), name, documentId: documentId || '', phone: phone || '', deuda: 0, favor: 0, createdAt: new Date().toISOString() };
        const updated = [...customers, newCustomer];
        setCustomers(updated);
        await storageService.setItem('bodega_customers_v1', updated);
        return newCustomer;
    };

    const handleAddCustomAmount = (amount, currency) => {
        let amountUsd = 0;
        let exactBsToStore = null;
        
        if (currency === 'USD') {
            amountUsd = round2(amount);
            // exactBsToStore remains null to float with effectiveRate
        } else if (currency === 'COP') {
            const tasaCopVal = typeof tasaCop !== 'undefined' ? tasaCop : (parseFloat(localStorage.getItem('tasa_cop')) || 4150);
            amountUsd = divR(amount, tasaCopVal);
            // exactBsToStore remains null to float with effectiveRate
        } else {
            // Default BS
            amountUsd = divR(amount, effectiveRate);
            exactBsToStore = round2(amount);
        }

        if (amountUsd <= 0) return;
        
        const customProduct = {
            id: `custom_${Date.now()}`,
            name: 'Venta Libre',
            priceUsdt: amountUsd, // Usamos priceUsdt para que la validación temprana lo acepte
            exactBs: exactBsToStore, // Monto exacto original en Bs, o null si debe flotar
            costBs: 0,
            costUsd: 0,
            unit: 'unidad',
            category: 'otros',
            stock: 9999,
        };

        addToCart(customProduct);
        setShowCustomAmountModal(false);
    };

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
        try {
            const today = new Date().toISOString();
            const aperturaRecord = {
                id: `apertura_${Date.now()}`,
                tipo: 'APERTURA_CAJA',
                openingUsd: data.openingUsd,
                openingBs: data.openingBs,
                timestamp: today,
                cajaCerrada: false,
                cajeroId: usuarioActivo?.id ?? null,
                cajeroNombre: usuarioActivo?.nombre ?? 'Desconocido',
            };

            const existingSales = await storageService.getItem(SALES_KEY, []);
            const updatedSales = [...existingSales, aperturaRecord];
            
            await storageService.setItem(SALES_KEY, updatedSales);
            setTodayAperturaData(aperturaRecord);
            setIsAperturaOpen(false);
            showToast('Caja abierta exitosamente', 'success');
            if (triggerHaptic) triggerHaptic();

        } catch (error) {
            console.error('Error al guardar apertura:', error);
            showToast('Error al abrir la caja', 'error');
            if (playError) playError();
        }
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
                        usuarioActivo.rol === 'ADMIN' ||
                        localStorage.getItem('cajero_puede_abrir_caja') !== 'false'
                    }
                />
            ) : (
                <>
                    {/* ── APERTURA DE CAJA BANNER ── */}
                    <div className="shrink-0 mb-2 lg:mb-1">
                        <div className="w-full bg-emerald-50 dark:bg-emerald-900/10 border border-emerald-200 dark:border-emerald-800/30 rounded-2xl sm:rounded-3xl p-3 sm:p-4 lg:p-2.5 flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="w-9 h-9 sm:w-10 sm:h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center">
                                    <CheckCircle2 size={18} className="text-emerald-500" />
                                </div>
                                <div>
                                    <p className="text-xs sm:text-sm font-bold text-emerald-700 dark:text-emerald-400">Apertura Registrada</p>
                                    <p className="text-[10px] sm:text-xs text-emerald-500/70">${todayAperturaData.openingUsd?.toFixed(2)} · Bs {formatBs(todayAperturaData.openingBs || 0)}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* ── Split Layout: Products (left) + Cart Sidebar (right) on tablet+ ── */}
                    <div className="flex-1 min-h-0 flex flex-col md:flex-row md:gap-4">

                        {/* ── Left Column: Search + Categories ── */}
                        <div className="flex-1 min-h-0 flex flex-col md:min-w-0 overflow-y-auto md:overflow-hidden" style={{ WebkitOverflowScrolling: 'touch' }}>
                            {/* Search + Popups */}
                            <div className="shrink-0 mb-2 lg:mb-1.5 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-3 sm:p-4 lg:p-3 shadow-sm border border-slate-100 dark:border-slate-800">
                                <SearchBar
                                    ref={searchInputRef}
                                    searchTerm={searchTerm}
                                    onSearchChange={handleSetSearchTerm}
                                    onKeyDown={handleSearchKeyDown}
                                    onPasteBarcode={handlePasteBarcode}
                                    searchResults={searchResults}
                                    selectedIndex={selectedIndex} setSelectedIndex={setSelectedIndex}
                                    effectiveRate={effectiveRate}
                                    addToCart={addToCart}
                                    isRecording={isRecording} isProcessingAudio={isProcessingAudio} startRecording={startRecording} stopRecording={stopRecording}
                                    hierarchyPending={hierarchyPending} setHierarchyPending={setHierarchyPending}
                                    weightPending={weightPending} setWeightPending={setWeightPending}
                                />
                            </div>

                            {/* Category Chips + Product Grid */}
                            {!showCheckout && !showReceipt && (
                                <CategoryBar
                                    selectedCategory={selectedCategory} setSelectedCategory={setSelectedCategory}
                                    filteredByCategory={filteredByCategory}
                                    addToCart={addToCart}
                                    triggerHaptic={triggerHaptic}
                                    searchTerm={searchTerm}
                                    onOpenCustomAmount={() => setShowCustomAmountModal(true)}

                            products={products}
                        />
                    )}
                </div>

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
            <div className="md:hidden">
                {/* Floating Action Button */}
                {cart.length > 0 && !isCartSheetOpen && !showCheckout && !showReceipt && (
                    <button 
                        onClick={() => { triggerHaptic && triggerHaptic(); setIsCartSheetOpen(true); }}
                        className="fixed bottom-[max(5rem,env(safe-area-inset-bottom)+4.5rem)] left-4 right-4 bg-emerald-500 hover:bg-emerald-600 text-white p-4 rounded-2xl shadow-xl shadow-emerald-500/30 flex items-center justify-between z-40 active:scale-95 transition-all animate-in slide-in-from-bottom"
                    >
                        <div className="flex items-center gap-3">
                            <div className="bg-white/20 p-2 rounded-xl">
                                <ShoppingCart size={20} />
                            </div>
                            <div className="text-left">
                                <div className="text-xs font-bold text-emerald-100 uppercase tracking-wider">Ver Cesta</div>
                                <div className="font-black leading-none">{cartItemCount} artículo{cartItemCount !== 1 && 's'}</div>
                            </div>
                        </div>
                        <div className="text-right">
                            <div className="text-2xl font-black leading-none">${cartTotalUsd.toFixed(2)}</div>
                            <div className="text-xs font-bold text-emerald-100 mt-1">Bs {formatBs(cartTotalBs)}</div>
                        </div>
                    </button>
                )}

                {/* Bottom Sheet Overlay */}
                {isCartSheetOpen && !showCheckout && !showReceipt && (
                    <div className="fixed inset-0 z-50 flex flex-col justify-end bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 pb-[max(0px,env(safe-area-inset-bottom))]"
                         onClick={() => setIsCartSheetOpen(false)}>
                        <div className="bg-slate-50 dark:bg-slate-950 w-full rounded-t-3xl shadow-2xl flex flex-col max-h-[85vh] animate-in slide-in-from-bottom-full duration-300"
                             onClick={e => e.stopPropagation()}>
                            <div className="shrink-0 flex justify-center pt-3 pb-2" onClick={() => setIsCartSheetOpen(false)}>
                                <div className="w-12 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full cursor-pointer" />
                            </div>
                            <div className="shrink-0 px-4 pb-3 flex items-center justify-between border-b border-slate-200 dark:border-slate-800">
                                <h3 className="font-black text-slate-800 dark:text-white text-lg flex items-center gap-2">
                                    <ShoppingCart size={20} className="text-emerald-500" /> Cesta Actual
                                </h3>
                                <button onClick={() => setIsCartSheetOpen(false)} className="p-2 -mr-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                <CartPanel
                                    cart={cart} effectiveRate={effectiveRate}
                                    cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
                                    cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} cartItemCount={cartItemCount}
                                    discountData={discountData} onOpenDiscount={() => setIsCartSheetOpen(false) || setShowDiscountModal(true)}
                                    updateQty={updateQty} removeFromCart={removeFromCart}
                                    onCheckout={() => { triggerHaptic && triggerHaptic(); setShowCheckout(true); setIsCartSheetOpen(false); }}
                                    onClearCart={() => { triggerHaptic && triggerHaptic(); setShowClearCartConfirm(true); }}
                                    triggerHaptic={triggerHaptic}
                                    cartSelectedIndex={cartSelectedIndex}
                                    copEnabled={copEnabled}
                                    tasaCop={tasaCop}
                                />
                            </div>
                        </div>
                    </div>
                )}
            </div>
            </>
            )}

            {/* Checkout Modal */}
            {showCheckout && (
                <CheckoutModal
                    onClose={() => { setShowCheckout(false); setSelectedCustomerId(''); }}
                    cartSubtotalUsd={cartSubtotalUsd} cartSubtotalBs={cartSubtotalBs}
                    cartTotalUsd={cartTotalUsd} cartTotalBs={cartTotalBs} 
                    discountData={discountData} effectiveRate={effectiveRate}
                    customers={customers} selectedCustomerId={selectedCustomerId} setSelectedCustomerId={setSelectedCustomerId}
                    paymentMethods={paymentMethods}
                    onConfirmSale={handleCheckout} onCreateCustomer={handleCreateCustomer}
                    isProcessingSale={isProcessingSale}
                    triggerHaptic={triggerHaptic}
                    copEnabled={copEnabled}
                    tasaCop={tasaCop}
                    useAutoRate={useAutoRate}
                    currentFloatUsd={currentFloat.usd}
                    currentFloatBs={currentFloat.bs}
                />
            )}

            {/* Receipt Modal */}
            <ReceiptModal
                receipt={showReceipt}
                onClose={() => { setShowReceipt(null); setSelectedCustomerId(''); }}
                onShareWhatsApp={(r) => { window.open(buildReceiptWhatsAppUrl(r, effectiveRate), '_blank'); }}
                currentRate={effectiveRate}
            />

            {/* Custom Amount Modal */}
            {showCustomAmountModal && (
                <CustomAmountModal
                    onClose={() => setShowCustomAmountModal(false)}
                    onConfirm={handleAddCustomAmount}
                    effectiveRate={effectiveRate}
                    triggerHaptic={triggerHaptic}
                />
            )}

            {/* Clear Cart Confirm */}
            <ConfirmModal
                isOpen={showClearCartConfirm}
                onClose={() => setShowClearCartConfirm(false)}
                onConfirm={() => { setCart([]); setDiscount({ type: 'percentage', value: 0 }); setShowClearCartConfirm(false); setCartSelectedIndex(-1); }}
                title="¿Vaciar toda la cesta?"
                message="Todos los productos serán eliminados de la cesta actual. Esta acción no se puede deshacer."
                confirmText="Sí, vaciar"
                variant="cart"
            />

            {/* Discount Modal */}
            {showDiscountModal && (
                <DiscountModal
                    currentDiscount={discount}
                    onApply={(newDiscount) => {
                        setDiscount(newDiscount);
                        setShowDiscountModal(false);
                    }}
                    onClose={() => setShowDiscountModal(false)}
                    cartSubtotalUsd={cartSubtotalUsd}
                    effectiveRate={effectiveRate}
                    tasaCop={tasaCop}
                    copEnabled={copEnabled}
                />
            )}

            {/* Confetti */}
            {showConfetti && <Confetti onDone={() => setShowConfetti(false)} />}

            {/* Keyboard Shortcuts Help Modal (Desktop Only) */}
            <KeyboardHelpModal 
                isOpen={showKeyboardHelp} 
                onClose={() => setShowKeyboardHelp(false)} 
            />

            {/* Apertura Caja Modal */}
            <AperturaCajaModal
                isOpen={isAperturaOpen}
                onClose={() => setIsAperturaOpen(false)}
                onConfirm={handleSaveApertura}
            />
        </div>
    );
}
