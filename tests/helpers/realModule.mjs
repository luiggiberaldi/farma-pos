import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import * as scope from '../../src/config/storageScope.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const normalize = file => resolve(root, file).replaceAll('\\', '/').replace(/\.jsx?$/, '').toLowerCase();

// Bundle the production module, replacing only IO boundaries named by each test.
// No copy of checkout/authorization/business logic is implemented in this helper.
export async function loadRealModule(file, mocks = {}, { dev = false, exportsFrom = [] } = {}) {
  const stubs = new Map(Object.entries(mocks).map(([name, contents]) => [normalize(name), contents]));
  const entry = exportsFrom.length ? { stdin: {
    contents: [file, ...exportsFrom].map(name => `export * from ${JSON.stringify(resolve(root, name))};`).join('\n'),
    resolveDir: root, sourcefile: 'qa-entry.js', loader: 'js',
  } } : { entryPoints: [resolve(root, file)] };
  const result = await build({
    ...entry, bundle: true, write: false, format: 'esm', platform: 'node',
    // Entradas fuera del repo (p. ej. /tmp) también resuelven node_modules del repo.
    nodePaths: [resolve(root, 'node_modules')],
    // Match Vite: .js compatibility exports must win over .jsx providers.
    resolveExtensions: ['.mjs', '.js', '.mts', '.ts', '.jsx', '.tsx', '.json'],
    logLevel: 'silent', define: {
      'import.meta.env.DEV': JSON.stringify(dev), 'import.meta.env.PROD': JSON.stringify(!dev),
      'import.meta.env.VITE_SUPABASE_URL': '""', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '""',
      'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY': '""',
    },
    plugins: [{ name: 'test-io-only', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        const key = normalize(args.path.startsWith('.') ? resolve(args.resolveDir, args.path) : args.path);
        if (stubs.has(key)) return { path: key, namespace: 'test-io' };
      });
      b.onLoad({ filter: /.*/, namespace: 'test-io' }, args => ({ contents: stubs.get(args.path), loader: 'js' }));
    } }],
  });
  const source = `${result.outputFiles[0].text}\n// instance ${randomUUID()}\n//# sourceURL=qa-real/${file}\n`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

export function installMemoryBrowser(t) {
  const descriptors = new Map(['localStorage', 'sessionStorage', 'window', 'navigator', 'CustomEvent', 'fetch'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]));
  const makeStorage = () => {
    const data = new Map();
    return { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v)), removeItem: k => data.delete(k), clear: () => data.clear() };
  };
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: makeStorage() });
  Object.defineProperty(globalThis, 'sessionStorage', { configurable: true, value: makeStorage() });
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { addEventListener() {}, removeEventListener() {}, dispatchEvent() {}, location: { hostname: '127.0.0.1' } } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } });
  Object.defineProperty(globalThis, 'CustomEvent', { configurable: true, value: class { constructor(type, options) { this.type = type; this.detail = options?.detail; } } });
  globalThis.fetch = async () => { throw new Error('Unexpected network: test must provide a stub'); };
  t.after(() => { for (const [key, descriptor] of descriptors) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
}

export function createProcessorFixture(t) {
  installMemoryBrowser(t);
  scope.setActiveSedeId('central');
  const records = new Map();
  const writes = [];
  const queued = [];
  const f = {
    writes, queued, records,
    user: { id: 1, nombre: 'Dueno QA', rol: 'DUENO', sedeId: null },
    storage: {
      async getItem(key, fallback = null, context = null) {
        const name = context && scope.getStorageKeyForContext ? scope.getStorageKeyForContext(key, context) : scope.getScopedStorageKey(key);
        return structuredClone(records.has(name) ? records.get(name) : fallback);
      },
      async setItem(key, value, context = null) {
        const name = context && scope.getStorageKeyForContext ? scope.getStorageKeyForContext(key, context) : scope.getScopedStorageKey(key);
        writes.push({ key, scopedKey: name, value: structuredClone(value) });
        records.set(name, structuredClone(value));
      },
      async transaction(declared, planner, context = scope.captureStorageContext()) {
        const values = Object.create(null);
        for (const item of declared) values[item.name] = await f.storage.getItem(item.key, item.fallback, item.context || context);
        const planned = planner(values);
        const staged = Object.entries(planned.writes).map(([name, value]) => ({ item: declared.find(item => item.name === name), value: structuredClone(value) }));
        const original = new Map(records);
        const beforeWrites = writes.length;
        try {
          for (const { item, value } of staged) await f.storage.setItem(item.key, value, item.context || context);
        } catch (error) {
          records.clear(); for (const [key, value] of original) records.set(key, value);
          writes.splice(beforeWrites);
          throw error;
        }
        const queueWrites = staged.find(entry => entry.item.key === 'offline_sales_queue');
        if (queueWrites) {
          const oldQueue = original.get(scope.getStorageKeyForContext('offline_sales_queue', { ...context, accountId: context.accountId || 'local' })) || [];
          for (const entry of queueWrites.value) if (!oldQueue.some(old => old.queue_id === entry.queue_id)) queued.push(entry);
        }
        return planned.result;
      },
    },
    queue: { async addSaleToQueue(payload) { const entry = { queue_id: payload.queue_id || randomUUID(), payload }; queued.push(entry); return entry; } },
    cloud: { auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-token', user: { id: 'account-qa' } } }, error: null }) } },
  };
  const registryKey = `__qa_${randomUUID()}`;
  globalThis[registryKey] = f;
  t.after(() => delete globalThis[registryKey]);
  const ref = `globalThis[${JSON.stringify(registryKey)}]`;
  f.mocks = {
    'src/utils/storageService.js': `export const storageService = ${ref}.storage;`,
    'src/hooks/store/useAuthStore.js': `export const useAuthStore = { getState: () => ({ usuarioActivo: ${ref}.user }) };`,
    'src/services/auditService.js': 'export const logEvent = () => {};',
    'src/services/notificationService.js': 'export const createNotification = () => {}; export const NOTIF_TYPES = { VENTA_ANULADA: "void" };',
    'src/services/offlineQueueService.js': `export const offlineQueueService = ${ref}.queue;`,
    'src/core/supabaseClient.js': `export const supabase = ${ref}.cloud;`,
    'src/services/PrinterSerial.js': 'export const PrinterSerial = { isConnected: () => false };',
  };
  f.seed = async (key, value) => { await f.storage.setItem(key, value); writes.length = 0; };
  return f;
}

export function saleOptions(extra = {}) {
  const product = { id: '11111111-1111-4111-8111-111111111111', name: 'Producto QA', stock: 10, priceUsd: 10, priceUsdt: 10, costUsd: 4 };
  return {
    cart: [{ ...product, qty: 1 }], products: [product], customers: [], selectedCustomerId: '',
    cartTotalUsd: 10, cartSubtotalUsd: 10, cartTotalBs: 1000, effectiveRate: 100,
    payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10, amountBs: 1000 }],
    changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 }, copEnabled: false, tasaCop: 0,
    ...extra,
  };
}
