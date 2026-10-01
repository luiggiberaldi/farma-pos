import { BODEGA_CATEGORIES } from './categories.js';
import { getActiveSedeId } from './storageScope.js';
import { TEST_SEED_PRODUCTS } from './seed/testSeedProducts.js';
import { SEED_PRODUCTS_01 } from './seed/seedProducts01.js';
import { SEED_PRODUCTS_02 } from './seed/seedProducts02.js';
import { SEED_PRODUCTS_03 } from './seed/seedProducts03.js';
import { SEED_PRODUCTS_04 } from './seed/seedProducts04.js';
import { SEED_PRODUCTS_05 } from './seed/seedProducts05.js';
import { SEED_PRODUCTS_06 } from './seed/seedProducts06.js';
import { SEED_PRODUCTS_07 } from './seed/seedProducts07.js';
import { SEED_PRODUCTS_08 } from './seed/seedProducts08.js';
import { SEED_PRODUCTS_09 } from './seed/seedProducts09.js';
import { SEED_PRODUCTS_10 } from './seed/seedProducts10.js';
import { SEED_PRODUCTS_11 } from './seed/seedProducts11.js';
import { SEED_PRODUCTS_12 } from './seed/seedProducts12.js';
import { SEED_PRODUCTS_13 } from './seed/seedProducts13.js';
import { SEED_PRODUCTS_14 } from './seed/seedProducts14.js';
import { SEED_PRODUCTS_15 } from './seed/seedProducts15.js';
import { SEED_PRODUCTS_16 } from './seed/seedProducts16.js';
import { SEED_PRODUCTS_17 } from './seed/seedProducts17.js';
// Catálogo consolidado oficial Farmacia & Casa Médica C&Y 2025
// Total: 666 artículos digitalizados y auditados con fotos reales
// Datos divididos en módulos seed/seedProductsNN.js
export const INITIAL_PHARMACY_PRODUCTS = [
    ...SEED_PRODUCTS_01,
    ...SEED_PRODUCTS_02,
    ...SEED_PRODUCTS_03,
    ...SEED_PRODUCTS_04,
    ...SEED_PRODUCTS_05,
    ...SEED_PRODUCTS_06,
    ...SEED_PRODUCTS_07,
    ...SEED_PRODUCTS_08,
    ...SEED_PRODUCTS_09,
    ...SEED_PRODUCTS_10,
    ...SEED_PRODUCTS_11,
    ...SEED_PRODUCTS_12,
    ...SEED_PRODUCTS_13,
    ...SEED_PRODUCTS_14,
    ...SEED_PRODUCTS_15,
    ...SEED_PRODUCTS_16,
    ...SEED_PRODUCTS_17,
];

// ─── Siembra y migración de farmacia ───
// Se ejecuta en el arranque del Inventario (ProductContext) sobre la sede activa.
// POLÍTICA DE INVENTARIOS AISLADOS:
// - El catálogo base solo se siembra en la sede matriz (C&Y 2025). Las demás
//   sedes nacen vacías: su inventario lo carga y edita el dueño sede por sede.
// - Cada sede marca `farmacia_seed_done_v1` al sembrar (o al vaciar con
//   "Borrar Todo"); una sede marcada jamás se re-siembra, así "Borrar Todo"
//   es permanente y nunca se rellenan sedes que el dueño ya configuró.
// - Migra categorías heredadas de la app de repuestos (Charcutería, Cauchos,
//   etc.) a las categorías reales de farmacia. Idempotente: nunca toca datos
//   existentes ni re-siembra sobre inventario no vacío.

export const SEED_HOME_SEDE_ID = 'central';
export const SEED_DONE_KEY = 'farmacia_seed_done_v1';

const LEGACY_CATEGORY_IDS = ['motor', 'electrico', 'carroceria', 'transmision', 'frenos', 'cauchos', 'suspension', 'escape', 'accesorios', 'aceites', 'baterias', 'guayas', 'bebidas', 'limpieza', 'charcuteria', 'snacks', 'granos', 'lacteos', 'carnes', 'verduras', 'panaderia', 'viveres'];

const m = s => (typeof s === 'string' && s.trim()) ? s.trim() : null;
const d = (value, fallback) => { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : fallback; };

