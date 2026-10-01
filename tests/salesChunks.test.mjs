// Pruebas deterministas de los chunks diarios de ventas (append-only).
//
// Contrato:
//  - Cada día comercial vive en su propio documento `bodega_sales_YYYYMMDD`.
//  - El gate de 1 MiB aplica POR DÍA, no al agregado de 30 días.
//  - La ventana cloud sigue siendo SALES_SYNC_WINDOW_DAYS (lo viejo no sube,
//    lo muy viejo se poda); nada se borra del dispositivo.
//  - Los doc_ids son válidos para el CHECK de sync_documents sin migración.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  saleChunkDay,
  groupSalesByDay,
  planSalesChunkPushes,
  staleChunkKeys,
} from '../src/hooks/cloudSync/salesChunks.js';
import {
  isSalesChunkKey,
  salesChunkDateOf,
  assertSalesChunkDate,
  buildSalesChunkDocumentId,
  parseCloudDocumentId,
  isCloudSedeScopedKey,
  isCloudDocumentForContext,
  salesChunkDocIdLike,
} from '../src/config/cloudDocumentScope.js';
import { inspectSyncPayload, SUPABASE_FREE_PROFILE } from '../src/config/supabaseFreeTier.js';
import { _mergeArraysById, SALES_SYNC_WINDOW_DAYS } from '../src/hooks/cloudSync/syncUtils.js';

// ─── Venta sintética determinista ────────────────────────────────────────────
// Shape fiel a src/utils/salePlan.js (3 líneas, huella, pagos): ~1702 B/venta,
// igual que la medida usada en tests/freeTierCapacity.test.mjs.
let saleSeq = 0;
function buildSale(fechaComercial) {
  const i = saleSeq++;
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
    timestamp: `${fechaComercial}T12:00:00.000Z`,
    cashSessionId: 'sess-1', fechaComercial, horaComercial: '20:00:00',
    changeUsd: 0, changeBs: 0, customerId: null, customerName: 'Consumidor Final',
    customerDocument: null, customerPhone: null, customerDelta: null,
    fiadoUsd: 0, casheaUsd: 0,
    huella: {
      correlativo: `V-${n}`, sedeId: 'central', usuarioId: 'op-1',
      usuarioNombre: 'Cajero', rol: 'CAJERO', clienteId: null,
      clienteNombre: 'Consumidor Final', fecha: fechaComercial, hora: '20:00:00',
      ts: 1759262400000, tipo: 'VENTA', ref: `sale-${n}-id-000000000000`,
    },
    lotesConsumidos: [], prescription: null,
  };
}

// Convierte un patrón LIKE de PostgREST a RegExp (para simular el discovery).
function likeToRegExp(pattern) {
  const esc = pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.');
  return new RegExp(`^${esc}$`);
}

// ─── 1. Reconocimiento de chunk keys ─────────────────────────────────────────
test('chunks: isSalesChunkKey reconoce el formato YYYYMMDD', () => {
  assert.equal(isSalesChunkKey('bodega_sales_20261001'), true);
  assert.equal(isSalesChunkKey('bodega_sales_v1'), false); // el monolito NO es chunk
  assert.equal(isSalesChunkKey('bodega_sales_2026-10-01'), false);
  assert.equal(isSalesChunkKey('bodega_sales_1234567'), false);
  assert.equal(isSalesChunkKey('bodega_sales_123456789'), false);
  assert.equal(isSalesChunkKey('bodega_sales_archive_v1'), false);
  assert.equal(isSalesChunkKey(null), false);
  assert.equal(isSalesChunkKey(42), false);
});

test('chunks: salesChunkDateOf extrae la fecha', () => {
  assert.equal(salesChunkDateOf('bodega_sales_20261001'), '20261001');
  assert.equal(salesChunkDateOf('bodega_sales_v1'), null);
});

test('chunks: assertSalesChunkDate valida calendario real', () => {
  assert.doesNotThrow(() => assertSalesChunkDate('20261001'));
  assert.throws(() => assertSalesChunkDate('2026-10-01'));
  assert.throws(() => assertSalesChunkDate('20260230')); // febrero 30 no existe
  assert.throws(() => assertSalesChunkDate('20261301')); // mes 13 no existe
  assert.throws(() => assertSalesChunkDate(''));
});

// ─── 2. doc_id válido para la DB sin migración ───────────────────────────────
const DB_CHECK = /^v2:[a-zA-Z0-9_-]{1,120}:account:[^:\s]{1,255}(:sede:(central|norte|sur))?$/;
const UID = '17486fbd-a7c5-4b8d-94c0-71688197ad76';

