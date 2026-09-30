/**
 * Tests para tenderMath: soporte COP y tolerancia de redondeo.
 *
 * - COP: normalizeTender acepta currency 'COP' y convierte usando la tasa COP.
 * - Sin tasa COP válida: rechaza con error claro.
 * - Tolerancia: tenderBalance trata remanentes <= Bs0.01 como cero
 *   (evita "FALTA POR PAGAR Bs0,01" por redondeo IEEE 754).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeTender, tenderBalance } from '../src/utils/tenderMath.js';

const BCV = 859.06;
const TASA_COP = 4150;

test('normalizeTender: acepta pago COP y convierte a USD/Bs', () => {
    const p = normalizeTender(
        { methodId: 'efectivo_cop', currency: 'COP', amountInput: 8300 },
        BCV, TASA_COP
    );
    assert.equal(p.currency, 'COP');
    assert.equal(p.amount, 8300);
    assert.equal(p.amountUsd, 2); // 8300 / 4150
    assert.equal(p.amountBs, 1718.12); // 2 * 859.06
    assert.equal(p.amountCop, 8300);
});

test('normalizeTender: detecta COP por sufijo _cop sin currency explícita', () => {
    const p = normalizeTender(
        { methodId: 'transferencia_cop', amountInput: 4150 },
        BCV, TASA_COP
    );
    assert.equal(p.currency, 'COP');
    assert.equal(p.amountUsd, 1);
});

test('normalizeTender: rechaza COP sin tasa válida', () => {
    assert.throws(
        () => normalizeTender({ methodId: 'efectivo_cop', currency: 'COP', amountInput: 1000 }, BCV, 0),
        /Tasa COP no disponible/
    );
    assert.throws(
        () => normalizeTender({ methodId: 'efectivo_cop', currency: 'COP', amountInput: 1000 }, BCV),
        /Tasa COP no disponible/
    );
});

test('normalizeTender: USD y BS siguen funcionando sin tasa COP', () => {
    const usd = normalizeTender({ methodId: 'efectivo_usd', currency: 'USD', amountInput: 2 }, BCV);
    assert.equal(usd.amountUsd, 2);
    assert.equal(usd.amountBs, 1718.12);

    const bs = normalizeTender({ methodId: 'efectivo_bs', currency: 'BS', amountInput: 1718.12 }, BCV);
    assert.equal(bs.amountBs, 1718.12);
    assert.equal(bs.amountUsd, 2);
});

test('tenderBalance: remanente de Bs0,01 por redondeo se trata como cero', () => {
    // Caso real QA: total $1.80 con descuento, pago exacto $1.80
    // 1.80 * 859.06 = 1546.308 -> redondeos pueden dejar 0.01 de diferencia
    const totalBs = 1546.32;
    const paidBs = 1546.31; // diferencia de 0.01 por redondeo
    const balance = tenderBalance([{ amountBs: paidBs }], totalBs, BCV);
    assert.equal(balance.remainingBs, 0, 'remanente de 1 centavo debe ser cero');
    assert.equal(balance.remainingUsd, 0);
});

test('tenderBalance: remanente real mayor a 1 centavo se conserva', () => {
    const balance = tenderBalance([{ amountBs: 1000 }], 1500, BCV);
    assert.equal(balance.remainingBs, 500);
});
