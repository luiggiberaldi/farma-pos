// Pruebas deterministas de capacidad: el tier gratis de Supabase soporta
// la operación de las 3 sedes dentro del sobre operativo declarado.
//
// Metodología: constantes MEDIDAS (no estimadas a ojo) + parámetros REALES del
// motor (SUPABASE_FREE_PROFILE) + límites OFICIALES auditados el 2026-09-30 en
// supabase.com/docs. Todo el modelo es aritmética pura y reproducible.
//
// Ventas (2026-10-01): viajan en CHUNKS DIARIOS append-only
// (`bodega_sales_YYYYMMDD`), un documento por día comercial. El gate de 1 MiB
// aplica por chunk (~616 ventas/día de techo con la venta medida), no al
// agregado de 30 días: el techo de ~21 ventas/día del monolito quedó eliminado.
// La ventana cloud sigue siendo SALES_SYNC_WINDOW_DAYS (+1 día por el borde
// inclusivo); los chunks viejos se podan.
//
// Sobre operativo declarado:
//   - 3 sedes, 1-2 equipos por sede (una sola caja por sede, decisión 2026-09-29)
//   - BASE: 15 ventas/sede/día · 6 ráfagas de actividad/día · 12 h de operación
//   - STRESS: 40 ventas/sede/día · 10 ráfagas/día
// El debounce pesado (30 min) coalescea las ventas de cada ráfaga en 1 push del
// chunk del día (el chunk crece durante el día; el modelo usa el peor caso:
// el día completo en cada ráfaga).
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SUPABASE_FREE_LIMITS,
  SUPABASE_FREE_PROFILE,
  inspectSyncPayload,
} from '../src/config/supabaseFreeTier.js';
import { SALES_SYNC_WINDOW_DAYS } from '../src/hooks/cloudSync/syncUtils.js';
import { planSalesChunkPushes } from '../src/hooks/cloudSync/salesChunks.js';

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
// Docs a nivel de cuenta (2026-10-01, fases A–E): usuarios + política de tasa +
// datos del negocio. Medidos del shape real: usuario ~400 B × 10, tasa ~300 B,
// negocio ~300 B. Se usa cota conservadora con overhead HTTP.
const ACCOUNT_DOCS_DB_BYTES = 10_000;
const RATE_POLL_BYTES = 1_000; // doc de tasa + overhead por poll del fast-lane
const RATE_FAST_LANE_POLLS_PER_DAY = 288; // cada 5 min

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
// Con chunks diarios, cada ráfaga sube el chunk del día (peor caso: el día
// completo ya acumulado) en vez del monolito de 30 días.
function monthlyEgressBytes({ salesPerDay, burstsPerDay, devicesPerSede }) {
  const chunkBytes = salesPerDay * SALE_BYTES; // chunk del día, peor caso
  const salesSyncable = chunkBytes <= SUPABASE_FREE_PROFILE.payloadMaxBytes;
  const syncedPerBurst = PRODUCTS_DOC_BYTES + (salesSyncable ? chunkBytes : 0);
  const uploadsPerSedeDay = burstsPerDay * syncedPerBurst + 2 * OTHER_DOCS_BYTES;
  // Cada push lo descarga cada otro equipo de la sede en su poll horario.
  const pollDownloadsPerSedeDay = burstsPerDay * syncedPerBurst * (devicesPerSede - 1);
  // Un pull inicial completo por equipo y día (peor caso): ventana de chunks + resto.
  const initialPullPerSedeDay = devicesPerSede * ((SALES_SYNC_WINDOW_DAYS + 1) * chunkBytes + OTHER_DOCS_BYTES);
  const metaPollPerSedeDay = devicesPerSede * 24 * META_POLL_BYTES;
  const perSedeDay = uploadsPerSedeDay + pollDownloadsPerSedeDay + initialPullPerSedeDay + metaPollPerSedeDay;
  // Fast-lane de la política de tasa (2026-10-01): doc a nivel de cuenta, cada
  // equipo lo sondea cada 5 min. Los docs de usuarios/negocio viajan en el bulk
  // horario ya modelado arriba (son KB).
  const rateFastLanePerDay = devicesPerSede * SEDES * RATE_FAST_LANE_POLLS_PER_DAY * RATE_POLL_BYTES;
  return { monthly: (perSedeDay * SEDES + rateFastLanePerDay) * 30, salesSyncable, chunkBytes };
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
  // Ventana de chunks por sede: (30+1) días × 200 ventas × 1702 B ≈ 10.6 MB.
  const perSede = PRODUCTS_DOC_BYTES + (SALES_SYNC_WINDOW_DAYS + 1) * 200 * SALE_BYTES + 300_000;
  const total = perSede * SEDES;
  assert.ok(total < SUPABASE_FREE_LIMITS.databaseBytesPerProject * 0.1,
    `${(total / 1e6).toFixed(1)} MB de 500 MB`);
});

