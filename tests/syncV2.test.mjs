import test from 'node:test';
import assert from 'node:assert/strict';
import { _mergeArraysById } from '../src/hooks/cloudSync/syncUtils.js';
import { MERGEABLE_KEYS } from '../src/hooks/cloudSync/syncKeys.js';
import { REMOTE_OPERATIONS_PAUSED, SYNC_V2_ENABLED, syncV2Paused } from '../src/config/operationSafety.js';
import { buildCloudDocumentId } from '../src/config/cloudDocumentScope.js';

// ADR-003: el inventario se mezcla por ID, no se reemplaza desde la nube.
test('sync v2: bodega_products_v1 es mergeable por ID', () => {
  assert.ok(MERGEABLE_KEYS.includes('bodega_products_v1'));
});

test('sync v2: flags — legacy pausado, documentos habilitados', () => {
  assert.equal(REMOTE_OPERATIONS_PAUSED, true); // checkout/RPCs/cola siguen pausados
  assert.equal(SYNC_V2_ENABLED, true);          // motor de documentos habilitado
  assert.equal(syncV2Paused(), false);
});

test('sync v2: merge preserva el stock vivo del equipo (updatedAt más reciente gana)', () => {
  const live = [
    { id: 'inv2026-7590000000667', name: 'Aspirina', stock: 95, updatedAt: '2026-09-30T20:00:00.000Z' },
    { id: 'seed-1', name: 'Paracetamol', stock: 50 }, // sin updatedAt
  ];
  const seed = [
    { id: 'inv2026-7590000000667', name: 'Aspirina', stock: 100 }, // semilla sin updatedAt
    { id: 'seed-1', name: 'Paracetamol', stock: 50 },
    { id: 'seed-2', name: 'Ibuprofeno', stock: 30 }, // solo en la nube
  ];
  const merged = _mergeArraysById(live, seed);
  assert.equal(merged.length, 3);
  const byId = new Map(merged.map(p => [p.id, p]));
  assert.equal(byId.get('inv2026-7590000000667').stock, 95); // gana el equipo (venta real)
  assert.equal(byId.get('seed-2').stock, 30);               // la nube aporta el faltante
});

test('sync v2: empate sin timestamps no pierde productos locales', () => {
  const live = [{ id: 'a', name: 'A', stock: 7 }];
  const cloud = [{ id: 'a', name: 'A', stock: 7 }, { id: 'b', name: 'B', stock: 3 }];
  const merged = _mergeArraysById(live, cloud);
  assert.equal(merged.length, 2);
});

test('sync v2: doc_id de productos de central tiene el formato esperado', () => {
  const uid = 'a21b635a-e34b-44fc-9830-9eb1d9254499';
  assert.equal(
    buildCloudDocumentId('bodega_products_v1', { accountId: uid, sedeId: 'central' }),
    `v2:bodega_products_v1:account:${uid}:sede:central`
  );
});
