/**
 * Migración única: productos del inventario físico C&Y 2025 (15/08/2026)
 * que no están en el catálogo del sistema → sede central.
 *
 * Contexto: el inventario manuscrito de la sede central contiene ~1710 filas.
 * Lote 1: ~920 medicamentos sin equivalente en el sistema.
 * Lote 2: 271 insumos, filas dudosas y resto no cubierto (nombres tal cual
 *         aparecen en las hojas, precios en Bs convertidos a USD).
 *
 * Reglas de seguridad:
 * - Solo aplica a la sede central (C&Y 2025), nunca a norte/sur.
 * - No duplica: omite productos cuyo nombre ya existe en el catálogo
 *   (comparación por similitud, ej. "Anaxen fem" vs "Amaremfem").
 * - No borra ni modifica productos existentes del sistema.
 * - Corrige precios de productos del propio lote inv2026 si el dato
 *   fue ajustado (ej. precios en Bs convertidos a USD).
 * - Idempotente: usa bandera `farmacia_products_inv2026_migrated_v3`.
 *   v3 re-ejecuta la deduplicación contra el inventario actual y agrega
 *   los productos del lote que falten (repara migraciones parciales).
 */

import { getActiveAccountId } from '../config/storageScope.js';
import { storageService } from './storageService.js';
import { isSameProduct } from './productNameMatch.js';
import { SEED_PRODUCTS_INV01 } from '../config/seed/seedProductsInv01.js';
import { SEED_PRODUCTS_INV02 } from '../config/seed/seedProductsInv02.js';
import { SEED_PRODUCTS_INV03 } from '../config/seed/seedProductsInv03.js';

const MIGRATION_FLAG = 'farmacia_products_inv2026_migrated_v3';
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

        const incoming = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02, ...SEED_PRODUCTS_INV03];
        // Mapa barcode → datos corregidos (para corregir precios del lote 1 si ya se migró)
        const byBarcode = new Map(incoming.map(p => [p.barcode, p]));

        let fixed = 0;
        // 1) Corregir precios de productos ya migrados del lote inv2026
        //    (ej. los 8 precios que venían en Bs y se convirtieron a USD)
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

        // 2) Agregar los que falten (con deduplicación por similitud)
        const toAdd = [];
        let skipped = 0;
        for (const prod of incoming) {
            const exists = updatedList.some(p => isSameProduct(p.name, prod.name))
                || toAdd.some(p => isSameProduct(p.name, prod.name));
            if (exists) {
                skipped++;
                continue;
            }
            toAdd.push({ ...prod, id: `${INV_ID_PREFIX}${prod.barcode}` });
        }

        if (toAdd.length > 0 || fixed > 0) {
            await storageService.setItem(PRODUCTS_KEY, [...updatedList, ...toAdd], context);
        }

        localStorage.setItem(MIGRATION_FLAG, '1');
        console.log(`[Migración] Inventario 2026: ${toAdd.length} agregados, ${fixed} precios corregidos, ${skipped} omitidos por duplicado.`);

        return { migrated: toAdd.length > 0 || fixed > 0, added: toAdd.length, fixed, skipped, reason: 'ok' };
    } catch (error) {
        console.error('[Migración] Error migrando productos del inventario 2026:', error.message);
        return empty('error:' + error.message);
    }
}
