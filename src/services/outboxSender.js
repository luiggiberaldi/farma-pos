import { REMOTE_OPERATIONS_PAUSED } from '../config/operationSafety.js';
import { round2, round4 } from '../utils/dinero.js';

// Sends locally confirmed operations to the server one at a time. An entry is
// only cleared after a stored receipt comes back, so an interrupted or
// ambiguous response can never lose or duplicate a sale: the retry reuses the
// same operation id, and the server answers with its own receipt.
export const OUTBOX_RESULT = Object.freeze({
    PAUSED: 'paused', DONE: 'done', SESSION_REQUIRED: 'session-required', UNAVAILABLE: 'unavailable',
});
export const OUTBOX_REJECTION = Object.freeze({
    MAX_ATTEMPTS: 'max-attempts', UNMAPPABLE: 'unmappable', UNSUPPORTED: 'unsupported', REJECTED: 'rejected',
});
// Only operations the server contract already implements are sent. Anything
// else stays queued and visible instead of being dropped silently.
export const SUPPORTED_KINDS = Object.freeze(['SALE', 'VOID']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OPERATION_ID = /^[A-Za-z0-9_-]{8,180}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function defaultDigest(value) {
    const bytes = new TextEncoder().encode(JSON.stringify(value));
    const hash = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const quantity = value => finite(value) && value > 0 && value === Math.round(value * 1000) / 1000;

// The client never decides money: it only reports the confirmed local lines.
// Anything it cannot express exactly is left for reconciliation.
export function mapQueueEntryToOperation(entry) {
    const kind = entry?.kind;
    if (!SUPPORTED_KINDS.includes(kind)) return { error: OUTBOX_REJECTION.UNSUPPORTED };
    if (!OPERATION_ID.test(entry.operation_id || '')) return { error: OUTBOX_REJECTION.UNMAPPABLE };
    const sale = entry.payload?.sale;
    if (!sale) return { error: OUTBOX_REJECTION.UNMAPPABLE };
    if (kind === 'VOID') {
        if (!UUID.test(entry.payload?.relatedSaleId || sale.id || '')) return { error: OUTBOX_REJECTION.UNMAPPABLE };
        return { kind: 'VOID', operationId: entry.operation_id, saleId: entry.payload.relatedSaleId || sale.id, raw: { operationId: entry.operation_id, kind, saleId: entry.payload.relatedSaleId || sale.id } };
    }
    if (!DATE.test(sale.fechaComercial || '') || !finite(sale.rate) || sale.rate <= 0) return { error: OUTBOX_REJECTION.UNMAPPABLE };
    if (!finite(sale.totalUsd) || sale.totalUsd < 0 || !finite(sale.totalBs) || sale.totalBs < 0) return { error: OUTBOX_REJECTION.UNMAPPABLE };
    if (!Array.isArray(sale.items) || sale.items.length === 0) return { error: OUTBOX_REJECTION.UNMAPPABLE };
    const items = [];
    for (const item of sale.items) {
        const id = item?.id;
        const quantityBase = Number(item?.quantityBase);
        const unitPrice = Number(item?.priceUsd);
        if (!UUID.test(id || '') || !quantity(quantityBase) || !finite(unitPrice) || unitPrice < 0) return { error: OUTBOX_REJECTION.UNMAPPABLE };
        items.push({ product_id: id, quantity_base: quantityBase, unit_price_usd: round4(unitPrice), line_total_usd: round2(unitPrice * quantityBase) });
    }
    const prescription = sale.prescription
        ? { reference: String(sale.prescription.reference || ''), prescriber: String(sale.prescription.prescriber || '') } : null;
    const raw = { kind: 'SALE', operationId: entry.operation_id, businessDate: sale.fechaComercial, rate: sale.rate,
        items, totalUsd: round2(sale.totalUsd), totalBs: round2(sale.totalBs), prescription };
    return { ...raw, raw };
}

function classify(status) {
    if (status === 200) return 'confirmed';
    if (status === 401 || status === 403) return 'session';
    if (status === 400 || status === 409 || status === 413 || status === 422) return 'permanent';
    return 'retryable';
}

export function createOutboxSender({
    transport,
    queue,
    isEnabled = () => !REMOTE_OPERATIONS_PAUSED,
    digest = defaultDigest,
    now = () => Date.now(),
    maxAttempts = 8,
    backoffMs = attempt => Math.min(30 * 60_000, 5_000 * 2 ** Math.max(0, attempt)),
    mapOperation = mapQueueEntryToOperation,
} = {}) {
    return {
        async sendPending() {
            const summary = { status: OUTBOX_RESULT.DONE, confirmed: [], rejected: [], retried: [], unsupported: [], stoppedEarly: false };
            if (!isEnabled()) return { ...summary, status: OUTBOX_RESULT.PAUSED };
            const entries = await queue.list();
            for (const entry of entries) {
                const attempts = Number(entry.attempts) || 0;
                if (attempts >= maxAttempts) {
                    await queue.reject(entry.id, OUTBOX_REJECTION.MAX_ATTEMPTS);
                    summary.rejected.push({ id: entry.id, reason: OUTBOX_REJECTION.MAX_ATTEMPTS });
                    continue;
                }
                const mapped = mapOperation(entry);
                if (mapped.error) {
                    // Unsupported work stays queued for a later phase; only truly
                    // unmappable work is flagged for a human.
                    if (mapped.error === OUTBOX_REJECTION.UNSUPPORTED) summary.unsupported.push({ id: entry.id, kind: entry.kind });
                    else {
                        await queue.reject(entry.id, mapped.error);
                        summary.rejected.push({ id: entry.id, reason: mapped.error });
                    }
                    continue;
                }
                const payloadHash = await digest(mapped.raw);
                let response;
                try {
                    response = await transport({ ...mapped, payloadHash });
                } catch (error) {
                    await queue.reschedule(entry.id, now() + backoffMs(attempts), error?.message || 'network');
                    summary.retried.push({ id: entry.id, reason: 'network' });
                    continue;
                }
                const verdict = classify(response?.status);
                if (verdict === 'confirmed' && response?.body?.receipt) {
                    await queue.confirm(entry.id, response.body.receipt);
                    summary.confirmed.push({ id: entry.id, receipt: response.body.receipt });
                } else if (verdict === 'confirmed') {
                    // A 200 without a receipt is not proof: treat it as ambiguous.
                    await queue.reschedule(entry.id, now() + backoffMs(attempts), 'missing receipt');
                    summary.retried.push({ id: entry.id, reason: 'missing-receipt' });
                } else if (verdict === 'session') {
                    // An expired or revoked session must not burn attempts.
                    summary.status = OUTBOX_RESULT.SESSION_REQUIRED;
                    summary.stoppedEarly = true;
                    break;
                } else if (verdict === 'permanent') {
                    await queue.reject(entry.id, response?.body?.error || OUTBOX_REJECTION.REJECTED);
                    summary.rejected.push({ id: entry.id, reason: response?.body?.error || OUTBOX_REJECTION.REJECTED });
                } else {
                    await queue.reschedule(entry.id, now() + backoffMs(attempts), `http-${response?.status ?? 'unknown'}`);
                    summary.retried.push({ id: entry.id, reason: `http-${response?.status ?? 'unknown'}` });
                }
            }
            return summary;
        },
    };
}
