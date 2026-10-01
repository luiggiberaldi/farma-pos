import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { createProcessorFixture } from './helpers/realModule.mjs';

// Cobertura de render 2026-10-01 (Plan Maestro de Fixeo, Fase 5):
// Los modales y gates pre-login listados aquí NO tenían ningún test de
// render. Cada test verifica que el componente renderiza sin lanzar con
// props mínimos — la misma clase de defecto que produjo las pantallas
// blancas de ayer (ReferenceError / orden de hooks / props ausentes).

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = file => resolve(root, file).replaceAll('\\', '/').replace(/\.jsx?$/, '').toLowerCase();

async function loadRenderHarness({ file, mocks = {}, namedExport = null }) {
  const stubs = new Map(Object.entries(mocks).map(([name, contents]) => [normalize(name), contents]));
  const target = JSON.stringify(resolve(root, file));
  const componentImport = namedExport
    ? `export { ${namedExport} as Component } from ${target};`
    : `export { default as Component } from ${target};`;
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
  // Limpieza: los bundles son pesados (html2canvas, etc.) y /tmp es limitado.
  await unlink(outFile).catch(() => {});
  return mod;
}

const noop = () => {};

const AUTH_MOCK = `
  const state = {
    usuarioActivo: null,
    usuarios: [{ id: 1, nombre: 'Dueño', rol: 'DUENO', pin: '000000' }, { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: '1234' }],
    login: async () => true,
    logout: () => {},
    sessionLocked: false,
    unlock: async () => true,
    clockInOffer: null,
    clearClockInOffer() {},
    clockIn: () => true,
  };
  export function useAuthStore(selector) { return selector ? selector(state) : state; }
  useAuthStore.getState = () => state;
`;

const SEDE_MOCK = `
  const state = { sedeActivaId: 'central', setSedeActiva: async () => true };
  export function useSedeStore(selector) { return selector ? selector(state) : state; }
  useSedeStore.getState = () => state;
`;

const CONFIRM_MOCK = `
  export function useConfirm() { return async () => true; }
`;

test('AperturaCajaModal: render abierto no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/Dashboard/AperturaCajaModal.jsx' });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, { isOpen: true, onClose: noop, onConfirm: noop }));
  });
  assert.match(html, /Apertura de Caja|Abrir caja/i);
  assert.equal(renderToString(React.createElement(Component, { isOpen: false, onClose: noop, onConfirm: noop })), '');
});

test('CashReconciliationModal: render abierto no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/Dashboard/CashReconciliationModal.jsx' });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      isOpen: true, onClose: noop, onConfirm: noop, expectedUsd: 100, expectedBs: 86000, bcvRate: 860,
    }));
  });
  assert.ok(html.length > 100, 'renderiza el contenido del arqueo');
});

test('CheckoutModal: render con carrito no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/Sales/CheckoutModal.jsx' });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      onClose: noop, cartSubtotalUsd: 10, cartSubtotalBs: 8600, cartTotalUsd: 10, cartTotalBs: 8600,
      discountData: null, effectiveRate: 860, customers: [], selectedCustomerId: null,
      setSelectedCustomerId: noop, paymentMethods: [], onConfirmSale: noop, isProcessingSale: false,
      requiresPrescription: false, triggerHaptic: noop, onCreateCustomer: noop,
      copEnabled: false, tasaCop: 0, currentFloatUsd: 0, currentFloatBs: 0, useAutoRate: false,
    }));
  });
  assert.match(html, /PROCESAR PAGO/);
});

test('ReceiptModal: render con recibo no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/Sales/ReceiptModal.jsx' });
  const receipt = {
    id: 'ABC123XYZ', totalUsd: 25.5, totalBs: 21930,
    payments: [{ methodLabel: 'Efectivo' }],
    items: [{ name: 'Aspirina', qty: 2, priceUsd: 5 }, { name: 'Alcohol', qty: 1, priceUsd: 15.5 }],
  };
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      receipt, onClose: noop, onShareWhatsApp: noop, currentRate: 860,
    }));
  });
  assert.match(html, /ABC123/, 'muestra el id de la venta');
  assert.equal(renderToString(React.createElement(Component, {
    receipt: null, onClose: noop, onShareWhatsApp: noop, currentRate: 860,
  })), '');
});

