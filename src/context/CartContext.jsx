import React, { createContext, useContext, useState, useRef, useEffect } from 'react';

const CartContext = createContext(null);

export function CartProvider({ children }) {
    const [cart, setCart] = useState([]);
    const cartRef = useRef(cart);
    useEffect(() => { cartRef.current = cart; }, [cart]);

    // Navegacion destino tras cargar carrito reciclado
    const [pendingNavigate, setPendingNavigate] = useState(null);

    // Estado del descuento global
    const [discount, setDiscount] = useState({ type: 'percentage', value: 0 });

    /**
     * Carga un carrito reciclado desde cualquier parte de la app.
     * @param {Array} items - Array de items de la venta original
     * @param {string} navigateTo - Tab destino (e.g. 'ventas')
     */
    const loadCart = (items, navigateTo = 'ventas') => {
        if (!Array.isArray(items) || items.length === 0) return;
        setCart(items.map(item => ({
            id: item.id,
            name: item.name,
            qty: Math.abs(item.qty),
            priceUsd: Math.abs(item.priceUsd),
            costBs: item.costBs || 0,
            costUsd: item.costUsd || 0,
            isWeight: item.isWeight || false,
        })));
        setPendingNavigate(navigateTo);
    };

    const clearCart = () => {
        setCart([]);
        setDiscount({ type: 'percentage', value: 0 });
    };

    return (
        <CartContext.Provider value={{ 
            cart, setCart, cartRef, loadCart, clearCart, 
            pendingNavigate, setPendingNavigate,
            discount, setDiscount
        }}>
            {children}
        </CartContext.Provider>
    );
}

export function useCart() {
    const ctx = useContext(CartContext);
    if (!ctx) throw new Error('useCart must be used within a CartProvider');
    return ctx;
}
