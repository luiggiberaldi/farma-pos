/**
 * Normalización del precio principal del producto.
 *
 * El precio principal del sistema es USD (campo `priceUsd`).
 * Versiones anteriores guardaban el precio como `priceUsdt` (nombre
 * heredado y confuso: el sistema no trabaja con USDT). Esta función
 * migra el valor al cargar, sin tocar el resto del producto.
 *
 * @param {object} p Producto tal como está guardado
 * @returns {object} Producto con `priceUsd` garantizado si había precio
 */
export function normalizeProductPrice(p) {
    if (!p || typeof p !== 'object') return p;
    const legacy = Number(p.priceUsdt);
    const current = Number(p.priceUsd);
    if ((!Number.isFinite(current) || current <= 0) && Number.isFinite(legacy) && legacy > 0) {
        return { ...p, priceUsd: legacy };
    }
    return p;
}

/**
 * ¿El producto tiene un precio de venta válido?
 * El guardarraíl de venta usa esta función: sin precio válido (> 0 USD)
 * el producto no entra al carrito ni se puede cobrar.
 *
 * @param {object} p Producto (o item de carrito con priceUsd)
 * @returns {boolean}
 */
export function hasValidSalePrice(p) {
    if (!p || typeof p !== 'object') return false;
    const price = Number(p.priceUsd);
    return Number.isFinite(price) && price > 0;
}