test('MobileCartSheet: render abierto no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/Sales/MobileCartSheet.jsx' });
  const cart = [{ id: 'p1', name: 'Aspirina', priceUsd: 5, qty: 2 }];
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      cart, cartItemCount: 2, cartTotalUsd: 10, cartTotalBs: 8600,
      isCartSheetOpen: true, setIsCartSheetOpen: noop,
      showCheckout: false, showReceipt: false,
      cartSubtotalUsd: 10, cartSubtotalBs: 8600, effectiveRate: 860, discountData: null,
      setShowDiscountModal: noop, updateQty: noop, removeFromCart: noop,
      setShowCheckout: noop, setShowClearCartConfirm: noop,
      triggerHaptic: noop, cartSelectedIndex: -1, copEnabled: false, tasaCop: 0,
    }));
  });
  assert.ok(html.length > 50, 'renderiza la hoja del carrito');
});

test('MonitorView: render no lanza', async t => {
  createProcessorFixture(t);
  // html2canvas toca el DOM al importarse (falla en node); se stubbea porque
  // solo se usa para capturas bajo demanda, no para el render.
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/views/MonitorView.jsx',
      mocks: { 'html2canvas': `export default async function html2canvas() { return { toDataURL: () => '' }; }` } });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      rates: { bcv: { price: 860 }, euro: { price: 861 }, lastUpdate: new Date().toISOString() },
      loading: false, isOffline: false, onRefresh: noop,
      toggleTheme: noop, theme: 'light', copyLogs: noop, addLog: noop, triggerHaptic: noop,
    }));
  });
  assert.ok(html.length > 50, 'renderiza el monitor');
});

test('DeleteHistoryModal: render abierto no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/Dashboard/DeleteHistoryModal.jsx' });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      isOpen: true, onClose: noop, deleteConfirmText: '', setDeleteConfirmText: noop,
      setSales: noop, storageService: {}, salesKey: 'bodega_sales_v1', sedeId: 'central',
      remotePaused: true, cloudPauseMessage: 'Sync pausado',
    }));
  });
  assert.ok(html.length > 50, 'renderiza el modal de borrado');
});

test('RecycleSaleModal: render con oferta no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/Dashboard/RecycleSaleModal.jsx' });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      recycleOffer: { items: [{ name: 'Aspirina', qty: 1 }] }, onClose: noop, onRecycle: noop,
    }));
  });
  assert.ok(html.length > 50, 'renderiza la oferta de reciclaje');
  assert.equal(renderToString(React.createElement(Component, {
    recycleOffer: null, onClose: noop, onRecycle: noop,
  })), '');
});

// ─── Gates pre-login de App.jsx ───

test('LockScreen: render de "¿Quién está operando?" no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/security/LockScreen.jsx',
      mocks: {
        'src/hooks/store/useAuthStore.js': AUTH_MOCK,
        'src/hooks/store/useSedeStore.js': SEDE_MOCK,
        'src/hooks/confirmState.js': CONFIRM_MOCK,
      } });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      installPrompt: null, onInstall: noop, showIOSButton: false,
      onShowIOSInstall: noop, onEnterMonitor: noop,
    }));
  });
  // El título va partido por un <strong>: "¿Quién está <strong>operando</strong>?".
  assert.match(html, /¿Quién está/, 'muestra el selector de operador');
  assert.match(html, /operando/, 'muestra el título completo');
  assert.match(html, /Dueño/, 'lista al dueño');
});

test('ClockInPrompt: sin oferta no renderiza nada; con oferta no lanza', async t => {
  createProcessorFixture(t);
  const withOffer = AUTH_MOCK.replace('clockInOffer: null,', "clockInOffer: { userName: 'Cajero Norte' },");
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/security/ClockInPrompt.jsx',
      mocks: { 'src/hooks/store/useAuthStore.js': withOffer } });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {}));
  });
  assert.match(html, /Fichar entrada/, 'muestra el prompt de fichaje');

  const { renderToString: r2, React: R2, Component: C2 } =
    await loadRenderHarness({ file: 'src/components/security/ClockInPrompt.jsx',
      mocks: { 'src/hooks/store/useAuthStore.js': AUTH_MOCK } });
  assert.equal(r2(R2.createElement(C2, {})), '', 'sin oferta no renderiza nada');
});

