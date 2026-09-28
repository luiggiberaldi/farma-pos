export function discountAuthorizationDetails({ type, value, cartSubtotalUsd, cart }) {
    if (!['percentage', 'fixed'].includes(type) || !Number.isFinite(value) || value < 0
        || !Number.isFinite(cartSubtotalUsd) || cartSubtotalUsd <= 0
        || (type === 'percentage' && value > 100) || (type === 'fixed' && value > cartSubtotalUsd)
        || !Array.isArray(cart)) throw new Error('Descuento inválido.');
    return {
        type, value, cartSubtotalUsd,
        cart: cart.map(item => ({ id: String(item._originalId || item.id), qty: item.qty, priceUsd: item.priceUsd, mode: item._mode || '' })),
    };
}
