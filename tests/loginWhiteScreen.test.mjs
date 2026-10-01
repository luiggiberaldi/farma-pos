import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile, mkdir } from 'node:fs/promises';
import { createProcessorFixture } from './helpers/realModule.mjs';

// Regresión 2026-10-01: pantalla blanca al tocar un tile de operador o al
// cambiar de sede. Causa raíz: `PinEntry` (LoginPinModal.jsx) referenciaba
// `isOpen` sin recibirlo como prop -> ReferenceError en render -> React
// desmontaba todo el árbol. Segundo hallazgo del mismo flujo:
// `SuperAdminModal` llamaba `useEscapeToClose` DESPUÉS de
// `if (!isOpen) return null`, lo que cambia el orden de hooks al abrir
// "Olvidé mi PIN" y también tumba la app.

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = file => resolve(root, file).replaceAll('\\', '/').replace(/\.jsx?$/, '').toLowerCase();

// Carga el componente REAL en un bundle que incluye react y react-dom/server
// para que el render comparta una sola instancia de React.
async function loadRenderHarness(componentFile, mocks = {}) {
  const stubs = new Map(Object.entries(mocks).map(([name, contents]) => [normalize(name), contents]));
  const result = await build({
    stdin: {
      contents: `
        export * as React from 'react';
        export { renderToString } from 'react-dom/server';
        export { default as Component } from ${JSON.stringify(resolve(root, componentFile))};
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
    },
    plugins: [{ name: 'test-io-only', setup(b) {
      b.onResolve({ filter: /.*/ }, args => {
        const key = normalize(args.path.startsWith('.') ? resolve(args.resolveDir, args.path) : args.path);
        if (stubs.has(key)) return { path: key, namespace: 'test-io' };
      });
      b.onLoad({ filter: /.*/, namespace: 'test-io' }, args => ({ contents: stubs.get(args.path), loader: 'js' }));
    } }],
  });
  // A archivo real (no data: URL): los require dinámicos del bundle
  // (react-dom/server) no funcionan importados desde data:.
  const outDir = '/tmp/qa-render';
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `harness-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  await writeFile(outFile, result.outputFiles[0].text);
  return import(pathToFileURL(outFile).href);
}

const AUTH_MOCK = `
  const state = {
    requireLogin: false,
    lastAuthError: null,
    cancelPendingAuthentication() {},
    usuarios: [{ id: 1, nombre: 'Dueño', rol: 'DUENO', pin: '000000', pinHashed: true }],
  };
  export function useAuthStore(selector) { return selector ? selector(state) : state; }
  useAuthStore.getState = () => state;
`;

const SEDE_MOCK = `
  const state = { sedeActivaId: 'central', setSedeActiva: async () => true };
  export function useSedeStore(selector) { return selector ? selector(state) : state; }
  useSedeStore.getState = () => state;
`;

const dueno = { id: 1, nombre: 'Dueño', rol: 'DUENO', pin: '000000', pinHashed: true };
const cajero = { id: 2, nombre: 'Cajero Norte', rol: 'CAJERO', pin: '1234', pinHashed: true, sedeId: 'norte' };
const noop = () => {};

test('LoginPinModal: abrir el PIN del operador (tap en tile) no lanza ReferenceError', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: LoginPinModal } =
    await loadRenderHarness('src/components/security/LoginPinModal.jsx', { 'src/hooks/store/useAuthStore.js': AUTH_MOCK });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(LoginPinModal, { isOpen: true, user: dueno, onClose: noop, onSubmit: async () => true }));
  }, 'el modal del PIN debe renderizar sin errores');
  assert.match(html, /PIN de 6 d.gitos/, 'el dueño ve PIN de 6 dígitos');
  const htmlCajero = renderToString(React.createElement(LoginPinModal, { isOpen: true, user: cajero, onClose: noop, onSubmit: async () => true }));
  assert.match(htmlCajero, /PIN de 4 d.gitos/, 'el cajero ve PIN de 4 dígitos');
  assert.equal(renderToString(React.createElement(LoginPinModal, { isOpen: false, user: dueno, onClose: noop, onSubmit: async () => true })), '');
});

test('BranchPinModal: el flujo de cambio de sede renderiza el PIN del dueño', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: BranchPinModal } =
    await loadRenderHarness('src/components/security/BranchPinModal.jsx', {
      'src/hooks/store/useAuthStore.js': AUTH_MOCK,
      'src/hooks/store/useSedeStore.js': SEDE_MOCK,
    });
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(BranchPinModal, { targetSedeId: 'norte', onClose: noop }));
  }, 'el modal de cambio de sede debe renderizar sin errores');
  assert.match(html, /Autoriza el cambio de sede/, 'pide autorización del dueño');
});

test('SedeName: nombre de sede ausente no rompe el render', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: SedeName } =
    await loadRenderHarness('src/components/security/SedeName.jsx');
  assert.doesNotThrow(() => {
    renderToString(React.createElement(SedeName, { nombre: undefined }));
    renderToString(React.createElement(SedeName, { nombre: 'C&y 2025' }));
  });
  const html = renderToString(React.createElement(SedeName, { nombre: 'C&Y 2025' }));
  assert.match(html, /C&amp;Y/, 'normaliza la marca a C&Y');
  assert.match(html, /2025/, 'el año queda visible');
});

test('SuperAdminModal: useEscapeToClose va ANTES del early return (orden de hooks estable)', async t => {
  createProcessorFixture(t);
  const src = readFileSync(new URL('../src/components/security/SuperAdminModal.jsx', import.meta.url), 'utf8');
  const hookCall = src.indexOf('useEscapeToClose(handleClose');
  const earlyReturn = src.indexOf('if (!isOpen) return null');
  assert.ok(hookCall !== -1, 'existe la llamada a useEscapeToClose');
  assert.ok(earlyReturn !== -1, 'existe el early return');
  assert.ok(hookCall < earlyReturn,
    'el hook debe llamarse antes del early return o abrir "Olvidé mi PIN" cambia el orden de hooks (pantalla blanca)');
});

test('LoginPinModal: PinEntry recibe isOpen como prop', async t => {
  createProcessorFixture(t);
  const src = readFileSync(new URL('../src/components/security/LoginPinModal.jsx', import.meta.url), 'utf8');
  assert.match(src, /<PinEntry[^>]*isOpen=\{isOpen\}/, 'LoginPinModal pasa isOpen a PinEntry');
  assert.match(src, /function PinEntry\(\{\s*isOpen,/, 'PinEntry declara isOpen en sus props');
});

test('LoginPinModal: el campo de PIN no abre el teclado del móvil (inputmode=none)', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: LoginPinModal } =
    await loadRenderHarness('src/components/security/LoginPinModal.jsx', { 'src/hooks/store/useAuthStore.js': AUTH_MOCK });
  const html = renderToString(React.createElement(LoginPinModal, { isOpen: true, user: dueno, onClose: noop, onSubmit: async () => true }));
  // El modal trae su propio teclado numérico en pantalla; el input no debe
  // pedirle al SO que abra el suyo (reporte 2026-10-01: el teclado de Android
  // tapaba el teclado de la app en "Autoriza el cambio de sede").
  assert.match(html, /id="operator-pin"[^>]*inputmode="none"/i, 'el input del PIN usa inputmode="none"');
  assert.doesNotMatch(html, /id="operator-pin"[^>]*inputmode="numeric"/i, 'ya no pide teclado numérico del SO');
});
