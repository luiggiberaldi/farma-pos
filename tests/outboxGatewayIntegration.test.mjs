import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes } from 'node:crypto';
import { createBusinessOperationHandler } from '../api/business-operation.js';
import { createOutboxSender, OUTBOX_RESULT } from '../src/services/outboxSender.js';
import { sha256, OPERATOR_COOKIE } from '../src/server/operatorAccess.js';

// The two halves of phase 4 joined together: the real client sender talks to the
// real HTTP handler, which talks to a synthetic PostgREST that implements the
// idempotency contract of the business migration. No network is involved.
const ENV = Object.freeze({ SUPABASE_URL: 'https://supabase.e2e.invalid', APP_ORIGIN: 'https://app.e2e.invalid',
  SUPABASE_ANON_KEY: 'synthetic-anon-key', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service-key' });
const AUTHORIZATION = 'Bearer synthetic-account-token';
const UID = '10000000-0000-4000-8000-000000000001';
const OPERATOR = '30000000-0000-4000-8000-000000000001';
const BRANCH = '40000000-0000-4000-8000-000000000001';
const DEVICE = '50000000-0000-4000-8000-000000000001';
const PRODUCT = '11111111-1111-4111-8111-111111111111';
const PROOF = randomBytes(32).toString('base64url');
const TOKEN = randomBytes(32).toString('base64url');
const OPERATION = 'sale-e2e-000001';
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

function server({ stock = 10, loseFirstResponse = false, rejectWith = null } = {}) {
    const receipts = new Map();
    const movements = [];
    const state = { stock, commitCalls: 0, lostResponses: 0, loseNext: loseFirstResponse };
    const fetchImpl = async (url, init) => {
        if (url.endsWith('/auth/v1/user')) return response({ id: UID, is_anonymous: false, role: 'authenticated' });
        const name = url.split('/').at(-1);
        const args = JSON.parse(init.body);
        if (name === 'pharmacy_validate_operator_session') {
            return response({ operator_id: OPERATOR, tenant_id: '20000000-0000-4000-8000-000000000001',
                branch_id: BRANCH, role: 'CAJERO', name: 'Cajera', expires_at: new Date(Date.now() + 900000).toISOString() });
        }
        assert.equal(name, 'pharmacy_commit_sale');
        state.commitCalls += 1;
        if (rejectWith) return response({ message: rejectWith }, 400);
        const existing = receipts.get(args.p_operation_id);
        if (existing) {
            if (existing.hash !== args.p_payload_hash) return response({ message: 'Operation id conflict' }, 400);
            return response({ ...existing.receipt, duplicate: true });
        }
        const items = JSON.parse(args.p_items);
        const required = items.reduce((sum, item) => sum + item.quantity_base, 0);
        if (required > state.stock) return response({ message: 'Insufficient stock' }, 400);
        // The commit is applied exactly once, before the response is produced.
        state.stock -= required;
        movements.push({ operationId: args.p_operation_id, delta: -required });
        const receipt = { sale_id: randomUUID(), operation_id: args.p_operation_id, status: 'CONFIRMADA', lines: items.length };
        receipts.set(args.p_operation_id, { hash: args.p_payload_hash, receipt });
        if (state.loseNext) {
            // Simulates a committed sale whose response never reached the client.
            state.loseNext = false; state.lostResponses += 1;
            return response({ message: 'gateway timeout' }, 504);
        }
        return response(receipt);
    };
    return { fetchImpl, receipts, movements, state };
}

function client({ handler, entries }) {
    const actions = [];
    const transport = async request => {
        const req = { method: 'POST', headers: { origin: ENV.APP_ORIGIN, 'content-type': 'application/json',
            authorization: AUTHORIZATION, 'x-pharmacy-device': `${DEVICE}.${PROOF}`, cookie: `${OPERATOR_COOKIE}=${TOKEN}` },
            body: { kind: request.kind, operationId: request.operationId, payloadHash: request.payloadHash,
                businessDate: request.businessDate, rate: request.rate, items: request.items,
                totalUsd: request.totalUsd, totalBs: request.totalBs, prescription: request.prescription,
                saleId: request.saleId } };
        let status = 503, body = {};
        const res = { setHeader() {}, status(code) { status = code; return this; }, json(value) { body = value; return this; } };
        await handler(req, res);
        return { status, body };
    };
    const queue = {
        list: async () => entries.filter(entry => entry.sync_status === 'pending'),
        confirm: async (id, receipt) => { actions.push({ type: 'confirm', id });
            const entry = entries.find(item => item.id === id); if (entry) entry.sync_status = 'confirmed'; },
        reject: async (id, reason) => { actions.push({ type: 'reject', id, reason });
            const entry = entries.find(item => item.id === id); if (entry) entry.sync_status = 'rejected'; },
        reschedule: async (id, nextAttemptAt, error) => { actions.push({ type: 'reschedule', id, error });
            const entry = entries.find(item => item.id === id);
            if (entry) { entry.attempts = (entry.attempts || 0) + 1; entry.next_attempt_at = nextAttemptAt; } },
    };
    return { transport, queue, actions };
}

const saleEntry = (quantity = 2) => {
    const sale = { id: OPERATION, operationId: OPERATION, fechaComercial: '2026-09-15', rate: 100,
        totalUsd: 20, totalBs: 2000, prescription: null,
        items: [{ id: PRODUCT, qty: quantity, quantityBase: quantity, priceUsd: 10 }] };
    return { id: OPERATION, queue_id: OPERATION, operation_id: OPERATION, kind: 'SALE', attempts: 0,
        sync_status: 'pending', payload: { sale } };
};

test('a queued sale reaches the server exactly once and is cleared only with a receipt', async () => {
    const s = server({ stock: 10 });
    const handler = createBusinessOperationHandler({ env: ENV, fetchImpl: s.fetchImpl });
    const entries = [saleEntry(2)];
    const c = client({ handler, entries });
    const sender = createOutboxSender({ transport: c.transport, queue: c.queue, isEnabled: () => true, now: () => 0 });

    const result = await sender.sendPending();
    assert.equal(result.confirmed.length, 1);
    assert.equal(entries[0].sync_status, 'confirmed');
    assert.equal(s.state.stock, 8);
    assert.equal(s.movements.length, 1);
    assert.equal(s.state.commitCalls, 1);
    assert.deepEqual(c.actions, [{ type: 'confirm', id: OPERATION }]);
});

test('a lost response is retried with the same id and never decrements stock twice', async () => {
    const s = server({ stock: 10, loseFirstResponse: true });
    const handler = createBusinessOperationHandler({ env: ENV, fetchImpl: s.fetchImpl });
    const entries = [saleEntry(3)];
    const c = client({ handler, entries });
    const sender = createOutboxSender({ transport: c.transport, queue: c.queue, isEnabled: () => true, now: () => 0 });

    const first = await sender.sendPending();
    assert.equal(first.confirmed.length, 0);
    assert.equal(first.retried.length, 1, 'a lost response must stay pending');
    assert.equal(entries[0].sync_status, 'pending');
    assert.equal(s.state.stock, 7, 'the server did commit on the first attempt');
    assert.equal(s.state.lostResponses, 1);

    const second = await sender.sendPending();
    assert.equal(second.confirmed.length, 1);
    assert.equal(second.confirmed[0].receipt.duplicate, true, 'the server recognises the replay');
    assert.equal(s.state.stock, 7, 'the replay must not decrement stock again');
    assert.equal(s.movements.length, 1);
    assert.equal(entries[0].sync_status, 'confirmed');
    assert.equal(s.state.commitCalls, 2);
});

test('a real business rejection surfaces to the operator instead of retrying forever', async () => {
    const s = server({ stock: 10, rejectWith: 'Insufficient stock' });
    const handler = createBusinessOperationHandler({ env: ENV, fetchImpl: s.fetchImpl });
    const entries = [saleEntry(50)];
    const c = client({ handler, entries });
    const sender = createOutboxSender({ transport: c.transport, queue: c.queue, isEnabled: () => true, now: () => 0 });

    const result = await sender.sendPending();
    assert.equal(result.rejected.length, 1);
    assert.equal(result.rejected[0].reason, 'INSUFFICIENT_STOCK');
    assert.equal(entries[0].sync_status, 'rejected');
    assert.equal(entries[0].attempts, 0);
    assert.equal(s.state.stock, 10, 'a rejected sale must not touch stock');
    assert.equal(s.movements.length, 0);

    const again = await sender.sendPending();
    assert.equal(again.confirmed.length, 0);
    assert.equal(s.state.commitCalls, 1, 'a rejected entry is not sent again');
});

test('an expired session pauses the whole run so no sale is burned', async () => {
    const s = server({ stock: 10 });
    const handler = createBusinessOperationHandler({ env: ENV, fetchImpl: async (url, init) => {
        if (url.endsWith('/auth/v1/user')) return response({ id: UID, is_anonymous: false, role: 'authenticated' });
        if (url.endsWith('pharmacy_validate_operator_session')) return response(null);
        return s.fetchImpl(url, init);
    } });
    const entries = [saleEntry(1), { ...saleEntry(1), id: 'sale-e2e-000002', queue_id: 'sale-e2e-000002', operation_id: 'sale-e2e-000002' }];
    const c = client({ handler, entries });
    const sender = createOutboxSender({ transport: c.transport, queue: c.queue, isEnabled: () => true, now: () => 0 });

    const result = await sender.sendPending();
    assert.equal(result.status, OUTBOX_RESULT.SESSION_REQUIRED);
    assert.equal(result.stoppedEarly, true);
    assert.equal(s.state.commitCalls, 0);
    assert.deepEqual(entries.map(entry => entry.sync_status), ['pending', 'pending']);
    assert.deepEqual(entries.map(entry => entry.attempts), [0, 0]);
});

test('the whole flow stays paused while the production flag is set', async () => {
    const s = server({ stock: 10 });
    const handler = createBusinessOperationHandler({ env: ENV, fetchImpl: s.fetchImpl });
    const entries = [saleEntry(1)];
    const c = client({ handler, entries });
    const sender = createOutboxSender({ transport: c.transport, queue: c.queue, now: () => 0 });
    const result = await sender.sendPending();
    assert.equal(result.status, OUTBOX_RESULT.PAUSED);
    assert.equal(s.state.commitCalls, 0);
    assert.equal(entries[0].sync_status, 'pending');
    assert.deepEqual(c.actions, []);
});

test('the session cookie is hashed for the RPC and never travels as a raw value', async () => {
    const seen = [];
    const s = server({ stock: 10 });
    const handler = createBusinessOperationHandler({ env: ENV, fetchImpl: async (url, init) => {
        seen.push({ url, body: init.body });
        return s.fetchImpl(url, init);
    } });
    const entries = [saleEntry(1)];
    const c = client({ handler, entries });
    await createOutboxSender({ transport: c.transport, queue: c.queue, isEnabled: () => true, now: () => 0 }).sendPending();
    const commit = seen.find(call => call.url.endsWith('pharmacy_commit_sale'));
    const args = JSON.parse(commit.body);
    assert.equal(args.p_token_hash, await sha256(TOKEN));
    assert.ok(!commit.body.includes(TOKEN), 'the raw session token must never reach PostgREST');
    assert.ok(!commit.body.includes(PROOF), 'the raw device proof must never reach PostgREST');
    assert.equal(args.p_device_proof_hash, await sha256(PROOF));
});
