import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
let PGlite;
try { ({ PGlite } = require('@electric-sql/pglite')); }
catch {
  ({ PGlite } = require(process.env.PGLITE_PATH
    || join(homedir(), '.workbuddy-ai', 'binaries', 'node', 'workspace', 'node_modules', '@electric-sql', 'pglite')));
}
const core = await readFile(new URL('../migrations/202609140001_pharmacy_core.sql', import.meta.url), 'utf8');
const access = await readFile(new URL('../migrations/202609140002_operator_access.sql', import.meta.url), 'utf8');
const hex = () => randomBytes(32).toString('hex');
const setup = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, is_anonymous boolean NOT NULL DEFAULT false);`;
const names = ['pharmacy_bootstrap_owner', 'pharmacy_enroll_device', 'pharmacy_operator_directory',
  'pharmacy_reserve_pin_attempt', 'pharmacy_finish_pin_attempt', 'pharmacy_validate_operator_session',
  'pharmacy_revoke_operator_session'];

// PGlite serializes its single connection. Promise batches below exercise the
// database budget/commit state machine, NOT real multi-connection lock scheduling.
// The trusted-server p_verified flag is synthetic here; PBKDF2 belongs to server tests.
test('fresh isolated operator SQL contract (synthetic Auth; no network)', async t => {
  const db = new PGlite();
  await db.exec(setup);
  await db.exec(core);
  await db.exec(access);
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const rawRpc = async (name, args) => {
    assert.ok(names.includes(name));
    return (await q(`SELECT public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS value`, args))[0].value;
  };
  const asRole = async (role, fn) => {
    assert.ok(['anon', 'authenticated', 'service_role'].includes(role));
    await db.exec(`SET ROLE ${role}`);
    try { return await fn(); } finally { await db.exec('RESET ROLE'); }
  };
  const rpc = (name, args) => asRole('service_role', () => rawRpc(name, args));
  const resetBudget = () => db.exec(`UPDATE app_private.pharmacy_tenants SET attempt_count=0, attempt_window=clock_timestamp();
    UPDATE app_private.devices SET attempt_count=0, attempt_window=clock_timestamp();
    UPDATE app_private.operators SET failed_attempts=0, locked_until=NULL;
    DELETE FROM app_private.pin_attempts;`);
  const fixture = async label => {
    const uid = randomUUID();
    await q('INSERT INTO auth.users(id) VALUES ($1)', [uid]);
    const owner = await rpc('pharmacy_bootstrap_owner', [uid, label, 'Owner', `owner-${label}`, hex(), hex(), 210000]);
    const branches = await q('SELECT id, code FROM app_private.branches WHERE tenant_id=$1 ORDER BY code', [owner.tenant_id]);
    const did = randomUUID(); const proof = hex();
    await rpc('pharmacy_enroll_device', [uid, did, proof, `Device ${label}`]);
    return { uid, did, proof, tenant: owner.tenant_id, operator: owner.operator_id,
      central: branches.find(b => b.code === 'central').id,
      norte: branches.find(b => b.code === 'norte').id, branches };
  };
  const a = await fixture('A'); const b = await fixture('B');
  const cashier = randomUUID(); const admin = randomUUID();
  await q(`INSERT INTO app_private.operators(id,tenant_id,local_code,name,role,branch_id,pin_salt,pin_hash,pin_iterations)
    VALUES ($1,$2,'cashier','Cashier','CAJERO',$3,$4,$5,210000),
           ($6,$2,'admin','Admin','ADMIN',NULL,$4,$5,210000)`, [cashier, a.tenant, a.central, hex(), hex(), admin]);
  const reserve = (f = a, operator = f.operator, branch = f.central) => rpc('pharmacy_reserve_pin_attempt',
    [f.uid, f.did, f.proof, operator, branch]);
  const finish = (attempt, token, f = a, operator = f.operator, verified = true) => rpc('pharmacy_finish_pin_attempt',
    [f.uid, f.did, f.proof, operator, attempt.attempt_id, attempt.credential_version, verified, token]);
  const validate = (token, f = a) => rpc('pharmacy_validate_operator_session', [f.uid, f.did, f.proof, token]);
  const login = async (f = a, operator = f.operator, branch = f.central) => {
    const attempt = await reserve(f, operator, branch); assert.ok(attempt);
    const token = hex(); assert.ok(await finish(attempt, token, f, operator)); return token;
  };
  try {
    await t.test('all six private tables have RLS and deny browser/direct service reads', async () => {
      const tables = await q(`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname='app_private' AND c.relkind='r' ORDER BY c.relname`);
      assert.equal(tables.length, 6);
      for (const table of tables) {
        assert.equal(table.relrowsecurity, true);
        for (const role of ['anon', 'authenticated', 'service_role']) {
          await assert.rejects(asRole(role, () => q(`SELECT * FROM app_private.${table.relname}`)), /permission denied/i);
        }
      }
      assert.equal((await q(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname='app_private'`))[0].n, 0);
    });
    await t.test('all seven RPCs deny anon/authenticated/PUBLIC and allow only service execution', async () => {
      const procs = await q(`SELECT p.oid, p.proname, p.prosecdef, p.proconfig FROM pg_proc p
        JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.proname LIKE 'pharmacy_%'`);
      assert.equal(procs.length, 7);
      for (const proc of procs) {
        assert.equal(proc.prosecdef, true);
        assert.ok(proc.proconfig.some(s => s.startsWith('search_path=')));
        for (const role of ['anon', 'authenticated']) {
          assert.equal((await q(`SELECT has_function_privilege($1,$2::oid,'EXECUTE') AS ok`, [role, proc.oid]))[0].ok, false);
        }
        assert.equal((await q(`SELECT has_function_privilege('service_role',$1::oid,'EXECUTE') AS ok`, [proc.oid]))[0].ok, true);
      }
      for (const role of ['anon', 'authenticated']) {
        await assert.rejects(asRole(role, () => rawRpc('pharmacy_operator_directory', [a.uid, a.did, a.proof])), /permission denied/i);
      }
      assert.equal((await q(`SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
        LATERAL aclexplode(p.proacl) acl WHERE n.nspname='public' AND p.proname LIKE 'pharmacy_%'
        AND acl.grantee=0 AND acl.privilege_type='EXECUTE'`))[0].n, 0);
    });
    await t.test('fresh preflight rejects legacy public tables/functions without partial schema', async () => {
      const legacy = new PGlite();
      try {
        await legacy.exec(setup);
        await legacy.exec('CREATE TABLE public.device_backups(id integer);');
        await assert.rejects(legacy.exec(core), /Fresh isolated project required/);
        await legacy.exec('ROLLBACK');
        assert.equal((await legacy.query("SELECT to_regnamespace('app_private') AS ns")).rows[0].ns, null);
        await legacy.exec('DROP TABLE public.device_backups; CREATE FUNCTION public.process_checkout() RETURNS void LANGUAGE sql AS $$ SELECT $$;');
        await assert.rejects(legacy.exec(core), /Fresh isolated project required/);
        await legacy.exec('ROLLBACK');
        assert.equal((await legacy.query("SELECT to_regnamespace('app_private') AS ns")).rows[0].ns, null);
      } finally { await legacy.close(); }
    });
    await t.test('intentional second migration execution fails atomically', async () => {
      const before = (await q('SELECT count(*)::int AS n FROM app_private.pharmacy_tenants'))[0].n;
      await assert.rejects(db.exec(core), /Fresh isolated project required|already exists/);
      await db.exec('ROLLBACK');
      await assert.rejects(db.exec(access), /already exists/);
      await db.exec('ROLLBACK');
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.pharmacy_tenants'))[0].n, before);
      assert.ok(await rpc('pharmacy_operator_directory', [a.uid, a.did, a.proof]));
    });
    await t.test('explicit bootstrap is unique, anonymous owner denied and enrollment is insert-only', async () => {
      await assert.rejects(rpc('pharmacy_bootstrap_owner', [a.uid, 'Again', 'Owner', 'x', hex(), hex(), 210000]), /unique|duplicate/);
      const anonymous = randomUUID(); await q('INSERT INTO auth.users(id,is_anonymous) VALUES ($1,true)', [anonymous]);
      await assert.rejects(rpc('pharmacy_bootstrap_owner', [anonymous, 'No', 'No', 'no', hex(), hex(), 210000]), /Verified owner required/);
      await assert.rejects(rpc('pharmacy_enroll_device', [a.uid, a.did, hex(), 'Again']), /unique|duplicate/);
      assert.equal(await rpc('pharmacy_enroll_device', [randomUUID(), randomUUID(), hex(), 'Unknown']), null);
    });
    await t.test('safe directory never returns PIN, credential versions, tenant or device secrets', async () => {
      const directory = await rpc('pharmacy_operator_directory', [a.uid, a.did, a.proof]);
      assert.equal(directory.branches.length, 3);
      assert.equal(directory.operators.length, 3);
      for (const o of directory.operators) assert.deepEqual(Object.keys(o).sort(), ['branch_id', 'id', 'local_code', 'name', 'role']);
      for (const branch of directory.branches) assert.deepEqual(Object.keys(branch).sort(), ['code', 'id', 'name']);
      for (const args of [[b.uid, a.did, a.proof], [a.uid, b.did, b.proof], [a.uid, a.did, hex()]]) {
        assert.equal(await rpc('pharmacy_operator_directory', args), null);
      }
    });
    await t.test('wrong account/device/tenant/branch fail and cashier cannot change branch', async () => {
      await resetBudget();
      assert.equal(await reserve({ ...a, uid: b.uid }), null);
      assert.equal(await reserve({ ...a, did: b.did, proof: b.proof }), null);
      assert.equal(await reserve({ ...a, proof: hex() }), null);
      assert.equal(await reserve(a, b.operator), null);
      assert.equal(await reserve(a, a.operator, b.central), null);
      assert.equal(await reserve(a, cashier, a.norte), null);
      const token = await login(a, cashier);
      const authority = await validate(token);
      assert.equal(authority.role, 'CAJERO'); assert.equal(authority.branch_id, a.central);
      assert.equal(await validate(token, b), null);
      assert.equal(await validate(token, { ...a, proof: hex() }), null);
      await assert.rejects(q(`INSERT INTO app_private.operators(tenant_id,local_code,name,role,pin_salt,pin_hash,pin_iterations)
        VALUES ($1,'invalid-cashier','Invalid','CAJERO',$2,$3,210000)`, [a.tenant, hex(), hex()]), /check constraint/);
    });
    await t.test('abandoned attempts spend budget; Promise batch is serialized PGlite, not live concurrency', async () => {
      await resetBudget();
      const attempts = await asRole('service_role', () => Promise.all(Array.from({ length: 12 }, () =>
        rawRpc('pharmacy_reserve_pin_attempt', [a.uid, a.did, a.proof, a.operator, a.central]))));
      assert.equal(attempts.filter(Boolean).length, 5);
      const row = (await q('SELECT failed_attempts, locked_until > clock_timestamp() AS locked FROM app_private.operators WHERE id=$1', [a.operator]))[0];
      assert.equal(row.failed_attempts, 5); assert.equal(row.locked, true);
      assert.equal(await reserve(), null);
      await q("UPDATE app_private.operators SET locked_until=clock_timestamp()-interval '1 second' WHERE id=$1", [a.operator]);
      assert.ok(await reserve());
    });
    await t.test('device and tenant aggregate budgets limit cross-operator fan-out', async () => {
      await resetBudget();
      // Missing operators still spend aggregate budget before target lookup.
      for (let i = 0; i < 20; i++) assert.equal(await reserve(a, randomUUID()), null);
      assert.equal(await reserve(), null);
      assert.equal((await q('SELECT attempt_count FROM app_private.devices WHERE id=$1', [a.did]))[0].attempt_count, 20);
      await resetBudget();
      for (let d = 0; d < 5; d++) {
        const device = { ...a, did: randomUUID(), proof: hex() };
        await rpc('pharmacy_enroll_device', [a.uid, device.did, device.proof, 'Budget device']);
        for (let i = 0; i < 20; i++) assert.equal(await reserve(device, randomUUID()), null);
      }
      assert.equal((await q('SELECT attempt_count FROM app_private.pharmacy_tenants WHERE id=$1', [a.tenant]))[0].attempt_count, 100);
      assert.equal(await reserve(), null);
      await db.exec("UPDATE app_private.pharmacy_tenants SET attempt_window=clock_timestamp()-interval '16 minutes'; UPDATE app_private.devices SET attempt_window=clock_timestamp()-interval '16 minutes';");
      assert.ok(await reserve());
    });
    await t.test('failed PIN consumes ticket and cannot be replayed as verified', async () => {
      await resetBudget();
      const attempt = await reserve(); const token = hex();
      assert.equal(await finish(attempt, token, a, a.operator, false), null);
      assert.equal(await finish(attempt, token), null);
      assert.equal(await validate(token), null);
      assert.equal((await q('SELECT failed_attempts FROM app_private.operators WHERE id=$1', [a.operator]))[0].failed_attempts, 1);
    });
    await t.test('successful ticket replay fails; expired and revoked sessions fail', async () => {
      await resetBudget();
      const attempt = await reserve(); const token = hex();
      const result = await finish(attempt, token); assert.ok(result);
      assert.ok(Date.parse(result.expires_at) > Date.now());
      assert.ok(Date.parse(result.expires_at) < Date.now() + 901000);
      assert.equal(await finish(attempt, hex()), null); assert.ok(await validate(token));
      assert.equal(await rpc('pharmacy_revoke_operator_session', [b.uid, a.did, a.proof, token]), false);
      assert.ok(await validate(token));
      assert.equal(await rpc('pharmacy_revoke_operator_session', [a.uid, a.did, a.proof, token]), true);
      assert.equal(await validate(token), null);
      const expired = await login();
      await q("UPDATE app_private.operator_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE token_hash=$1", [expired]);
      assert.equal(await validate(expired), null);
      const late = await reserve();
      await q("UPDATE app_private.pin_attempts SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1", [late.attempt_id]);
      assert.equal(await finish(late, hex()), null);
    });
    await t.test('credential reset invalidates both outstanding attempt and existing session', async () => {
      await resetBudget(); const token = await login(); const attempt = await reserve();
      await q('UPDATE app_private.operators SET pin_hash=$1 WHERE id=$2', [hex(), a.operator]);
      assert.equal(await finish(attempt, hex()), null); assert.equal(await validate(token), null);
      assert.ok(await validate(await login()));
    });
    await t.test('branch disable/re-enable cannot resurrect attempts or sessions', async () => {
      await resetBudget(); const token = await login(); const attempt = await reserve();
      await q('UPDATE app_private.branches SET enabled=false WHERE id=$1', [a.central]);
      assert.equal(await validate(token), null); assert.equal(await reserve(), null);
      await q('UPDATE app_private.branches SET enabled=true WHERE id=$1', [a.central]);
      assert.equal(await validate(token), null); assert.equal(await finish(attempt, hex()), null);
      assert.ok(await validate(await login()));
    });
    await t.test('device disable/re-enable and operator disable/re-enable remain revoked', async () => {
      await resetBudget(); const token = await login(); const attempt = await reserve();
      await q('UPDATE app_private.devices SET enabled=false WHERE id=$1', [a.did]);
      assert.equal(await validate(token), null);
      await q('UPDATE app_private.devices SET enabled=true WHERE id=$1', [a.did]);
      assert.equal(await validate(token), null); assert.equal(await finish(attempt, hex()), null);
      const adminToken = await login(a, admin);
      await q('UPDATE app_private.operators SET enabled=false WHERE id=$1', [admin]);
      assert.equal(await validate(adminToken), null);
      await q('UPDATE app_private.operators SET enabled=true WHERE id=$1', [admin]);
      assert.equal(await validate(adminToken), null);
    });
    await t.test('operator switch revokes prior device session; batched finishes serialize to one survivor', async () => {
      await resetBudget(); const first = await login(); const second = await login(a, admin);
      assert.equal(await validate(first), null); assert.ok(await validate(second));
      const ownerAttempt = await reserve(); const adminAttempt = await reserve(a, admin);
      const ownerToken = hex(); const adminToken = hex();
      await asRole('service_role', () => Promise.all([
        rawRpc('pharmacy_finish_pin_attempt', [a.uid, a.did, a.proof, a.operator, ownerAttempt.attempt_id, ownerAttempt.credential_version, true, ownerToken]),
        rawRpc('pharmacy_finish_pin_attempt', [a.uid, a.did, a.proof, admin, adminAttempt.attempt_id, adminAttempt.credential_version, true, adminToken]),
      ]));
      assert.equal([await validate(ownerToken), await validate(adminToken)].filter(Boolean).length, 1);
      assert.equal((await q('SELECT count(*)::int AS n FROM app_private.operator_sessions WHERE device_id=$1 AND revoked_at IS NULL AND expires_at>clock_timestamp()', [a.did]))[0].n, 1);
    });
    await t.test('protected owner cannot be demoted disabled or deleted', async () => {
      await assert.rejects(q("UPDATE app_private.operators SET role='ADMIN' WHERE id=$1", [a.operator]), /Owner must remain enabled/);
      await assert.rejects(q('UPDATE app_private.operators SET enabled=false WHERE id=$1', [a.operator]), /Owner must remain enabled/);
      await assert.rejects(q('DELETE FROM app_private.operators WHERE id=$1', [a.operator]), /Owner deletion requires/);
      await assert.rejects(q('UPDATE app_private.operators SET credential_version=1 WHERE id=$1', [a.operator]), /cannot decrease/);
    });
    await t.test('composite tenant foreign keys reject cross-tenant sessions', async () => {
      await assert.rejects(q(`INSERT INTO app_private.operator_sessions(token_hash,tenant_id,operator_id,device_id,
        branch_id,credential_version,device_version,branch_version,expires_at)
        VALUES ($1,$2,$3,$4,$5,1,1,1,clock_timestamp()+interval '1 minute')`,
      [hex(), a.tenant, b.operator, a.did, a.central]), /foreign key/);
    });
  } finally { await db.close(); }
});
