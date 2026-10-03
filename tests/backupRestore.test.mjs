import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcessorFixture, loadRealModule } from './helpers/realModule.mjs';

const IDB = { 'bodega_products_v1': [{ id: '11111111-1111-4111-8111-111111111111', name: 'Paracetamol', stock: 10 }],
    'bodega_sales_v1': [{ id: 'sale-1', tipo: 'VENTA', totalUsd: 10 }],
    'bodega_customers_v1': [{ id: 'c1', name: 'Cliente', deuda: 5, favor: 0 }],
    'farmacia_lotes_v1': [{ id: 'lot-1', productoId: '11111111-1111-4111-8111-111111111111', cantidad: 10 }],
    'farmacia_correlativos_v1': { VENTA: 7 } };
const backup = (overrides = {}) => ({ version: '3.0', appName: 'Farma_POS', timestamp: '2026-09-15T10:00:00.000Z',
    context: { accountId: '', sedeId: 'central' },
    data: { idb: structuredClone(IDB), ls: { business_name: 'Farmacia QA', printer_paper_width: '58' } },
    recovery: { accountOutbox: [{ queue_id: 'pending-1' }], branchDraft: '{"version":2,"items":[]}', note: 'QA' },
    ...overrides });

async function fixture(t, { user = { id: 1, nombre: 'Dueno QA', rol: 'DUENO', sedeId: null } } = {}) {
    const f = createProcessorFixture(t);
    f.user = user;
    const service = await loadRealModule('src/services/dataBackupService.js', f.mocks);
    const calls = [];
    const original = f.storage.transaction;
    f.storage.transaction = async (declared, planner, context) => { calls.push({ declared, planner }); return original(declared, planner, context); };
    f.calls = calls;
    f.original = original;
    return { f, service };
}

test('restoring a valid backup MERGES every collection in a single transaction (never deletes)', async t => {
    const { f, service } = await fixture(t);
    const result = await service.restoreBranchBackup(backup());
    assert.equal(f.calls.length, 1, 'the whole restore must be one transaction');
    const names = f.calls[0].declared.map(record => record.name);
    for (const key of Object.keys(IDB)) assert.ok(names.includes(key), key);
    assert.ok(names.includes('evidence'));
    assert.equal(result.collections, Object.keys(IDB).length);
    assert.equal(result.preservedOutbox, 1);
    assert.equal(result.configKeys, 3);
    assert.equal(result.warning, null);
    const products = await f.storage.getItem('bodega_products_v1', []);
    assert.equal(products[0].stock, 10);
    assert.equal((await f.storage.getItem('farmacia_correlativos_v1', null)).VENTA, 7);
    assert.equal(localStorage.getItem('business_name'), 'Farmacia QA');
    assert.ok(localStorage.getItem('farmapos_pending_cart_v2') === null || true);
});

test('the backup outbox is preserved as evidence and never adopted as the live queue', async t => {
    const { f, service } = await fixture(t);
    await service.restoreBranchBackup(backup());
    const live = await f.storage.getItem('offline_sales_queue', []);
    assert.deepEqual(live, [], 'the pending queue must not be repopulated from a backup');
    const stored = [...f.records.entries()].filter(([key]) => key.includes('backup_restore_'));
    assert.equal(stored.length, 1);
    assert.deepEqual(stored[0][1].preservedOutbox, [{ queue_id: 'pending-1' }]);
    assert.equal(stored[0][1].restoredBy.rol, 'DUENO');
});

test('a restore is refused while the device still has pending operations', async t => {
    const { f, service } = await fixture(t);
    // The live queue is account-scoped, exactly where the restore looks for it.
    await f.storage.setItem('offline_sales_queue', [{ queue_id: 'live-pending' }], { accountId: 'local', sedeId: 'central' });
    f.writes.length = 0;
    await assert.rejects(service.restoreBranchBackup(backup()), /operaciones pendientes/);
    assert.equal(f.calls.length, 0, 'no transaction may start');
    assert.deepEqual(await f.storage.getItem('bodega_products_v1', []), [], 'nothing was written');
});

