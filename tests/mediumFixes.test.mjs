import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { createProcessorFixture } from './helpers/realModule.mjs';

// Regresión 2026-10-01 (Plan Maestro de Fixeo, Fase 3):
// M1. AccordionSection estaba definido DENTRO del render en
//     DashboardPaymentSection.jsx y PaymentBreakdown.jsx: cada render creaba
//     un componente nuevo y React remontaba los acordeones (pierden
//     estado/foco). Ahora vive a nivel de módulo y recibe estado por props.
// M2. ProductPhoto hacía setState sincrónico al inicio del useEffect en cada
//     tarjeta con foto (renders en cascada; loop potencial si las deps
//     cambian). Ahora el estado se deriva de los props en lazy init +
//     re-derivación durante el render; el efecto solo resuelve la URL remota.

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = file => resolve(root, file).replaceAll('\\', '/').replace(/\.jsx?$/, '').toLowerCase();

async function loadRenderHarness(componentFile, mocks = {}, namedExport = null) {
  const stubs = new Map(Object.entries(mocks).map(([name, contents]) => [normalize(name), contents]));
  const componentImport = namedExport
    ? `export { ${namedExport} as Component } from ${JSON.stringify(resolve(root, componentFile))};`
    : `export { default as Component } from ${JSON.stringify(resolve(root, componentFile))};`;
  const result = await build({
    stdin: {
      contents: `
        export * as React from 'react';
        export { renderToString } from 'react-dom/server';
        ${componentImport}
      `,
      resolveDir: root, sourcefile: 'qa-render-entry.jsx', loader: 'jsx',
    },
    bundle: true, write: false, format: 'cjs', platform: 'node',
    jsx: 'automatic',
    resolveExtensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    logLevel: 'silent',
    define: {
      'import.meta.env.DEV': 'false', 'import.meta.env.PROD': 'true',
      'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""',
      'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
    },
    plugins: [{ name: 'test-io-only', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        const key = normalize(args.path.startsWith('.') ? resolve(args.resolveDir, args.path) : args.path);
        if (stubs.has(key)) return { path: key, namespace: 'test-io' };
      });
      b.onLoad({ filter: /.*/, namespace: 'test-io' }, args => ({ contents: stubs.get(args.path), loader: 'js' }));
    } }],
  });
  const outDir = '/tmp/qa-render';
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `harness-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  await writeFile(outFile, result.outputFiles[0].text);
  const mod = await import(pathToFileURL(outFile).href);
  await unlink(outFile).catch(() => {});
  return mod;
}

const noop = () => {};

for (const [label, file] of [
  ['DashboardPaymentSection', '../src/components/Dashboard/DashboardPaymentSection.jsx'],
  ['PaymentBreakdown', '../src/components/Reports/PaymentBreakdown.jsx'],
]) {
  test(`M1 ${label}: AccordionSection vive a nivel de módulo (no dentro del render)`, async t => {
    createProcessorFixture(t);
    const raw = readFileSync(new URL(file, import.meta.url), 'utf8');
    const src = raw.replace(/\/\/.*$/gm, '');
    assert.ok(/^function AccordionSection\(/m.test(src),
      'AccordionSection es una función estable a nivel de módulo');
    assert.ok(!src.includes('const AccordionSection ='),
      'no hay definición de AccordionSection dentro del componente padre');
    assert.ok(src.includes('isOpen={openPaySections.'), 'el padre pasa isOpen por props');
    assert.ok(src.includes('onToggle={toggleSection}'), 'el padre pasa onToggle por props');
  });
}

test('M1 DashboardPaymentSection: los acordeones respetan openPaySections', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: DashboardPaymentSection } =
    await loadRenderHarness('src/components/Dashboard/DashboardPaymentSection.jsx');
  const breakdown = { efectivo: { total: 100, currency: 'BS', label: 'Efectivo' } };
  const base = { isAdmin: true, paymentBreakdown: breakdown, bcvRate: 860, tasaCop: 5, copEnabled: false, todayTotalBs: 86000, setOpenPaySections: noop };
  const open = renderToString(React.createElement(DashboardPaymentSection, { ...base, openPaySections: { bs: true } }));
  assert.match(open, /Efectivo/, 'con la sección abierta se ven los métodos');
  const closed = renderToString(React.createElement(DashboardPaymentSection, { ...base, openPaySections: {} }));
  assert.ok(!closed.includes('Efectivo'), 'con la sección cerrada los métodos quedan ocultos');
  assert.match(closed, /Bolívares/, 'pero el encabezado del acordeón sigue visible');
});

test('M2 ProductPhoto: estado derivado de props sin setState sincrónico en el efecto', async t => {
  createProcessorFixture(t);
  const raw = readFileSync(new URL('../src/components/Products/ProductPhoto.jsx', import.meta.url), 'utf8');
  const src = raw.replace(/\/\/.*$/gm, '');
  assert.ok(/if \(sync\.photoHash !== photoHash/.test(src),
    'el estado se re-deriva durante el render cuando cambian los props (lazy init + ajuste en render)');
  // El efecto ya no blanquea el src sincrónicamente al inicio.
  const effectBody = src.slice(src.indexOf('useEffect('));
  assert.ok(!effectBody.includes('setSync(null)') && !/setSrc\(null\)/.test(effectBody),
    'el efecto no hace setState sincrónico de limpieza al inicio');
});

test('M2 ProductPhoto: render con imagen legado y sin hash no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: ProductPhoto } =
    await loadRenderHarness('src/components/Products/ProductPhoto.jsx', {}, 'ProductPhoto');
  // Caso legado: sin hash válido, usa `image` desde el lazy init.
  const html = renderToString(React.createElement(ProductPhoto, { image: '/legado/foto.jpg', alt: 'Prod' }));
  assert.match(html, /src="\/legado\/foto\.jpg"/, 'usa la imagen legado sin pasar por el efecto');
  // Sin hash ni imagen: no renderiza nada.
  assert.equal(renderToString(React.createElement(ProductPhoto, {})), '');
});
