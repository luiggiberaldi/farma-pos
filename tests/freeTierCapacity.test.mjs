// Pruebas deterministas de capacidad: el tier gratis de Supabase soporta
// la operación de las 3 sedes dentro del sobre operativo declarado.
//
// Metodología: constantes MEDIDAS (no estimadas a ojo) + parámetros REALES del
// motor (SUPABASE_FREE_PROFILE) + límites OFICIALES auditados el 2026-09-30 en
// supabase.com/docs. Todo el modelo es aritmética pura y reproducible.
//
// Sobre operativo declarado:
//   - 3 sedes, 1-2 equipos por sede (una sola caja por sede, decisión 2026-09-29)
//   - BASE: 15 ventas/sede/día · 6 ráfagas de actividad/día · 12 h de operación
//   - STRESS: 40 ventas/sede/día · 10 ráfagas/día
// El debounce pesado (30 min) coalescea las ventas de cada ráfaga en 1 push.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPABASE_FREE_LIMITS,
  SUPABASE_FREE_PROFILE,
  inspectSyncPayload,
} from '../src/config/supabaseFreeTier.js';
import { _trimSalesForSync, SALES_SYNC_WINDOW_DAYS } from '../src/hooks/cloudSync/syncUtils.js';

// ── Constantes medidas ──────────────────────────────────────────────────────
// Doc canónico live (2026-10-01): 657_749 bytes / 1539 productos.
const PRODUCTS_DOC_BYTES = 657_749;
// Venta sintética fiel al shape real de salePlan.js (3 líneas, huella, pagos):
// medida en 1702 bytes/venta (determinista, ver test de frontera).
const SALE_BYTES = 1_702;
// Polling fase 1 (solo metadatos): ~1 KB por poll (comentario en useCloudSync).
const META_POLL_BYTES = 1_000;
// Otros docs por sede (clientes, cierres, caja, correlativos, métodos...): ~150 KB.
const OTHER_DOCS_BYTES = 150_000;

const SEDES = 3;
const BYTES_MIB = 1024 * 1024;

// ── Venta sintética determinista (shape fiel a src/utils/salePlan.js) ───────
function buildSale(i) {
  const n = String(i).padStart(7, '0');
  const item = (k) => ({
    id: `inv2026-7590000000${660 + k}`, productId: `inv2026-7590000000${660 + k}`,
    name: 'Amoxicilina 500mg x 21 cap', priceUsd: 3.5, quantity: 2,
    subtotalUsd: 7.0, laboratorio: 'Genven', presentacion: 'caja x 21',
  });
  return {
    id: `sale-${n}-id-000000000000`, operationId: `sale-${n}-op-000000000000`,
    schemaVersion: 3, accountId: 'acc', sedeId: 'central', saleNumber: i,
    tipo: 'VENTA', status: 'CONFIRMADA', syncMode: 'local',
    items: [item(1), item(2), item(3)], cartSubtotalUsd: 21.0,
    discountType: 'none', discountValue: 0, discountAmountUsd: 0,
    discountAuthorization: null, totalUsd: 21.0, totalBs: 17987.5,
    totalCop: 0, copEnabled: false, tasaCop: 0,
    payments: [{ method: 'efectivo_usd', amountUsd: 21.0 }],
    rate: 856.5, rateSource: 'BCV Auto',
    timestamp: new Date(Date.now() - i * 3600_000).toISOString(),
    cashSessionId: 'sess-1', fechaComercial: '2026-09-30', horaComercial: '20:00:00',
    changeUsd: 0, changeBs: 0, customerId: null, customerName: 'Consumidor Final',
    customerDocument: null, customerPhone: null, customerDelta: null,
    fiadoUsd: 0, casheaUsd: 0,
    huella: {
      correlativo: `V-${n}`, sedeId: 'central', usuarioId: 'op-1',
      usuarioNombre: 'Cajero', rol: 'CAJERO', clienteId: null,
      clienteNombre: 'Consumidor Final', fecha: '2026-09-30', hora: '20:00:00',
      ts: 1759262400000, tipo: 'VENTA', ref: `sale-${n}-id-000000000000`,
    },
    lotesConsumidos: [], prescription: null,
  };
}