test('chunks: doc_id satisface el CHECK de sync_documents y hace round-trip', () => {
  const docId = buildSalesChunkDocumentId('20261001', { accountId: UID, sedeId: 'central' });
  assert.equal(docId, `v2:bodega_sales_20261001:account:${UID}:sede:central`);
  assert.ok(DB_CHECK.test(docId), 'debe pasar el CHECK de la tabla');
  const parsed = parseCloudDocumentId(docId);
  assert.equal(parsed.key, 'bodega_sales_20261001');
  assert.equal(parsed.sedeId, 'central');
  assert.equal(parsed.sedeScoped, true);
  assert.equal(isCloudSedeScopedKey(parsed.key), true);
  assert.equal(
    isCloudDocumentForContext(docId, parsed.key, { accountId: UID, sedeId: 'central' }),
    true,
  );
  assert.equal(
    isCloudDocumentForContext(docId, parsed.key, { accountId: UID, sedeId: 'norte' }),
    false,
  );
});

test('chunks: buildSalesChunkDocumentId rechaza entradas inválidas', () => {
  assert.throws(() => buildSalesChunkDocumentId('2026-10-01', { accountId: UID, sedeId: 'central' }));
  assert.throws(() => buildSalesChunkDocumentId('20261001', { accountId: '', sedeId: 'central' }));
  assert.throws(() => buildSalesChunkDocumentId('20261001', { accountId: UID, sedeId: 'este' }));
});

test('chunks: el patrón LIKE de discovery casa con los doc_ids reales', () => {
  const like = salesChunkDocIdLike({ accountId: UID, sedeId: 'sur' });
  const re = likeToRegExp(like);
  const real = buildSalesChunkDocumentId('20260915', { accountId: UID, sedeId: 'sur' });
  assert.ok(re.test(real), `${like} debe casar con ${real}`);
  const otherSede = buildSalesChunkDocumentId('20260915', { accountId: UID, sedeId: 'norte' });
  assert.equal(re.test(otherSede), false, 'no debe casar con otra sede');
});

// ─── 3. Día comercial ────────────────────────────────────────────────────────
test('chunks: saleChunkDay respeta precedencia fechaComercial > businessDate > timestamp', () => {
  assert.equal(saleChunkDay({ fechaComercial: '2026-10-01' }), '20261001');
  assert.equal(
    saleChunkDay({ businessDate: '2026-09-30', timestamp: '2026-10-01T12:00:00.000Z' }),
    '20260930',
  );
  const ts = Date.parse('2026-08-15T12:00:00.000Z');
  const d = new Date(ts);
  const expected = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(saleChunkDay({ timestamp: '2026-08-15T12:00:00.000Z' }), expected);
});

test('chunks: saleChunkDay sin fecha parseable usa el día actual (conservar)', () => {
  const nowMs = Date.parse('2026-10-01T08:00:00.000Z');
  const d = new Date(nowMs);
  const expected = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  assert.equal(saleChunkDay({ id: 'x' }, nowMs), expected);
  assert.equal(saleChunkDay({ timestamp: 'no-es-fecha' }, nowMs), expected);
});

// ─── 4. Agrupación y planificación ───────────────────────────────────────────
test('chunks: groupSalesByDay agrupa sin mutar la entrada', () => {
  const sales = [buildSale('2026-10-01'), buildSale('2026-10-02'), buildSale('2026-10-01')];
  const before = sales.map((s) => s.id).join(',');
  const groups = groupSalesByDay(sales);
  assert.equal(groups.get('20261001').length, 2);
  assert.equal(groups.get('20261002').length, 1);
  assert.equal(sales.map((s) => s.id).join(','), before, 'no debe mutar el array');
  assert.equal(groupSalesByDay(null).size, 0);
});

test('chunks: planSalesChunkPushes filtra la ventana y ordena por día', () => {
  const nowMs = Date.parse('2026-10-01T12:00:00.000Z');
  const sales = [
    buildSale('2026-10-01'),
    buildSale('2026-09-02'), // 29 días atrás: dentro
    buildSale('2026-09-01'), // 30 días atrás: borde, dentro
    buildSale('2026-08-31'), // 31 días atrás: fuera
    buildSale('2026-09-15'),
  ];
  const plans = planSalesChunkPushes(sales, { nowMs });
  const days = plans.map((p) => p.day);
  assert.deepEqual(days, ['20260901', '20260902', '20260915', '20261001']);
  assert.ok(plans.every((p) => p.chunkKey === `bodega_sales_${p.day}`));
});

