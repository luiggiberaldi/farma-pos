import test from 'node:test';
import assert from 'node:assert/strict';
import { validateChangeBreakdown } from '../src/utils/changeValidation.js';
import { validateChangeInBs } from '../src/utils/tenderMath.js';

for (const [name, usd, bs] of [['USD', 10, 0], ['Bs', 0, 1000], ['mixto', 4, 600]]) {
  test(`vuelto fisico ${name}: reparto unico equivalente a 10 USD`, () => {
    const r = validateChangeBreakdown(10, { changeUsdGiven: usd, changeBsGiven: bs }, 100);
    assert.deepEqual(r, { valid: true, changeUsdGiven: usd, changeBsGiven: bs, deliveredUsd: 10 });
  });
}

test('vuelto: pago exacto permite importes vacios pero nunca una salida positiva', () => {
  assert.equal(validateChangeBreakdown(0).valid, true);
  assert.equal(validateChangeBreakdown(0, { changeUsdGiven: 1 }, 100).valid, false);
  assert.equal(validateChangeBreakdown(0.01, { changeUsdGiven: 0, changeBsGiven: 0 }, 100).valid, false);
});

test('vuelto: reparto ausente, doble, negativo o no numerico se rechaza', () => {
  for (const breakdown of [undefined, null, {}, { changeUsdGiven: '', changeBsGiven: '' },
    { changeUsdGiven: 10, changeBsGiven: 1000 }, { changeUsdGiven: 3, changeBsGiven: 0 },
    { changeUsdGiven: -1, changeBsGiven: 1100 }, { changeUsdGiven: Infinity },
    { changeUsdGiven: NaN }, { changeUsdGiven: 'no' }, { changeUsdGiven: true },
    { changeBsGiven: [] }, { changeUsdGiven: 1e308 }, { changeBsGiven: 1e308 }]) {
    assert.equal(validateChangeBreakdown(10, breakdown, 100).valid, false, JSON.stringify(breakdown));
  }
});

test('vuelto: la tasa es obligatoria para Bs y no se admite desbordamiento', () => {
  for (const rate of [0, -1, Infinity, NaN, Number.MIN_VALUE]) {
    assert.equal(validateChangeBreakdown(10, { changeBsGiven: 1000 }, rate).valid, false);
  }
  assert.equal(validateChangeBreakdown(Infinity, {}, 100).valid, false);
  assert.equal(validateChangeBreakdown(1e308, { changeUsdGiven: 1e308 }, 100).valid, false);
  assert.equal(validateChangeBreakdown(0, { changeBsGiven: 1e308 }, 100).valid, false);
});

test('vuelto: conserva centavos de Bs y compara el equivalente a precision de centavos USD', () => {
  const r = validateChangeBreakdown(1.25, { changeUsdGiven: '0.25', changeBsGiven: '123.45' }, 123.45);
  assert.equal(r.valid, true);
  assert.equal(r.changeBsGiven, 123.45);
  assert.equal(validateChangeBreakdown(10, { changeUsdGiven: 9.98, changeBsGiven: 0 }, 100).valid, false);
});

test('vuelto: tampoco permite duplicar un centavo ni registrar un centavo de diferencia', () => {
  assert.equal(validateChangeBreakdown(0.01, { changeUsdGiven: 0.02, changeBsGiven: 0 }, 100).valid, false);
  assert.equal(validateChangeBreakdown(0.01, { changeUsdGiven: 0.01, changeBsGiven: 1 }, 100).valid, false);
  assert.equal(validateChangeBreakdown(10, { changeUsdGiven: 9.99, changeBsGiven: 0 }, 100).valid, false);
  assert.equal(validateChangeBreakdown(10, { changeUsdGiven: 10.01, changeBsGiven: 0 }, 100).valid, false);
  assert.equal(validateChangeBreakdown(0.01, { changeUsdGiven: 0, changeBsGiven: 1 }, 100).valid, true);
});

test('vuelto: boton Todo $ usa floor y remanente en Bs para cuadrar exacto', () => {
  // Simula el cálculo del botón "Todo $" corregido
  const computeTodoDollar = (changeBs, rate) => {
    const changeUsd = changeBs / rate;
    const usd = Math.floor(changeUsd * 100) / 100;
    const remainderBs = Math.max(0, Math.round((changeBs - usd * rate) * 100) / 100);
    return { usd: usd.toFixed(2), bs: remainderBs.toFixed(2) };
  };

  // Caso del bug: 100 Bs con tasa 857.89
  // Antes: toFixed(2) daba 0.12 → 0.12*857.89=102.95 ≠ 100 → validación fallaba
  const { usd, bs } = computeTodoDollar(100, 857.89);
  assert.equal(usd, '0.11'); // floor(0.1165...) = 0.11
  const r = validateChangeInBs(100, { changeUsdGiven: usd, changeBsGiven: bs }, 857.89);
  assert.equal(r.valid, true, `Todo $ debe validar: usd=${usd} bs=${bs}`);

  // Caso exacto: sin remanente
  const exact = computeTodoDollar(857.89, 857.89);
  assert.equal(exact.usd, '1.00');
  assert.equal(validateChangeInBs(857.89, { changeUsdGiven: exact.usd, changeBsGiven: exact.bs }, 857.89).valid, true);
});