// ── Modelo de egress mensual (bytes), aritmética pura ───────────────────────
function monthlyEgressBytes({ salesPerDay, burstsPerDay, devicesPerSede }) {
  const salesDoc = salesPerDay * SALES_SYNC_WINDOW_DAYS * SALE_BYTES;
  const salesSyncable = salesDoc <= SUPABASE_FREE_PROFILE.payloadMaxBytes;
  const syncedPerBurst = PRODUCTS_DOC_BYTES + (salesSyncable ? salesDoc : 0);
  const uploadsPerSedeDay = burstsPerDay * syncedPerBurst + 2 * OTHER_DOCS_BYTES;
  // Cada push lo descarga cada otro equipo de la sede en su poll horario.
  const pollDownloadsPerSedeDay = burstsPerDay * syncedPerBurst * (devicesPerSede - 1);
  // Un pull inicial completo por equipo y día (peor caso).
  const initialPullPerSedeDay = devicesPerSede * (syncedPerBurst + OTHER_DOCS_BYTES);
  const metaPollPerSedeDay = devicesPerSede * 24 * META_POLL_BYTES;
  const perSedeDay = uploadsPerSedeDay + pollDownloadsPerSedeDay + initialPullPerSedeDay + metaPollPerSedeDay;
  return { monthly: perSedeDay * 30 * SEDES, salesSyncable, salesDoc };
}

// ── 1. Límites oficiales congelados (auditoría 2026-09-30, supabase.com) ─────
test('capacidad: límites oficiales del Free usados por el modelo', () => {
  assert.equal(SUPABASE_FREE_LIMITS.databaseBytesPerProject, 500_000_000);
  assert.equal(SUPABASE_FREE_LIMITS.uncachedEgressBytesPerCycle, 5_000_000_000);
  assert.equal(SUPABASE_FREE_LIMITS.monthlyActiveUsers, 50_000);
  assert.equal(SUPABASE_FREE_LIMITS.realtimeMessagesPerCycle, 2_000_000);
  assert.equal(SUPABASE_FREE_LIMITS.realtimePeakConnections, 200);
  assert.equal(SUPABASE_FREE_LIMITS.edgeInvocationsPerCycle, 500_000);
  assert.equal(SUPABASE_FREE_LIMITS.activeFreeProjects, 2);
});

// ── 2. Parámetros del motor usados por el modelo ─────────────────────────────
test('capacidad: parámetros del perfil Free usados por el modelo', () => {
  assert.equal(SUPABASE_FREE_PROFILE.heavyDebounceMs, 30 * 60 * 1000);
  assert.equal(SUPABASE_FREE_PROFILE.pollIntervalMs, 60 * 60 * 1000);
  assert.equal(SUPABASE_FREE_PROFILE.payloadMaxBytes, BYTES_MIB);
  assert.equal(SUPABASE_FREE_PROFILE.realtimeEnabled, false);
});

// ── 3. Base de datos: holgura enorme incluso en estrés ───────────────────────
test('capacidad: 3 sedes a 200 ventas/día usan <10% de los 500 MB', () => {
  const perSede = PRODUCTS_DOC_BYTES + 200 * SALES_SYNC_WINDOW_DAYS * SALE_BYTES + 300_000;
  const total = perSede * SEDES;
  assert.ok(total < SUPABASE_FREE_LIMITS.databaseBytesPerProject * 0.1,
    `${(total / 1e6).toFixed(1)} MB de 500 MB`);
});

// ── 4. Egress escenario BASE: <50% de los 5 GB ───────────────────────────────
test('capacidad: egress mensual escenario BASE < 50% del límite', () => {
  const { monthly, salesSyncable } = monthlyEgressBytes({ salesPerDay: 15, burstsPerDay: 6, devicesPerSede: 2 });
  assert.equal(salesSyncable, true);
  assert.ok(monthly < SUPABASE_FREE_LIMITS.uncachedEgressBytesPerCycle * 0.5,
    `${(monthly / 1e9).toFixed(2)} GB/mes de 5 GB`);
});

