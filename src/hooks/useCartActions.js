import { useCallback } from 'react';
import { showToast } from '../components/Toast';
import { getLocalISODate } from '../utils/dateHelpers';
import { hasValidSalePrice } from '../utils/productPrice.js';
import { quantityInBase, isBulkProduct, isPackageProduct, packageFactor } from '../utils/inventoryQuantities.js';

export function useCartActions(deps) {
    const {
        triggerHaptic, playAdd, playError, playRemove,
        cart, setCart, setCartSelectedIndex,
        setHierarchyPending, setWeightPending,
        searchInputRef, effectiveRate,
        cartRef, products, handleSetSearchTerm,
    } = deps;

const addToCart = useCallback((product, qtyOverride = null, forceMode = null) => {
    triggerHaptic && triggerHaptic();

    // Guardarraíl: sin precio válido en USD el producto no entra al carrito.
    // (El sistema no trabaja con USDT; el precio principal es `priceUsd`.)
    if (!hasValidSalePrice(product)) {
        playError();
        showToast('Este producto no tiene precio válido. Edítalo primero.', 'warning');
        return;
    }

    // Bloqueo farmacéutico: producto vencido no se vende (F3.7)
    if (product.vencimiento && product.vencimiento <= getLocalISODate()) {
        playError();
        showToast(`${product.name}: VENCIDO (${product.vencimiento}) — venta bloqueada`, 'error');
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

    let priceToUse = parseFloat(product.priceUsd) || 0;
    let cartId = product.id;
    let cartName = product.name;
    let qtyToAdd = qtyOverride || 1;

    if (forceMode === 'unit') {
        priceToUse = product.unitPriceUsd;
        cartId = product.id + '_unit';
        cartName = product.name + ' (Ud.)';
    }

    if (product.kind !== 'custom') {
        try {
            if (isPackageProduct(product) && product.stockUnit !== 'base') throw new Error('Confirma primero la existencia física en unidades desde Inventario.');
            const used = cartRef.current.filter(item => (item.productId || item._originalId || item.id) === product.id)
                .reduce((sum, item) => sum + quantityInBase(item, product).quantityBase, 0);
            const added = quantityInBase({ qty: qtyToAdd, _mode: forceMode || (isBulkProduct(product) ? 'weight' : 'package') }, product).quantityBase;
            if (used + added > currentStock) throw new Error(`${product.name}: stock máximo alcanzado`);
        } catch (error) { playError(); showToast(error.message, 'warning'); return; }
    }

    setCart(prev => {
        const existing = prev.find(i => i.id === cartId && i.priceUsd === priceToUse);
        if (existing && !qtyOverride) return prev.map(i => i.id === cartId ? { ...i, qty: i.qty + 1 } : i);
        if (existing && qtyOverride) return prev.map(i => i.id === cartId ? { ...i, qty: i.qty + qtyOverride } : i);

        const itemCostBs = product.costBs || (product.costUsd ? product.costUsd * effectiveRate : 0);
        return [{
            ...product, id: cartId, name: cartName, priceUsd: priceToUse,
            exactBs: product.exactBs != null ? product.exactBs / (forceMode === 'unit' ? packageFactor(product) : 1) : null,
            costBs: forceMode === 'unit' ? itemCostBs / (product.unitsPerPackage || 1) : itemCostBs,
            costUsd: forceMode === 'unit' ? (product.costUsd || 0) / (product.unitsPerPackage || 1) : (product.costUsd || 0),
            qty: qtyToAdd, isWeight: isBulkProduct(product), productId: product.id,
            _originalId: product.id, _mode: forceMode || (isBulkProduct(product) ? 'weight' : 'package'), _unitsPerPackage: product.unitsPerPackage || 1,
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

    // Pharmacy stock cannot be silently oversold. The final transaction
    // repeats this check against persisted stock under the database lock.
    if (delta > 0) {
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
                    return sum + quantityInBase(item, productData).quantityBase;
                }, 0);
                const thisItemStock = quantityInBase({ ...cartItem, qty: newQty }, productData).quantityBase;
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
    return { addToCart, updateQty, removeFromCart };
}
