// PDF térmico 80mm multipágina (Fase 2f).
// El generador hacía UNA sola página del alto total del canvas: un recibo
// largo (150 items ≈ 14000px de canvas a scale 2) roza el límite de canvas
// del navegador y produce un PDF de ~2 m de alto. Ahora se pagina en tramos
// de THERMAL_PDF_MAX_PAGE_MM.
//
// Verificación con recibo largo sintético: el HTML del ticket contiene los
// 150 items (2 filas <tr> por item) y la paginación cubre el canvas completo
// sin huecos ni solapes. Sin navegador real no se ejecuta html2canvas; la
// matemática de paginación (lo que decide si se corta) sí se prueba.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installMemoryBrowser, loadRealModule } from './helpers/realModule.mjs';

installMemoryBrowser({ after() {} });
if (typeof globalThis.location === 'undefined') {
    globalThis.location = { origin: 'https://test.local', href: 'https://test.local/' };
}
localStorage.setItem('printer_paper_width', '80');
localStorage.setItem('printer_mode', 'thermal');

const { buildThermalHTML, paginateThermalCanvas, THERMAL_PDF_MAX_PAGE_MM } =
    await loadRealModule('src/utils/ticketGenerator.js');

const ITEMS = 150;
const longSale = {
    saleNumber: 1234,
    totalUsd: ITEMS * 5,
    totalBs: ITEMS * 500,
    items: Array.from({ length: ITEMS }, (_, i) => ({
        qty: 1, isWeight: false, name: `Producto sintético ${i + 1}`, priceUsd: 5,
    })),
    payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: ITEMS * 5 }],
};

test('recibo largo sintético: el HTML contiene los 150 items completos', () => {
    const html = buildThermalHTML(longSale, 100, true);
    // Cada item genera 2 filas <tr> en la tabla de items.
    const itemRows = (html.match(/<tr>\s*<td style="text-align:left;font-size:/g) || []).length;
    assert.equal(itemRows, ITEMS, `filas de item en el HTML: ${itemRows}`);
    for (let i = 1; i <= ITEMS; i++) {
        assert.ok(html.includes(`Producto sintético ${i}`), `falta el item ${i}`);
    }
    assert.ok(html.includes('80mm auto'), 'tamaño de página 80mm');
});

test('paginación: recibo corto queda en una sola página (comportamiento anterior)', () => {
    // Recibo típico: canvas 600x2400 px → 320mm de alto... no: 2400/600*80 = 320mm > 290.
    // Uno realmente corto: 600x1200 → 160mm.
    const pages = paginateThermalCanvas(600, 1200, 80);
    assert.equal(pages.length, 1);
    assert.equal(pages[0].y, 0);
    assert.equal(pages[0].h, 1200);
    assert.ok(Math.abs(pages[0].heightMm - 160) < 0.01);
});

test('paginación: recibo largo se parte sin huecos ni solapes', () => {
    // 150 items ≈ canvas 600x14000 px a scale 2, papel 80mm.
    const pages = paginateThermalCanvas(600, 14000, 80);
    const totalMm = (14000 / 600) * 80; // ≈ 1866.67mm
    const expected = Math.ceil(totalMm / THERMAL_PDF_MAX_PAGE_MM);
    assert.equal(pages.length, expected, `${pages.length} páginas para ${totalMm.toFixed(0)}mm`);
    assert.ok(pages.length > 1, 'más de una página');
    // Cobertura total contigua.
    let y = 0;
    let mmSum = 0;
    for (const p of pages) {
        assert.equal(p.y, y, `la página ${p.page} empieza donde terminó la anterior`);
        assert.ok(p.h > 0, 'alto positivo');
        assert.ok(p.heightMm <= THERMAL_PDF_MAX_PAGE_MM + 0.01, `página ${p.page} ≤ ${THERMAL_PDF_MAX_PAGE_MM}mm`);
        y += p.h;
        mmSum += p.heightMm;
    }
    assert.equal(y, 14000, 'los recortes cubren todo el canvas');
    assert.ok(Math.abs(mmSum - totalMm) < 0.01, 'la suma en mm es el alto total');
});

test('paginación: entradas inválidas no rompen', () => {
    assert.deepEqual(paginateThermalCanvas(0, 100, 80), []);
    assert.deepEqual(paginateThermalCanvas(600, 0, 80), []);
});
