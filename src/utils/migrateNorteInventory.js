import { SEED_PRODUCTS_NORTE01 } from '../config/seed/seedProductsNorte01.js';
import { storageService } from './storageService.js';
import { getActiveAccountId } from './userProvisioning.js';

const PRODUCTS_KEY = 'bodega_products_v1';
const FLAG = 'farmacia_products_norte_inv2026_migrated_v1';
export const NORTE_SEED_COUNT = SEED_PRODUCTS_NORTE01.length;

/**
 * Migración única: reemplaza el catálogo de la sede norte (C&Y 2026) por el
 * inventario físico real transcrito de las 25 hojas manuscritas (2026-10-01).
 *
 * Es un REEMPLAZO, no un merge: la sede norte tenía un catálogo de prueba de
 * ~30 productos que debe desaparecer. Corre una sola vez por equipo
 * (bandera en localStorage). Es idempotente: si ya corrió, no hace nada.
 *
 * Los productos no traen costUsd porque las hojas no traen costo.
 * Los productos sin precio legible quedan en priceUsd=0 (el guardarraíl del
 * POS bloquea su venta hasta que el dueño les ponga precio).
 *
 * Al reemplazar, pone el flag `skip_cloud_pull` de sessionStorage: el pull
 * inicial del sync de este arranque se omite y el catch-up push sube los 506
 * productos tal cual a la nube. Sin esto, el pull podría fusionar el catálogo
 * de prueba con el inventario real y los productos de prueba quedarían
 * inmortalizados en el documento nube (el merge por ID es unión).
 */
export async function migrateNorteInventory() {
  if (typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1') {
    return { skipped: true };
  }
  const accountId = getActiveAccountId();
  const context = accountId ? { accountId, sedeId: 'norte' } : { sedeId: 'norte' };
  const products = SEED_PRODUCTS_NORTE01.map((p) => ({
    ...p,
    sedeId: 'norte',
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

export function isNorteInventoryMigrated() {
  return typeof localStorage !== 'undefined' && localStorage.getItem(FLAG) === '1';
}
