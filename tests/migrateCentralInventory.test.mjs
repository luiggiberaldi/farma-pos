/**
 * Tests para migrateCentralInventory.js
 * Verifica que la migración del inventario físico real C&Y 2025 a central sea
 * un REEMPLAZO seguro:
 * - Sobrescribe el catálogo previo de central (que era el de Las 24 Horas)
 *   con los 807 productos reales
 * - No toca norte ni sur
 * - Es idempotente (segunda corrida no hace nada)
 * - Todos los productos quedan con sedeId 'central', IDs y barcodes únicos
 * - Los barcodes no colisionan con los de norte ni con el manuscrito viejo
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
const sessionStorageMock = (() => {
    let store = {};
    return {
        getItem: (k) => store[k] ?? null,
        setItem: (k, v) => { store[k] = String(v); },
        removeItem: (k) => { delete store[k]; },
        clear: () => { store = {}; },
    };
})();
global.sessionStorage = sessionStorageMock;

const mockAccountId = 'test-account-central';
const CENTRAL_KEY = `account:${mockAccountId}:sede:central:bodega_products_v1`;

async function loadMigration(records) {
    const mocks = {
        'src/utils/storageService.js': `
            const records = globalThis.__centralTestRecords;
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
        'src/config/storageScope.js': `
            export const getActiveAccountId = () => ${JSON.stringify(mockAccountId)};`,
    };
    globalThis.__centralTestRecords = records;
    return loadRealModule('src/utils/migrateCentralInventory.js', mocks);
}

// La semilla es un módulo de datos puro: se importa directo
const { SEED_PRODUCTS_CENTRAL01 } = await import('../src/config/seed/seedProductsCentral01.js');

describe('seed central 2025', () => {
    it('tiene 807 productos con IDs y barcodes únicos', () => {
        assert.equal(SEED_PRODUCTS_CENTRAL01.length, 807);
        assert.equal(new Set(SEED_PRODUCTS_CENTRAL01.map((p) => p.id)).size, 807);
        assert.equal(new Set(SEED_PRODUCTS_CENTRAL01.map((p) => p.barcode)).size, 807);
        assert.ok(SEED_PRODUCTS_CENTRAL01.every((p) => p.id.startsWith('inv2025c-')));
        assert.ok(SEED_PRODUCTS_CENTRAL01.every((p) => typeof p.priceUsd === 'number' && typeof p.stock === 'number'));
    });

    it('los barcodes no colisionan con norte ni con el manuscrito viejo', async () => {
        const { SEED_PRODUCTS_NORTE01 } = await import('../src/config/seed/seedProductsNorte01.js');
        const centralBC = new Set(SEED_PRODUCTS_CENTRAL01.map((p) => p.barcode));
        const norteBC = new Set(SEED_PRODUCTS_NORTE01.map((p) => p.barcode));
        for (const bc of centralBC) assert.ok(!norteBC.has(bc), `barcode ${bc} colisiona con norte`);
        // Rango del manuscrito viejo de central (Las 24 Horas): 7590000000667–1857
        for (const p of SEED_PRODUCTS_CENTRAL01) {
            const n = Number(p.barcode);
            assert.ok(n < 7590000000667 || n > 7590000001857, `barcode ${p.barcode} colisiona con el manuscrito viejo`);
        }
    });
});

describe('migrateCentralInventory', () => {
    let records;
    beforeEach(() => {
        localStorageMock.clear();
        sessionStorageMock.clear();
        records = new Map();
        // Catálogo previo de central (el de Las 24 Horas) + datos en norte/sur
        records.set(CENTRAL_KEY, [
            { id: 'las24h-1', name: 'Producto Las 24 Horas 1', priceUsd: 1, stock: 5, sedeId: 'central' },
            { id: 'las24h-2', name: 'Producto Las 24 Horas 2', priceUsd: 2, stock: 3, sedeId: 'central' },
        ]);
        records.set(`account:${mockAccountId}:sede:norte:bodega_products_v1`, [{ id: 'n-1', name: 'Norte Prod' }]);
        records.set(`account:${mockAccountId}:sede:sur:bodega_products_v1`, [{ id: 's-1', name: 'Sur Prod' }]);
    });

    it('reemplaza el catálogo previo de central con el inventario real', async () => {
        const { migrateCentralInventory, CENTRAL_SEED_COUNT } = await loadMigration(records);
        const res = await migrateCentralInventory();
        assert.equal(res.replaced, true);
        assert.equal(res.count, CENTRAL_SEED_COUNT);
        assert.equal(CENTRAL_SEED_COUNT, 807);
        const prods = records.get(CENTRAL_KEY);
        assert.equal(prods.length, 807);
        assert.ok(!prods.some((p) => p.id === 'las24h-1' || p.id === 'las24h-2'), 'el catálogo previo debe desaparecer');
        assert.ok(prods.every((p) => p.sedeId === 'central'));
        assert.equal(new Set(prods.map((p) => p.id)).size, prods.length);
        assert.equal(new Set(prods.map((p) => p.barcode)).size, prods.length);
    });

    it('no toca norte ni sur', async () => {
        const { migrateCentralInventory } = await loadMigration(records);
        await migrateCentralInventory();
        assert.equal(records.get(`account:${mockAccountId}:sede:norte:bodega_products_v1`).length, 1);
        assert.equal(records.get(`account:${mockAccountId}:sede:sur:bodega_products_v1`).length, 1);
    });

    it('es idempotente: la segunda corrida no hace nada', async () => {
        const { migrateCentralInventory, isCentralInventoryMigrated } = await loadMigration(records);
        await migrateCentralInventory();
        sessionStorageMock.clear();
        const res2 = await migrateCentralInventory();
        assert.equal(res2.skipped, true);
        assert.equal(records.get(CENTRAL_KEY).length, 807);
        assert.equal(isCentralInventoryMigrated(), true);
        assert.equal(sessionStorageMock.getItem('skip_cloud_pull'), null,
            'al omitir la migración no debe pedirse omitir el pull');
    });

    it('pone skip_cloud_pull al reemplazar (el pull no debe fusionar el catálogo previo)', async () => {
        const { migrateCentralInventory } = await loadMigration(records);
        await migrateCentralInventory();
        assert.equal(sessionStorageMock.getItem('skip_cloud_pull'), '1');
    });

    it('App.jsx: el efecto de migración de central se declara antes de useCloudSync()', async () => {
        const { readFileSync } = await import('node:fs');
        const src = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
        const idxMig = src.indexOf('migrateCentralInventory');
        const idxSync = src.indexOf('useCloudSync();');
        assert.ok(idxMig !== -1 && idxSync !== -1, 'ambos deben existir en App.jsx');
        assert.ok(idxMig < idxSync, 'la migración debe declarar su efecto antes del sync');
    });
});
