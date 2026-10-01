import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProcessorFixture } from './helpers/realModule.mjs';

// Regresión 2026-10-01 (Plan Maestro de Fixeo, Fase 2):
// A1. El botón "Limpiar y Recargar" del ErrorBoundary borraba
//     'bodega_accounts_v2' (cuentas de pago/billetera). La recuperación de
//     errores jamás debe tocar datos del usuario.
// A2. ProductContext inicializaba rateMode con JSON.parse(localStorage) sin
//     try/catch: un valor corrupto tumbaba ProductProvider (pantalla blanca).

test('A1 ErrorBoundary: el botón de recuperación no borra datos del usuario', async t => {
  createProcessorFixture(t);
  const raw = readFileSync(new URL('../src/components/ErrorBoundary.jsx', import.meta.url), 'utf8');
  // Se ignoran los comentarios: se busca en el código real.
  const src = raw.replace(/\/\/.*$/gm, '');
  assert.ok(!src.includes('bodega_accounts_v2'),
    'el fallback del ErrorBoundary no debe referenciar las cuentas de pago');
  assert.ok(!src.includes('localStorage.removeItem('),
    'la recuperación de errores jamás borra datos del usuario: solo recarga');
  assert.match(src, /window\.location\.reload\(\)/, 'la recuperación recarga la app');
});

test('A2 ProductContext: JSON.parse de bodega_use_auto_rate protegido con try/catch', async t => {
  createProcessorFixture(t);
  const src = readFileSync(new URL('../src/context/ProductContext.jsx', import.meta.url), 'utf8');
  const idx = src.indexOf("localStorage.getItem('bodega_use_auto_rate')");
  assert.ok(idx !== -1, 'se lee bodega_use_auto_rate de localStorage');
  // La lectura debe estar dentro de un bloque try con fallback 'bcv'.
  const window = src.slice(Math.max(0, idx - 400), idx + 300);
  assert.ok(/try\s*\{/.test(window), 'hay un bloque try alrededor de la lectura');
  assert.ok(window.includes('JSON.parse(savedAuto)'), 'se parsea el valor guardado');
  assert.ok(/catch\s*\{[^}]*'bcv'/.test(window), 'el catch cae a default \'bcv\'');
});
