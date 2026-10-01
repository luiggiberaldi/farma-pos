// Semántica de concurrencia del sync (Fase 2c).
// Verificado en vivo el 2026-10-01 (~/workspace/e2e-fase2c/concurrency-e2e.mjs,
// 5/5): dos equipos venden el mismo producto casi a la vez, antes de
// descargar la venta del otro. Este test fija el comportamiento observado:
//
//   VENTAS: convergen por unión de IDs — ninguna se pierde ni se duplica,
//           aunque el push de B pise el chunk del día en la nube (mismo
//           doc_id): el pull+merge la recupera y el re-push converge.
//   STOCK:  LWW por producto (updatedAt más reciente gana). El descuento del
//           equipo "perdedor" se pierde en la cifra de stock: con stock 10,
//           A vende 3 y B vende 4 (concurrente), el stock converge a 6 (el de
//           B, posterior), no al real 3. Las ventas quedan intactas ($35) y
//           el cierre cuadra contra el libro de ventas, no contra el stock.
//           Riesgo operativo bajo: una sola caja por sede (decisión 2026-09-29).
import test from 'node:test';
import assert from 'node:assert/strict';
import { _mergeArraysById } from '../src/hooks/cloudSync/syncUtils.js';

const sale = (id, totalUsd, ts) => ({ id, totalUsd, tipo: 'VENTA', timestamp: ts, updatedAt: ts });

test('concurrencia: ventas del mismo día convergen por unión de IDs', () => {
    // A vendió y subió; B vendió sin haber descargado (su push pisa el doc).
    const chunkTrasPushB = [sale('v-b', 20, '2026-10-01T12:00:01.000Z')]; // sin la venta de A
    // A hace pull+merge: recupera su venta y re-sube la unión.
    const localA = [sale('v-a', 15, '2026-10-01T12:00:00.000Z')];
    const mergedA = _mergeArraysById(localA, chunkTrasPushB);
    assert.equal(mergedA.length, 2, 'A recupera ambas ventas');
    // B hace pull del doc ya convergido y mezcla.
    const localB = [sale('v-b', 20, '2026-10-01T12:00:01.000Z')];
    const mergedB = _mergeArraysById(localB, mergedA);
    assert.equal(mergedB.length, 2, 'B converge a ambas ventas');
    assert.deepEqual(
        mergedA.map(s => s.id).sort(), mergedB.map(s => s.id).sort(),
        'mismo conjunto en ambos equipos',
    );
    assert.equal(mergedA.reduce((a, s) => a + s.totalUsd, 0), 35, 'montos intactos');
});

test('concurrencia: stock del mismo producto es LWW (documentado)', () => {
    // Stock 10. A vende 3 → 7 (t0). B vende 4 sin ver a A → 6 (t1 > t0).
    const prodA = { id: 'p1', stock: 7, updatedAt: '2026-10-01T12:00:00.000Z' };
    const prodB = { id: 'p1', stock: 6, updatedAt: '2026-10-01T12:00:01.000Z' };
    const mergedAB = _mergeArraysById([prodA], [prodB]);
    const mergedBA = _mergeArraysById([prodB], [prodA]);
    assert.equal(mergedAB[0].stock, 6, 'gana el updatedAt más reciente (B)');
    assert.equal(mergedBA[0].stock, 6, 'el orden del merge no importa');
    assert.equal(mergedAB[0].stock, mergedBA[0].stock, 'convergencia determinista');
    // El stock real sería 3: la diferencia queda documentada, no corregida.
});
