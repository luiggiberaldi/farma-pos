import { SEED_PRODUCTS_CENTRAL01 } from '../config/seed/seedProductsCentral01.js';
import { storageService } from './storageService.js';
import { getActiveAccountId } from '../config/storageScope.js';

const PRODUCTS_KEY = 'bodega_products_v1';
const FLAG = 'farmacia_products_central_inv2025_migrated_v1';
export const CENTRAL_SEED_COUNT = SEED_PRODUCTS_CENTRAL01.length;

/**
 * Migración única: reemplaza el catálogo de la sede central (C&Y 2025) por el
 * inventario físico real transcrito de las 41 hojas manuscritas (2026-10-01).
 *
 * Es un REEMPLAZO, no un merge: la sede central tenía el inventario de
 * Farmacia Las 24 Horas (1539 productos), que ya vive en la sede sur y no
 * debe resucitar aquí. Corre una sola vez por equipo (bandera en
 * localStorage). Es idempotente: si ya corrió, no hace nada.
 *
 * Los productos no traen costUsd porque las hojas no traen costo.
 * Los productos sin precio legible quedan en priceUsd=0 (el guardarraíl del
 * POS bloquea su venta hasta que el dueño les ponga precio).
 *
 * Al reemplazar, pone el flag `skip_cloud_pull` de sessionStorage: el pull
 * inicial del sync de este arranque se omite y el catch-up push sube los 807
 * productos tal cual a la nube (upsert de documento completo). Sin esto, el
 * pull podría fusionar el catálogo viejo con el inventario real.
 */
export async function migrateCentralInventory() {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1') {
    return { skipped: true };
  }
  const accountId = getActiveAccountId();
  const context = accountId ? { accountId, sedeId: 'central' } : { sedeId: 'central' };
  const products = SEED_PRODUCTS_CENTRAL01.map((p) => ({
    ...p,
    sedeId: 'central',
    updatedAt: new Date().toISOString(),
  }));
  await storageService.setItem(PRODUCTS_KEY, products, context);
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(FLAG, '1');
  }
  if (typeof sessionStorage !== 'undefined') {
    sessionStorage.setItem('skip_cloud_pull', '1');
  }
  return { replaced: true, count: products.length };
}

export function isCentralInventoryMigrated() {
  return typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1';
}
