import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicIndexedDb } from '../src/services/atomicIndexedDb.js';

const require = createRequire(import.meta.url);
let IDBFactory;
try { ({ IDBFactory } = require('fake-indexeddb')); }
catch { ({ IDBFactory } = require(join(homedir(), '.workbuddy-ai/binaries/node/workspace/node_modules/fake-indexeddb'))); }
const records = [{ name: 'stock', key: 'stock', fallback: 1 }, { name: 'sales', key: 'sales', fallback: [] }, { name: 'queue', key: 'queue', fallback: [] }];
function setup() { return { indexedDBFactory: new IDBFactory(), databaseName: 'qa-atomic', storeName: 'data' }; }
const read = options => atomicIndexedDb(records, data => ({ writes: {}, result: data }), options);

test('native multi-record transaction commits stock, sale and queue together', async () => {
  const options = setup();
  await atomicIndexedDb(records, state => ({ writes: { stock: state.stock - 1, sales: ['sale'], queue: ['sale'] }, result: 'sale' }), options);
  assert.deepEqual({ ...await read(options) }, { stock: 0, sales: ['sale'], queue: ['sale'] });
});

test('serialization failure aborts every write, preserving existing sale and stock', async () => {
  const options = setup();
  await assert.rejects(() => atomicIndexedDb(records, () => ({ writes: { stock: 0, sales: ['sale'], queue: [() => 'invalid'] } }), options));
  assert.deepEqual({ ...await read(options) }, { stock: 1, sales: [], queue: [] });
});

test('two independent connections cannot sell the last base unit twice', async () => {
  const options = setup();
  const sell = id => atomicIndexedDb(records, state => {
    if (state.stock < 1) throw new Error('insufficient');
    return { writes: { stock: state.stock - 1, sales: [...state.sales, id], queue: [...state.queue, id] }, result: id };
  }, options);
  const results = await Promise.allSettled([sell('one'), sell('two')]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.deepEqual({ ...await read(options) }, { stock: 0, sales: ['one'], queue: ['one'] });
});

test('independent enqueues retain both entries instead of stale-array overwrite', async () => {
  const options = setup();
  await Promise.all(['one', 'two'].map(id => atomicIndexedDb(records, state => ({ writes: { queue: [...state.queue, id] } }), options)));
  assert.deepEqual((await read(options)).queue, ['one', 'two']);
});

test('planner cannot await or write outside declared keys', async () => {
  const options = setup();
  await assert.rejects(() => atomicIndexedDb(records, async () => ({ writes: {} }), options), /síncrono/);
  await assert.rejects(() => atomicIndexedDb(records, () => ({ writes: { other: 42 } }), options), /fuera/);
  assert.deepEqual((await read(options)).queue, []);
});

test('blocked or missing IndexedDB cannot silently become a partial fallback', async () => {
  await assert.rejects(() => atomicIndexedDb(records, () => ({ writes: {} }), { indexedDBFactory: null }), /IndexedDB/);
});
