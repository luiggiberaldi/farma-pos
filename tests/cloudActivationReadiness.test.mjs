import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildCloudDocumentId,
  isCloudDocumentForContext,
  parseCloudDocumentId,
  isLegacyCloudDocumentId,
  CLOUD_SEDE_SCOPED_KEYS,
  CLOUD_ACCOUNT_SCOPED_KEYS,
} from '../src/config/cloudDocumentScope.js';
import {
  getStorageKeyForContext,
} from '../src/config/storageScope.js';
import {
  ledgerRecords,
  assertQueueOwnership,
  pendingOperation,
} from '../src/utils/localLedger.js';

// ══════════════════════════════════════════════════════════════════════════
// Utilidades deterministas: nada de setTimeout, Date.now ni Math.random.
// El tiempo es una variable que el test controla; la concurrencia es orden
// explícito de microtareas (colas de promesas resueltas a mano).
// ══════════════════════════════════════════════════════════════════════════

const T0 = Date.parse('2026-09-17T09:00:00.000Z');
const step = n => T0 + n * 1000;

/** PRNG con seed fija (mulberry32): misma secuencia en cualquier máquina. */
function seededRandom(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Scheduler determinista: las "latencias" son ticks de microtarea, no milisegundos.
 * Todas las promesas creadas en un tick se resuelven antes del siguiente tick,
 * en orden de encolado. Reproducible al 100% en cualquier plataforma.
 */
function createScheduler() {
  const queue = [];
  let settled = 0;
  return {
    /** Programa una operación que completa después de `ticks` ciclos. */
    schedule(ticks, run) {
      return new Promise((resolve, reject) => {
        queue.push({ due: settled + ticks, run, resolve, reject });
      });
    },
    /**
     * Avanza exactamente `n` ciclos. Cada ciclo resuelve lo vencido SIN awaits
     * entre items: los `run` son síncronos y sus promesas se resuelven en el
     * mismo microtask-batch, preservando el orden FIFO del ciclo.
     */
    async advance(n) {
      for (let i = 0; i < n; i += 1) {
        settled += 1;
        const due = queue.filter(item => item.due <= settled);
        for (let j = queue.length - 1; j >= 0; j -= 1) {
          if (queue[j].due <= settled) queue.splice(j, 1);
        }
        // Resolución síncrona por batch: sin `await` entre items, evitando
        // que un run se cuele en el ciclo siguiente del test.
        for (const item of due) {
          try { item.resolve(item.run()); }
          catch (error) { item.reject(error); }
        }
      }
    },
    get pending() { return queue.length; },
  };
}

const ACCOUNT = 'qa-activation';
const SEDES = ['central', 'norte', 'sur'];
const OPERATOR = { id: 'op-1', nombre: 'Dueño QA', rol: 'DUENO' };
const CONTEXT = { accountId: ACCOUNT, sedeId: 'central' };

/**
 * Transporte cloud sintético con orden FIFO determinista. `upsert`/`read`
 * aceptan `ticks` para escalonar latencias sin relojes: 1 tick = 1 ciclo
 * del scheduler. Nada aquí depende de setTimeout ni Date.now.
 */
function createCloudTransport(scheduler) {
  const documents = new Map();
  const receipts = new Set();
  return {
    documents,
    receipts,
    upsert(key, value, context, ticks = 1) {
      const docId = buildCloudDocumentId(key, context);
      return scheduler.schedule(ticks, () => {
        documents.set(docId, { docId, key, value: structuredClone(value), context: { ...context } });
        return docId;
      });
    },
    read(key, context, ticks = 1) {
      const docId = buildCloudDocumentId(key, context);
      return scheduler.schedule(ticks, () => {
        const doc = documents.get(docId);
        return doc ? structuredClone(doc.value) : null;
      });
    },
  };
}

// ══════════════════════════════════════════════════════════════════════════
// GATE A — Contrato de documentos cloud v2: tres sedes, cero colisiones.
// ══════════════════════════════════════════════════════════════════════════

test('GATE A: los 3 doc_id v2 de cada entidad sede-scoped son únicos y aislados', () => {
  for (const key of CLOUD_SEDE_SCOPED_KEYS) {
    const ids = SEDES.map(sedeId => buildCloudDocumentId(key, { accountId: ACCOUNT, sedeId }));
    assert.equal(new Set(ids).size, 3, `doc_id duplicados para ${key}`);

    for (let i = 0; i < SEDES.length; i += 1) {
      for (let j = 0; j < SEDES.length; j += 1) {
        const expected = i === j;
        assert.equal(
          isCloudDocumentForContext(ids[i], key, { accountId: ACCOUNT, sedeId: SEDES[j] }),
          expected,
          `${key}: doc de ${SEDES[i]} no debe aceptarse en ${SEDES[j]}`,
        );
      }
    }
    const parsed = parseCloudDocumentId(ids[0]);
    assert.equal(parsed.sedeScoped, true);
    assert.equal(parsed.accountId, ACCOUNT);
    assert.equal(parsed.sedeId, 'central');
  }
});

test('GATE A: claves account-scoped comparten un único doc_id por cuenta', () => {
  for (const key of CLOUD_ACCOUNT_SCOPED_KEYS) {
    const id = buildCloudDocumentId(key, { accountId: ACCOUNT, sedeId: 'central' });
    const idOther = buildCloudDocumentId(key, { accountId: ACCOUNT, sedeId: 'norte' });
    assert.equal(id, idOther, `${key} no debe variar por sede`);
    const parsed = parseCloudDocumentId(id);
    assert.equal(parsed.sedeScoped, false);
    assert.equal(parsed.sedeId, null);
    assert.equal(isCloudDocumentForContext(id, key, { accountId: ACCOUNT, sedeId: 'sur' }), true);
  }
});

test('GATE A: rechaza IDs legacy, cuentas malformadas y sedes fuera del contrato', () => {
  assert.equal(isLegacyCloudDocumentId('bodega_products_v1'), true);
  assert.equal(isLegacyCloudDocumentId('v1:bodega_products_v1:account:x:sede:central'), true);
  assert.equal(isLegacyCloudDocumentId('v2:farmacia_transferencias_v1:account:a:sede:norte'), true, 'account-scoped con sede es inválido');
  assert.equal(isLegacyCloudDocumentId(buildCloudDocumentId('bodega_products_v1', { accountId: ACCOUNT, sedeId: 'central' })), false);

  assert.throws(() => buildCloudDocumentId('bodega_products_v1', { accountId: 'a:b', sedeId: 'central' }), /Cuenta cloud inválida/);
  assert.throws(() => buildCloudDocumentId('bodega_products_v1', { accountId: ACCOUNT, sedeId: 'este' }), /Sede cloud inválida/);
  assert.throws(() => buildCloudDocumentId('entidad_sin_politica', { accountId: ACCOUNT, sedeId: 'central' }), /sin política/);
  assert.equal(parseCloudDocumentId(null), null);
  assert.equal(parseCloudDocumentId('v2:malformado'), null);
});

// ══════════════════════════════════════════════════════════════════════════
// GATE B — Matriz local ↔ cloud coherente: una clave sede-scoped en cloud
// nunca puede resolverse a una clave global en local (y viceversa).
// ══════════════════════════════════════════════════════════════════════════

test('GATE B: cada clave sede-scoped en cloud también está aislada localmente', () => {
  for (const key of CLOUD_SEDE_SCOPED_KEYS) {
    const central = getStorageKeyForContext(key, { accountId: ACCOUNT, sedeId: 'central' });
    const norte = getStorageKeyForContext(key, { accountId: ACCOUNT, sedeId: 'norte' });
    assert.notEqual(central, norte, `${key} debe tener claves locales distintas por sede`);
    assert.ok(central.includes('sede:central'), `${key} no quedó aislada localmente`);
  }
});

test('GATE B: claves account-scoped en cloud no se duplican localmente por sede', () => {
  for (const key of CLOUD_ACCOUNT_SCOPED_KEYS) {
    const a = getStorageKeyForContext(key, { accountId: ACCOUNT, sedeId: 'central' });
    const b = getStorageKeyForContext(key, { accountId: ACCOUNT, sedeId: 'sur' });
    assert.equal(a, b, `${key} no debe variar localmente por sede`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GATE C — Concurrencia entre sedes con orden determinista (scheduler propio,
// sin setTimeout). Las tres sedes escriben a la vez en ticks distintos y los
// documentos resultantes son exactamente 3.
// ══════════════════════════════════════════════════════════════════════════

test('GATE C: escrituras simultáneas de las 3 sedes producen exactamente 3 documentos', async () => {
  const scheduler = createScheduler();
  const cloud = createCloudTransport(scheduler);

  const writes = SEDES.map((sedeId, index) =>
    cloud.upsert('bodega_products_v1', [{ id: `prod-${sedeId}`, stock: index }], { accountId: ACCOUNT, sedeId }, index + 1));
  assert.equal(scheduler.pending, 3, 'las tres escrituras deben estar en vuelo');

  await scheduler.advance(3);
  assert.equal(scheduler.pending, 0);
  assert.equal(cloud.documents.size, 3);

  const reads = SEDES.map(sedeId => cloud.read('bodega_products_v1', { accountId: ACCOUNT, sedeId }));
  await scheduler.advance(1);
  const values = await Promise.all(reads);
  for (let i = 0; i < SEDES.length; i += 1) {
    assert.equal(values[i].length, 1);
    assert.equal(values[i][0].id, `prod-${SEDES[i]}`);
  }
  assert.deepEqual(
    [...cloud.documents.keys()].sort(),
    SEDES.map(sedeId => buildCloudDocumentId('bodega_products_v1', { accountId: ACCOUNT, sedeId })).sort(),
  );
});

test('GATE C: la escritura vencida de una sede nunca contamina a otra (orden FIFO)', async () => {
  const scheduler = createScheduler();
  const cloud = createCloudTransport(scheduler);

  // Norte programa 2 ticks, Central 1. Central aterriza primero aunque Norte
  // se programó antes. El orden de llegada no altera el aislamiento.
  const slowWrite = cloud.upsert('bodega_products_v1', [{ id: 'prod-norte' }], { accountId: ACCOUNT, sedeId: 'norte' }, 2);
  const fastWrite = cloud.upsert('bodega_products_v1', [{ id: 'prod-central' }], { accountId: ACCOUNT, sedeId: 'central' }, 1);
  assert.ok(slowWrite && fastWrite);

  await scheduler.advance(1);
  assert.ok(cloud.documents.has(buildCloudDocumentId('bodega_products_v1', { accountId: ACCOUNT, sedeId: 'central' })));
  assert.equal(cloud.documents.has(buildCloudDocumentId('bodega_products_v1', { accountId: ACCOUNT, sedeId: 'norte' })), false);

  await scheduler.advance(1);
  assert.equal(cloud.documents.size, 2);
});

// ══════════════════════════════════════════════════════════════════════════
// GATE D — Idempotencia de cola y transferencias con la lógica real
// (assertQueueOwnership + pendingOperation de localLedger, timestamps fijos).
// ══════════════════════════════════════════════════════════════════════════

test('GATE D: pendingOperation de cada sede lleva account, sede y clave de ventas propia', () => {
  for (const sedeId of SEDES) {
    const context = { accountId: ACCOUNT, sedeId };
    const op = pendingOperation(`op-${sedeId}-001`, 'SALE', { total: 10 }, context, OPERATOR, step(1));
    assert.equal(op.account_id, ACCOUNT);
    assert.equal(op.sede_id, sedeId);
    assert.equal(op.local_sales_key, getStorageKeyForContext('bodega_sales_v1', context));
    assert.equal(op.sync_status, 'pending');
    assert.equal(op.attempts, 0);
  }
  const central = pendingOperation('op-x', 'SALE', {}, { accountId: ACCOUNT, sedeId: 'central' }, OPERATOR, step(1));
  const norte = pendingOperation('op-x', 'SALE', {}, { accountId: ACCOUNT, sedeId: 'norte' }, OPERATOR, step(1));
  assert.notEqual(central.local_sales_key, norte.local_sales_key);
});

test('GATE D: el mismo operationId en otra sede es conflicto, no duplicado', () => {
  const queue = [
    pendingOperation('op-shared-01', 'SALE', {}, { accountId: ACCOUNT, sedeId: 'central' }, OPERATOR, step(1)),
  ];
  // Mismo id, misma sede y kind: válido (reintento).
  assert.equal(assertQueueOwnership(queue, 'op-shared-01', 'SALE', { accountId: ACCOUNT, sedeId: 'central' }), queue[0]);
  // Mismo id, sede distinta: debe rechazar.
  assert.throws(
    () => assertQueueOwnership(queue, 'op-shared-01', 'SALE', { accountId: ACCOUNT, sedeId: 'norte' }),
    /Conflicto de idempotencia/,
  );
  // Mismo id, otra cuenta: rechazar.
  assert.throws(
    () => assertQueueOwnership(queue, 'op-shared-01', 'SALE', { accountId: 'otra-cuenta', sedeId: 'central' }),
    /Conflicto de idempotencia/,
  );
});

test('GATE D: la cola account-scoped preserva sede_id y local_sales_key en cada entrada', () => {
  const queue = ledgerRecords(['queue'], CONTEXT);
  assert.equal(queue.length, 1);
  assert.equal(queue[0].name, 'queue');
  assert.equal(queue[0].context.accountId, ACCOUNT);
  // La cola nunca se fragmenta por sede, pero cada entrada lleva su origen:
  const entries = SEDES.map((sedeId, i) =>
    pendingOperation(`op-q-${i}`, 'SALE', {}, { accountId: ACCOUNT, sedeId }, OPERATOR, step(i + 2)));
  const sedeIds = new Set(entries.map(entry => entry.sede_id));
  assert.equal(sedeIds.size, 3);
  const keys = new Set(entries.map(entry => entry.local_sales_key));
  assert.equal(keys.size, 3);
});

// ══════════════════════════════════════════════════════════════════════════
// GATE E — La contención sigue activa: sin contrato server-side verificado,
// REMOTE_OPERATIONS_PAUSED debe seguir en true. Mientras esté pausado,
// ninguna ruta de negocio puede enviar datos a la nube.
// ══════════════════════════════════════════════════════════════════════════

test('GATE E: la bandera de contención permanece activa hasta pasar Gates server-side', async () => {
  const { REMOTE_OPERATIONS_PAUSED } = await import('../src/config/operationSafety.js');
  assert.equal(REMOTE_OPERATIONS_PAUSED, true, 'No activar cloud sin completar Fases 3-5 del plan');
});

// ══════════════════════════════════════════════════════════════════════════
// GATE F — Contrato SQL estático: las 3 migraciones declaran RLS en todas
// sus tablas y todas las RPC como security definer con search_path fijado.
// ══════════════════════════════════════════════════════════════════════════

test('GATE F: cada CREATE TABLE de las migraciones declara RLS o vive en app_private', async () => {
  const migrations = [
    'supabase/migrations/202609140001_pharmacy_core.sql',
    'supabase/migrations/202609140002_operator_access.sql',
    'supabase/migrations/202609150001_business_operations.sql',
  ];
  const rlsByFile = await Promise.all(migrations.map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    .then(sql => (sql.match(/ENABLE ROW LEVEL SECURITY/g) || []).length)));
  const tablesByFile = await Promise.all(migrations.map(path => readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    .then(sql => (sql.match(/CREATE TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[\w.]+/gi) || []).length)));

  // 12 tablas de app_private entre las 3 migraciones; todas deben tener RLS explícita.
  const totalTables = tablesByFile.reduce((a, b) => a + b, 0);
  const totalRls = rlsByFile.reduce((a, b) => a + b, 0);
  assert.ok(totalTables >= 12, `se esperaban >=12 tablas, hay ${totalTables}`);
  assert.equal(totalRls, totalTables, `cada tabla debe declarar RLS explícita: ${totalRls}/${totalTables}`);

  // Toda RPC de negocio es security definer (contrato de servicio confiable).
  for (const path of migrations) {
    const sql = await readFile(new URL(`../${path}`, import.meta.url), 'utf8');
    const rpcs = sql.match(/CREATE OR REPLACE FUNCTION[\s\S]*?AS \$\$/g) || [];
    for (const rpc of rpcs) {
      assert.ok(/SECURITY DEFINER/i.test(rpc), `RPC sin SECURITY DEFINER en ${path}`);
      assert.ok(/search_path\s*=/i.test(rpc), `RPC sin search_path fijado en ${path}`);
    }
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GATE G — Aleatoriedad con seed fija: 200 operaciones barajadas con el
// mismo PRNG producen siempre el mismo resultado (regresión de permutación).
// ══════════════════════════════════════════════════════════════════════════

test('GATE G: permutaciones con seed fija del orden de escritura conservan el aislamiento', async () => {
  const rand = seededRandom(20260917);
  const snapshotOf = async order => {
    const scheduler = createScheduler();
    const cloud = createCloudTransport(scheduler);
    for (const sedeId of order) {
      void cloud.upsert('bodega_products_v1', [{ id: `prod-${sedeId}` }], { accountId: ACCOUNT, sedeId });
    }
    await scheduler.advance(3);
    return [...cloud.documents.keys()].sort();
  };

  const canonical = await snapshotOf(SEDES);
  for (let iteration = 0; iteration < 200; iteration += 1) {
    const shuffled = [...SEDES];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rand() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    assert.deepEqual(await snapshotOf(shuffled), canonical, `permutación ${iteration} alteró el aislamiento`);
  }
});

// ══════════════════════════════════════════════════════════════════════════
// GATE H — Covarianza local↔cloud: la clave local de un producto de una
// sede nunca puede resolverse al doc_id cloud de otra sede, ni al revés.
// ══════════════════════════════════════════════════════════════════════════

test('GATE H: la clave local de una sede nunca mapea al doc_id cloud de otra', () => {
  for (const key of CLOUD_SEDE_SCOPED_KEYS) {
    for (const origin of SEDES) {
      for (const target of SEDES) {
        if (origin === target) continue;
        const localKey = getStorageKeyForContext(key, { accountId: ACCOUNT, sedeId: origin });
        const cloudTarget = buildCloudDocumentId(key, { accountId: ACCOUNT, sedeId: target });
        // El ID cloud de la sede destino no puede contener el namespace local
        // de la sede origen (y viceversa): dominios de nombres disjuntos.
        assert.ok(!localKey.includes(`sede:${target}:`), `${key}: clave local de ${origin} menciona a ${target}`);
        assert.ok(!cloudTarget.includes(`sede:${origin}:`), `${key}: doc_id de ${target} menciona a ${origin}`);
      }
    }
  }
});
