import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeName, similarity, isSameProduct } from '../src/utils/productNameMatch.js';
import { INITIAL_PHARMACY_PRODUCTS, buildSeedProduct } from '../src/config/pharmacySeed.js';
import { SEED_PRODUCTS_INV01 } from '../src/config/seed/seedProductsInv01.js';
import { SEED_PRODUCTS_INV02 } from '../src/config/seed/seedProductsInv02.js';
import { SEED_PRODUCTS_INV03 } from '../src/config/seed/seedProductsInv03.js';

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

test('lote 2: 271 productos (insumos + dudosos), barcodes únicos y continuos', () => {
    const all = [...SEED_PRODUCTS_INV03];
    assert.equal(all.length, 271);
    const barcodes = new Set(all.map(p => p.barcode));
    assert.equal(barcodes.size, 271);
    const sorted = [...barcodes].sort();
    assert.equal(sorted[0], '7590000001587');
    assert.equal(sorted[sorted.length - 1], '7590000001857');
    for (const p of all) {
        assert.ok(p.name && p.name.length > 0, 'nombre requerido');
        assert.ok(typeof p.priceUsd === 'number' && p.priceUsd >= 0, `precio válido: ${p.name}`);
        assert.ok(typeof p.stock === 'number' && p.stock >= 0, `stock válido: ${p.name}`);
    }
    // Sin colisión con el lote 1
    const lote1 = new Set([...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02].map(p => p.barcode));
    for (const bc of barcodes) {
        assert.ok(!lote1.has(bc), `barcode no colisiona con lote 1: ${bc}`);
    }
});

test('precios en Bs convertidos a USD (ningún producto del lote 1 supera $200)', () => {
    const all = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02, ...SEED_PRODUCTS_INV03];
    const sospechosos = all.filter(p => p.priceUsd >= 300);
    assert.deepEqual(sospechosos.map(p => p.name), [], 'no quedan precios en Bs sin convertir');
    // Verificar conversiones conocidas
    const porNombre = new Map(all.map(p => [p.name, p]));
    assert.equal(porNombre.get('Anfotericina B ampolla').priceUsd, 58.82);
    assert.equal(porNombre.get('Tom Toston pqño').priceUsd, 0.47);
});

test('migración: deduplicación determinista contra el seed base (666 + 894 = 1560)', () => {
    // Reproduce el núcleo de migrateMissingProducts: agrega los del lote cuyo
    // nombre no sea similar a uno del catálogo base ni a otro ya agregado.
    const base = INITIAL_PHARMACY_PRODUCTS.map(p => p.name);
    const incoming = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02, ...SEED_PRODUCTS_INV03];
    assert.equal(incoming.length, 1191);
    const toAdd = [];
    for (const prod of incoming) {
        const exists = base.some(n => isSameProduct(n, prod.name))
            || toAdd.some(p => isSameProduct(p.name, prod.name));
        if (!exists) toAdd.push(prod);
    }
    assert.equal(toAdd.length, 894, 'productos nuevos que debe agregar la migración');
    assert.equal(base.length + toAdd.length, 1560, 'total esperado en central tras migrar');
});

test('migración v4: repara un equipo que solo tiene los 963 del manuscrito (agrega la base faltante)', () => {
    // Escenario real: la migración v1–v3 corrió sobre un catálogo vacío y
    // dejó solo los 963 del manuscrito. v4 agrega la base que falta sin
    // duplicar (21 productos base quedan cubiertos por casi-duplicados del
    // manuscrito ya presentes en el equipo).
    const base = INITIAL_PHARMACY_PRODUCTS.map((item, i) => buildSeedProduct(item, i));
    const invLotes = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02, ...SEED_PRODUCTS_INV03];
    // Inventario actual del equipo: solo manuscrito deduplicado (963)
    const current = [];
    for (const prod of invLotes) {
        if (current.some(p => isSameProduct(p.name, prod.name))) continue;
        current.push(prod);
    }
    assert.equal(current.length, 963, 'equipo con solo el manuscrito');
    // Núcleo de la migración v4 en dos fases (base = referencia)
    const toAdd = [];
    for (const prod of base) {
        if (!current.some(p => isSameProduct(p.name, prod.name))) toAdd.push(prod);
    }
    for (const prod of invLotes) {
        if (current.some(p => isSameProduct(p.name, prod.name)) || toAdd.some(p => isSameProduct(p.name, prod.name))) continue;
        toAdd.push(prod);
    }
    assert.equal(toAdd.length, 576, 'productos base que debe agregar v4');
    assert.equal(current.length + toAdd.length, 1539, 'total esperado tras v4');
});

test('migración v4: equipo ya completo no agrega nada (idempotente)', () => {
    const base = INITIAL_PHARMACY_PRODUCTS.map((item, i) => buildSeedProduct(item, i));
    const invLotes = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02, ...SEED_PRODUCTS_INV03];
    const current = [...base];
    for (const prod of invLotes) {
        if (current.some(p => isSameProduct(p.name, prod.name))) continue;
        current.push(prod);
    }
    assert.equal(current.length, 1560, 'equipo ya completo');
    const toAdd = [];
    for (const prod of base) {
        if (!current.some(p => isSameProduct(p.name, prod.name))) toAdd.push(prod);
    }
    for (const prod of invLotes) {
        if (current.some(p => isSameProduct(p.name, prod.name)) || toAdd.some(p => isSameProduct(p.name, prod.name))) continue;
        toAdd.push(prod);
    }
    assert.equal(toAdd.length, 0, 'v4 no agrega nada si ya está completo');
});

test('migración v4: equipo vacío recibe el catálogo completo (1560)', () => {
    const base = INITIAL_PHARMACY_PRODUCTS.map((item, i) => buildSeedProduct(item, i));
    const invLotes = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02, ...SEED_PRODUCTS_INV03];
    const toAdd = [...base];
    for (const prod of invLotes) {
        if (toAdd.some(p => isSameProduct(p.name, prod.name))) continue;
        toAdd.push(prod);
    }
    assert.equal(toAdd.length, 1560, 'catálogo completo desde cero');
});