test('chunks: planSalesChunkPushes conserva ventas sin fecha (nunca perder)', () => {
  const nowMs = Date.parse('2026-10-01T12:00:00.000Z');
  const plans = planSalesChunkPushes([{ id: 'sin-fecha' }], { nowMs });
  assert.equal(plans.length, 1);
  assert.equal(plans[0].sales.length, 1);
});

// ─── 5. El gate de 1 MiB ahora es por día ────────────────────────────────────
// Medido con el shape real: 600 ventas/día ≈ 1.02 MB (pasa), 630 ≈ 1.07 MB
// (se difiere SOLO ese día). Antes, 630 ventas en 30 días diferían TODO.
test('chunks: un día con 600 ventas pasa el gate; 630 se difiere (aislado)', () => {
  const day600 = Array.from({ length: 600 }, () => buildSale('2026-10-01'));
  const day630 = Array.from({ length: 630 }, () => buildSale('2026-10-02'));
  const r600 = inspectSyncPayload(day600);
  const r630 = inspectSyncPayload(day630);
  assert.equal(r600.allowed, true, `${r600.bytes} bytes`);
  assert.equal(r630.allowed, false, `${r630.bytes} bytes`);
  // El diferimiento es por chunk: el día de 600 no se contamina por el de 630.
  assert.ok(r600.bytes <= SUPABASE_FREE_PROFILE.payloadMaxBytes);
});

// ─── 6. Simulación: 40 ventas/día × 35 días ──────────────────────────────────
// Antes: el monolito de 30 días (1200 ventas) superaba 1 MiB y TODO se difería.
// Ahora: 31 chunks bajo el cap + 4 días podables, cero diferidos.
// (El borde de la ventana es inclusivo, como el trim viejo a precisión de ms.)
test('chunks: 40/día × 35 días → 31 chunks bajo el cap, 4 para podar', () => {
  const nowMs = Date.parse('2026-10-01T12:00:00.000Z');
  const sales = [];
  for (let d = 0; d < 35; d++) {
    const dt = new Date(nowMs - d * 24 * 60 * 60 * 1000);
    const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
    for (let k = 0; k < 40; k++) sales.push(buildSale(iso));
  }
  const plans = planSalesChunkPushes(sales, { nowMs });
  assert.equal(plans.length, SALES_SYNC_WINDOW_DAYS + 1, 'solo la ventana cloud se sube (borde inclusivo)');
  assert.equal(plans.reduce((n, p) => n + p.sales.length, 0), 40 * (SALES_SYNC_WINDOW_DAYS + 1));
  for (const plan of plans) {
    const r = inspectSyncPayload(plan.sales);
    assert.equal(r.allowed, true, `chunk ${plan.day}: ${r.bytes} bytes`);
  }
  // El monolito equivalente (lo que se subía antes) sí se difería:
  const legacy = inspectSyncPayload(sales.slice(0, 40 * SALES_SYNC_WINDOW_DAYS));
  assert.equal(legacy.allowed, false, 'el monolito de 1200 ventas supera 1 MiB');
  // Poda: los 4 días más viejos de la nube se identifican para eliminar.
  const allKeys = [];
  for (let d = 0; d < 35; d++) {
    const dt = new Date(nowMs - d * 24 * 60 * 60 * 1000);
    allKeys.push(`bodega_sales_${dt.getFullYear()}${String(dt.getMonth() + 1).padStart(2, '0')}${String(dt.getDate()).padStart(2, '0')}`);
  }
  const stale = staleChunkKeys(allKeys, { nowMs });
  assert.equal(stale.length, 4);
  assert.ok(!stale.some((k) => plans.some((p) => p.chunkKey === k)), 'la poda no toca la ventana activa');
});

// ─── 7. Merge de chunks en el pull: sin duplicados ───────────────────────────
test('chunks: el merge por ID no duplica ventas entre local y chunk', () => {
  const a = buildSale('2026-10-01');
  const b = buildSale('2026-10-01');
  const bNewer = { ...b, updatedAt: '2026-10-01T13:00:00.000Z', totalUsd: 8.0 };
  const c = buildSale('2026-10-01');
  const merged = _mergeArraysById([a, b], [bNewer, c]);
  assert.equal(merged.length, 3);
  const ids = merged.map((s) => s.id);
  assert.equal(new Set(ids).size, 3, 'sin IDs duplicados');
  assert.equal(merged.find((s) => s.id === b.id).totalUsd, 8.0, 'gana el más reciente');
});

test('chunks: staleChunkKeys ignora llaves que no son chunks', () => {
  const nowMs = Date.parse('2026-10-01T12:00:00.000Z');
  const stale = staleChunkKeys(['bodega_sales_v1', 'bodega_sales_20200101', null], { nowMs });
  assert.deepEqual(stale, ['bodega_sales_20200101']);
});