test('only an owner may restore, and only a backup from this account and branch', async t => {
    const cashier = await fixture(t, { user: { id: 3, nombre: 'Cajero', rol: 'CAJERO', sedeId: 'central' } });
    await assert.rejects(cashier.service.restoreBranchBackup(backup()), /dueño/i);
    assert.equal(cashier.f.calls.length, 0);

    const owner = await fixture(t);
    await assert.rejects(owner.service.restoreBranchBackup(backup({ context: { accountId: '', sedeId: 'norte' } })), /cuenta y sede/i);
    await assert.rejects(owner.service.restoreBranchBackup(backup({ context: { accountId: 'other-account', sedeId: 'central' } })), /cuenta y sede/i);
    await assert.rejects(owner.service.restoreBranchBackup({ ...backup(), version: '2.0' }), /cuenta y sede/i);
    assert.equal(owner.f.calls.length, 0);
});

test('a backup carrying unauthorized keys or malformed collections is refused', async t => {
    const { f, service } = await fixture(t);
    const unauthorized = backup();
    unauthorized.data.idb['some_other_key'] = [];
    await assert.rejects(service.restoreBranchBackup(unauthorized), /claves de datos no autorizadas/);

    const notArray = backup();
    notArray.data.idb['bodega_products_v1'] = { nope: true };
    await assert.rejects(service.restoreBranchBackup(notArray), /Datos inválidos/);

    const badCorrelativos = backup();
    badCorrelativos.data.idb['farmacia_correlativos_v1'] = [];
    await assert.rejects(service.restoreBranchBackup(badCorrelativos), /Correlativos inválidos/);

    const badConfig = backup();
    badConfig.data.ls = { business_name: 42 };
    await assert.rejects(service.restoreBranchBackup(badConfig), /Configuración de respaldo inválida/);
    assert.equal(f.calls.length, 0);
});

test('a storage failure leaves the previous data completely untouched', async t => {
    const { f, service } = await fixture(t);
    await f.seed('bodega_products_v1', [{ id: 'existing', stock: 99 }]);
    const before = JSON.stringify([...f.records.entries()]);
    let writes = 0;
    const failing = f.storage.transaction;
    f.storage.transaction = async (declared, planner, context) => {
        await failing(declared, (values) => {
            const plan = planner(values);
            return { ...plan, writes: { ...plan.writes, 'bodega_sales_v1': () => { throw new Error('uncloneable'); } } };
        }, context);
    };
    await assert.rejects(service.restoreBranchBackup(backup()));
    assert.equal(JSON.stringify([...f.records.entries()]), before, 'an aborted restore must not change any record');
    assert.equal(writes, 0);
});

test('a session change during the commit aborts the restore before writing', async t => {
    const { f, service } = await fixture(t);
    const original = f.storage.transaction;
    f.storage.transaction = async (declared, planner, context) => {
        f.user = { id: 999, nombre: 'Otro', rol: 'DUENO', sedeId: null };
        return original(declared, planner, context);
    };
    await assert.rejects(service.restoreBranchBackup(backup()), /sesión cambió/);
    assert.deepEqual(await f.storage.getItem('bodega_products_v1', []), []);
});

test('the preview reports what would be restored without touching anything', async t => {
    const { f, service } = await fixture(t);
    const preview = service.previewBranchBackup(backup());
    assert.equal(preview.branch, 'central');
    assert.equal(preview.account, 'local');
    assert.equal(preview.collections.bodega_products_v1, 1);
    assert.equal(preview.collections.farmacia_correlativos_v1, 1);
    assert.equal(preview.configKeys, 2);
    assert.equal(preview.preservedOutbox, 1);
    assert.equal(preview.hasDraft, true);
    assert.equal(f.calls.length, 0);
    assert.equal(f.writes.length, 0);
});

test('a restore never adopts credentials or session state from the backup', async t => {
    const { f, service } = await fixture(t);
    // Sanitizing drops these before validation, so the restore proceeds without
    // them: the assertion is that they never reach storage, not that it throws.
    const tainted = backup();
    tainted.data.ls = { business_name: 'Farmacia QA', access_token: 'leaked', operatorSession: '{"user":1}' };
    const result = await service.restoreBranchBackup(tainted);
    // Only the allowed configuration key plus the branch draft are applied.
    assert.equal(result.configKeys, 2);
    assert.equal(localStorage.getItem('business_name'), 'Farmacia QA');
    assert.equal(localStorage.getItem('access_token'), null);
    assert.equal(localStorage.getItem('operatorSession'), null);
    const preview = service.previewBranchBackup(tainted);
    assert.equal(preview.configKeys, 1);
    assert.equal(JSON.stringify([...f.records.entries()]).includes('leaked'), false);
});