export function buildSeedProduct(item, index) {    const stock = Math.max(0, Math.round(d(item.stock, 0)));
    return {
        id: `seed-${index + 1}`,
        name: item.name,
        barcode: m(item.barcode || item.barCode),
        priceUsd: d(item.priceUsd, 1),
        costUsd: d(item.costUsd, 0),
        costBs: 0,
        stock,
        stockUnit: 'base',
        quantitySchemaVersion: 1,
        unit: 'unidad',
        packagingType: 'suelto',
        unitsPerPackage: 1,
        sellByUnit: false,
        unitPriceUsd: null,
        stockInLotes: null,
        category: m(item.category) || 'otros',
        lowStockAlert: 5,
        genericName: m(item.genericName),
        laboratorio: m(item.laboratorio),
        concentracion: m(item.concentracion),
        presentacion: m(item.presentacion),
        requiresPrescription: Boolean(item.requiresPrescription),
        isControlled: Boolean(item.isControlled),
        requiresRefrigeration: Boolean(item.requiresRefrigeration),
        vencimiento: null,
        image: m(item.image),
    };
}

function buildSeedLots(products, seedDate) {
    const lots = [];
    for (const p of products) {
        if (p.stock <= 0) continue;
        const half = Math.floor(p.stock / 2) || 1;
        lots.push({
            id: `seedlot-${p.id}-a`,
            productoId: p.id,
            numeroLote: `L-${p.id}-A`,
            cantidad: half,
            vencimiento: `${seedDate.getFullYear() + 1}-12-31`,
            createdAt: seedDate.toISOString(),
        });
        const rest = p.stock - half;
        if (rest > 0) {
            lots.push({
                id: `seedlot-${p.id}-b`,
                productoId: p.id,
                numeroLote: `L-${p.id}-B`,
                cantidad: rest,
                vencimiento: `${seedDate.getFullYear() + 2}-12-31`,
                createdAt: seedDate.toISOString(),
            });
        }
    }
    return lots;
}

function isLegacyCategories(list) {
    return Array.isArray(list) && list.some(c => LEGACY_CATEGORY_IDS.includes(c && c.id));
}

// Marca una sede como configurada: jamás volverá a sembrarse aunque el
// dueño vacíe su inventario con "Borrar Todo". ProductContext la invoca
// también al vaciar el inventario para hacer el borrado permanente.
export async function markSeedDone(storageService, context) {
    const sedeId = context?.sedeId || getActiveSedeId();
    if (!sedeId) return;
    await storageService.setItem(SEED_DONE_KEY, { [sedeId]: true }, context);
}

export async function seedPharmacyInventoryIfEmpty(storageService, context) {
    const sedeId = context?.sedeId || getActiveSedeId();
    // Migración de categorías heredadas de repuestos -> farmacia (una sola vez por sede).
    const savedCategories = await storageService.getItem('my_categories_v1', null, context);
    if (isLegacyCategories(savedCategories)) {
        await storageService.setItem('my_categories_v1', BODEGA_CATEGORIES, context);
    }
    const savedProducts = await storageService.getItem('bodega_products_v1', null, context);
    if (Array.isArray(savedProducts) && savedProducts.length > 0) return false;
    // Sedes norte/sur: inventario de PRUEBA (30 productos) para validar flujos.
    // Solo se aplica una vez; si el dueño vacía con "Borrar Todo", queda vacío.
    if (sedeId === 'norte' || sedeId === 'sur') {
        return await seedTestInventory(storageService, context, sedeId);
    }
    // Solo la sede matriz recibe el catálogo base; las demás nacen vacías y
    // quedan marcadas para que el vaciado del dueño sea permanente.
    if (sedeId !== SEED_HOME_SEDE_ID) {
        await markSeedDone(storageService, context);
        return false;
    }
    // Una sede matriz ya configurada (o vaciada a propósito) no se toca nunca.
    const seedState = await storageService.getItem(SEED_DONE_KEY, null, context);
    if (seedState?.[sedeId] === true) return false;
    const products = INITIAL_PHARMACY_PRODUCTS.map(buildSeedProduct);
    const seedDate = new Date();
    const lots = buildSeedLots(products, seedDate);
    await storageService.transaction([
        { name: 'products', key: 'bodega_products_v1', fallback: [] },
        { name: 'categories', key: 'my_categories_v1', fallback: BODEGA_CATEGORIES },
        { name: 'lots', key: 'farmacia_lotes_v1', fallback: [] },
        { name: 'seedDone', key: SEED_DONE_KEY, fallback: null },
    ], current => {
        // Doble verificación dentro de la transacción: otra pestaña pudo sembrar.
        if (Array.isArray(current.products) && current.products.length > 0) return { writes: {} };
        const priorSeedState = current.seedDone && typeof current.seedDone === 'object' ? current.seedDone : {};
        return {
            writes: {
                products,
                categories: isLegacyCategories(current.categories) ? BODEGA_CATEGORIES : current.categories,
                lots: Array.isArray(current.lots) && current.lots.length > 0 ? current.lots : lots,
                seedDone: { ...priorSeedState, [sedeId]: true },
            },
        };
    }, context);
    return true;
}

