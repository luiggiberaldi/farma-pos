import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRealModule, installMemoryBrowser } from './helpers/realModule.mjs';
import { getActiveSedeId, setActiveSedeId, getStorageKeyForContext } from '../src/config/storageScope.js';

// Fixture: memoria + almacenamiento falso con claves scoped reales.
async function seedFixture(t) {
  installMemoryBrowser(t);
  const records = new Map();
  const storage = {
    async getItem(key, fallback = null, context = null) {
      const name = context ? `${context.accountId || 'unscoped'}:sede:${context.sedeId}:${key}` : key;
      return structuredClone(records.has(name) ? records.get(name) : fallback);
    },
    async setItem(key, value, context = null) {
      const name = context ? `${context.accountId || 'unscoped'}:sede:${context.sedeId}:${key}` : key;
      records.set(name, structuredClone(value));
    },
    async transaction(declared, planner, context = null) {
      const values = Object.create(null);
      for (const item of declared) values[item.name] = await this.getItem(item.key, item.fallback, context);
      const planned = planner(values);
      for (const [name, value] of Object.entries(planned.writes || {})) {
        const item = declared.find(d => d.name === name);
        if (item) await this.setItem(item.key, value, context);
      }
    },
  };
  const mod = await loadRealModule('src/config/pharmacySeed.js', {
    'src/utils/storageService.js': 'export const storageService = ' + 'null;',
  }, { exportsFrom: ['src/config/pharmacySeed.js'] });
  const ctx = sedeId => ({ accountId: '', sedeId });
  return { ...mod, storage, records, ctx };
}

const ctxOf = sedeId => ({ accountId: '', sedeId });

test('las colecciones operativas locales quedan aisladas y las transferencias son buzón compartido', () => {
  for (const key of ['farmacia_seed_done_v1', 'farmacia_controlados_v1', 'abasto_audit_log_v1']) {
    assert.notEqual(
      getStorageKeyForContext(key, ctxOf('central')),
      getStorageKeyForContext(key, ctxOf('norte')),
      `${key} debe aislarse por sede`
    );
  }
  for (const key of ['farmacia_transferencias_v1', 'offline_sales_queue']) {
    assert.equal(
      getStorageKeyForContext(key, ctxOf('central')),
      getStorageKeyForContext(key, ctxOf('norte')),
      `${key} debe permanecer account-scoped y llevar sede en cada evento`
    );
  }
});

test('sede matriz recibe catalogo completo; norte/sur reciben inventario de prueba', async t => {
  const { seedPharmacyInventoryIfEmpty, storage, records, SEED_HOME_SEDE_ID, SEED_DONE_KEY } = await seedFixture(t);
  // Sede norte: se siembra inventario de prueba (30 productos) y queda marcada.
  setActiveSedeId('norte');
  assert.equal(await seedPharmacyInventoryIfEmpty(storage, ctxOf('norte')), true);
  const norteProducts = records.get(`unscoped:sede:norte:bodega_products_v1`);
  assert.ok(Array.isArray(norteProducts) && norteProducts.length === 30);
  assert.equal(records.get(`unscoped:sede:norte:${SEED_DONE_KEY}`)?.norte, true);
  // Sede sur: igual que norte.
  setActiveSedeId('sur');
  assert.equal(await seedPharmacyInventoryIfEmpty(storage, ctxOf('sur')), true);
  const surProducts = records.get(`unscoped:sede:sur:bodega_products_v1`);
  assert.ok(Array.isArray(surProducts) && surProducts.length === 30);
  // Sede matriz: se siembra el catalogo completo y queda marcada.
  setActiveSedeId('central');
  const seeded = await seedPharmacyInventoryIfEmpty(storage, ctxOf('central'));
  assert.equal(seeded, true);
  const products = records.get('unscoped:sede:central:bodega_products_v1');
  assert.ok(products.length > 0);
  assert.equal(records.get(`unscoped:sede:central:${SEED_DONE_KEY}`)?.central, true);
});

test('borrar todo es permanente: la sede matriz vaciada no se re-siembra', async t => {
  const { seedPharmacyInventoryIfEmpty, storage, records, SEED_DONE_KEY } = await seedFixture(t);
  setActiveSedeId('central');
  await seedPharmacyInventoryIfEmpty(storage, ctxOf('central'));
  assert.ok(records.get('unscoped:sede:central:bodega_products_v1').length > 0);
  // El dueño borra todo: inventario vacio PERO marca de configurada intacta.
  records.set('unscoped:sede:central:bodega_products_v1', []);
  assert.equal(await seedPharmacyInventoryIfEmpty(storage, ctxOf('central')), false);
  assert.deepEqual(records.get('unscoped:sede:central:bodega_products_v1'), []);
});

test('la migracion de categorias legacy corre en cualquier sede (con inventario de prueba en sur)', async t => {
  const { seedPharmacyInventoryIfEmpty, storage, records } = await seedFixture(t);
  records.set('unscoped:sede:sur:my_categories_v1', [{ id: 'motor', label: 'Motor' }, { id: 'cauchos', label: 'Cauchos' }]);
  setActiveSedeId('sur');
  // Ahora sur recibe inventario de prueba (true), pero la migración de categorías sigue corriendo.
  assert.equal(await seedPharmacyInventoryIfEmpty(storage, ctxOf('sur')), true);
  const cats = records.get('unscoped:sede:sur:my_categories_v1');
  assert.equal(cats.some(c => c.id === 'motor'), false);
  assert.equal(cats.some(c => c.id === 'analgesicos'), true);
  // El inventario de prueba sí se sembró (30 productos).
  const products = records.get('unscoped:sede:sur:bodega_products_v1');
  assert.ok(Array.isArray(products) && products.length === 30);
});

test('nunca re-siembra sobre inventario existente en la sede matriz', async t => {
  const { seedPharmacyInventoryIfEmpty, storage, records } = await seedFixture(t);
  setActiveSedeId('central');
  records.set('unscoped:sede:central:bodega_products_v1', [{ id: 'custom-1', name: 'Producto del dueno', stock: 3 }]);
  assert.equal(await seedPharmacyInventoryIfEmpty(storage, ctxOf('central')), false);
  const products = records.get('unscoped:sede:central:bodega_products_v1');
  assert.equal(products.length, 1);
  assert.equal(products[0].name, 'Producto del dueno');
});