// ── 5. Egress escenario STRESS: <50% aunque el doc de ventas se difiera ──────
test('capacidad: egress mensual escenario STRESS < 50% del límite', () => {
  const { monthly, salesSyncable } = monthlyEgressBytes({ salesPerDay: 40, burstsPerDay: 10, devicesPerSede: 2 });
  assert.equal(salesSyncable, false); // el doc de ventas supera 1 MiB: se difiere, no se sube
  assert.ok(monthly < SUPABASE_FREE_LIMITS.uncachedEgressBytesPerCycle * 0.5,
    `${(monthly / 1e9).toFixed(2)} GB/mes de 5 GB`);
});

// ── 6. Frontera determinista del cap de 1 MiB (gate REAL del motor) ──────────
test('capacidad: doc de ventas a 20/día pasa el gate, a 21/día no', () => {
  const sales20 = Array.from({ length: 20 * SALES_SYNC_WINDOW_DAYS }, (_, i) => buildSale(i));
  const sales21 = Array.from({ length: 21 * SALES_SYNC_WINDOW_DAYS }, (_, i) => buildSale(i));
  // El trim real de 30 días no recorta nada (todas dentro de la ventana).
  assert.equal(_trimSalesForSync(sales20).length, sales20.length);
  assert.equal(_trimSalesForSync(sales21).length, sales21.length);
  const r20 = inspectSyncPayload(sales20);
  const r21 = inspectSyncPayload(sales21);
  assert.equal(r20.allowed, true, `${r20.bytes} bytes`);
  assert.equal(r21.allowed, false, `${r21.bytes} bytes`);
});

// ── 7. Degradación elegante: el gate no pierde datos ni lanza ────────────────
test('capacidad: payload sobre 1 MiB se marca diferido sin perder el valor', () => {
  const big = Array.from({ length: 25 * SALES_SYNC_WINDOW_DAYS }, (_, i) => buildSale(i));
  const { allowed, warning, bytes, serialized } = inspectSyncPayload(big);
  assert.equal(allowed, false);
  assert.equal(warning, true);
  assert.ok(bytes > BYTES_MIB);
  // El valor sigue intacto para reintento: el motor lo conserva en _pendingPushValues.
  assert.equal(JSON.parse(serialized).length, big.length);
});

// ── 8. Polling horario: costo despreciable ────────────────────────────────────
test('capacidad: polling de metadatos < 0.1% del egress', () => {
  const monthly = 6 * 24 * 30 * META_POLL_BYTES; // 6 equipos × 24 polls/día × 30 días
  assert.ok(monthly < SUPABASE_FREE_LIMITS.uncachedEgressBytesPerCycle * 0.001,
    `${(monthly / 1e6).toFixed(2)} MB/mes`);
});

// ── 9. Servicios no usados / muy por debajo del límite ───────────────────────
test('capacidad: realtime, edge, auth y proyectos sobrados', () => {
  assert.equal(SUPABASE_FREE_PROFILE.realtimeEnabled, false); // 0 de 2M mensajes, 0 de 200 conexiones
  assert.ok(10 < SUPABASE_FREE_LIMITS.monthlyActiveUsers);    // ~10 usuarios de 50.000
  assert.ok(1 <= SUPABASE_FREE_LIMITS.activeFreeProjects);     // 1 proyecto de 2
});

// ── 10. Doc de productos: bajo 1 MiB con margen ──────────────────────────────
test('capacidad: catálogo de 1539 productos bajo el cap con margen', () => {
  assert.ok(PRODUCTS_DOC_BYTES < SUPABASE_FREE_PROFILE.payloadMaxBytes * 0.7,
    `${PRODUCTS_DOC_BYTES} bytes`);
});
