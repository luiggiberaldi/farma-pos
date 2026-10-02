/**
 * Prueba determinista: la pestaña Inventario ABRE para el cajero.
 *
 * Regresión real (2026-10-01): la pestaña 'catalogo' se agregó a las tabs del
 * cajero en App.jsx, pero el contenedor de la vista seguía envuelto en
 * `{!isCajero && ...}` y la pestaña abría vacía. Este test monta el
 * ProductsView real con usuario CAJERO (SSR determinista) y verifica que
 * renderiza el inventario en modo solo lectura, sin controles de admin.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createProcessorFixture } from './helpers/realModule.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = file => resolve(root, file).replaceAll('\\', '/').replace(/\.jsx?$/, '').toLowerCase();

async function loadRenderHarness({ file, mocks = {} }) {
  const stubs = new Map(Object.entries(mocks).map(([name, contents]) => [normalize(name), contents]));
  const target = JSON.stringify(resolve(root, file));
  const result = await build({
    stdin: {
      contents: `
        if (typeof globalThis.localStorage === 'undefined') {
          globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
        }
        export * as React from 'react';
        export { renderToString } from 'react-dom/server';
        export { ProductsView as Component } from ${target};
      `,
      resolveDir: root, sourcefile: 'qa-cajero-entry.jsx', loader: 'jsx',
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
  const outFile = resolve(outDir, `harness-cajero-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  await writeFile(outFile, result.outputFiles[0].text);
  const mod = await import(pathToFileURL(outFile).href);
  await unlink(outFile).catch(() => {});
  return mod;
}

const noop = () => {};

const CAJERO_AUTH_MOCK = `
  const state = {
    usuarioActivo: { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: '1234' },
    usuarios: [{ id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: '1234' }],
  };
  export function useAuthStore(selector) { return selector ? selector(state) : state; }
  useAuthStore.getState = () => state;
`;

const PRODUCT_CONTEXT_MOCK = `
  const products = [
    { id: 'p1', name: 'Aspirina 500mg', priceUsd: 2.5, stock: 10, category: 'insumos', barcode: '7590000002001' },
    { id: 'p2', name: 'Alcohol 70%', priceUsd: 1.2, stock: 0, category: 'insumos', barcode: '7590000002002', lowStockAlert: 5 },
  ];
  const categories = [{ id: 'todos', label: 'Todos' }, { id: 'insumos', label: 'Insumos' }];
  export function useProductContext() {
    return {
      products, categories,
      setProducts: () => {}, adoptCommittedProducts: () => {}, setCategories: () => {},
      saveError: null, retryProductSave: async () => {}, recoverCommittedInventory: async () => {},
      isLoadingProducts: false,
      streetRate: 860, setStreetRate: () => {}, useAutoRate: false, setUseAutoRate: () => {},
      customRate: 0, setCustomRate: () => {}, effectiveRate: 860,
      copEnabled: false, tasaCop: 0,
    };
  }
`;

const FORM_MOCK = `
  const noop = () => {};
  const asyncNoop = async () => {};
  export function useProductForm() {
    return {
      editingId: null, isModalOpen: false, setIsModalOpen: noop,
      name: '', setName: noop, barcode: '', setBarcode: noop,
      priceUsd: '', priceBs: '', costUsd: '', costBs: '',
      handlePriceUsdChange: noop, handlePriceBsChange: noop,
      handleCostUsdChange: noop, handleCostBsChange: noop,
      stock: '', setStock: noop, unit: 'unidad', setUnit: noop,
      unitsPerPackage: '', setUnitsPerPackage: noop,
      sellByUnit: false, setSellByUnit: noop, unitPriceUsd: '', setUnitPriceUsd: noop,
      category: 'insumos', setCategory: noop, lowStockAlert: 5, setLowStockAlert: noop,
      image: '', setImage: noop, packagingType: '', setPackagingType: noop,
      stockInLotes: false, setStockInLotes: noop, granelUnit: '', setGranelUnit: noop,
      genericName: '', setGenericName: noop, laboratorio: '', setLaboratorio: noop,
      concentracion: '', setConcentracion: noop, presentacion: '', setPresentacion: noop,
      requiresPrescription: false, setRequiresPrescription: noop,
      isControlled: false, setIsControlled: noop,
      requiresRefrigeration: false, setRequiresRefrigeration: noop,
      vencimiento: '', setVencimiento: noop,
      isFormShaking: false, fileInputRef: { current: null },
      lotesProducto: [], productMovements: [],
      handleImageUpload: noop, handleSave: asyncNoop, handleEdit: noop, handleClose: noop,
      guardarLote: asyncNoop, ajustarCantidadLote: asyncNoop,
    };
  }
`;

const mocks = {
  'src/hooks/store/useAuthStore': CAJERO_AUTH_MOCK,
  'src/context/ProductContext': PRODUCT_CONTEXT_MOCK,
  'src/hooks/useProductForm': FORM_MOCK,
  'src/hooks/useInventoryVelocity': `export function useInventoryVelocity() { return { salesVelocityMap: {} }; }`,
  'src/hooks/useProductFiltering': `export function useProductFiltering(products) { return { filteredProducts: products }; }`,
  'src/hooks/useWallet': `export function useWallet() { return { accounts: [] }; }`,
  'src/hooks/useAudit': `export function useAudit() { return { log: () => {} }; }`,
  'src/hooks/confirmState': `export function useConfirm() { return async () => true; }`,
  'src/utils/scopedStorage': `export const bindStorageContext = () => ({ context: { accountId: 'qa', sedeId: 'norte' } });`,
  'src/components/Toast': `export const showToast = () => {};`,
  'src/utils/ticketGenerator': `export const generarEtiquetas = () => {};`,
  'src/utils/localAdminOperations': `export const processLocalAdminOperation = async () => ({ products: [] });`,
  // Los modales no son parte de "la pestaña abre": se anulan para aislar la vista.
  'src/components/Products/ProductFormModal': `export default function ProductFormModal() { return null; }`,
  'src/components/Products/CategoryManagerModal': `export default function CategoryManagerModal() { return null; }`,
  'src/components/Products/BulkPriceAdjustModal': `export default function BulkPriceAdjustModal() { return null; }`,
  'src/components/Products/TransferenciasModal': `export default function TransferenciasModal() { return null; }`,
  'src/components/ProductShareModal': `export function ProductShareModal() { return null; }`,
};

test('ProductsView abre para el cajero: renderiza el inventario en solo lectura', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/views/ProductsView.jsx', mocks });

  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, { rates: {}, triggerHaptic: noop }));
  }, 'el inventario debe abrir sin lanzar para el cajero');
  assert.match(html, /Inventario/, 'muestra el título de la pestaña');
  assert.match(html, /Aspirina 500mg/, 'lista los productos');
  assert.match(html, /Alcohol 70%/, 'lista los productos');
  // Sin controles de administración
  assert.doesNotMatch(html, /title="Agregar"/, 'sin botón Nuevo');
  assert.doesNotMatch(html, /Transferencias entre sedes/, 'sin transferencias');
  assert.doesNotMatch(html, /Ajuste Masivo de Precios/, 'sin ajuste masivo');
  assert.doesNotMatch(html, /Borrar Todo/, 'sin borrado total');
  assert.doesNotMatch(html, /Imprimir Etiqueta/, 'sin impresión de etiquetas');
});

test('ProductsView cajero: render determinista (dos pasadas idénticas)', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/views/ProductsView.jsx', mocks });
  const props = { rates: {}, triggerHaptic: noop };
  const a = renderToString(React.createElement(Component, props));
  const b = renderToString(React.createElement(Component, props));
  assert.equal(a, b, 'el render del inventario del cajero es determinista');
});

test('App.jsx: el contenedor de la vista catalogo no está vetado al cajero', () => {
  const src = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
  assert.doesNotMatch(src, /\{!isCajero && <div[^>]*activeTab === 'catalogo'/);
  assert.match(src, /<div className=\{`flex-1 flex flex-col \$\{activeTab === 'catalogo'/);
});
