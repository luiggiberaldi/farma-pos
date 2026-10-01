import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { createProcessorFixture } from './helpers/realModule.mjs';

// Regresión 2026-10-01 (Plan Maestro de Fixeo, Fase 1):
// C1. TicketClientModal llamaba `useEscapeToClose` DESPUÉS de
//     `if (!ticketPendingSale) return null` -> al abrir "enviar ticket" el
//     orden de hooks cambiaba y el Dashboard caía al fallback "Error de Carga".
// C2. El ErrorBoundary solo envolvía las vistas por pestaña; todo el flujo
//     pre-login (login, PIN, cambio de sede, bloqueo, Supervisión) quedaba
//     fuera -> cualquier throw futuro = pantalla blanca total.

const root = fileURLToPath(new URL('../', import.meta.url));
const normalize = file => resolve(root, file).replaceAll('\\', '/').replace(/\.jsx?$/, '').toLowerCase();

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
  const outDir = '/tmp/qa-render';
  await mkdir(outDir, { recursive: true });
  const outFile = resolve(outDir, `harness-${Date.now()}-${Math.random().toString(36).slice(2)}.cjs`);
  await writeFile(outFile, result.outputFiles[0].text);
  const mod = await import(pathToFileURL(outFile).href);
  await unlink(outFile).catch(() => {});
  return mod;
}

const noop = () => {};
const sale = { id: 'TEST-1', total: 10.5 };

test('C1 TicketClientModal: useEscapeToClose va ANTES del early return (orden de hooks estable)', async t => {
  createProcessorFixture(t);
  const src = readFileSync(new URL('../src/components/Dashboard/TicketClientModal.jsx', import.meta.url), 'utf8');
  // Se buscan las sentencias reales (inicio de línea), no menciones en comentarios.
  const hookCall = src.search(/^\s*useEscapeToClose\(reset/m);
  const earlyReturn = src.search(/^\s*if \(!ticketPendingSale\) return null;$/m);
  assert.ok(hookCall !== -1, 'existe la llamada a useEscapeToClose');
  assert.ok(earlyReturn !== -1, 'existe el early return');
  assert.ok(hookCall < earlyReturn,
    'el hook debe llamarse antes del early return o abrir "enviar ticket" cambia el orden de hooks y tumba el Dashboard');
});

test('C1 TicketClientModal: render con y sin venta pendiente no lanza', async t => {
  createProcessorFixture(t);
  const { React, renderToString, Component: TicketClientModal } =
    await loadRenderHarness('src/components/Dashboard/TicketClientModal.jsx');
  const base = {
    setTicketPendingSale: noop, setTicketClientName: noop, setTicketClientPhone: noop,
    setTicketClientDocument: noop, onRegister: noop,
  };
  // Sin venta pendiente: no renderiza nada (ni lanza).
  assert.equal(
    renderToString(React.createElement(TicketClientModal, { ...base, ticketPendingSale: null, ticketClientName: '', ticketClientPhone: '', ticketClientDocument: '' })),
    '');
  // Con venta pendiente: renderiza el modal (ni lanza).
  let html;
  assert.doesNotThrow(() => {
    html = renderToString(React.createElement(TicketClientModal, { ...base, ticketPendingSale: sale, ticketClientName: 'Ana', ticketClientPhone: '0414', ticketClientDocument: '' }));
  }, 'el modal de ticket debe renderizar sin errores');
  assert.match(html, /Registrar Cliente/, 'muestra el título del modal');
});

test('C2 main.jsx: ErrorBoundary global envuelve toda la app (incluye pre-login)', async t => {
  createProcessorFixture(t);
  const src = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
  assert.match(src, /import ErrorBoundary from/, 'main.jsx importa ErrorBoundary');
  const boundaryOpen = src.indexOf('<ErrorBoundary>');
  const appRouter = src.indexOf('<AppRouter');
  const boundaryClose = src.indexOf('</ErrorBoundary>');
  assert.ok(boundaryOpen !== -1 && appRouter !== -1 && boundaryClose !== -1,
    'existe el par <ErrorBoundary>...</ErrorBoundary> alrededor de <AppRouter />');
  assert.ok(boundaryOpen < appRouter && appRouter < boundaryClose,
    'AppRouter (login, PIN, bloqueo, Supervisión) queda DENTRO del ErrorBoundary');
});

test('C2 ErrorBoundary: el fallback no depende de contexto que pueda estar roto', async t => {
  createProcessorFixture(t);
  const src = readFileSync(new URL('../src/components/ErrorBoundary.jsx', import.meta.url), 'utf8');
  assert.ok(!src.includes('useContext('), 'el fallback no usa useContext');
  assert.ok(!src.includes('useSelector('), 'el fallback no usa useSelector');
  assert.ok(!src.includes('useStore('), 'el fallback no usa useStore');
});
