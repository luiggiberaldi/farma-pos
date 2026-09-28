import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createOutboxSender, mapQueueEntryToOperation, OUTBOX_RESULT, OUTBOX_REJECTION, SUPPORTED_KINDS } from '../src/services/outboxSender.js';

const PRODUCT = '11111111-1111-4111-8111-111111111111';
const SECOND = '22222222-2222-4222-8222-222222222222';
const OPERATION = 'sale-outbox-0001';

function saleEntry(overrides = {}) {
    const sale = { id: OPERATION, operationId: OPERATION, fechaComercial: '2026-09-15', rate: 100,
        totalUsd: 20, totalBs: 2000, prescription: null,
        items: [{ id: PRODUCT, qty: 2, quantityBase: 2, priceUsd: 10 },
            { id: SECOND, qty: 0.125, quantityBase: 0.125, priceUsd: 0.125 }],
        ...overrides.sale };
    return { id: OPERATION, queue_id: OPERATION, operation_id: OPERATION, kind: 'SALE',
        sede_id: 'central', operator_id: 'operator-1', attempts: 0, sync_status: 'pending',
        payload: { schemaVersion: 3, operation_id: OPERATION, sale, ...overrides.payload }, ...overrides.entry };
}

function harness({ entries = [saleEntry()], responses = [], isEnabled = () => true, ...options } = {}) {
    const calls = [];
    const actions = [];
    let inFlight = 0;
    let peak = 0;
    const transport = async request => {
        calls.push(request);
        inFlight += 1; peak = Math.max(peak, inFlight);
        try {
            const next = responses.length > 1 ? responses.shift() : responses[0];
            if (typeof next === 'function') return await next(request, calls.length);
            if (next instanceof Error) throw next;
            return next ?? { status: 200, body: { receipt: { sale_id: randomUUID(), operation_id: request.operationId } } };
        } finally { inFlight -= 1; }
    };
    const queue = {
        list: async () => entries.filter(entry => entry.sync_status === 'pending'),
        confirm: async (id, receipt) => { actions.push({ type: 'confirm', id, receipt });
            const entry = entries.find(item => item.id === id); if (entry) entry.sync_status = 'confirmed'; },
        reject: async (id, reason) => { actions.push({ type: 'reject', id, reason });
            const entry = entries.find(item => item.id === id); if (entry) entry.sync_status = 'rejected'; },
        reschedule: async (id, nextAttemptAt, error) => { actions.push({ type: 'reschedule', id, nextAttemptAt, error });
            const entry = entries.find(item => item.id === id);
            if (entry) { entry.attempts = (entry.attempts || 0) + 1; entry.next_attempt_at = nextAttemptAt; entry.last_error = error; } },
    };
    const sender = createOutboxSender({ transport, queue, isEnabled, now: () => 1_000_000, ...options });
    return { sender, queue, entries, calls, actions, peak: () => peak };
}

test('a paused sender never calls the transport and never mutates the queue', async () => {
    const h = harness({ isEnabled: () => false });
    const result = await h.sender.sendPending();
    assert.equal(result.status, OUTBOX_RESULT.PAUSED);
    assert.equal(h.calls.length, 0); assert.equal(h.actions.length, 0);
    assert.equal(h.entries[0].sync_status, 'pending');
});

test('a confirmed receipt clears the entry and reuses the local operation id', async () => {
    const receipt = { sale_id: randomUUID(), operation_id: OPERATION, status: 'CONFIRMADA' };
    const h = harness({ responses: [{ status: 200, body: { receipt } }] });
    const result = await h.sender.sendPending();
    assert.equal(result.status, OUTBOX_RESULT.DONE);
    assert.equal(result.confirmed.length, 1);
    assert.deepEqual(result.confirmed[0].receipt, receipt);
    assert.equal(h.entries[0].sync_status, 'confirmed');
    const request = h.calls[0];
    assert.equal(request.kind, 'SALE'); assert.equal(request.operationId, OPERATION);
    assert.match(request.payloadHash, /^[0-9a-f]{64}$/);
    assert.equal(request.businessDate, '2026-09-15'); assert.equal(request.rate, 100);
    assert.deepEqual(request.items.map(item => item.product_id), [PRODUCT, SECOND]);
    assert.equal(request.items[1].unit_price_usd, 0.125, 'fractional unit price must not be rounded');
    assert.equal(request.items[1].line_total_usd, 0.02);
    assert.equal(request.totalUsd, 20);
});

