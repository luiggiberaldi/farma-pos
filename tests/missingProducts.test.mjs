import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, similarity, isSameProduct } from '../src/utils/productNameMatch.js';
import { SEED_PRODUCTS_INV01 } from '../src/config/seed/seedProductsInv01.js';
import { SEED_PRODUCTS_INV02 } from '../src/config/seed/seedProductsInv02.js';

test('normalizeName: minúsculas, sin acentos, sin laboratorio, une número+unidad', () => {
    assert.equal(normalizeName('Ácido Fólico 5 mg (PlusAndex)'), 'acido folico 5mg');
    assert.equal(normalizeName('Captopril 50mg (La Sante)'), 'captopril 50mg');
    assert.equal(normalizeName('  Ibuprofeno   400 MG '), 'ibuprofeno 400mg');
    assert.equal(normalizeName(''), '');
});

test('isSameProduct: detecta el mismo producto con distinto formato', () => {
    assert.ok(isSameProduct('Ácido Fólico 5 mg (PlusAndex)', 'acido folico 5mg (Calox)'));
    assert.ok(isSameProduct('Captopril 50mg (Protafarma)', 'Captopril 50 mg'));
    assert.ok(isSameProduct('Paracetamol 500mg', 'Paracetamol 500mg'));
});

test('isSameProduct: no confunde productos distintos', () => {
    assert.ok(!isSameProduct('Ibuprofeno 400mg', 'Ibuprofeno 600mg'));
    assert.ok(!isSameProduct('Losartan 50mg', 'Losartan 100mg'));
    assert.ok(!isSameProduct('Paracetamol 500mg', 'Amoxicilina 500mg'));
});

test('similarity: casos borde', () => {
    assert.equal(similarity('', 'algo'), 0);
    assert.equal(similarity('a b', 'a b'), 1);
    assert.ok(similarity('a b c', 'a b') >= 0.6);
});

test('datos del inventario 2026: 920 productos con campos válidos y barcodes únicos', () => {
    const all = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02];
    assert.equal(all.length, 920);
    const barcodes = new Set(all.map(p => p.barcode));
    assert.equal(barcodes.size, 920);
    for (const p of all) {
        assert.ok(p.name && p.name.length > 0, 'nombre requerido');
        assert.ok(p.barcode && /^759\d+$/.test(p.barcode), `barcode válido: ${p.barcode}`);
        assert.ok(typeof p.priceUsd === 'number' && p.priceUsd > 0, `precio válido: ${p.name}`);
        assert.ok(typeof p.stock === 'number' && p.stock >= 0, `stock válido: ${p.name}`);
        assert.ok(typeof p.costUsd === 'number' && p.costUsd > 0, `costo válido: ${p.name}`);
    }
    // Los barcodes continúan donde terminó el seed (7590000000666)
    const sorted = [...barcodes].sort();
    assert.equal(sorted[0], '7590000000667');
    assert.equal(sorted[sorted.length - 1], '7590000001586');
});
