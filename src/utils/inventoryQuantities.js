// Quantities are stored as base units (or kg/litre for bulk), never a mixture
// of package counts and units. Old ambiguous package stock is not auto-scaled.
export const QUANTITY_SCALE = 1000;
export const quantityRound = value => Math.round((value + Number.EPSILON) * QUANTITY_SCALE) / QUANTITY_SCALE;
export const productIdentity = item => String(item.productId ?? item._originalId ?? item.id ?? '');
export const isBulkProduct = product => product.packagingType === 'granel' || ['kg', 'litro'].includes(product.unit);
export const isPackageProduct = product => product.packagingType === 'lote' || product.unit === 'paquete';

export function packageFactor(product) {
    const factor = isPackageProduct(product) ? Number(product.unitsPerPackage) : 1;
    if (!Number.isSafeInteger(factor) || factor < 1) throw new Error('El producto tiene un factor de empaque inválido. Corrígelo antes de vender.');
    return factor;
}

export function quantityInBase(item, product) {
    const qty = Number(item.qty);
    if (!Number.isFinite(qty) || qty <= 0 || qty !== quantityRound(qty)) throw new Error('Cantidad inválida: usa hasta tres decimales.');
    if (!isBulkProduct(product) && !Number.isSafeInteger(qty)) throw new Error('Los productos por unidad o empaque requieren cantidades enteras.');
    const mode = item.mode || item._mode || (isBulkProduct(product) ? 'weight' : isPackageProduct(product) ? 'package' : 'unit');
    if (!['package', 'unit', 'weight'].includes(mode)) throw new Error('Presentación de venta inválida.');
    if (mode === 'weight' && !isBulkProduct(product)) throw new Error('Este producto no admite venta por peso.');
    if (mode === 'unit' && isPackageProduct(product) && !product.sellByUnit) throw new Error('El producto no está habilitado para venta fraccionada.');
    const factor = mode === 'package' ? packageFactor(product) : 1;
    return { mode, factor, quantityBase: quantityRound(qty * factor) };
}

export function assertUsableStock(product) {
    const stock = Number(product.stock);
    if (!Number.isFinite(stock) || stock < 0 || stock !== quantityRound(stock)) throw new Error(`Existencia inválida de ${product.name || product.id}. Requiere conciliación.`);
    if (isPackageProduct(product) && product.stockUnit !== 'base') {
        throw new Error(`Confirma las unidades base de ${product.name || product.id} en Inventario. No se convertirá stock legado automáticamente.`);
    }
    return stock;
}

export function consumeLots(lots, deductions, products, today) {
    const updated = structuredClone(lots);
    const consumed = [];
    for (const [productId, required] of Object.entries(deductions)) {
        const product = products.find(item => String(item.id) === productId);
        const all = updated.filter(lot => String(lot.productoId) === productId);
        const tracked = all.length > 0 || product?.tracksLots === true || product?.lotTracked === true;
        if (!tracked) continue;
        let remaining = required;
        const available = all.filter(lot => {
            if (!Number.isFinite(lot.cantidad) || lot.cantidad < 0) throw new Error('Un lote contiene una cantidad inválida.');
            if (!/^\d{4}-\d{2}-\d{2}$/.test(lot.vencimiento || '')) return false;
            return lot.vencimiento > today && lot.cantidad > 0;
        }).sort((a, b) => a.vencimiento.localeCompare(b.vencimiento) || String(a.id).localeCompare(String(b.id)));
        for (const lot of available) {
            const taken = quantityRound(Math.min(lot.cantidad, remaining));
            if (taken <= 0) continue;
            lot.cantidad = quantityRound(lot.cantidad - taken);
            remaining = quantityRound(remaining - taken);
            consumed.push({ loteId: lot.id, productoId: productId, cantidad: taken, numeroLote: lot.numeroLote || '', vencimiento: lot.vencimiento });
            if (remaining <= 0) break;
        }
        if (remaining > 0) throw new Error(`Lotes vigentes insuficientes de ${product?.name || productId}. La venta no fue registrada.`);
    }
    return { lots: updated, consumed };
}
