import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes, createHash } from 'node:crypto';

const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch {
  ({ PGlite } = require(process.env.PGLITE_PATH
    || join(homedir(), '.workbuddy-ai', 'binaries', 'node', 'workspace', 'node_modules', '@electric-sql', 'pglite')));
}
const core = await readFile(new URL('../migrations/202609140001_pharmacy_core.sql', import.meta.url), 'utf8');
const access = await readFile(new URL('../migrations/202609140002_operator_access.sql', import.meta.url), 'utf8');
const business = await readFile(new URL('../migrations/202609150001_business_operations.sql', import.meta.url), 'utf8');
const setup = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, is_anonymous boolean NOT NULL DEFAULT false);`;
const hex = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const PRODUCT = randomUUID();
const CONTROLLED = randomUUID();

// PGlite serializes a single connection. The batches below exercise the claim
// and idempotency state machine, NOT real multi-connection lock scheduling.
// Real contention must be verified on PostgreSQL with separate connections.
test('fresh isolated business operations contract (synthetic Auth; no network)', async t => {
  const db = new PGlite();
  await db.exec(setup);
  await db.exec(core);
  await db.exec(access);
  await db.exec(business);
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const rpc = async (name, args) => {
    const params = args.map((_, i) => `$${i + 1}`).join(',');
    return (await q(`SELECT public.${name}(${params}) AS value`, args))[0].value;
  };
  const asRole = async (role, fn) => { await db.exec(`SET ROLE ${role}`); try { return await fn(); } finally { await db.exec('RESET ROLE'); } };

  const uid = randomUUID();
  await q('INSERT INTO auth.users(id) VALUES ($1)', [uid]);
  const owner = await rpc('pharmacy_bootstrap_owner', [uid, 'Ops', 'Owner', 'owner-ops', hex(), hex(), 210000]);
  const branches = await q('SELECT id, code FROM app_private.branches WHERE tenant_id=$1', [owner.tenant_id]);
  const central = branches.find(b => b.code === 'central').id;
  const norte = branches.find(b => b.code === 'norte').id;
  // One session per device: each role and branch needs its own terminal.
  const ownerDevice = { id: randomUUID(), proof: hex() };
  const cashierDevice = { id: randomUUID(), proof: hex() };
  const norteDevice = { id: randomUUID(), proof: hex() };
  await rpc('pharmacy_enroll_device', [uid, ownerDevice.id, ownerDevice.proof, 'Mostrador']);
  await rpc('pharmacy_enroll_device', [uid, cashierDevice.id, cashierDevice.proof, 'Caja']);
  await rpc('pharmacy_enroll_device', [uid, norteDevice.id, norteDevice.proof, 'Sucursal']);

  const cashier = randomUUID();
  await q(`INSERT INTO app_private.operators(id,tenant_id,local_code,name,role,branch_id,pin_salt,pin_hash,pin_iterations)
    VALUES ($1,$2,'cashier','Cashier','CAJERO',$3,$4,$5,210000)`, [cashier, owner.tenant_id, central, hex(), hex()]);
  const login = async (device, operator, branch) => {
    const attempt = await rpc('pharmacy_reserve_pin_attempt', [uid, device.id, device.proof, operator, branch]);
    assert.ok(attempt, 'reservation must succeed');
    const token = hex();
    assert.ok(await rpc('pharmacy_finish_pin_attempt',
      [uid, device.id, device.proof, operator, attempt.attempt_id, attempt.credential_version, true, token]));
    return token;
  };
  const ownerToken = await login(ownerDevice, owner.operator_id, central);
  const cashierToken = await login(cashierDevice, cashier, central);
  const norteToken = await login(norteDevice, owner.operator_id, norte);
  const creds = (device, token) => [uid, device.id, device.proof, token];
  const upsert = (device, token, id, name, price, prescription = false, controlled = false) => rpc(
    'pharmacy_upsert_catalogue_item', [...creds(device, token), id, name, price, prescription, controlled]);
  const stock = (device, token, operationId, productId, delta, reason = 'ADJUSTMENT') => rpc(
    'pharmacy_commit_stock_movement', [...creds(device, token), operationId, hash([productId, delta, reason]), productId, delta, reason]);
  const sale = (device, token, operationId, items, extra = {}) => {
    const payload = { operationId, items, extra };
    return rpc('pharmacy_commit_sale', [...creds(device, token), operationId, hash(payload),
      extra.businessDate || '2026-09-15', extra.rate || 100, JSON.stringify(items),
      extra.totalUsd ?? 10, extra.totalBs ?? 1000,
      extra.prescription ? JSON.stringify(extra.prescription) : null]);
  };
  const voidSale = (device, token, operationId, saleId) => rpc(
    'pharmacy_commit_void', [...creds(device, token), operationId, hash([saleId]), saleId]);
  const line = (quantity, price = 10) => [{ product_id: PRODUCT, quantity_base: quantity, unit_price_usd: price, line_total_usd: 10 }];
  const stockOf = async (productId, branchId = central) => Number((await q(
    'SELECT quantity FROM app_private.branch_stock WHERE product_id=$1 AND branch_id=$2', [productId, branchId]))[0]?.quantity ?? -1);
  const salesCount = async () => (await q('SELECT count(*)::int AS n FROM app_private.sales'))[0].n;

  try {
    await t.test('business RPCs are service-only, definer-safe and add no browser policy', async () => {
      const procs = await q(`SELECT p.oid, p.proname, p.prosecdef, p.proconfig FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pharmacy_%'`);
      assert.equal(procs.length, 11);
      for (const proc of procs) {
        assert.equal(proc.prosecdef, true, proc.proname);
        assert.ok(proc.proconfig.some(s => s.startsWith('search_path=')), proc.proname);
        for (const role of ['anon', 'authenticated']) {
          assert.equal((await q(`SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS ok`, [role, proc.oid]))[0].ok, false, `${role} ${proc.proname}`);
        }
        assert.equal((await q(`SELECT has_function_privilege('service_role',$1::oid,'EXECUTE') AS ok`, [proc.oid]))[0].ok, true, proc.proname);
      }
      const tables = await q(`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app_private' AND c.relkind='r' ORDER BY c.relname`);
      assert.equal(tables.length, 12);
      for (const table of tables) {
        assert.equal(table.relrowsecurity, true, table.relname);
        for (const role of ['anon', 'authenticated', 'service_role']) {
          await assert.rejects(asRole(role, () => q(`SELECT * FROM app_private.${table.relname}`)), /permission denied/i);
        }
      }
      assert.equal((await q(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='app_private'`))[0].n, 0);
      assert.equal((await q(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
        LATERAL aclexplode(p.proacl) acl WHERE n.nspname='public' AND p.proname LIKE 'pharmacy_%'
        AND acl.grantee=0 AND acl.privilege_type='EXECUTE'`))[0].n, 0);
    });

    await t.test('catalogue requires owner or admin and rejects malformed input', async () => {
      assert.ok(await upsert(ownerDevice, ownerToken, PRODUCT, 'Paracetamol', 10));
      assert.ok(await upsert(ownerDevice, ownerToken, CONTROLLED, 'Controlado', 25, true, true));
      assert.equal(await upsert(cashierDevice, cashierToken, randomUUID(), 'No', 5), null);
      for (const bad of [[null, 'x', 5], [randomUUID(), '', 5], [randomUUID(), 'x', -1], [randomUUID(), 'x', null]]) {
        assert.equal(await upsert(ownerDevice, ownerToken, ...bad), null);
      }
      assert.equal(await upsert(ownerDevice, hex(), PRODUCT, 'x', 5), null);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.catalogue_items'))[0].n, 2);
    });

    await t.test('one session per device: a second login revokes the first on that terminal', async () => {
      const first = await login(cashierDevice, cashier, central);
      const second = await login(cashierDevice, cashier, central);
      assert.equal(await rpc('pharmacy_validate_operator_session', [...creds(cashierDevice, first)]), null);
      assert.ok(await rpc('pharmacy_validate_operator_session', [...creds(cashierDevice, second)]));
      assert.equal(await stock(cashierDevice, first, 'opening-revoked', PRODUCT, 5, 'OPENING'), null);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.stock_movements'))[0].n, 0);
    });

    await t.test('stock opening is idempotent, refuses negatives and unknown products', async () => {
      const first = await stock(ownerDevice, ownerToken, 'opening-0001', PRODUCT, 25, 'OPENING');
      assert.equal(Number(first.quantity), 25);
      const replay = await stock(ownerDevice, ownerToken, 'opening-0001', PRODUCT, 25, 'OPENING');
      assert.equal(replay.duplicate, true); assert.equal(Number(replay.quantity), 25);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.stock_movements'))[0].n, 1);
      assert.equal(await stock(ownerDevice, ownerToken, 'opening-0002', PRODUCT, -1, 'OPENING'), null);
      await assert.rejects(stock(ownerDevice, ownerToken, 'adjust-0001', PRODUCT, -30), /negative/i);
      await assert.rejects(stock(ownerDevice, ownerToken, 'adjust-0002', randomUUID(), 1), /Unknown or disabled product/);
      assert.equal(await stock(ownerDevice, ownerToken, 'adjust-0003', PRODUCT, 0), null);
      assert.equal(await stock(ownerDevice, ownerToken, 'adjust-0004', PRODUCT, 1, 'SALE'), null);
      assert.equal(await stock(ownerDevice, ownerToken, 'adjust-0005', PRODUCT, 1.0005), null);
      assert.equal(Number((await stock(ownerDevice, ownerToken, 'opening-0003', CONTROLLED, 5, 'OPENING')).quantity), 5);
      assert.equal(await stockOf(PRODUCT), 25);
    });

    await t.test('a confirmed sale decrements stock exactly once and records one movement', async () => {
      const receipt = await sale(ownerDevice, ownerToken, 'sale-00000001', line(2));
      assert.equal(receipt.duplicate, undefined); assert.equal(receipt.status, 'CONFIRMADA');
      assert.equal(receipt.lines, 1); assert.equal(receipt.branch_id, central);
      assert.equal(await stockOf(PRODUCT), 23);
      assert.equal((await q("SELECT count(*)::int AS n FROM app_private.stock_movements WHERE reason='SALE'"))[0].n, 1);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.sale_items'))[0].n, 1);
      assert.equal(Number((await q('SELECT unit_price_usd FROM app_private.sale_items'))[0].unit_price_usd), 10);
    });

    await t.test('replaying the same operation returns the stored receipt and never sells twice', async () => {
      const replay = await sale(ownerDevice, ownerToken, 'sale-00000001', line(2));
      assert.equal(replay.duplicate, true);
      assert.equal(replay.sale_id, (await q("SELECT id FROM app_private.sales WHERE operation_id='sale-00000001'"))[0].id);
      assert.equal(await salesCount(), 1);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.stock_movements'))[0].n, 3);
      assert.equal(await stockOf(PRODUCT), 23);
    });

    await t.test('a reused operation id with a different payload is rejected without side effects', async () => {
      await assert.rejects(sale(ownerDevice, ownerToken, 'sale-00000001', line(5)), /Operation id conflict/);
      assert.equal(await salesCount(), 1);
      assert.equal(await stockOf(PRODUCT), 23);
    });

    await t.test('an operation id is global per tenant: another branch or kind cannot reuse it', async () => {
      await assert.rejects(sale(norteDevice, norteToken, 'sale-00000001', line(1)), /Operation id conflict/);
      await assert.rejects(stock(ownerDevice, ownerToken, 'sale-00000001', PRODUCT, 1), /Operation id conflict/);
      assert.equal(await salesCount(), 1);
      assert.equal(await stockOf(PRODUCT, norte), -1, 'the conflicted sale must not create branch stock');
    });

    await t.test('insufficient stock, duplicate lines and unknown products abort the whole sale', async () => {
      const duplicate = [{ product_id: PRODUCT, quantity_base: 1, unit_price_usd: 10, line_total_usd: 10 },
        { product_id: PRODUCT, quantity_base: 1, unit_price_usd: 10, line_total_usd: 10 }];
      const unknown = [{ product_id: randomUUID(), quantity_base: 1, unit_price_usd: 10, line_total_usd: 10 }];
      await assert.rejects(sale(ownerDevice, ownerToken, 'sale-bad-stock', line(1000)), /Insufficient stock/);
      await assert.rejects(sale(ownerDevice, ownerToken, 'sale-bad-dup', duplicate), /Duplicate product lines/);
      await assert.rejects(sale(ownerDevice, ownerToken, 'sale-bad-unknown', unknown), /Unknown or disabled product/);
      assert.equal(await salesCount(), 1);
      assert.equal(await stockOf(PRODUCT), 23);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.operation_receipts WHERE receipt IS NULL'))[0].n, 0);
    });

    await t.test('prescription-only lines require evidence and store it on the sale', async () => {
      const controlled = [{ product_id: CONTROLLED, quantity_base: 1, unit_price_usd: 25, line_total_usd: 25 }];
      await assert.rejects(sale(ownerDevice, ownerToken, 'sale-controlled-1', controlled), /Prescription evidence required/);
      await assert.rejects(sale(ownerDevice, ownerToken, 'sale-controlled-2', controlled,
        { prescription: { reference: '', prescriber: 'Dr. X' } }), /Prescription evidence required/);
      const receipt = await sale(ownerDevice, ownerToken, 'sale-controlled-3', controlled,
        { prescription: { reference: 'REF-1', prescriber: 'Dr. X' } });
      assert.equal(receipt.status, 'CONFIRMADA');
      assert.equal((await q("SELECT prescription->>'reference' AS ref FROM app_private.sales WHERE operation_id=$1",
        ['sale-controlled-3']))[0].ref, 'REF-1');
      assert.equal(await stockOf(CONTROLLED), 4);
    });

    await t.test('malformed payloads are refused before any write', async () => {
      const c = creds(ownerDevice, ownerToken);
      const calls = [
        [...c, 'short', hash([1]), '2026-09-15', 100, JSON.stringify(line(1)), 10, 1000, null],
        [...c, 'sale-mal-01', 'nothex', '2026-09-15', 100, JSON.stringify(line(1)), 10, 1000, null],
        [...c, 'sale-mal-02', hash([1]), '2026-09-15', 100, JSON.stringify([]), 10, 1000, null],
        [...c, 'sale-mal-03', hash([1]), '2026-09-15', 100, '"not-array"', 10, 1000, null],
        [...c, 'sale-mal-04', hash([1]), '2026-09-15', 0, JSON.stringify(line(1)), 10, 1000, null],
        [...c, 'sale-mal-05', hash([1]), '2026-09-15', 100, JSON.stringify(line(0)), 10, 1000, null],
        [...c, 'sale-mal-06', hash([1]), null, 100, JSON.stringify(line(1)), 10, 1000, null],
      ];
      for (const args of calls) assert.equal(await rpc('pharmacy_commit_sale', args), null);
      assert.equal((await q("SELECT count(*)::int AS n FROM app_private.operation_receipts WHERE operation_id LIKE '%mal%'"))[0].n, 0);
    });

    await t.test('writes require a live session: wrong device, wrong account and revoked token are refused', async () => {
      assert.equal(await rpc('pharmacy_commit_sale', [randomUUID(), ownerDevice.id, ownerDevice.proof, ownerToken,
        'sale-wrong-acc', hash([1]), '2026-09-15', 100, JSON.stringify(line(1)), 10, 1000, null]), null);
      assert.equal(await rpc('pharmacy_commit_sale', [uid, ownerDevice.id, hex(), ownerToken,
        'sale-wrong-dev', hash([1]), '2026-09-15', 100, JSON.stringify(line(1)), 10, 1000, null]), null);
      assert.equal(await rpc('pharmacy_commit_sale', [uid, ownerDevice.id, ownerDevice.proof, hex(),
        'sale-no-token', hash([1]), '2026-09-15', 100, JSON.stringify(line(1)), 10, 1000, null]), null);
      assert.equal(await rpc('pharmacy_commit_stock_movement', [uid, ownerDevice.id, ownerDevice.proof, hex(),
        'stock-no-token', hash([1]), PRODUCT, 1, 'ADJUSTMENT']), null);
      assert.equal(await rpc('pharmacy_commit_void', [uid, ownerDevice.id, ownerDevice.proof, hex(),
        'void-no-token', hash([1]), randomUUID()]), null);
      const revoked = await login(cashierDevice, cashier, central);
      await rpc('pharmacy_revoke_operator_session', [...creds(cashierDevice, revoked)]);
      assert.equal(await rpc('pharmacy_validate_operator_session', [...creds(cashierDevice, revoked)]), null);
      assert.equal(await sale(cashierDevice, revoked, 'sale-revoked-1', line(1)), null);
      assert.equal(await salesCount(), 2);
    });

    await t.test('a void restores the exact quantities once and blocks a second reversal', async () => {
      const saleId = (await q("SELECT id FROM app_private.sales WHERE operation_id='sale-00000001'"))[0].id;
      const receipt = await voidSale(ownerDevice, ownerToken, 'void-00000001', saleId);
      assert.equal(receipt.status, 'ANULADA');
      assert.equal(await stockOf(PRODUCT), 25);
      const replay = await voidSale(ownerDevice, ownerToken, 'void-00000001', saleId);
      assert.equal(replay.duplicate, true);
      assert.equal(await stockOf(PRODUCT), 25);
      assert.equal((await q("SELECT count(*)::int AS n FROM app_private.stock_movements WHERE reason='VOID'"))[0].n, 1);
      await assert.rejects(voidSale(ownerDevice, ownerToken, 'void-00000002', saleId), /already reversed/i);
      assert.equal(await stockOf(PRODUCT), 25);
      await assert.rejects(voidSale(ownerDevice, ownerToken, 'void-00000003', randomUUID()), /Unknown sale/);
      assert.equal(await stockOf(PRODUCT), 25);
    });

    await t.test('a sale is never reversible from another branch, not even by the owner', async () => {
      const saleId = (await q("SELECT id FROM app_private.sales WHERE operation_id='sale-controlled-3'"))[0].id;
      await assert.rejects(voidSale(norteDevice, norteToken, 'void-cross-01', saleId), /another branch/i);
      assert.equal((await q('SELECT status FROM app_private.sales WHERE id=$1', [saleId]))[0].status, 'CONFIRMADA');
      assert.equal(await stockOf(CONTROLLED), 4);
    });

    await t.test('branch isolation holds: a sale in one branch never touches another branch stock', async () => {
      await stock(norteDevice, norteToken, 'opening-norte-1', PRODUCT, 7, 'OPENING');
      const receipt = await sale(norteDevice, norteToken, 'sale-norte-0001', line(3), { totalUsd: 30, totalBs: 3000 });
      assert.equal(receipt.branch_id, norte);
      assert.equal(await stockOf(PRODUCT, norte), 4);
      assert.equal(await stockOf(PRODUCT, central), 25);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.sales WHERE branch_id=$1', [central]))[0].n, 2);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.sales WHERE branch_id=$1', [norte]))[0].n, 1);
    });

    await t.test('an anonymous account bearer cannot reach any business RPC', async () => {
      for (const role of ['anon', 'authenticated']) {
        await assert.rejects(asRole(role, () => rpc('pharmacy_commit_sale', [...creds(ownerDevice, ownerToken),
          'sale-anon-001', hash([1]), '2026-09-15', 100, JSON.stringify(line(1)), 10, 1000, null])), /permission denied/i);
        await assert.rejects(asRole(role, () => rpc('pharmacy_commit_stock_movement', [...creds(ownerDevice, ownerToken),
          'stock-anon-01', hash([1]), PRODUCT, 1, 'ADJUSTMENT'])), /permission denied/i);
        await assert.rejects(asRole(role, () => rpc('pharmacy_commit_void', [...creds(ownerDevice, ownerToken),
          'void-anon-001', hash([1]), randomUUID()])), /permission denied/i);
      }
      assert.equal(await salesCount(), 3);
      assert.equal(await stockOf(PRODUCT, central), 25);
    });

    await t.test('second execution of the business migration fails atomically', async () => {
      const before = await salesCount();
      await assert.rejects(db.exec(business), /already exists/);
      await db.exec('ROLLBACK');
      assert.equal(await salesCount(), before);
      assert.ok(await rpc('pharmacy_operator_directory', [uid, ownerDevice.id, ownerDevice.proof]));
    });
  } finally { await db.close(); }
});
