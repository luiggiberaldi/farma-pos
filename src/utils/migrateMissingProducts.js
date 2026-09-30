/**
 * Migración única: productos del inventario físico C&Y 2025 (15/08/2026)
 * que no están en el catálogo del sistema → sede central.
 *
 * Contexto: el inventario manuscrito de la sede central contiene ~1710 filas.
 * Tras comparar contra el catálogo del POS, ~920 medicamentos no tienen
 * equivalente en el sistema. Esta migración los agrega UNA sola vez.
 *
 * Reglas de seguridad:
 * - Solo aplica a la sede central (C&Y 2025), nunca a norte/sur.
 * - No duplica: omite productos cuyo nombre normalizado ya existe en el
 *   catálogo (el inventario manuscrito usa nombres comerciales distintos,
 *   ej. "Anaxen fem" vs "Amaremfem" del sistema).
 * - No borra ni modifica productos existentes.
 * - Idempotente: usa bandera `farmacia_products_inv2026_migrated_v1`.
 */

import { getActiveAccountId } from '../config/storageScope.js';
import { storageService } from './storageService.js';
import { isSameProduct } from './productNameMatch.js';
import { SEED_PRODUCTS_INV01 } from '../config/seed/seedProductsInv01.js';
import { SEED_PRODUCTS_INV02 } from '../config/seed/seedProductsInv02.js';

const MIGRATION_FLAG = 'farmacia_products_inv2026_migrated_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

/**
 * Ejecuta la migración si no se ha hecho antes.
 * @returns {Promise<{migrated: boolean, added: number, skipped: number, reason: string}>}
 */
export async function migrateMissingProducts() {
    try {
        const done = localStorage.getItem(MIGRATION_FLAG);
        if (done === '1') {
            return { migrated: false, added: 0, skipped: 0, reason: 'ya_migrado' };
        }
    } catch {
        return { migrated: false, added: 0, skipped: 0, reason: 'sin_localstorage' };
    }

    const accountId = getActiveAccountId();
    if (!accountId) {
        return { migrated: false, added: 0, skipped: 0, reason: 'sin_cuenta' };
    }

    try {
        // Productos actuales de central (sede-scoped)
        const context = { accountId, sedeId: 'central' };
        const current = await storageService.getItem(PRODUCTS_KEY, [], context).catch(() => []);
        const currentList = Array.isArray(current) ? current : [];

        const incoming = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02];
        const toAdd = [];
        let skipped = 0;

        for (const prod of incoming) {
            // Omitir si ya existe un producto igual o similar en el catálogo
            // o en el lote ya aceptado (evita duplicados por nombres
            // comerciales distintos del mismo medicamento)
            const exists = currentList.some(p => isSameProduct(p.name, prod.name))
                || toAdd.some(p => isSameProduct(p.name, prod.name));
            if (exists) {
                skipped++;
                continue;
            }
            toAdd.push({ ...prod, id: `inv2026-${prod.barcode}` });
        }

        if (toAdd.length > 0) {
            await storageService.setItem(PRODUCTS_KEY, [...currentList, ...toAdd], context);
        }

        localStorage.setItem(MIGRATION_FLAG, '1');
        console.log(`[Migración] ${toAdd.length} productos del inventario 2026 agregados a central, ${skipped} omitidos por duplicado.`);

        return { migrated: toAdd.length > 0, added: toAdd.length, skipped, reason: 'ok' };
    } catch (error) {
        console.error('[Migración] Error migrando productos del inventario 2026:', error.message);
        return { migrated: false, added: 0, skipped: 0, reason: 'error:' + error.message };
    }
}
