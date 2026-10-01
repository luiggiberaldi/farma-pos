/**
 * Tests para migrateNorteInventory.js
 * Verifica que la migración del inventario físico C&Y 2026 a norte sea un
 * REEMPLAZO seguro:
 * - Sobrescribe el catálogo de prueba de norte con los 506 productos reales
 * - No toca central ni sur
 * - Es idempotente (segunda corrida no hace nada)
 * - Todos los productos quedan con sedeId 'norte', IDs y barcodes únicos
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert';
import { loadRealModule } from './helpers/realModule.mjs';

const localStorageMock = (() => {
    let store = {};
    return {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { store = {}; },
    };
})();
global.localStorage = localStorageMock;

const mockAccountId = 'test-account-norte';
const NORTE_KEY = `account:${mockAccountId}:sede:norte:bodega_products_v1`;

async function loadMigration(records) {
    const mocks = {
        'src/utils/storageService.js': `
            const records = globalThis.__norteTestRecords;
            const SEDE_SCOPED = new Set(['bodega_products_v1']);
            const scopedKey = (key, context) => {
                const prefix = context && context.accountId ? 'account:' + context.accountId + ':' : 'unscoped:';
                return SEDE_SCOPED.has(key) && context && context.sedeId
                    ? prefix + 'sede:' + context.sedeId + ':' + key
                    : prefix + key;
            };
            export const storageService = {
                async getItem(key, def, context) { return structuredClone(records.get(scopedKey(key, context)) ?? def ?? null); },
                async setItem(key, value, context) { records.set(scopedKey(key, context), structuredClone(value)); return value; },
            };`,
        'src/utils/userProvisioning.js': `
            export const getActiveAccountId = () => ${JSON.stringify(mockAccountId)};`,
    };
    globalThis.__norteTestRecords = records;
    return loadRealModule('src/utils/migrateNorteInventory.js', mocks);
}

// La semilla es un módulo de datos puro: se importa directo
const { SEED_PRODUCTS_NORTE01 } = await import('../src/config/seed/seedProductsNorte01.js');

describe('seed norte 2026', () => {
    it('tiene 506 productos con IDs y barcodes únicos', () => {
        assert.equal(SEED_PRODUCTS_NORTE01.length, 506);
        assert.equal(new Set(SEED_PRODUCTS_NORTE01.map((p) => p.id)).size, 506);
        assert.equal(new Set(SEED_PRODUCTS_NORTE01.map((p) => p.barcode)).size, 506);
        assert.ok(SEED_PRODUCTS_NORTE01.every((p) => p.id.startsWith('inv2026n-')));
        assert.ok(SEED_PRODUCTS_NORTE01.every((p) => typeof p.priceUsd === 'number' && typeof p.stock === 'number'));
    });
});

describe('migrateNorteInventory', () => {
    let records;
    beforeEach(() => {
        localStorageMock.clear();
        records = new Map();
        // Catálogo de prueba preexistente en norte + datos en central/sur
        records.set(NORTE_KEY, [
            { id: 'test-1', name: 'Producto Prueba 1', priceUsd: 1, stock: 5, sedeId: 'norte' },
            { id: 'test-2', name: 'Producto Prueba 2', priceUsd: 2, stock: 3, sedeId: 'norte' },
        ]);
        records.set(`account:${mockAccountId}:sede:central:bodega_products_v1`, [{ id: 'c-1', name: 'Central Prod' }]);
        records.set(`account:${mockAccountId}:sede:sur:bodega_products_v1`, [{ id: 's-1', name: 'Sur Prod' }]);
    });

    it('reemplaza el catálogo de prueba de norte con el inventario real', async () => {
        const { migrateNorteInventory, NORTE_SEED_COUNT } = await loadMigration(records);
        const res = await migrateNorteInventory();
        assert.equal(res.replaced, true);
        assert.equal(res.count, NORTE_SEED_COUNT);
        assert.equal(NORTE_SEED_COUNT, 506);
        const prods = records.get(NORTE_KEY);
        assert.equal(prods.length, 506);
        assert.ok(!prods.some((p) => p.id === 'test-1' || p.id === 'test-2'), 'el catálogo de prueba debe desaparecer');
        assert.ok(prods.every((p) => p.sedeId === 'norte'));
        assert.equal(new Set(prods.map((p) => p.id)).size, prods.length);
        assert.equal(new Set(prods.map((p) => p.barcode)).size, prods.length);
    });

    it('no toca central ni sur', async () => {
        const { migrateNorteInventory } = await loadMigration(records);
        await migrateNorteInventory();
        assert.equal(records.get(`account:${mockAccountId}:sede:central:bodega_products_v1`).length, 1);
        assert.equal(records.get(`account:${mockAccountId}:sede:sur:bodega_products_v1`).length, 1);
    });

    it('es idempotente: la segunda corrida no hace nada', async () => {
        const { migrateNorteInventory, isNorteInventoryMigrated } = await loadMigration(records);
        await migrateNorteInventory();
        const res2 = await migrateNorteInventory();
        assert.equal(res2.skipped, true);
        assert.equal(records.get(NORTE_KEY).length, 506);
        assert.equal(isNorteInventoryMigrated(), true);
    });
});
