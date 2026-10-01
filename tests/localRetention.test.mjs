// Pruebas deterministas de retención local (purgas/archivo).
//
// Pregunta que responden: ¿el sistema tiene las purgas correctas para evitar
// el colapso con el tiempo?
//
// Política bajo prueba (src/utils/localRetention.js):
//  - NADA se borra del dispositivo. Ventas y auditoría viejas se MUEVEN de la
//    clave caliente a una clave de archivo en el mismo IndexedDB.
//  - Ventana caliente: 90 días (SALES_HOT_DAYS / AUDIT_HOT_DAYS).
//  - Lotes muertos (cantidad <= 0 y vencidos) sí se purgan: son invisibles
//    para la app (la asignación exige cantidad > 0 y vencimiento futuro).
//  - Las claves de archivo nunca salen del dispositivo (no están en
//    SYNC_KEYS, están en PULL_IGNORE_KEYS) y entran en el auto-backup local.
//
// Todo es aritmética pura con timestamps fijos: reproducible siempre.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  splitByAge,
  saleTimestampMs,
  auditTimestampMs,
  appendToArchive,
  purgeDeadLots,
  readAllSales,
  readSalesForSede,
  readFullAuditLog,
  SALES_ARCHIVE_KEY,
  AUDIT_ARCHIVE_KEY,
  SALES_HOT_DAYS,
  AUDIT_HOT_DAYS,
} from '../src/utils/localRetention.js';
import { SYNC_KEYS, PULL_IGNORE_KEYS } from '../src/hooks/cloudSync/syncKeys.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DAY_MS = 24 * 60 * 60 * 1000;
// "Ahora" fijo: determinista, sin depender del reloj de la máquina.
const NOW = Date.parse('2026-10-01T12:00:00.000Z');
const cutoff = (days) => NOW - days * DAY_MS;
const saleAt = (daysAgo, n) => ({ id: `sale-${n}`, saleNumber: n, tipo: 'VENTA', timestamp: new Date(cutoff(daysAgo)).toISOString() });
const auditAt = (daysAgo, n) => ({ id: `audit-${n}`, ts: cutoff(daysAgo), cat: 'VENTA', action: 'X' });

// ─── splitByAge ────────────────────────────────────────────────────────────

test('splitByAge: arreglo vacío y entrada no-arreglo', () => {
  assert.deepEqual(splitByAge([], saleTimestampMs, 90, NOW), { hot: [], archived: [] });
  assert.deepEqual(splitByAge(null, saleTimestampMs, 90, NOW), { hot: [], archived: [] });
  assert.deepEqual(splitByAge('x', saleTimestampMs, 90, NOW), { hot: [], archived: [] });
});

test('splitByAge: todo caliente / todo archivado', () => {
  const fresh = [saleAt(1, 1), saleAt(10, 2), saleAt(89, 3)];
  const r1 = splitByAge(fresh, saleTimestampMs, SALES_HOT_DAYS, NOW);
  assert.equal(r1.hot.length, 3);
  assert.equal(r1.archived.length, 0);

  const old = [saleAt(91, 1), saleAt(200, 2), saleAt(800, 3)];
  const r2 = splitByAge(old, saleTimestampMs, SALES_HOT_DAYS, NOW);
  assert.equal(r2.hot.length, 0);
  assert.equal(r2.archived.length, 3);
});

test('splitByAge: frontera exacta — el borde queda en caliente, 1ms más viejo se archiva', () => {
  const getTs = (x) => x.ts;
  const atCutoff = { id: 'edge', ts: cutoff(SALES_HOT_DAYS) };
  const justOld = { id: 'old', ts: cutoff(SALES_HOT_DAYS) - 1 };
  const { hot, archived } = splitByAge([atCutoff, justOld], getTs, SALES_HOT_DAYS, NOW);
  assert.deepEqual(hot.map((x) => x.id), ['edge']);
  assert.deepEqual(archived.map((x) => x.id), ['old']);
});

test('splitByAge: sin timestamp válido JAMÁS se archiva (ante la duda, caliente)', () => {
  const weird = [
    { id: 'no-ts' },
    { id: 'null-ts', timestamp: null },
    { id: 'bad-ts', timestamp: 'no-es-fecha' },
    { id: 'nan-ts', timestamp: NaN },
    null,
    'texto',
  ];
  const { hot, archived } = splitByAge(weird, saleTimestampMs, SALES_HOT_DAYS, NOW);
  assert.equal(hot.length, weird.length);
  assert.equal(archived.length, 0);
});