test('a 200 without a receipt is ambiguous and never clears the entry', async () => {
    const h = harness({ responses: [{ status: 200, body: { ok: true } }] });
    const result = await h.sender.sendPending();
    assert.equal(result.confirmed.length, 0); assert.equal(result.retried.length, 1);
    assert.equal(result.retried[0].reason, 'missing-receipt');
    assert.equal(h.entries[0].sync_status, 'pending');
    assert.equal(h.entries[0].attempts, 1);
    assert.ok(h.entries[0].next_attempt_at > 1_000_000);
});

test('a transport failure reschedules and the retry reuses the same id and hash', async () => {
    const receipt = { sale_id: randomUUID(), operation_id: OPERATION };
    const h = harness({ responses: [new Error('synthetic network failure'), { status: 200, body: { receipt } }] });
    const first = await h.sender.sendPending();
    assert.equal(first.retried.length, 1); assert.equal(h.entries[0].sync_status, 'pending');
    assert.equal(h.entries[0].last_error, 'synthetic network failure');
    const second = await h.sender.sendPending();
    assert.equal(second.confirmed.length, 1);
    assert.equal(h.calls.length, 2);
    assert.equal(h.calls[0].operationId, h.calls[1].operationId);
    assert.equal(h.calls[0].payloadHash, h.calls[1].payloadHash, 'the retry must be the same request');
    assert.equal(h.entries[0].sync_status, 'confirmed');
});

test('server and rate-limit responses are retried, never treated as success', async () => {
    for (const status of [500, 502, 503, 429, 408, 0]) {
        const h = harness({ responses: [{ status, body: {} }] });
        const result = await h.sender.sendPending();
        assert.equal(result.confirmed.length, 0, `status ${status}`);
        assert.equal(result.retried.length, 1, `status ${status}`);
        assert.equal(h.entries[0].sync_status, 'pending', `status ${status}`);
    }
});

test('a permanent rejection surfaces for reconciliation instead of looping forever', async () => {
    for (const status of [400, 409, 413, 422]) {
        const h = harness({ responses: [{ status, body: { error: 'Insufficient stock' } }] });
        const result = await h.sender.sendPending();
        assert.equal(result.rejected.length, 1, `status ${status}`);
        assert.equal(result.rejected[0].reason, 'Insufficient stock');
        assert.equal(h.entries[0].sync_status, 'rejected');
        assert.equal(h.entries[0].attempts, 0, 'a permanent rejection must not consume attempts');
    }
});

test('an expired session stops the run without consuming attempts on any entry', async () => {
    const entries = [saleEntry(), { ...saleEntry(), id: 'sale-outbox-0002', queue_id: 'sale-outbox-0002', operation_id: 'sale-outbox-0002' }];
    const h = harness({ entries, responses: [{ status: 401, body: {} }] });
    const result = await h.sender.sendPending();
    assert.equal(result.status, OUTBOX_RESULT.SESSION_REQUIRED);
    assert.equal(result.stoppedEarly, true);
    assert.equal(h.calls.length, 1, 'the second entry must not be attempted');
    assert.equal(h.actions.length, 0);
    assert.deepEqual(entries.map(entry => entry.attempts), [0, 0]);
});

test('an entry that exhausts its attempts is flagged, not silently dropped', async () => {
    const h = harness({ entries: [{ ...saleEntry(), attempts: 8 }] });
    const result = await h.sender.sendPending();
    assert.equal(result.rejected[0].reason, OUTBOX_REJECTION.MAX_ATTEMPTS);
    assert.equal(h.calls.length, 0);
    assert.equal(h.entries[0].sync_status, 'rejected');
});

test('unsupported work stays queued while unmappable work is flagged', async () => {
    const unsupported = { ...saleEntry(), id: 'close-1', queue_id: 'close-1', operation_id: 'close-1', kind: 'CLOSE_CASH' };
    const h = harness({ entries: [unsupported] });
    const result = await h.sender.sendPending();
    assert.deepEqual(result.unsupported, [{ id: 'close-1', kind: 'CLOSE_CASH' }]);
    assert.equal(h.entries[0].sync_status, 'pending', 'unsupported work must not be cleared');
    assert.equal(h.calls.length, 0);
});

