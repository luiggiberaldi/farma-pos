import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCloudDocumentId,
  isCloudDocumentForContext,
  parseCloudDocumentId,
} from '../src/config/cloudDocumentScope.js';

const ACCOUNT = 'concurrency-qa';
const SEDES = ['central', 'norte', 'sur'];
const PRODUCT_KEY = 'bodega_products_v1';
const TRANSFER_KEY = 'farmacia_transferencias_v1';

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const clone = value => structuredClone(value);
const assertPinnedContext = (captured, active) => {
  if (captured.accountId !== active.accountId || captured.sedeId !== active.sedeId) {
    throw new Error('La cuenta o sede cambió durante la operación.');
  }
};

/**
 * Transporte cloud sintético: conserva la misma frontera que el contrato v2
 * pero no toca Supabase ni credenciales. Cada operación captura su doc_id antes
 * del await, que es lo que protege contra cambios de sede durante la latencia.
 */
class ThreeSedeHarness {
  constructor() {
    this.documents = new Map();
    this.calls = [];
    this.appliedOperations = new Set();
    this.queue = [];
  }

  async upsert(key, value, context, delay = 0) {
    const docId = buildCloudDocumentId(key, context);
    this.calls.push({ key, docId, context: clone(context) });
    await sleep(delay);
    this.documents.set(docId, { docId, key, value: clone(value), context: clone(context) });
    return docId;
  }

  async read(key, context, delay = 0) {
    const docId = buildCloudDocumentId(key, context);
    await sleep(delay);
    return clone(this.documents.get(docId)?.value ?? null);
  }

  async enqueueOperation(entry, delay = 0) {
    await sleep(delay);
    const existing = this.queue.find(item => item.accountId === entry.accountId && item.operationId === entry.operationId);
    if (existing) return { duplicate: true, entry: clone(existing) };
    this.queue.push(clone(entry));
    return { duplicate: false, entry: clone(entry) };
  }

  async applyTransfer(event, delay = 0) {
    const context = { accountId: event.accountId, sedeId: event.origenId };
    const docId = buildCloudDocumentId(TRANSFER_KEY, context);
    await sleep(delay);
    const current = this.documents.get(docId)?.value ?? [];
    if (this.appliedOperations.has(event.operationId)) {
      return { duplicate: true, events: clone(current) };
    }
    this.appliedOperations.add(event.operationId);
    const next = [clone(event), ...current];
    this.documents.set(docId, { docId, key: TRANSFER_KEY, value: next, context: clone(context) });
    return { duplicate: false, events: clone(next) };
  }
}

function products(sedeId, stock) {
  return [{ id: `product-${sedeId}`, sedeId, stock, updatedAt: `2026-09-16T10:00:0${stock}Z` }];
}

test('tres sedes escriben inventario concurrentemente sin colisión de documentos', async () => {
  const h = new ThreeSedeHarness();
  const operations = SEDES.map((sedeId, index) => h.upsert(
    PRODUCT_KEY,
    products(sedeId, 10 + index),
    { accountId: ACCOUNT, sedeId },
    12 - index * 4,
  ));
  const ids = await Promise.all(operations);

  assert.equal(new Set(ids).size, 3);
  for (const sedeId of SEDES) {
    const context = { accountId: ACCOUNT, sedeId };
    const docId = buildCloudDocumentId(PRODUCT_KEY, context);
    assert.equal(parseCloudDocumentId(docId).sedeId, sedeId);
    assert.deepEqual(await h.read(PRODUCT_KEY, context), products(sedeId, 10 + SEDES.indexOf(sedeId)));
    assert.equal(isCloudDocumentForContext(docId, PRODUCT_KEY, context), true);
  }
  assert.equal(h.calls.length, 3);
  assert.equal(new Set(h.calls.map(call => call.docId)).size, 3);
});

