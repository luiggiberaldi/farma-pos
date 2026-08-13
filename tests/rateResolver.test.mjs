import test from 'node:test';
import assert from 'node:assert/strict';

import { BcvApiClient, DEFAULT_BCV_API_URL } from '../src/services/bcvApiClient.js';
import {
  bcvDateKey,
  formatOfficialRate,
  getRateDiscrepancy,
  makeRateCandidate,
  normalizeRateDate,
  parseSafeFloat,
  selectRateCandidate,
} from '../src/utils/rateResolver.js';

test('parses Venezuelan and international decimal formats', () => {
  assert.equal(parseSafeFloat('764,3486'), 764.3486);
  assert.equal(parseSafeFloat('1.234,56'), 1234.56);
  assert.equal(parseSafeFloat('1,234.56'), 1234.56);
});

test('normalizes the Google Script date format', () => {
  assert.equal(normalizeRateDate('8/12/2026'), '2026-08-12');
});

test('uses the Venezuelan business date for BCV comparisons', () => {
  assert.equal(bcvDateKey('2026-08-12T03:30:00.000Z'), '2026-08-11');
});

test('formats official rates with exactly two visible decimals', () => {
  assert.equal(formatOfficialRate(764.3486), '764,35');
  assert.equal(formatOfficialRate(882.29523246), '882,30');
});

test('prefers a dated official candidate over a higher stale Google value', () => {
  const candidates = [
    makeRateCandidate({
      value: 766.8603,
      source: 'Google Script (VITE_GOOGLE_SCRIPT_URL)',
      priority: 200,
      validDate: '8/12/2026',
    }),
    makeRateCandidate({
      value: 764.3486,
      source: 'DolarApi Oficial',
      priority: 300,
      validDate: '2026-08-12T00:00:00-04:00',
    }),
  ];

  const selected = selectRateCandidate(candidates, { today: '2026-08-12' });
  assert.equal(selected.source, 'DolarApi Oficial');
  assert.equal(selected.val, 764.3486);
});

test('rejects a candidate dated after the business date', () => {
  const selected = selectRateCandidate([
    makeRateCandidate({ value: 766.8603, source: 'Google Script', priority: 300, validDate: '2026-08-13' }),
    makeRateCandidate({ value: 764.3486, source: 'DolarApi Oficial', priority: 200, validDate: '2026-08-12' }),
  ], { today: '2026-08-12' });

  assert.equal(selected.val, 764.3486);
});

test('does not let an undated cache override a dated official BCV value', () => {
  const selected = selectRateCandidate([
    makeRateCandidate({ value: 766.8603, source: '/api/rates', priority: 350 }),
    makeRateCandidate({ value: 764.3486, source: 'DolarApi Oficial', priority: 320, validDate: '2026-08-12' }),
  ], { today: '2026-08-12' });

  assert.equal(selected.source, 'DolarApi Oficial');
  assert.equal(selected.val, 764.3486);
});

test('reports a meaningful discrepancy between sources', () => {
  const warning = getRateDiscrepancy([
    makeRateCandidate({ value: 766.8603, source: 'Google Script' }),
    makeRateCandidate({ value: 764.3486, source: 'DolarApi Oficial' }),
  ]);

  assert.equal(warning.highestSource, 'Google Script');
  assert.equal(warning.lowestSource, 'DolarApi Oficial');
  assert.ok(warning.diff > 0.25);
});

test('normalizes the exact public BCV feed and its effective date', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    assert.equal(url, DEFAULT_BCV_API_URL);
    return {
      ok: true,
      json: async () => ({
        USD: 764.3486,
        EUR: 882.29523246,
        updated_at: '2026-08-11T22:36:18.307951+00:00',
        effective_date: '2026-08-12',
      }),
    };
  };

  try {
    const result = await new BcvApiClient().getRaw();
    assert.equal(result.tasa, 764.3486);
    assert.equal(result.euro, 882.29523246);
    assert.equal(result.validDate, '2026-08-12');
    assert.equal(result.source, 'BCV oficial (BCV Today)');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('normalizes BCV and Euro values from a configured client', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    json: async () => ({
      bcv: { price: '764,3486', fechaActualizacion: '2026-08-12' },
      euro: { price: '901,20' },
      source: 'BCV API',
    }),
  });

  try {
    const result = await new BcvApiClient('https://example.test/rates').getRaw();
    assert.equal(result.tasa, 764.3486);
    assert.equal(result.euro, 901.2);
    assert.equal(result.validDate, '2026-08-12');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
