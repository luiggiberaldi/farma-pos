import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCloudDocumentId,
  parseCloudDocumentId,
  isCloudDocumentForContext,
  isLegacyCloudDocumentId,
} from '../src/config/cloudDocumentScope.js';

const account = 'qa-account-123';

test('documentos de inventario generan IDs distintos por cada sede', () => {
  const central = buildCloudDocumentId('bodega_products_v1', { accountId: account, sedeId: 'central' });
  const norte = buildCloudDocumentId('bodega_products_v1', { accountId: account, sedeId: 'norte' });
  const sur = buildCloudDocumentId('bodega_products_v1', { accountId: account, sedeId: 'sur' });
  assert.deepEqual([central, norte, sur], [
    'v2:bodega_products_v1:account:qa-account-123:sede:central',
    'v2:bodega_products_v1:account:qa-account-123:sede:norte',
    'v2:bodega_products_v1:account:qa-account-123:sede:sur',
  ]);
  assert.equal(new Set([central, norte, sur]).size, 3);
});

test('documentos account-scoped no se duplican por sede', () => {
  const central = buildCloudDocumentId('my_categories_v1', { accountId: account, sedeId: 'central' });
  const norte = buildCloudDocumentId('my_categories_v1', { accountId: account, sedeId: 'norte' });
  assert.equal(central, 'v2:my_categories_v1:account:qa-account-123');
  assert.equal(central, norte);
  assert.equal(buildCloudDocumentId('farmacia_transferencias_v1', { accountId: account, sedeId: 'central' }), 'v2:farmacia_transferencias_v1:account:qa-account-123');
});

test('parseo y validación rechazan cuenta o sede equivocada', () => {
  const id = buildCloudDocumentId('bodega_sales_v1', { accountId: account, sedeId: 'norte' });
  assert.deepEqual(parseCloudDocumentId(id), {
    version: 'v2', key: 'bodega_sales_v1', accountId: account, sedeId: 'norte', sedeScoped: true,
  });
  assert.equal(isCloudDocumentForContext(id, 'bodega_sales_v1', { accountId: account, sedeId: 'norte' }), true);
  assert.equal(isCloudDocumentForContext(id, 'bodega_sales_v1', { accountId: account, sedeId: 'central' }), false);
  assert.equal(isCloudDocumentForContext(id, 'bodega_sales_v1', { accountId: 'otro-account', sedeId: 'norte' }), false);
});

test('documentos legacy y entidades sin política no se aceptan', () => {
  assert.equal(parseCloudDocumentId('bodega_products_v1'), null);
  assert.equal(isLegacyCloudDocumentId('bodega_products_v1'), true);
  assert.equal(buildCloudDocumentId('farmacia_transferencias_v1', { accountId: account, sedeId: 'central' }), 'v2:farmacia_transferencias_v1:account:qa-account-123');
  assert.throws(() => buildCloudDocumentId('unregistered_entity', { accountId: account, sedeId: 'central' }), /sin política/);
  assert.throws(() => buildCloudDocumentId('bodega_products_v1', { accountId: account, sedeId: 'invalid' }), /Sede cloud inválida/);
});
