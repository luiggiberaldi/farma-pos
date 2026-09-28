import test from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryBrowser } from './helpers/realModule.mjs';
import { getSyncMetrics, getSyncMetricSummary, recordSyncMetric, utf8ByteLength } from '../src/utils/syncMetrics.js';

const KEY = 'farmapos_sync_metrics_v1';
function fixture(t) {
  installMemoryBrowser(t);
  t.mock.method(Date, 'now', () => Date.parse('2026-09-13T23:00:00Z'));
}

test('metrics aggregate counters without double counting legacy and SDK byte estimates', t => {
  fixture(t);
  recordSyncMetric('bodega_products_v1', 'push');
  recordSyncMetric('bodega_products_v1', 'uploadBytes', 100);
  recordSyncMetric('sdk_rest', 'request');
  recordSyncMetric('sdk_rest', 'uploadBytes', 100);
  recordSyncMetric('sdk_auth', 'downloadBytes', 23);
  recordSyncMetric('sdk_auth', 'unknownResponseSize');
  recordSyncMetric('sdk_storage', 'blocked');
  recordSyncMetric('sdk_rest', 'oversized');
  const summary = getSyncMetricSummary();
  assert.equal(summary.pushCount, 1);
  assert.equal(summary.requests, 1);
  assert.equal(summary.bytesUploaded, 200, 'legacy aggregate preserved for compatibility');
  assert.equal(summary.sdkBytesUploaded, 100, 'UI must use SDK-only estimate');
  assert.equal(summary.sdkBytesDownloaded, 23);
  assert.equal(summary.responsesWithoutSize, 1);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.oversized, 1);
  assert.equal(summary.days, 1);
});

test('metrics reject identities, URLs, payload fields and unknown metric labels', t => {
  fixture(t);
  localStorage.setItem('business_records', 'preserve');
  const before = localStorage.getItem(KEY);
  for (const key of ['qa@example.invalid', 'https://example.invalid/private?token=secret', '__proto__', 'constructor']) recordSyncMetric(key, 'request');
  recordSyncMetric('sdk_auth', 'password', 'synthetic-secret');
  assert.equal(localStorage.getItem(KEY), before);
  recordSyncMetric('sdk_auth', 'request');
  assert.equal(localStorage.getItem(KEY).includes('synthetic-secret'), false);
  assert.equal(localStorage.getItem('business_records'), 'preserve');
});

test('metric bytes remain finite nonnegative numbers with corrupt inputs', t => {
  fixture(t);
  for (const bytes of [NaN, Infinity, -3, '400', null, {}]) recordSyncMetric('sdk_rest', 'uploadBytes', bytes);
  assert.equal(getSyncMetricSummary().sdkBytesUploaded, 0);
  recordSyncMetric('sdk_rest', 'uploadBytes', 12);
  assert.equal(getSyncMetricSummary().sdkBytesUploaded, 12);
});

test('read returns validated last 14 UTC days without writing or touching business data', t => {
  fixture(t);
  const data = {
    '2026-08-30': { sdk_auth: { requests: 40 } },
    '2026-08-31': { sdk_auth: { requests: 2, bytesDownloaded: 7 } },
    '2026-09-13': { sdk_auth: { requests: 3, bytesDownloaded: -9, password: 'should-not-return' }, 'untrusted-label': { requests: 9 } },
    '2026-09-14': { sdk_auth: { requests: 100 } },
    '2026-09-31': { sdk_auth: { requests: 100 } },
    'not-a-day': { sdk_auth: { requests: 100 } },
  };
  const serialized = JSON.stringify(data);
  localStorage.setItem(KEY, serialized);
  assert.deepEqual(Object.keys(getSyncMetrics()), ['2026-08-31', '2026-09-13']);
  assert.equal(getSyncMetricSummary().requests, 5);
  assert.equal(getSyncMetricSummary().sdkBytesDownloaded, 7);
  assert.ok(!JSON.stringify(getSyncMetrics()).includes('should-not-return'));
  assert.equal(localStorage.getItem(KEY), serialized, 'reading is not a cleanup write');
  recordSyncMetric('sdk_auth', 'request');
  assert.equal(JSON.parse(localStorage.getItem(KEY))['2026-08-30'], undefined);
});

for (const value of ['null', '[]', '"text"', 'bad json', '{"2026-09-13":[]}']) {
  test(`invalid metrics storage ${value} is tolerated`, t => {
    fixture(t);
    localStorage.setItem(KEY, value);
    assert.deepEqual(getSyncMetrics(), {});
    recordSyncMetric('sdk_auth', 'request');
    assert.equal(getSyncMetricSummary().requests, 1);
  });
}

test('denied metric persistence never interrupts caller', t => {
  fixture(t);
  t.mock.method(localStorage, 'setItem', () => { throw new Error('synthetic quota'); });
  assert.doesNotThrow(() => recordSyncMetric('sdk_auth', 'request'));
});

test('UTF-8 helper measures actual bytes without persisting content', t => {
  fixture(t);
  assert.equal(utf8ByteLength('ñ€'), 5);
  assert.equal(utf8ByteLength({ test: 'á' }), new TextEncoder().encode(JSON.stringify({ test: 'á' })).byteLength);
  const cycle = {}; cycle.self = cycle;
  assert.equal(utf8ByteLength(cycle), 0);
  assert.equal(localStorage.getItem(KEY), null);
});