test('splitByAge: conserva el orden y no muta la entrada', () => {
  const input = [saleAt(5, 1), saleAt(100, 2), saleAt(10, 3), saleAt(200, 4)];
  const snapshot = JSON.stringify(input);
  const { hot, archived } = splitByAge(input, saleTimestampMs, SALES_HOT_DAYS, NOW);
  assert.deepEqual(hot.map((s) => s.id), ['sale-1', 'sale-3']);
  assert.deepEqual(archived.map((s) => s.id), ['sale-2', 'sale-4']);
  assert.equal(JSON.stringify(input), snapshot);
});

test('splitByAge: mezcla con un solo corte — partición exacta', () => {
  const items = [];
  for (let d = 0; d < 200; d++) items.push(saleAt(d, d));
  const { hot, archived } = splitByAge(items, saleTimestampMs, SALES_HOT_DAYS, NOW);
  // Días 0..90 → caliente (91; el borde exacto NO se archiva); días 91..199 → archivo (109).
  assert.equal(hot.length, 91);
  assert.equal(archived.length, 109);
  assert.ok(hot.every((s) => saleTimestampMs(s) >= cutoff(SALES_HOT_DAYS)));
  assert.ok(archived.every((s) => saleTimestampMs(s) < cutoff(SALES_HOT_DAYS)));
});

// ─── Extractores de timestamp ──────────────────────────────────────────────

test('saleTimestampMs: prioridades y casos inválidos', () => {
  assert.equal(saleTimestampMs({ timestamp: '2026-09-01T10:00:00.000Z' }), Date.parse('2026-09-01T10:00:00.000Z'));
  assert.equal(saleTimestampMs({ fecha: '2026-09-02' }), Date.parse('2026-09-02'));
  assert.equal(saleTimestampMs({ huella: { fechaComercial: '2026-09-03' } }), Date.parse('2026-09-03'));
  assert.ok(Number.isNaN(saleTimestampMs({})));
  assert.ok(Number.isNaN(saleTimestampMs(null)));
  assert.ok(Number.isNaN(saleTimestampMs({ timestamp: 'basura' })));
});

test('auditTimestampMs: numérico válido / inválidos', () => {
  assert.equal(auditTimestampMs({ ts: 123 }), 123);
  assert.ok(Number.isNaN(auditTimestampMs({})));
  assert.ok(Number.isNaN(auditTimestampMs({ ts: 'x' })));
});

// ─── appendToArchive ───────────────────────────────────────────────────────

test('appendToArchive: antepone lo nuevo; sin nada nuevo devuelve el previo intacto', () => {
  const prev = [{ id: 'a' }];
  assert.strictEqual(appendToArchive([], prev), prev);
  assert.deepEqual(appendToArchive([{ id: 'n' }], prev).map((x) => x.id), ['n', 'a']);
  assert.deepEqual(appendToArchive([{ id: 'n' }], null).map((x) => x.id), ['n']);
});

// ─── purgeDeadLots ─────────────────────────────────────────────────────────

test('purgeDeadLots: solo purga lotes vacíos Y vencidos', () => {
  const lots = [
    { id: 'muerto', cantidad: 0, vencimiento: '2026-09-01' },      // purga
    { id: 'muerto-neg', cantidad: -3, vencimiento: '2026-01-01' }, // purga
    { id: 'vacio-vigente', cantidad: 0, vencimiento: '2026-12-01' },// se queda
    { id: 'con-stock-vencido', cantidad: 5, vencimiento: '2026-09-01' }, // se queda: stock real
    { id: 'con-stock-vigente', cantidad: 5, vencimiento: '2026-12-01' },// se queda
    { id: 'malformado' },                                          // se queda: conservador
    { id: 'sin-venc', cantidad: 0 },                               // se queda: conservador
    { id: 'qty-texto', cantidad: 'x', vencimiento: '2020-01-01' }, // se queda: conservador
  ];
  const { lots: kept, purged } = purgeDeadLots(lots, '2026-10-01');
  assert.equal(purged, 2);
  assert.deepEqual(kept.map((l) => l.id), [
    'vacio-vigente', 'con-stock-vencido', 'con-stock-vigente',
    'malformado', 'sin-venc', 'qty-texto',
  ]);
});

test('purgeDeadLots: el vencimiento de hoy NO es vencido', () => {
  const { lots: kept, purged } = purgeDeadLots(
    [{ id: 'hoy', cantidad: 0, vencimiento: '2026-10-01' }], '2026-10-01');
  assert.equal(purged, 0);
  assert.equal(kept.length, 1);
});

