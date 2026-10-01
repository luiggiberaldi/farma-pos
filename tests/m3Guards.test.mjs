import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { createProcessorFixture } from './helpers/realModule.mjs';

// Regresión 2026-10-01 (Plan Maestro de Fixeo, Fase 4):
// M3. Guards defensivos en los puntos más expuestos: ningún render debe
// lanzar por un prop ausente. Hoy los padres siempre pasan los props, así
// que estos tests verifican el comportamiento degradado seguro.

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = file => resolve(root, file).replaceAll('\\', '/').replace(/\.jsx?$/, '').toLowerCase();

async function loadRenderHarness({ file, mocks = {}, namedExport = null, wrapHook = false }) {
  const stubs = new Map(Object.entries(mocks).map(([name, contents]) => [normalize(name), contents]));
  const target = JSON.stringify(resolve(root, file));
  const componentImport = wrapHook
    ? `import { ${namedExport} as Hook } from ${target};
       export function Component(props) { Hook(props); return null; }`
    : (namedExport
      ? `export { ${namedExport} as Component } from ${target};`
      : `export { default as Component } from ${target};`);
  const result = await build({
    stdin: {
      contents: `
        if (typeof globalThis.localStorage === 'undefined') {
          globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
        }
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
const AUTH_MOCK = `
  const state = {
    usuarioActivo: { id: 1, nombre: 'Dueño', rol: 'DUENO' },
    usuarios: [],
    issueApproval: async () => null,
    checkApproval: async () => null,
  };
  export function useAuthStore(selector) { return selector ? selector(state) : state; }
  useAuthStore.getState = () => state;
`;

test('M3 BulkPriceAdjustModal: products/categories ausentes no rompen el render', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: BulkPriceAdjustModal } =
    await loadRenderHarness({ file: 'src/components/Products/BulkPriceAdjustModal.jsx',
      mocks: { 'src/hooks/store/useAuthStore.js': AUTH_MOCK } });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(BulkPriceAdjustModal, {
      isOpen: true, onClose: noop, products: undefined, setProducts: noop,
      categories: undefined, activeCategory: 'todos', effectiveRate: 860,
      triggerHaptic: noop, showToast: noop,
    }));
  }, 'el modal debe renderizar con products/categories ausentes');
  assert.match(html, /Todos los productos/, 'muestra el selector de productos');
  assert.ok(/\(<!-- -->0/.test(html) || /\(0\)/.test(html), 'muestra conteo 0 en vez de lanzar');
});

test('M3 ProductShareModal: accounts/rates ausentes no rompen el render', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: ProductShareModal } =
    await loadRenderHarness({ file: 'src/components/ProductShareModal.jsx', namedExport: 'ProductShareModal' });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(ProductShareModal, {
      isOpen: true, onClose: noop, product: { priceUsd: 10, name: 'Prueba' },
      rates: undefined, accounts: undefined, streetRate: 0,
    }));
  }, 'el modal debe renderizar con accounts/rates ausentes');
  assert.match(html, /Cotización Flash/, 'el modal se abre igual');
});

test('M3 TransactionModal: transactionModal ausente no rompe el render', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: TransactionModal } =
    await loadRenderHarness({ file: 'src/components/Customers/TransactionModal.jsx' });
  assert.doesNotThrow(() => {
    const html = renderToString(React.createElement(TransactionModal, {
      transactionModal: undefined, setTransactionModal: noop, transactionAmount: '',
      setTransactionAmount: noop, currencyMode: 'USD', setCurrencyMode: noop,
    }));
    assert.equal(html, '', 'sin transactionModal no renderiza nada (en vez de lanzar)');
  });
});

test('M3 DiscountModal: cartSubtotalUsd ausente no rompe el render', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: DiscountModal } =
    await loadRenderHarness({ file: 'src/components/Sales/DiscountModal.jsx',
      mocks: { 'src/hooks/store/useAuthStore.js': AUTH_MOCK } });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(DiscountModal, {
      currentDiscount: { type: 'percentage', value: 0 }, onApply: noop, onClose: noop,
      cartSubtotalUsd: undefined, cart: [], effectiveRate: 860, tasaCop: 5, copEnabled: false,
    }));
  }, 'el modal debe renderizar con cartSubtotalUsd ausente');
  assert.ok(html.includes('0.00'), 'el subtotal cae a 0.00 en vez de lanzar');
  assert.ok(!html.includes('NaN'), 'no hay NaN en el render');
});

test('M3 useCheckoutPayments: customers ausente no rompe el hook', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: HookProbe } =
    await loadRenderHarness({ file: 'src/hooks/useCheckoutPayments.js', namedExport: 'useCheckoutPayments', wrapHook: true });
  assert.doesNotThrow(() => {
    renderToString(React.createElement(HookProbe, {
      cartTotalUsd: 10, cartTotalBs: 8600, effectiveRate: 860, customers: undefined,
      selectedCustomerId: null, setSelectedCustomerId: noop, paymentMethods: [],
      onConfirmSale: noop, requiresPrescription: false, triggerHaptic: noop,
      onCreateCustomer: noop, tasaCop: 0, isProcessingSale: false,
    }));
  }, 'el hook debe tolerar customers ausente');
});