test('TermsOverlay: render no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/TermsOverlay.jsx' });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, { onAccepted: noop }));
  });
  assert.ok(html.length > 50, 'renderiza los términos');
});

test('OnboardingOverlay: render no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/OnboardingOverlay.jsx' });
  assert.doesNotThrow(() => {
    renderToString(React.createElement(Component, {}));
  });
});

test('SpotlightTour: render con pasos no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/SpotlightTour.jsx' });
  assert.doesNotThrow(() => {
    // Sin rect medido (SSR) retorna null de forma segura.
    renderToString(React.createElement(Component, { steps: [{ target: '#x', title: 'T', text: 't' }], onComplete: noop }));
    renderToString(React.createElement(Component, { steps: [], onComplete: noop }));
  });
});

test('CloudAuthModal: render de login no lanza', async t => {
  createProcessorFixture(t);
  const CLOUD_MOCK = `
    export function useCloudAuthLogic() {
      const noop = () => {};
      return {
        inputEmail: '', setInputEmail: noop, inputPassword: '', setInputPassword: noop,
        emailError: null, setEmailError: noop, passwordError: null, setPasswordError: noop,
        isRecoveringPassword: false, setIsRecoveringPassword: noop,
        deviceLimitError: null, setDeviceLimitError: noop,
        blockedDevices: [], setBlockedDevices: noop,
        dataConflictPending: null, importStatus: null, statusMessage: '',
        localDeviceAlias: 'test', setLocalDeviceAlias: noop,
        handleDataConflictChoice: noop, handleUnlinkSpecificDevice: noop,
        handleSaveCloudAccount: noop, handleResetPasswordRequest: noop,
      };
    }
  `;
  const { React, renderToString, Component } =
    await loadRenderHarness({ file: 'src/components/security/CloudAuthModal.jsx',
      mocks: {
        'src/hooks/useCloudAuthLogic.js': CLOUD_MOCK,
        'src/hooks/confirmState.js': CONFIRM_MOCK,
      } });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(Component, {
      isOpen: true, onClose: noop, forceLogin: true, installPrompt: null,
      onInstall: noop, showIOSButton: false, onShowIOSInstall: noop,
    }));
  });
  assert.ok(html.length > 50, 'renderiza el modal de cuenta cloud');
});

// ─── Bajos (B1/B2/B3) ───

test('B1 useConfirm: sin claves duplicadas en VARIANTS', async t => {
  createProcessorFixture(t);
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('../src/hooks/useConfirm.jsx', import.meta.url), 'utf8');
  const src = raw.replace(/\/\/.*$/gm, '');
  const variantsBlock = src.slice(src.indexOf('const VARIANTS'), src.indexOf('};', src.indexOf('const VARIANTS')) + 2);
  for (const key of ['danger', 'warning', 'cart', 'logout', 'unlink']) {
    const count = (variantsBlock.match(new RegExp(`\\b${key}:`, 'g')) || []).length;
    assert.equal(count, 1, `la clave "${key}" aparece exactamente una vez en VARIANTS`);
  }
});

test('B2 App.jsx: sin gate duplicado de usuarioActivo (código muerto)', async t => {
  createProcessorFixture(t);
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
  const src = raw.replace(/\/\/.*$/gm, '');
  const count = (src.match(/if \(!usuarioActivo\)/g) || []).length;
  assert.equal(count, 5, 'solo quedan los 4 guards en callbacks + el gate de render (el duplicado muerto se eliminó)');
});

test('B3 SalesHeader: rateAgeMs memoizado, sin Date.now() directo en render', async t => {
  createProcessorFixture(t);
  const { readFileSync } = await import('node:fs');
  const raw = readFileSync(new URL('../src/components/Sales/SalesHeader.jsx', import.meta.url), 'utf8');
  const src = raw.replace(/\/\/.*$/gm, '');
  assert.ok(/const rateAgeMs = useMemo\(/.test(src), 'rateAgeMs se calcula con useMemo');
  assert.ok(!/const rateAgeMs = rates\?\.lastUpdate \? Date\.now\(\)/.test(src),
    'ya no hay Date.now() directo en el cuerpo del render');
});
