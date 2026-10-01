/**
 * Migración única: catálogo completo de la sede central (C&Y 2025).
 *
 * Contexto: el catálogo base (666 productos) + el inventario manuscrito
 * 2026 (lotes inv01/inv02/inv03) deben sumar ~1560 productos únicos en
 * central. En algunos equipos la migración v1–v3 corrió sobre un catálogo
 * vacío y solo dejó los 963 del manuscrito (sin el catálogo base).
 *
 * v4 repara eso de forma idempotente: construye el conjunto deseado
 * (base + manuscrito), deduplica por similitud de nombre contra el
 * inventario actual y agrega solo los que falten. No borra ni modifica
 * productos existentes (salvo la corrección de precios del propio lote
 * inv2026, heredada de v2).
 *
 * Reglas de seguridad:
 * - Solo aplica a la sede central, nunca a norte/sur.
 * - No duplica: omite productos cuyo nombre ya existe (similitud ≥ 0.6).
 * - Idempotente: bandera `farmacia_products_inv2026_migrated_v4`.
 */

import { getActiveAccountId } from '../config/storageScope.js';
import { storageService } from './storageService.js';
import { isSameProduct } from './productNameMatch.js';
import { INITIAL_PHARMACY_PRODUCTS, buildSeedProduct } from '../config/pharmacySeed.js';
import { SEED_PRODUCTS_INV01 } from '../config/seed/seedProductsInv01.js';
import { SEED_PRODUCTS_INV02 } from '../config/seed/seedProductsInv02.js';
import { SEED_PRODUCTS_INV03 } from '../config/seed/seedProductsInv03.js';

const MIGRATION_FLAG = 'farmacia_products_inv2026_migrated_v4';
const PRODUCTS_KEY = 'bodega_products_v1';
const INV_ID_PREFIX = 'inv2026-';

/**
 * Ejecuta la migración si no se ha hecho antes.
 * @returns {Promise<{migrated: boolean, added: number, fixed: number, skipped: number, reason: string}>}
 */
export async function migrateMissingProducts() {
    const empty = (reason) => ({ migrated: false, added: 0, fixed: 0, skipped: 0, reason });
    try {
        if (localStorage.getItem(MIGRATION_FLAG) === '1') {
            return empty('ya_migrado');
        }
    } catch {
        return empty('sin_localstorage');
    }

    const accountId = getActiveAccountId();
    if (!accountId) {
        return empty('sin_cuenta');
    }

    try {
        const context = { accountId, sedeId: 'central' };
        const current = await storageService.getItem(PRODUCTS_KEY, [], context).catch(() => []);
        const currentList = Array.isArray(current) ? current : [];

        // Conjunto deseado: catálogo base + inventario manuscrito 2026.
        const base = INITIAL_PHARMACY_PRODUCTS.map((item, i) => buildSeedProduct(item, i));
        const invLotes = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02, ...SEED_PRODUCTS_INV03];
        // Mapa barcode → datos del lote inv2026 (para corregir precios si ya se migró)
        const byBarcode = new Map(invLotes.map(p => [p.barcode, p]));

        let fixed = 0;
        // 1) Corregir precios de productos ya migrados del lote inv2026
        const updatedList = currentList.map(p => {
            if (typeof p.id === 'string' && p.id.startsWith(INV_ID_PREFIX)) {
                const ref = byBarcode.get(p.barcode);
                if (ref && (p.priceUsd !== ref.priceUsd || p.costUsd !== ref.costUsd)) {
                    fixed++;
                    return { ...p, priceUsd: ref.priceUsd, costUsd: ref.costUsd };
                }
            }
            return p;
        });

        // 2) Agregar los que falten (con deduplicación por similitud).
        //    Dos fases para replicar la semántica original: el catálogo base
        //    es el conjunto de referencia (fase A: cada producto base solo se
        //    compara contra el inventario actual, nunca contra otros de la
        //    base); el manuscrito se deduplica contra todo lo anterior
        //    (fase B).
        const toAdd = [];
        let skipped = 0;
        for (const prod of base) {
            if (updatedList.some(p => isSameProduct(p.name, prod.name))) { skipped++; continue; }
            toAdd.push(prod);
        }
        for (const prod of invLotes) {
            const exists = updatedList.some(p => isSameProduct(p.name, prod.name))
                || toAdd.some(p => isSameProduct(p.name, prod.name));
            if (exists) { skipped++; continue; }
            toAdd.push({ ...prod, id: `${INV_ID_PREFIX}${prod.barcode}` });
        }

        if (toAdd.length > 0 || fixed > 0) {
            await storageService.setItem(PRODUCTS_KEY, [...updatedList, ...toAdd], context);
        }

        localStorage.setItem(MIGRATION_FLAG, '1');
        console.log(`[Migración] Catálogo central v4: ${toAdd.length} agregados, ${fixed} precios corregidos, ${skipped} omitidos por duplicado.`);

        return { migrated: toAdd.length > 0 || fixed > 0, added: toAdd.length, fixed, skipped, reason: 'ok' };
    } catch (error) {
        console.error('[Migración] Error migrando catálogo central:', error.message);
        return empty('error:' + error.message);
    }
}