test('unmappable sales are rejected with a reason and never sent', async () => {
    const cases = {
        'missing sale': { payload: { sale: undefined } },
        'bad operation id': { entry: { operation_id: 'short' } },
        'bad date': { sale: { fechaComercial: '15-09-2026' } },
        'zero rate': { sale: { rate: 0 } },
        'no items': { sale: { items: [] } },
        'non-uuid product': { sale: { items: [{ id: 'product-1', qty: 1, quantityBase: 1, priceUsd: 5 }] } },
        'negative quantity': { sale: { items: [{ id: PRODUCT, qty: -1, quantityBase: -1, priceUsd: 5 }] } },
        'excess decimals': { sale: { items: [{ id: PRODUCT, qty: 1.0005, quantityBase: 1.0005, priceUsd: 5 }] } },
        'negative price': { sale: { items: [{ id: PRODUCT, qty: 1, quantityBase: 1, priceUsd: -1 }] } },
        'negative total': { sale: { totalUsd: -1 } },
    };
    for (const [label, overrides] of Object.entries(cases)) {
        const entry = saleEntry(overrides);
        const h = harness({ entries: [entry] });
        const result = await h.sender.sendPending();
        assert.equal(h.calls.length, 0, label);
        assert.equal(result.rejected.length, 1, label);
        assert.equal(result.rejected[0].reason, OUTBOX_REJECTION.UNMAPPABLE, label);
    }
});

test('only one request is ever in flight and order is preserved', async () => {
    const entries = ['a', 'b', 'c'].map((suffix, index) => {
        const id = `sale-outbox-100${index}`;
        return { ...saleEntry(), id, queue_id: id, operation_id: id };
    });
    const h = harness({ entries, responses: [{ status: 200, body: { receipt: { sale_id: randomUUID() } } }] });
    const result = await h.sender.sendPending();
    assert.equal(result.confirmed.length, 3);
    assert.equal(h.peak(), 1, 'the sender must be sequential');
    assert.deepEqual(h.calls.map(call => call.operationId), entries.map(entry => entry.operation_id));
});

test('the void mapping references the sale and the same entry is never sent twice', async () => {
    const saleId = randomUUID();
    const entry = { ...saleEntry(), kind: 'VOID', id: 'void-00000001', queue_id: 'void-00000001',
        operation_id: 'void-00000001', payload: { sale: { id: saleId } } };
    const h = harness({ entries: [entry], responses: [{ status: 200, body: { receipt: { sale_id: saleId, status: 'ANULADA' } } }] });
    const result = await h.sender.sendPending();
    assert.equal(result.confirmed.length, 1);
    assert.equal(h.calls[0].kind, 'VOID'); assert.equal(h.calls[0].saleId, saleId);
    const again = await h.sender.sendPending();
    assert.equal(again.confirmed.length, 0, 'a confirmed entry is no longer listed');
    assert.equal(h.calls.length, 1);
});

test('the default digest is a real SHA-256 and supported kinds stay explicit', async () => {
    const h = harness({ responses: [{ status: 200, body: { receipt: { sale_id: randomUUID() } } }] });
    await h.sender.sendPending();
    assert.match(h.calls[0].payloadHash, /^[0-9a-f]{64}$/);
    assert.equal(h.calls[0].payloadHash, await (async () => {
        const bytes = new TextEncoder().encode(JSON.stringify(h.calls[0].raw));
        return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(b => b.toString(16).padStart(2, '0')).join('');
    })());
    assert.deepEqual([...SUPPORTED_KINDS], ['SALE', 'VOID']);
});

test('a sale that is only queued is never reported as sent', async () => {
    const h = harness({ responses: [{ status: 503, body: {} }, { status: 503, body: {} }, { status: 503, body: {} }] });
    for (let round = 0; round < 3; round += 1) {
        const result = await h.sender.sendPending();
        assert.equal(result.confirmed.length, 0);
        assert.equal(result.status, OUTBOX_RESULT.DONE);
    }
    assert.equal(h.entries[0].sync_status, 'pending');
    assert.equal(h.entries[0].attempts, 3);
    assert.equal(h.actions.filter(action => action.type === 'confirm').length, 0);
});

test('the mapping is pure: it never mutates the queued entry', async () => {
    const entry = saleEntry();
    const before = JSON.stringify(entry);
    mapQueueEntryToOperation(entry);
    assert.equal(JSON.stringify(entry), before);
});
