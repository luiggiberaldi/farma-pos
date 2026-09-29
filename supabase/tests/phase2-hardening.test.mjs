// Contratos de endurecimiento Fase 2 (2026-09-28) — PGlite, sin red.
// Cubre: C4 (totales/tasa recalculados en servidor), A1 (roles en void/ajustes),
// M7 (upsert en producto deshabilitado), M2 (impuesto por tenant), C2 (backups
// por device_id), M11 (updated_at), RLS en tenant_rates.
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
  ({ PGlite } = require(join(homedir(), '.workbuddy-ai', 'binaries', 'node', 'workspace', 'node_modules', '@electric-sql', 'pglite')));
}

const mig = name => readFile(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const setup = `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY, is_anonymous boolean NOT NULL DEFAULT false);`;
const hex = () => randomBytes(32).toString('hex');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const today = new Date().toISOString().slice(0, 10);
const PRODUCT = randomUUID();

test('phase2 hardening: server totals, roles, tax, backups (PGlite)', async t => {
  const db = new PGlite();
  await db.exec(setup);
  for (const f of ['202609140001_pharmacy_core.sql', '202609140002_operator_access.sql',
    '202609150001_business_operations.sql', '202609280001_device_backups_hardening.sql',
    '202609280002_sale_server_totals.sql', '202609280003_void_stock_roles.sql',
    '202609280004_model_hardening.sql', '202609280005_tenant_tax.sql',
    '202609280006_rate_broadcast.sql']) {
    await db.exec(await mig(f));
  }
  const q = async (sql, args = []) => (await db.query(sql, args)).rows;
  const rpc = async (name, args) => {
    const params = args.map((_, i) => `$${i + 1}`).join(',');
    return (await q(`SELECT public.${name}(${params}) AS value`, args))[0].value;
  };
  const rpcThrows = async (name, args, match) => {
    await assert.rejects(() => rpc(name, args), err => {
      assert.match(String(err?.message || err), match);
      return true;
    });
  };

  const uid = randomUUID();
  await q('INSERT INTO auth.users(id) VALUES ($1)', [uid]);
  const owner = await rpc('pharmacy_bootstrap_owner', [uid, 'Ops', 'Owner', 'owner-ops', hex(), hex(), 210000]);
  const branches = await q('SELECT id, code FROM app_private.branches WHERE tenant_id=$1', [owner.tenant_id]);
  const central = branches.find(b => b.code === 'central').id;
  const ownerDevice = { id: randomUUID(), proof: hex() };
  const cashierDevice = { id: randomUUID(), proof: hex() };
  await rpc('pharmacy_enroll_device', [uid, ownerDevice.id, ownerDevice.proof, 'Mostrador']);
  await rpc('pharmacy_enroll_device', [uid, cashierDevice.id, cashierDevice.proof, 'Caja']);
  const cashier = randomUUID();
  await q(`INSERT INTO app_private.operators(id,tenant_id,local_code,name,role,branch_id,pin_salt,pin_hash,pin_iterations)
    VALUES ($1,$2,'cashier','Cashier','CAJERO',$3,$4,$5,210000)`, [cashier, owner.tenant_id, central, hex(), hex()]);
  const login = async (device, operator, branch) => {
    const attempt = await rpc('pharmacy_reserve_pin_attempt', [uid, device.id, device.proof, operator, branch]);
    const token = hex();
    assert.ok(await rpc('pharmacy_finish_pin_attempt',
      [uid, device.id, device.proof, operator, attempt.attempt_id, attempt.credential_version, true, token]));
    return token;
  };
  const ownerToken = await login(ownerDevice, owner.operator_id, central);
  const cashierToken = await login(cashierDevice, cashier, central);
  const ocreds = [uid, ownerDevice.id, ownerDevice.proof, ownerToken];
  const ccreds = [uid, cashierDevice.id, cashierDevice.proof, cashierToken];

  // Catálogo + stock inicial (owner).
  await rpc('pharmacy_upsert_catalogue_item', [...ocreds, PRODUCT, 'Aspirina', 10, false, false]);
  await rpc('pharmacy_commit_stock_movement', [...ocreds, 'op-stock-001', hash('s1'), PRODUCT, 100, 'OPENING']);

  const saleArgs = (creds, opId, items, totalUsd, totalBs, rate = 100) =>
    [...creds, opId, hash({ opId, items, totalUsd }), today, rate, JSON.stringify(items), totalUsd, totalBs, null];
  const items2 = [{ product_id: PRODUCT, quantity_base: 2, unit_price_usd: 10, line_total_usd: 20 }];

  // 1. C4: venta válida con totales del servidor.
  const r1 = await rpc('pharmacy_commit_sale', saleArgs(ocreds, 'op-sale-001', items2, 20, 2000));
  assert.ok(r1 && r1.sale_id, 'venta válida debe comprometerse');
  const row1 = (await q('SELECT total_usd, total_bs, tax_usd FROM app_private.sales WHERE operation_id=$1', ['op-sale-001']))[0];
  assert.equal(Number(row1.total_usd), 20);
  assert.equal(Number(row1.tax_usd), 0);

  // 2. C4: total manipulado por el cliente → rechazo permanente.
  await rpcThrows('pharmacy_commit_sale', saleArgs(ccreds, 'op-sale-002', items2, 15, 1500), /Sale total mismatch/);

  // 3. C4: línea manipulada (precio del cliente ignorado) → rechazo.
  const badItems = [{ product_id: PRODUCT, quantity_base: 2, unit_price_usd: 10, line_total_usd: 15 }];
  await rpcThrows('pharmacy_commit_sale', saleArgs(ccreds, 'op-sale-003', badItems, 10, 1000), /Line total mismatch/);

  // 4. C4: banda de tasa ±5% contra tasa observada.
  await rpc('pharmacy_record_rate', [owner.tenant_id, 100, 'bcv']);
  await rpcThrows('pharmacy_commit_sale', saleArgs(ccreds, 'op-sale-004', items2, 20, 2400, 120), /out of band/);
  const r4b = await rpc('pharmacy_commit_sale', saleArgs(ccreds, 'op-sale-005', items2, 20, 2060, 103));
  assert.ok(r4b && r4b.sale_id, 'tasa dentro de banda debe aceptarse');

  // 5. A1: cajero no puede anular ni ajustar.
  await rpcThrows('pharmacy_commit_void', [...ccreds, 'op-void-001', hash('v1'), r1.sale_id], /OPERATION_NOT_AUTHORIZED/);
  await rpcThrows('pharmacy_commit_stock_movement', [...ccreds, 'op-adj-001', hash('a1'), PRODUCT, 50, 'ADJUSTMENT'], /OPERATION_NOT_AUTHORIZED/);
  // El dueño sí puede anular.
  const v = await rpc('pharmacy_commit_void', [...ocreds, 'op-void-002', hash('v2'), r1.sale_id]);
  assert.ok(v, 'el dueño debe poder anular');
  // Movimiento normal (RECEIPT) sí lo puede hacer el cajero.
  const m = await rpc('pharmacy_commit_stock_movement', [...ccreds, 'op-rcpt-001', hash('r1'), PRODUCT, 10, 'TRANSFER_IN']);
  assert.ok(m, 'el cajero puede registrar entradas');

  // 6. M7: upsert sobre producto deshabilitado → error ruidoso.
  await q('UPDATE app_private.catalogue_items SET enabled=false WHERE product_id=$1', [PRODUCT]);
  await rpcThrows('pharmacy_upsert_catalogue_item', [...ocreds, PRODUCT, 'Aspirina X', 12, false, false], /disabled/);
  await q('UPDATE app_private.catalogue_items SET enabled=true WHERE product_id=$1', [PRODUCT]);

  // 7. M2: impuesto por tenant calculado en servidor.
  await q('UPDATE app_private.pharmacy_tenants SET tax_rate=0.16 WHERE id=$1', [owner.tenant_id]);
  // neto 20 + 16% = 23.20 USD / 2320 Bs @100
  const r7 = await rpc('pharmacy_commit_sale', saleArgs(ccreds, 'op-sale-007', items2, 23.20, 2320));
  assert.ok(r7 && r7.sale_id);
  const row7 = (await q('SELECT total_usd, tax_usd FROM app_private.sales WHERE operation_id=$1', ['op-sale-007']))[0];
  assert.equal(Number(row7.tax_usd), 3.20);
  assert.equal(Number(row7.total_usd), 23.20);
  // Cliente que no incluye el impuesto → rechazo fail-closed.
  await rpcThrows('pharmacy_commit_sale', saleArgs(ccreds, 'op-sale-008', items2, 20, 2000), /Sale total mismatch/);
  await q('UPDATE app_private.pharmacy_tenants SET tax_rate=0 WHERE id=$1', [owner.tenant_id]);

  // 8. C2: backups aislados por device_id.
  await rpc('device_backup_save', ['dev-1', JSON.stringify({ a: 1 })]);
  const loaded = await rpc('device_backup_load', ['dev-1']);
  assert.equal(loaded.backup_data.a, 1);
  const other = await rpc('device_backup_load', ['dev-2']);
  assert.equal(other, null, 'otro device_id no debe leer el backup');
  await rpc('device_backup_delete', ['dev-1']);
  assert.equal(await rpc('device_backup_load', ['dev-1']), null);

  // 9. M11 + RLS: updated_at y RLS en tenant_rates.
  const cat = (await q('SELECT updated_at FROM app_private.catalogue_items WHERE product_id=$1', [PRODUCT]))[0];
  assert.ok(cat.updated_at, 'catalogue_items debe tener updated_at');
  const rls = (await q(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='app_private' AND c.relname='tenant_rates' AND c.relrowsecurity`))[0];
  assert.ok(rls, 'tenant_rates debe tener RLS habilitado');

  // 10. Idempotencia: reintento con el mismo operation_id devuelve el recibo.
  const r10 = await rpc('pharmacy_commit_sale', saleArgs(ocreds, 'op-sale-001', items2, 20, 2000));
  assert.equal(r10.sale_id, r1.sale_id, 'reintento debe devolver el recibo original');

  // 11. M6: pharmacy_record_rate_all difunde la tasa a todos los tenants.
  const before = (await q('SELECT count(*)::int AS n FROM app_private.tenant_rates'))[0].n;
  const n = await rpc('pharmacy_record_rate_all', [150.5, 'bcv']);
  assert.ok(n >= 1, 'debe registrar al menos un tenant');
  const after = (await q('SELECT count(*)::int AS n FROM app_private.tenant_rates'))[0].n;
  assert.equal(after - before, n);
  const last = (await q('SELECT rate FROM app_private.tenant_rates ORDER BY observed_at DESC LIMIT 1'))[0];
  assert.equal(Number(last.rate), 150.5);
  await assert.rejects(() => rpc('pharmacy_record_rate_all', [-5, 'bcv']), /inválido/);
});