// ─── Simulación de crecimiento: 3 años, 20 ventas/día ─────────────────────
// Modela exactamente lo que hace prepareSale en cada venta: anteponer la
// nueva y partir por edad. Verifica que caliente queda acotado, que nada
// se pierde y que el correlativo sigue monótono.
test('simulación 3 años × 20 ventas/día: caliente acotado, cero pérdida, correlativo monótono', () => {
  const DAYS = 3 * 365;
  const PER_DAY = 20;
  let hot = [];
  let archive = [];
  let saleNumber = 0;
  let auditHot = [];
  let auditArchive = [];
  const total = DAYS * PER_DAY;

  for (let d = DAYS; d >= 1; d--) {
    // "Día d" contado hacia atrás desde NOW (orden cronológico real).
    const dayMs = NOW - d * DAY_MS;
    const daySales = [];
    const dayAudit = [];
    for (let i = 0; i < PER_DAY; i++) {
      saleNumber++;
      const ts = new Date(dayMs + i * 1000).toISOString();
      daySales.push({ id: `s-${saleNumber}`, saleNumber, tipo: 'VENTA', timestamp: ts });
      for (let a = 0; a < 4; a++) dayAudit.push({ id: `a-${saleNumber}-${a}`, ts: dayMs + i * 1000 });
    }
    // Igual que prepareSale: lo nuevo va primero, luego se parte por edad.
    const s = splitByAge([...daySales, ...hot], saleTimestampMs, SALES_HOT_DAYS, dayMs + PER_DAY * 1000);
    hot = s.hot;
    archive = appendToArchive(s.archived, archive);
    const au = splitByAge([...dayAudit, ...auditHot], auditTimestampMs, AUDIT_HOT_DAYS, dayMs + PER_DAY * 1000);
    auditHot = au.hot;
    auditArchive = appendToArchive(au.archived, auditArchive);
  }

  // 1) Caliente acotado: como máximo 90 días + el día en curso.
  assert.ok(hot.length <= PER_DAY * (SALES_HOT_DAYS + 1), `hot=${hot.length}`);
  assert.ok(auditHot.length <= PER_DAY * 4 * (AUDIT_HOT_DAYS + 1), `auditHot=${auditHot.length}`);
  // 2) Cero pérdida: todo lo generado está en caliente o archivo.
  assert.equal(hot.length + archive.length, total);
  assert.equal(auditHot.length + auditArchive.length, total * 4);
  // 3) Sin duplicados entre caliente y archivo.
  assert.equal(new Set([...hot, ...archive].map((s) => s.id)).size, total);
  // 4) El correlativo máximo vive en caliente (la venta nueva siempre es la
  //    más reciente): saleNumber = max+1 nunca colisiona tras archivar.
  const maxHot = Math.max(...hot.map((s) => s.saleNumber));
  assert.equal(maxHot, total);
  // 5) Tamaño caliente acotado en bytes (~1.7 KB/venta medida en producción).
  const hotBytes = Buffer.byteLength(JSON.stringify(hot));
  assert.ok(hotBytes < 5 * 1024 * 1024, `hot=${hotBytes} bytes`);
  // Sin archivo, 3 años serían ~37 MB solo en ventas calientes.
  const unboundedBytes = Buffer.byteLength(JSON.stringify([...hot, ...archive]));
  assert.ok(unboundedBytes > hotBytes * 5, 'el archivo sí hace diferencia');
});

// ─── Las claves de archivo nunca salen del dispositivo ─────────────────────

test('archivo excluido del sync: no está en SYNC_KEYS y se ignora en pull', () => {
  for (const key of [SALES_ARCHIVE_KEY, AUDIT_ARCHIVE_KEY]) {
    assert.ok(!SYNC_KEYS.includes(key), `${key} no debe sincronizarse`);
    assert.ok(PULL_IGNORE_KEYS.includes(key), `${key} debe ignorarse en pull`);
  }
});

test('archivo incluido en el auto-backup local', () => {
  const src = readFileSync(resolve(ROOT, 'src/hooks/useAutoBackup.js'), 'utf8');
  for (const key of [SALES_ARCHIVE_KEY, AUDIT_ARCHIVE_KEY]) {
    assert.ok(src.includes(`'${key}'`), `${key} debe estar en CRITICAL_KEYS`);
  }
});

// ─── Lectores hot+archivo ──────────────────────────────────────────────────

