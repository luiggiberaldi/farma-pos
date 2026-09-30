import { round2, mulR, divR } from './dinero';

const number = (value, fallback = 0) => value === '' || value == null ? fallback : Number(value);
export function buildProductPayload(formData, effectiveRate) {
    const { name, barcode, priceUsd, priceBs, costUsd, costBs, stock, stockInLotes,
        packagingType = 'suelto', unitsPerPackage, granelUnit = 'kg', sellByUnit, unitPriceUsd,
        category, lowStockAlert, genericName, laboratorio, concentracion, presentacion,
        requiresPrescription, isControlled, requiresRefrigeration, vencimiento } = formData;
    if (typeof name !== 'string' || !name.trim()) throw new Error('El nombre del producto es obligatorio.');
    if (!['suelto', 'lote', 'granel'].includes(packagingType)) throw new Error('Presentación inválida.');
    const validRate = Number.isFinite(effectiveRate) && effectiveRate > 0;
    if ((!priceUsd && priceBs || !costUsd && costBs) && !validRate) throw new Error('Fija una tasa válida para convertir los precios.');
    const finalPriceUsd = priceUsd ? number(priceUsd) : divR(number(priceBs), effectiveRate);
    const finalCostUsd = costUsd ? number(costUsd) : costBs ? divR(number(costBs), effectiveRate) : 0;
    const finalCostBs = costBs ? number(costBs) : costUsd && validRate ? mulR(number(costUsd), effectiveRate) : 0;
    if (!Number.isFinite(finalPriceUsd) || finalPriceUsd <= 0 || ![finalCostUsd, finalCostBs].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Precio o costo inválido.');
    const isLote = packagingType === 'lote';
    const factor = isLote ? number(unitsPerPackage) : 1;
    if (!Number.isSafeInteger(factor) || factor < 1) throw new Error('Las unidades por empaque deben ser un entero positivo.');
    if (packagingType === 'granel' && !['kg', 'litro'].includes(granelUnit)) throw new Error('Unidad de granel inválida.');
    // An explicit package-count input is converted once. The resulting stock
    // and all future edits are expressed in base units, never cached pack counts.
    const packages = stockInLotes !== '' && stockInLotes != null ? number(stockInLotes) : null;
    if (packages !== null && (!Number.isSafeInteger(packages) || packages < 0)) throw new Error('Cantidad de empaques inválida.');
    const finalStock = isLote && packages !== null ? packages * factor : number(stock);
    if (!Number.isFinite(finalStock) || finalStock < 0 || finalStock !== Math.round(finalStock * 1000) / 1000
        || packagingType !== 'granel' && !Number.isSafeInteger(finalStock)) throw new Error('El stock debe indicar unidades físicas válidas; granel admite hasta tres decimales.');
    const finalUnitPrice = unitPriceUsd ? number(unitPriceUsd) : divR(finalPriceUsd, factor);
    if (isLote && sellByUnit && (!Number.isFinite(finalUnitPrice) || finalUnitPrice <= 0)) throw new Error('Precio por unidad inválido.');
    const alert = number(lowStockAlert, 5);
    if (!Number.isFinite(alert) || alert < 0) throw new Error('Alerta de stock inválida.');
    if (vencimiento && (!/^\d{4}-\d{2}-\d{2}$/.test(vencimiento) || new Date(vencimiento + 'T12:00:00Z').toISOString().slice(0, 10) !== vencimiento)) throw new Error('Fecha de vencimiento inválida.');
    const clean = value => typeof value === 'string' && value.trim() ? value.trim() : null;
    return {
        name: name.trim().replace(/(^[\p{L}\p{N}])|(\s+[\p{L}\p{N}])/gu, letter => letter.toUpperCase()),
        barcode: clean(barcode), priceUsd: finalPriceUsd, costUsd: finalCostUsd, costBs: finalCostBs,
        stock: finalStock, stockUnit: 'base', quantitySchemaVersion: 1,
        unit: isLote ? 'paquete' : packagingType === 'granel' ? granelUnit : 'unidad',
        packagingType, unitsPerPackage: factor, sellByUnit: isLote && Boolean(sellByUnit),
        unitPriceUsd: isLote && sellByUnit ? finalUnitPrice : null, stockInLotes: null,
        category: category || 'otros', lowStockAlert: alert,
        genericName: clean(genericName), laboratorio: clean(laboratorio), concentracion: clean(concentracion), presentacion: clean(presentacion),
        requiresPrescription: Boolean(requiresPrescription), isControlled: Boolean(isControlled), requiresRefrigeration: Boolean(requiresRefrigeration),
        vencimiento: vencimiento || null,
    };
}
