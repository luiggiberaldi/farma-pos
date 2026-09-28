import test from 'node:test';
import assert from 'node:assert/strict';
import { enqueueSnapshotWrite, drainSnapshotWrites } from '../src/services/localSnapshotQueue.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('cola de snapshots comparte orden entre proveedor antiguo y remontado', async () => {
  const context = { accountId: 'qa', sedeId: 'central' };
  const gate = deferred();
  const writes = [];
  const first = enqueueSnapshotWrite(context, async () => { await gate.promise; writes.push('A1'); });
  const second = enqueueSnapshotWrite(context, async () => { writes.push('A2'); });
  let hydrated = false;
  const hydration = drainSnapshotWrites(context).then(() => { hydrated = true; });
  const newProvider = enqueueSnapshotWrite(context, async () => { writes.push('B'); });
  await Promise.resolve();
  assert.equal(hydrated, false);
  gate.resolve();
  await Promise.all([first, second, hydration, newProvider]);
  assert.deepEqual(writes, ['A1', 'A2', 'B']);
  assert.equal(hydrated, true);
});

test('fallo de un snapshot se propaga sin impedir el reintento siguiente', async () => {
  const context = { accountId: 'qa-retry', sedeId: 'central' };
  await assert.rejects(() => enqueueSnapshotWrite(context, async () => { throw new Error('synthetic write failure'); }), /synthetic/);
  let completed = false;
  await enqueueSnapshotWrite(context, async () => { completed = true; });
  await drainSnapshotWrites(context);
  assert.equal(completed, true);
});

test('snapshots de otra cuenta o sede no se serializan detrás de un bloqueo ajeno', async () => {
  const gate = deferred();
  const pending = enqueueSnapshotWrite({ accountId: 'a', sedeId: 'central' }, () => gate.promise);
  let otherFinished = false;
  await enqueueSnapshotWrite({ accountId: 'b', sedeId: 'central' }, async () => { otherFinished = true; });
  assert.equal(otherFinished, true);
  gate.resolve(); await pending;
});
