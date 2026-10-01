// Pruebas deterministas de los objetivos de borrado cloud del historial de ventas.
// Contrato (auditoría de modales 2026-10-01):
//  - Borrar el historial debe eliminar el monolito legacy `bodega_sales_v1`
//    (doc_id exacto) Y todos los chunks diarios `bodega_sales_YYYYMMDD`
//    (patrón LIKE). Sin el LIKE, los chunks se re-descargan en el siguiente
//    poll y las ventas "resucitan".
//  - salesCloudDeletionTargets es pura: solo construye objetivos, no toca red.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  salesCloudDeletionTargets,
  buildCloudDocumentId,
  salesChunkDocIdLike,
} from '../src/config/cloudDocumentScope.js';

const ACCOUNT = 'acc-test-123';
const SEDE = 'central';

test('devuelve el doc_id exacto del monolito legacy y el LIKE de chunks', () => {
  const t = salesCloudDeletionTargets({ accountId: ACCOUNT, sedeId: SEDE });
  assert.equal(t.legacyDocId, buildCloudDocumentId('bodega_sales_v1', { accountId: ACCOUNT, sedeId: SEDE }));
  assert.equal(t.legacyDocId, `v2:bodega_sales_v1:account:${ACCOUNT}:sede:${SEDE}`);
  assert.equal(t.chunksDocIdLike, salesChunkDocIdLike({ accountId: ACCOUNT, sedeId: SEDE }));
  assert.equal(t.chunksDocIdLike, `v2:bodega_sales_%:account:${ACCOUNT}:sede:${SEDE}`);
});

test('el LIKE de chunks casa con doc_ids reales de chunks y no con el monolito exacto', () => {
  const { chunksDocIdLike, legacyDocId } = salesCloudDeletionTargets({ accountId: ACCOUNT, sedeId: SEDE });
  // Simulación determinista de LIKE de SQL: % = cualquier secuencia.
  const likeToRegExp = (like) => new RegExp('^' + like.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$');
  const re = likeToRegExp(chunksDocIdLike);
  assert.match(`v2:bodega_sales_20261001:account:${ACCOUNT}:sede:${SEDE}`, re);
  assert.match(`v2:bodega_sales_20250902:account:${ACCOUNT}:sede:${SEDE}`, re);
  // El monolito legacy también casa con el LIKE (contiene bodega_sales_ + 'v1'),
  // por eso se borra además por doc_id exacto: el borrado es idempotente.
  assert.match(legacyDocId, re);
  // No casa con otra cuenta ni otra sede.
  assert.doesNotMatch(`v2:bodega_sales_20261001:account:otra-cuenta:sede:${SEDE}`, re);
  assert.doesNotMatch(`v2:bodega_sales_20261001:account:${ACCOUNT}:sede:norte`, re);
  // No casa con otros documentos de la misma cuenta/sede.
  assert.doesNotMatch(`v2:bodega_products_v1:account:${ACCOUNT}:sede:${SEDE}`, re);
});

test('es estable por sede: norte y sur generan sus propios objetivos', () => {
  for (const sede of ['central', 'norte', 'sur']) {
    const t = salesCloudDeletionTargets({ accountId: ACCOUNT, sedeId: sede });
    assert.ok(t.legacyDocId.endsWith(`:sede:${sede}`));
    assert.ok(t.chunksDocIdLike.endsWith(`:sede:${sede}`));
  }
  const a = salesCloudDeletionTargets({ accountId: ACCOUNT, sedeId: 'norte' });
  const b = salesCloudDeletionTargets({ accountId: ACCOUNT, sedeId: 'sur' });
  assert.notEqual(a.chunksDocIdLike, b.chunksDocIdLike);
});

test('rechaza cuenta inválida', () => {
  assert.throws(() => salesCloudDeletionTargets({ accountId: '', sedeId: SEDE }), /Cuenta cloud inválida/);
  assert.throws(() => salesCloudDeletionTargets({ accountId: 'con:dos:puntos', sedeId: SEDE }), /Cuenta cloud inválida/);
  assert.throws(() => salesCloudDeletionTargets({ sedeId: SEDE }), /Cuenta cloud inválida/);
});

test('rechaza sede inválida', () => {
  assert.throws(() => salesCloudDeletionTargets({ accountId: ACCOUNT, sedeId: 'este' }), /Sede cloud inválida/);
  assert.throws(() => salesCloudDeletionTargets({ accountId: ACCOUNT }), /Sede cloud inválida/);
});