test('readAllSales / readSalesForSede / readFullAuditLog mezclan caliente primero', async () => {
  const store = {
    data: {
      'bodega_sales_v1': [{ id: 'hot-1' }],
      [SALES_ARCHIVE_KEY]: [{ id: 'arc-1' }, { id: 'arc-2' }],
      'abasto_audit_log_v1': [{ id: 'ah-1' }],
      [AUDIT_ARCHIVE_KEY]: [{ id: 'aa-1' }],
    },
    async getItem(key, fb) { const v = this.data[key]; return Array.isArray(v) ? v : fb; },
    async getItemForSede(key, _sede, fb) { return this.getItem(key, fb); },
  };
  assert.deepEqual((await readAllSales(store)).map((s) => s.id), ['hot-1', 'arc-1', 'arc-2']);
  assert.deepEqual((await readSalesForSede(store, 'central')).map((s) => s.id), ['hot-1', 'arc-1', 'arc-2']);
  assert.deepEqual((await readFullAuditLog(store)).map((e) => e.id), ['ah-1', 'aa-1']);
  // Tolera claves ausentes o corruptas.
  const empty = { async getItem(k, fb) { return fb; }, async getItemForSede(k, _s, fb) { return fb; } };
  assert.deepEqual(await readAllSales(empty), []);
  assert.deepEqual(await readFullAuditLog(empty), []);
});

// ─── Integración: el checkout real archiva ventas/auditoría viejas ──────────
// Usa el módulo real checkoutProcessor (con prepareSale modificado) y un
// storage en memoria. Semilla: 3 ventas viejas (120/200/400 días) + 2
// entradas de auditoría viejas. Después de vender, lo viejo debe estar en
// las claves de archivo y la venta nueva debe llevar el correlativo 4.
test('checkout real: archiva ventas y auditoría viejas en la misma transacción', async (t) => {
  const { createProcessorFixture, loadRealModule, saleOptions } =
    await import('./helpers/realModule.mjs');
  const { setActiveSedeId } = await import('../src/config/storageScope.js');
  setActiveSedeId('central');
  const f = createProcessorFixture(t);
  const { processSaleTransaction } = await loadRealModule('src/utils/checkoutProcessor.js', f.mocks);

  const oldSale = (daysAgo, n) => ({
    id: `old-sale-${n}`, saleNumber: n, tipo: 'VENTA',
    timestamp: new Date(NOW - daysAgo * DAY_MS).toISOString(),
    huella: { sedeId: 'central' },
  });
  await f.seed('bodega_sales_v1', [oldSale(120, 3), oldSale(200, 2), oldSale(400, 1)]);
  await f.seed('abasto_audit_log_v1', [
    { id: 'old-audit-1', ts: NOW - 200 * DAY_MS, cat: 'VENTA' },
    { id: 'old-audit-2', ts: NOW - 400 * DAY_MS, cat: 'VENTA' },
  ]);
  await f.seed('bodega_products_v1', saleOptions().products);

  const result = await processSaleTransaction(saleOptions());
  assert.equal(result.success, true, result.error);

  // 1) Correlativo monótono: la nueva es la 4.
  assert.equal(result.sale.saleNumber, 4);

  // 2) Ventas: caliente solo la nueva; archivo con las 3 viejas.
  const hot = await f.storage.getItem('bodega_sales_v1', []);
  const archive = await f.storage.getItem(SALES_ARCHIVE_KEY, []);
  assert.equal(hot.length, 1);
  assert.equal(hot[0].saleNumber, 4);
  assert.deepEqual(archive.map((s) => s.saleNumber), [3, 2, 1]);

  // 3) Auditoría: la entrada nueva en caliente; las viejas en archivo.
  const auditHot = await f.storage.getItem('abasto_audit_log_v1', []);
  const auditArchive = await f.storage.getItem(AUDIT_ARCHIVE_KEY, []);
  assert.ok(auditHot.every((e) => e.ts >= NOW - AUDIT_HOT_DAYS * DAY_MS), 'caliente solo reciente');
  assert.deepEqual(auditArchive.map((e) => e.id), ['old-audit-1', 'old-audit-2']);

  // 4) Cero pérdida: 3 + 1 ventas en total.
  assert.equal(hot.length + archive.length, 4);

  // 5) Segunda venta: el archivo no duplica y el correlativo avanza.
  const result2 = await processSaleTransaction(saleOptions());
  assert.equal(result2.sale.saleNumber, 5);
  const hot2 = await f.storage.getItem('bodega_sales_v1', []);
  const archive2 = await f.storage.getItem(SALES_ARCHIVE_KEY, []);
  assert.equal(hot2.length, 2);
  assert.equal(archive2.length, 3);
  assert.equal(new Set([...hot2, ...archive2].map((s) => s.id)).size, 5);
});