// ── 3b. Docs a nivel de cuenta: despreciables frente a los 500 MB ──────────
test('capacidad: docs de cuenta (usuarios, tasa, negocio) < 0.01% de los 500 MB', () => {
  assert.ok(ACCOUNT_DOCS_DB_BYTES < SUPABASE_FREE_LIMITS.databaseBytesPerProject * 0.0001,
    `${ACCOUNT_DOCS_DB_BYTES} B de 500 MB`);
});

// ── 4. Egress escenario BASE: <50% de los 5 GB ───────────────────────────────
test('capacidad: egress mensual escenario BASE < 50% del límite', () => {
  const { monthly, salesSyncable } = monthlyEgressBytes({ salesPerDay: 15, burstsPerDay: 6, devicesPerSede: 2 });
  assert.equal(salesSyncable, true);
  assert.ok(monthly < SUPABASE_FREE_LIMITS.uncachedEgressBytesPerCycle * 0.5,
    `${(monthly / 1e9).toFixed(2)} GB/mes de 5 GB`);
});

// ── 5. Egress escenario STRESS: <50% con las ventas sincronizándose ─────────
test('capacidad: egress mensual escenario STRESS < 50% del límite', () => {
  const { monthly, salesSyncable } = monthlyEgressBytes({ salesPerDay: 40, burstsPerDay: 10, devicesPerSede: 2 });
  assert.equal(salesSyncable, true); // con chunks, 40/día (68 KB/día) se sube sin diferir
  assert.ok(monthly < SUPABASE_FREE_LIMITS.uncachedEgressBytesPerCycle * 0.5,
    `${(monthly / 1e9).toFixed(2)} GB/mes de 5 GB`);
});

// ── 6. Frontera determinista del cap de 1 MiB (gate REAL del motor) ──────────
// El gate ahora aplica por chunk diario usando el planificador real.
test('capacidad: chunk de ventas a 600/día pasa el gate, a 630/día se difiere solo ese día', () => {
  const nowMs = Date.parse('2026-10-01T12:00:00.000Z'); // anclado: no rota con el calendario
  const day600 = Array.from({ length: 600 }, (_, i) => ({ ...buildSale(i), fechaComercial: '2026-09-30' }));
  const day630 = Array.from({ length: 630 }, (_, i) => ({ ...buildSale(i), fechaComercial: '2026-09-30' }));
  const plans600 = planSalesChunkPushes(day600, { nowMs });
  const plans630 = planSalesChunkPushes(day630, { nowMs });
  assert.equal(plans600.length, 1);
  assert.equal(plans630.length, 1);
  const r600 = inspectSyncPayload(plans600[0].sales);
  const r630 = inspectSyncPayload(plans630[0].sales);
  assert.equal(r600.allowed, true, `${r600.bytes} bytes`);
  assert.equal(r630.allowed, false, `${r630.bytes} bytes`);
  // Techo honesto por chunk: ~616 ventas/día con la venta medida (1702 B).
  assert.ok(r600.bytes <= SUPABASE_FREE_PROFILE.payloadMaxBytes);
  assert.ok(r630.bytes > SUPABASE_FREE_PROFILE.payloadMaxBytes);
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