// ─── Inventario de prueba para sedes norte/sur ───
// Siembra 30 productos de prueba una sola vez por sede. Usa bandera propia
// (TEST_SEED_DONE_KEY) para no chocar con el marcado anterior que las dejaba vacías.
const TEST_SEED_DONE_KEY = 'farmacia_test_seed_done_v1';
export { TEST_SEED_DONE_KEY };
async function seedTestInventory(storageService, context, sedeId) {
    const testSeedState = await storageService.getItem(TEST_SEED_DONE_KEY, null, context);
    if (testSeedState?.[sedeId] === true) return false;
    const products = TEST_SEED_PRODUCTS.map((item, index) => ({
        ...buildSeedProduct(item, index),
        id: `test-${sedeId}-${index + 1}`,
    }));
    const seedDate = new Date();
    const lots = buildSeedLots(products, seedDate);
    await storageService.transaction([
        { name: 'products', key: 'bodega_products_v1', fallback: [] },
        { name: 'categories', key: 'my_categories_v1', fallback: BODEGA_CATEGORIES },
        { name: 'lots', key: 'farmacia_lotes_v1', fallback: [] },
        { name: 'testSeedDone', key: TEST_SEED_DONE_KEY, fallback: null },
    ], current => {
        if (Array.isArray(current.products) && current.products.length > 0) return { writes: {} };
        const priorTestSeedState = current.testSeedDone && typeof current.testSeedDone === 'object' ? current.testSeedDone : {};
        return {
            writes: {
                products,
                categories: isLegacyCategories(current.categories) ? BODEGA_CATEGORIES : current.categories,
                lots: Array.isArray(current.lots) && current.lots.length > 0 ? current.lots : lots,
                testSeedDone: { ...priorTestSeedState, [sedeId]: true },
            },
        };
    }, context);
    return true;
}

export const CATALOG_BUILD_VERSION = '2026.09.16.v4';
export const CATALOG_VERSION_KEY = 'pharmacy_catalog_version_v1';

export async function upgradePharmacyCatalogIfNeeded(storageService, context, force = false) {
    const sedeId = context?.sedeId || getActiveSedeId();
    if (sedeId !== SEED_HOME_SEDE_ID) return false;

    const savedProducts = await storageService.getItem('bodega_products_v1', null, context);
    if (!Array.isArray(savedProducts) || savedProducts.length === 0) return false;

    const currentVersion = await storageService.getItem(CATALOG_VERSION_KEY, null, context);
    const hasSvgImages = savedProducts.some(p => p.image && p.image.startsWith('data:image'));
    const hasGenericNames = savedProducts.some(p => p.name && (p.name.startsWith('Genérico') || p.name.startsWith('Generico')));
    const isOldVersion = currentVersion !== CATALOG_BUILD_VERSION;

    if (!force && !hasSvgImages && !hasGenericNames && !isOldVersion) {
        return false;
    }

    const seedMapByBarcode = new Map();
    const seedMapById = new Map();
    for (const p of INITIAL_PHARMACY_PRODUCTS) {
        if (p.barcode) seedMapByBarcode.set(p.barcode, p);
        if (p.id) seedMapById.set(p.id, p);
    }

    const updatedProducts = savedProducts.map(p => {
        const seed = seedMapByBarcode.get(p.barcode) || seedMapById.get(p.id);
        if (!seed) return p;
        return {
            ...p,
            name: seed.name,
            genericName: seed.genericName || p.genericName,
            laboratorio: seed.laboratorio || p.laboratorio,
            concentracion: seed.concentracion || p.concentracion,
            presentacion: seed.presentacion || p.presentacion,
            image: `/products/${seed.barcode}.jpg`,
            category: seed.category || p.category,
            priceUsd: (p.priceUsd > 0) ? p.priceUsd : (seed.priceUsd || 1.0),
        };
    });

    await storageService.setItem('bodega_products_v1', updatedProducts, context);
    await storageService.setItem(CATALOG_VERSION_KEY, CATALOG_BUILD_VERSION, context);
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_products_v1' } }));
    }
    return true;
}
