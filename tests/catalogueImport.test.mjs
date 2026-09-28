import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCsv, parseCatalogue, validateCatalogue, deriveProductId, diffCatalogue, CATALOGUE_COLUMNS } from '../src/services/catalogueImport.js';

const CSV = [
    'sku,name,price,cost,stock,category,unit,barcode,requiresPrescription,isControlled',
    'PARA-500,"Paracetamol 500mg, caja",10,4,25,analgesicos,unidad,7591234567890,no,no',
    'AMOX-500,Amoxicilina 500mg,15.5,7,0,antibioticos,unidad,,si,no',
    'ALCO-70,Alcohol 70%,3.25,,12.5,otros,litro,,no,no',
].join('\n');

test('the CSV reader honours quoted separators, escaped quotes and line endings', () => {
    assert.deepEqual(parseCsv('a,b\n1,2'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCsv('a;b\r\n1;2\r\n'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCsv('a,b\n"x, y",2'), [['a', 'b'], ['x, y', '2']]);
    assert.deepEqual(parseCsv('a\n"say ""hi"""'), [['a'], ['say "hi"']]);
    assert.deepEqual(parseCsv('\uFEFFa,b\n1,2'), [['a', 'b'], ['1', '2']]);
    assert.deepEqual(parseCsv('a,b\n\n1,2\n'), [['a', 'b'], ['1', '2']]);
});

test('a CSV catalogue is parsed into rows and an empty or malformed file is refused', () => {
    const rows = parseCatalogue(CSV);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].name, 'Paracetamol 500mg, caja');
    assert.equal(rows[2].stock, '12.5');
    assert.throws(() => parseCatalogue('   '), /vacío/);
    assert.throws(() => parseCatalogue('{'), /JSON válido/);
    assert.throws(() => parseCatalogue('a,b\n1,2'), /Columnas no reconocidas/);
    assert.throws(() => parseCatalogue('sku,name\n1,x'), /name y price/);
    assert.throws(() => parseCatalogue('sku,name,price\n'), /encabezado/);
});

test('a JSON catalogue is accepted as a list or as an object with products', () => {
    const list = parseCatalogue(JSON.stringify([{ name: 'A', price: 1 }]));
    assert.equal(list.length, 1);
    const wrapped = parseCatalogue(JSON.stringify({ products: [{ name: 'A', price: 1 }] }));
    assert.equal(wrapped.length, 1);
    assert.throws(() => parseCatalogue('{"products":{}}'), /lista de productos/);
});

test('valid rows are accepted and mapped with the client precision', async () => {
    const result = await validateCatalogue(parseCatalogue(CSV));
    assert.deepEqual(result.errors, []);
    assert.equal(result.accepted, 3);
    const [paracetamol, amoxicilina, alcohol] = result.items;
    assert.equal(paracetamol.name, 'Paracetamol 500mg, caja');
    assert.equal(paracetamol.priceUsd, 10);
    assert.equal(paracetamol.costUsd, 4);
    assert.equal(paracetamol.stock, 25);
    assert.equal(paracetamol.unit, 'unidad');
    assert.equal(paracetamol.barcode, '7591234567890');
    assert.equal(paracetamol.requiresPrescription, false);
    assert.equal(amoxicilina.requiresPrescription, true);
    assert.equal(alcohol.costUsd, null, 'an absent cost stays unknown, not zero');
    assert.equal(alcohol.stock, 12.5);
    assert.equal(alcohol.unit, 'litro');
    for (const item of result.items) assert.match(item.id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('product ids are stable for the same business key and differ across keys', async () => {
    const first = await deriveProductId('PARA-500');
    const again = await deriveProductId('PARA-500');
    const other = await deriveProductId('AMOX-500');
    assert.equal(first, again, 're-importing the same file must not create duplicates');
    assert.notEqual(first, other);
    const a = await validateCatalogue([{ sku: 'X', name: 'A', price: 1 }]);
    const b = await validateCatalogue([{ sku: 'X', name: 'A renombrado', price: 2 }]);
    assert.equal(a.items[0].id, b.items[0].id, 'the id follows the SKU, not the name');
});

test('every invalid row is reported with its line and reason, and never invented', async () => {
    const rows = [
        { sku: 'A', name: '', price: 1 },
        { sku: 'B', name: 'Sin precio', price: 'abc' },
        { sku: 'C', name: 'Precio negativo', price: -1 },
        { sku: 'D', name: 'Costo inválido', price: 1, cost: 'x' },
        { sku: 'E', name: 'Stock con cuatro decimales', price: 1, stock: 1.0005 },
        { sku: 'F', name: 'Unidad rara', price: 1, unit: 'docena' },
        { sku: 'G', name: 'Bandera rara', price: 1, requiresPrescription: 'quizá' },
        { sku: 'H', name: 'Válido', price: 1 },
        { sku: 'H', name: 'Duplicado', price: 2 },
    ];
    const result = await validateCatalogue(rows);
    assert.equal(result.accepted, 1);
    assert.equal(result.rejected, 8);
    assert.deepEqual(result.errors.map(error => [error.line, error.field]),
        [[1, 'name'], [2, 'price'], [3, 'price'], [4, 'cost'], [5, 'stock'], [6, 'unit'], [7, 'requiresPrescription'], [9, 'sku']]);
    for (const error of result.errors) assert.ok(error.message.length > 0);
    assert.equal(result.items[0].name, 'Válido');
});

test('a product without SKU or barcode falls back to its name as the stable key', async () => {
    const result = await validateCatalogue([{ name: 'Producto sin código', price: 5 }]);
    assert.equal(result.accepted, 1);
    assert.equal(result.items[0].key, 'producto sin código');
    const repeat = await validateCatalogue([{ name: 'Producto sin código', price: 9 }]);
    assert.equal(repeat.items[0].id, result.items[0].id);
});

test('the diff separates additions, updates, unchanged and removals', async () => {
    const { items } = await validateCatalogue(parseCatalogue(CSV));
    const existing = [{ id: items[0].id, name: items[0].name, priceUsd: items[0].priceUsd, costUsd: items[0].costUsd,
        category: items[0].category, unit: items[0].unit, barcode: items[0].barcode },
    { id: items[1].id, name: 'Nombre viejo', priceUsd: 99 },
    { id: '99999999-9999-4999-8999-999999999999', name: 'Producto que ya no está', priceUsd: 1 }];
    const diff = diffCatalogue(items, existing);
    assert.equal(diff.added.length, 1);
    assert.equal(diff.updated.length, 1);
    assert.equal(diff.updated[0].after.name, 'Amoxicilina 500mg');
    assert.equal(diff.unchanged.length, 1);
    assert.equal(diff.removed.length, 1);
    assert.equal(diff.removed[0].name, 'Producto que ya no está');
});

test('the importer never writes and never mutates its input', async () => {
    const rows = parseCatalogue(CSV);
    const snapshot = JSON.stringify(rows);
    const result = await validateCatalogue(rows);
    assert.equal(JSON.stringify(rows), snapshot);
    const existing = [];
    const existingSnapshot = JSON.stringify(existing);
    diffCatalogue(result.items, existing);
    assert.equal(JSON.stringify(existing), existingSnapshot);
});

test('the expected column list is explicit so an operator can prepare the file', () => {
    assert.deepEqual([...CATALOGUE_COLUMNS], ['sku', 'name', 'price', 'cost', 'stock', 'category', 'unit',
        'barcode', 'laboratorio', 'concentracion', 'presentacion', 'requiresPrescription', 'isControlled']);
});