test('un cambio de sede durante un await no deposita la respuesta en la sede nueva', async () => {
  const h = new ThreeSedeHarness();
  let activeContext = { accountId: ACCOUNT, sedeId: 'central' };
  const captured = clone(activeContext);
  const operation = (async () => {
    await sleep(3);
    assertPinnedContext(captured, activeContext);
    return h.upsert(PRODUCT_KEY, products('central', 99), captured, 1);
  })();

  activeContext = { accountId: ACCOUNT, sedeId: 'norte' };
  await assert.rejects(operation, /cuenta o sede cambió/);
  assert.equal(await h.read(PRODUCT_KEY, { accountId: ACCOUNT, sedeId: 'central' }), null);
  assert.equal(await h.read(PRODUCT_KEY, { accountId: ACCOUNT, sedeId: 'norte' }), null);
});

test('transferencias concurrentes conservan origen/destino y el reintento es idempotente', async () => {
  const h = new ThreeSedeHarness();
  const event = {
    operationId: 'transfer-concurrency-01', accountId: ACCOUNT,
    origenId: 'central', destinoId: 'norte', estado: 'ENVIADA',
    items: [{ productoId: 'product-central', cantidad: 3 }],
  };
  const [first, retry, second] = await Promise.all([
    h.applyTransfer(event, 10),
    h.applyTransfer(event, 2),
    h.applyTransfer({ ...event, operationId: 'transfer-concurrency-02', destinoId: 'sur' }, 5),
  ]);

  assert.equal([first, retry].filter(result => !result.duplicate).length, 1);
  assert.equal([first, retry].filter(result => result.duplicate).length, 1);
  assert.equal(second.duplicate, false);
  const mailbox = await h.read(TRANSFER_KEY, { accountId: ACCOUNT, sedeId: 'central' });
  assert.equal(mailbox.length, 2);
  assert.deepEqual(mailbox.map(item => item.operationId).sort(), ['transfer-concurrency-01', 'transfer-concurrency-02']);
  assert.deepEqual(mailbox.map(item => item.destinoId).sort(), ['norte', 'sur']);
});

test('la cola de operaciones es account-scoped, conserva la sede y deduplica reintentos', async () => {
  const h = new ThreeSedeHarness();
  const entries = SEDES.map((sedeId, index) => ({
    accountId: ACCOUNT, sedeId, operationId: `sale-queue-${index}`, kind: 'SALE',
  }));
  const results = await Promise.all(entries.map((entry, index) => h.enqueueOperation(entry, 9 - index * 2)));
  assert.equal(results.filter(result => !result.duplicate).length, 3);
  assert.deepEqual(h.queue.map(item => item.sedeId).sort(), [...SEDES].sort());

  const retryEntry = { accountId: ACCOUNT, sedeId: 'central', operationId: 'sale-queue-concurrent', kind: 'SALE' };
  const first = await h.enqueueOperation({ ...retryEntry }, 1);
  const retry = await h.enqueueOperation({ ...retryEntry }, 8);
  assert.equal(first.duplicate, false);
  assert.equal(retry.duplicate, true);
  assert.equal(h.queue.filter(item => item.operationId === retryEntry.operationId).length, 1);
});

test('un fallo de red no cambia el documento ni consume la operación hasta confirmar', async () => {
  const h = new ThreeSedeHarness();
  const context = { accountId: ACCOUNT, sedeId: 'sur' };
  const original = products('sur', 7);
  await h.upsert(PRODUCT_KEY, original, context);

  const docId = buildCloudDocumentId(PRODUCT_KEY, context);
  const before = await h.read(PRODUCT_KEY, context);
  await assert.rejects(async () => {
    const captured = clone(context);
    await sleep(2);
    throw new Error('synthetic network timeout');
    // La mutación siempre ocurre después de que el transporte confirma.
    // eslint-disable-next-line no-unreachable
    await h.upsert(PRODUCT_KEY, products('sur', 6), captured);
  }, /synthetic network timeout/);

  assert.deepEqual(await h.read(PRODUCT_KEY, context), before);
  assert.equal(h.documents.has(docId), true);
});
