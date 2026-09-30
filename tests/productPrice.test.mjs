/**
 * Arnés: el precio principal es USD (`priceUsd`), no USDT.
 * El sistema no trabaja con USDT: ningún código debe referenciar `priceUsdt`,
 * los datos legados se normalizan al cargar, y ningún producto en $0
 * puede entrar al carrito ni cobrarse.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { normalizeProductPrice, hasValidSalePrice } from '../src/utils/productPrice.js';

test('auditoría: no queda ninguna referencia a priceUsdt en código src/', () => {
    let out = '';
    try {
        out = execSync('grep -rn "priceUsdt" src/ --include="*.js" --include="*.jsx" || true', { cwd: new URL('../', import.meta.url).pathname }).toString().trim();
    } catch {
        out = '';
    }
    // Solo cuentan usos reales en código; los comentarios que documentan
    // la migración del nombre legado están permitidos, igual que el propio
    // shim de normalización (src/utils/productPrice.js) que debe leer el
    // campo viejo una vez para migrarlo.
    const enCodigo = out.split('\n').filter(line => {
        if (!line.trim()) return false;
        if (line.startsWith('src/utils/productPrice.js:')) return false;
        const code = line.split(':').slice(2).join(':');
        const stripped = code.trim();
        return !(stripped.startsWith('//') || stripped.startsWith('*') || stripped.startsWith('/*'));
    });
    assert.equal(enCodigo.join('\n'), '', `Referencias a priceUsdt en código:\n${enCodigo.join('\n')}`);
});

test('normalizeProductPrice: migra precio legado priceUsdt → priceUsd', () => {
    const legado = { id: 'x', name: 'Viejo', priceUsdt: 5.5 };
    const norm = normalizeProductPrice(legado);
    assert.equal(norm.priceUsd, 5.5);
    // No toca productos que ya tienen priceUsd válido
    const actual = { id: 'y', name: 'Nuevo', priceUsd: 3.25, priceUsdt: 9.99 };
    assert.equal(normalizeProductPrice(actual).priceUsd, 3.25);
    // No inventa precio si no había ninguno
    assert.equal(normalizeProductPrice({ id: 'z' }).priceUsd, undefined);
    // Entradas no-objeto pasan intactas
    assert.equal(normalizeProductPrice(null), null);
});

test('hasValidSalePrice: bloquea $0, negativos, NaN y ausentes', () => {
    assert.equal(hasValidSalePrice({ priceUsd: 10 }), true);
    assert.equal(hasValidSalePrice({ priceUsd: 0.01 }), true);
    assert.equal(hasValidSalePrice({ priceUsd: 0 }), false, '$0 no se vende');
    assert.equal(hasValidSalePrice({ priceUsd: -5 }), false, 'negativo no se vende');
    assert.equal(hasValidSalePrice({ priceUsd: NaN }), false, 'NaN no se vende');
    assert.equal(hasValidSalePrice({ priceUsd: 'abc' }), false, 'texto no se vende');
    assert.equal(hasValidSalePrice({}), false, 'sin precio no se vende');
    assert.equal(hasValidSalePrice(null), false);
    // Producto legado normalizado sí pasa
    assert.equal(hasValidSalePrice(normalizeProductPrice({ priceUsdt: 7 })), true);
});

test('lotes del inventario 2026 usan priceUsd (vendibles tras la migración)', async () => {
    const { SEED_PRODUCTS_INV01 } = await import('../src/config/seed/seedProductsInv01.js');
    const { SEED_PRODUCTS_INV02 } = await import('../src/config/seed/seedProductsInv02.js');
    const { SEED_PRODUCTS_INV03 } = await import('../src/config/seed/seedProductsInv03.js');
    const todos = [...SEED_PRODUCTS_INV01, ...SEED_PRODUCTS_INV02, ...SEED_PRODUCTS_INV03];
    assert.equal(todos.length, 1191);
    const sinCampo = todos.filter(p => !('priceUsd' in p));
    assert.equal(sinCampo.length, 0, 'todos traen priceUsd');
    const conLegado = todos.filter(p => 'priceUsdt' in p);
    assert.equal(conLegado.length, 0, 'ninguno trae priceUsdt');
    // Los 58 sin precio legible quedan bloqueados por el guardarraíl
    const bloqueados = todos.filter(p => !hasValidSalePrice(p));
    assert.equal(bloqueados.length, 58);
});
