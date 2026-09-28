import React, { useState, useRef, useEffect, useCallback } from 'react';
import { CartContext } from './cartState.js';
import { captureStorageContext, assertStorageContextActive, getStorageKeyForContext } from '../config/storageScope.js';
import { registerContextBlocker, assertLocalOperationAllowed } from '../services/localOperationGuard.js';

const EMPTY_DISCOUNT = { type: 'percentage', value: 0 };

export function CartProvider({ children }) {
    const [context] = useState(captureStorageContext);
    const [draftKey] = useState(() => getStorageKeyForContext('bodega_pending_cart_v2', context));
    const [draft] = useState(() => {
        // Legacy unscoped drafts have no proven branch: leave them untouched.
        try {
            const parsed = JSON.parse(localStorage.getItem(draftKey) || 'null');
            if (parsed === null) return { items: [], discount: EMPTY_DISCOUNT };
            if (parsed.version !== 2 || !Array.isArray(parsed.items)
                || parsed.items.some(item => !item || !item.id || !Number.isFinite(item.qty) || item.qty <= 0 || !Number.isFinite(item.priceUsd) || item.priceUsd < 0)
                || !['percentage', 'fixed'].includes(parsed.discount?.type) || !Number.isFinite(parsed.discount.value) || parsed.discount.value < 0) {
                return { items: [], discount: EMPTY_DISCOUNT, invalid: true };
            }
            return { ...parsed, discount: { type: parsed.discount.type, value: parsed.discount.value } };
        } catch { return { items: [], discount: EMPTY_DISCOUNT, invalid: true }; }
    });
    const [cart, updateCart] = useState(draft.items);
    const cartRef = useRef(draft.items);
    const [operationId, setOperationId] = useState(() => draft.operationId || crypto.randomUUID());
    const operationRef = useRef(operationId);
    const [discount, updateDiscount] = useState(draft.discount || EMPTY_DISCOUNT);
    const discountRef = useRef(draft.discount || EMPTY_DISCOUNT);
    const [pendingNavigate, setPendingNavigate] = useState(null);
    const mountedRef = useRef(false);

    // Synchronous local draft persistence: logout/unmount cannot cancel a
    // debounce and lose the cart. The key is pinned to its original context.
    const persistDraft = useCallback((items, value) => {
        assertStorageContextActive(context);
        assertLocalOperationAllowed();
        if (!mountedRef.current) throw new Error('La cesta anterior ya no está activa.');
        if (draft.invalid) throw new Error('El borrador de esta sede no es válido. Revisa el respaldo antes de reemplazarlo.');
        const changed = JSON.stringify(items) !== JSON.stringify(cartRef.current) || value.type !== discountRef.current.type || value.value !== discountRef.current.value;
        const nextId = changed ? crypto.randomUUID() : operationRef.current;
        localStorage.setItem(draftKey, JSON.stringify({ version: 2, items, operationId: nextId,
            discount: { type: value.type, value: value.value } }));
        operationRef.current = nextId;
        setOperationId(nextId);
    }, [context, draftKey, draft.invalid]);

    const setCart = useCallback(value => {
        const next = typeof value === 'function' ? value(cartRef.current) : value;
        if (!Array.isArray(next)) throw new Error('Carrito inválido.');
        const nextDiscount = next.length ? discountRef.current : EMPTY_DISCOUNT;
        persistDraft(next, nextDiscount);
        cartRef.current = next;
        discountRef.current = nextDiscount;
        updateCart(next);
        if (!next.length) updateDiscount(EMPTY_DISCOUNT);
    }, [persistDraft]);

    const setDiscount = useCallback(value => {
        const next = typeof value === 'function' ? value(discountRef.current) : value;
        persistDraft(cartRef.current, next);
        discountRef.current = next;
        updateDiscount(next);
    }, [persistDraft]);

    useEffect(() => {
        mountedRef.current = true;
        const unregister = registerContextBlocker(() => cartRef.current.length
            ? 'Hay productos en la cesta. Cobra o vacía la cesta antes de cambiar de sede.'
            : draft.invalid ? 'El borrador de la sede necesita revisión.' : null);
        return () => { mountedRef.current = false; unregister(); };
    }, [draft.invalid]);

    const loadCart = useCallback((items, navigateTo = 'ventas') => {
        if (!Array.isArray(items) || !items.length) return;
        setCart(items.map(item => ({ ...item, qty: Math.abs(item.qty), priceUsd: Math.abs(item.priceUsd) })));
        setDiscount(EMPTY_DISCOUNT);
        setPendingNavigate(navigateTo);
    }, [setCart, setDiscount]);

    const clearCart = useCallback(() => { setCart([]); }, [setCart]);
    const checkpointCheckout = useCallback(() => {
        // Upgrade a restored v2 draft lacking an operation ID BEFORE any sale commit.
        // Failure to persist the identity must stop checkout, not permit a replay with a new ID.
        persistDraft(cartRef.current, discountRef.current);
        return operationRef.current;
    }, [persistDraft]);

    return (
        <CartContext.Provider value={{ cart, setCart, cartRef, loadCart, clearCart, pendingNavigate, setPendingNavigate,
            discount, setDiscount, operationId, checkpointCheckout, storageContext: context }}>
            {children}
        </CartContext.Provider>
    );
}