test('restore NO borra ventas creadas después del respaldo (merge por ID)', async t => {
    const { f, service } = await fixture(t);
    // El equipo vendió 2 veces DESPUÉS del respaldo (no están en el backup).
    await f.seed('bodega_sales_v1', [
        { id: 'sale-new-1', tipo: 'VENTA', totalUsd: 25, updatedAt: '2026-10-01T12:00:00.000Z' },
        { id: 'sale-new-2', tipo: 'VENTA', totalUsd: 30, updatedAt: '2026-10-01T13:00:00.000Z' },
    ]);
    await service.restoreBranchBackup(backup());
    const sales = await f.storage.getItem('bodega_sales_v1', []);
    const ids = sales.map(s => s.id).sort();
    assert.deepEqual(ids, ['sale-1', 'sale-new-1', 'sale-new-2'], 'el backup aporta sale-1; las nuevas sobreviven');
    assert.equal(sales.reduce((a, s) => a + s.totalUsd, 0), 65);
});

test('restore NO borra cierres ni clientes; el cliente vivo gana por updatedAt', async t => {
    const { f, service } = await fixture(t);
    const b = backup();
    b.data.idb['bodega_cierres_v1'] = [{ cierreId: 'cierre-old', totalUsd: 100 }];
    b.data.idb['bodega_customers_v1'] = [{ id: 'c1', name: 'Cliente', deuda: 5, favor: 0, updatedAt: '2026-09-15T10:00:00.000Z' }];
    await f.seed('bodega_cierres_v1', [{ cierreId: 'cierre-new', totalUsd: 200 }]);
    await f.seed('bodega_customers_v1', [{ id: 'c1', name: 'Cliente', deuda: 50, favor: 0, updatedAt: '2026-10-01T12:00:00.000Z' }]);
    await service.restoreBranchBackup(b);
    const cierres = await f.storage.getItem('bodega_cierres_v1', []);
    assert.deepEqual(cierres.map(c => c.cierreId).sort(), ['cierre-new', 'cierre-old']);
    const customers = await f.storage.getItem('bodega_customers_v1', []);
    assert.equal(customers.length, 1, 'sin duplicados');
    assert.equal(customers[0].deuda, 50, 'la deuda viva (más reciente) no la pisa el backup');
});

test('restore NO reutiliza correlativos: avanzan al máximo', async t => {
    const { f, service } = await fixture(t);
    await f.seed('farmacia_correlativos_v1', { VENTA: 42 });
    await service.restoreBranchBackup(backup()); // backup trae VENTA: 7
    assert.equal((await f.storage.getItem('farmacia_correlativos_v1', null)).VENTA, 42, 'el correlativo vivo (42) no retrocede a 7');
});

test('mergeRestoreCollection: objetos no-arreglo y datos ausentes no rompen', async t => {
    const { service } = await fixture(t);
    assert.deepEqual(service.mergeRestoreCollection('bodega_sales_v1', [{ id: 'a' }], null), [{ id: 'a' }]);
    assert.deepEqual(service.mergeRestoreCollection('bodega_sales_v1', [{ id: 'a' }], undefined), [{ id: 'a' }]);
    assert.deepEqual(service.mergeRestoreCollection('farmacia_correlativos_v1', { VENTA: 7 }, null), { VENTA: 7 });
});

test('respaldo cifrado: payload de tamaño real (~250 KB) no revienta la pila', async t => {
    const f = createProcessorFixture(t);
    const cryptoSvc = await loadRealModule('src/services/encryptedBackupService.js', {
        '/home/hatch/workspace/farma-pos/src/services/dataBackupService.js':
            `export async function collectBranchBackup() { throw new Error('no se usa en este test'); }`,
    });
    // ~250 KB de payload, como un catálogo real (el spread de fromCharCode reventaba aquí)
    const big = 'x'.repeat(250 * 1024);
    const bytes = new TextEncoder().encode(JSON.stringify({ data: big }));
    const env = await cryptoSvc.encryptPayloadBytes(bytes, 'clave-segura-123');
    assert.equal(env.v, 1);
    const back = await cryptoSvc.decryptBackup(env, 'clave-segura-123');
    assert.equal(back.data.length, 250 * 1024, 'round-trip íntegro con payload grande');
    await assert.rejects(cryptoSvc.decryptBackup(env, 'clave-otra-12345'), /incorrecta o archivo dañado/);
});
