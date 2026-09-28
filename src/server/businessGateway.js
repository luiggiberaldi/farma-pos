import { createOperatorAccess, readOperatorConfig } from './operatorAccess.js';

// Server-side gateway for queued business operations. The browser never talks to
// PostgREST directly: it presents its account bearer, its session cookie and its
// device proof, and this module resolves them into the service RPC parameters.
// Upstream error text is never forwarded; only fixed, safe codes are returned.
export const OPERATION_KINDS = Object.freeze({
    SALE: 'pharmacy_commit_sale',
    VOID: 'pharmacy_commit_void',
    STOCK: 'pharmacy_commit_stock_movement',
});
// A raise from these messages is a business rejection the client must reconcile,
// not an outage. Everything else stays retryable.
const BUSINESS_REJECTIONS = Object.freeze({
    'Insufficient stock': 'INSUFFICIENT_STOCK',
    'No stock record for this branch': 'UNKNOWN_STOCK',
    'Unknown or disabled product': 'UNKNOWN_PRODUCT',
    'Duplicate product lines are not accepted': 'DUPLICATE_LINES',
    'Prescription evidence required': 'PRESCRIPTION_REQUIRED',
    'Operation id conflict': 'OPERATION_CONFLICT',
    'Sale already reversed': 'ALREADY_REVERSED',
    'Sale belongs to another branch': 'WRONG_BRANCH',
    'Unknown sale': 'UNKNOWN_SALE',
    'Stock cannot become negative': 'NEGATIVE_STOCK',
    'Invalid quantity': 'INVALID_QUANTITY',
});
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const OPERATION_ID = /^[A-Za-z0-9_-]{8,180}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function buildOperationArgs(kind, operation) {
    if (!Object.hasOwn(OPERATION_KINDS, kind)) return null;
    if (!operation || operation.kind !== kind) return null;
    if (!OPERATION_ID.test(operation.operationId || '') || !HASH.test(operation.payloadHash || '')) return null;
    if (kind === 'VOID') return UUID.test(operation.saleId || '') ? { p_sale_id: operation.saleId } : null;
    if (kind === 'STOCK') {
        if (!UUID.test(operation.productId || '')) return null;
        if (!Number.isFinite(operation.delta) || operation.delta === 0) return null;
        if (!['OPENING', 'ADJUSTMENT', 'TRANSFER_IN', 'TRANSFER_OUT'].includes(operation.reason)) return null;
        return { p_product_id: operation.productId, p_delta: operation.delta, p_reason: operation.reason };
    }
    if (!DATE.test(operation.businessDate || '') || !Number.isFinite(operation.rate) || operation.rate <= 0) return null;
    if (!Array.isArray(operation.items) || operation.items.length === 0 || operation.items.length > 200) return null;
    return { p_business_date: operation.businessDate, p_rate: operation.rate,
        p_items: JSON.stringify(operation.items),
        p_total_usd: operation.totalUsd, p_total_bs: operation.totalBs,
        p_prescription: operation.prescription ? JSON.stringify(operation.prescription) : null };
}

export function createBusinessGateway({ env = process.env, fetchImpl = globalThis.fetch, allowTestHttp = false } = {}) {
    const config = readOperatorConfig(env, { allowTestHttp });
    const access = createOperatorAccess({ env, fetchImpl, allowTestHttp });
    async function callRpc(name, args) {
        try {
            const response = await fetchImpl(`${config.url}/rest/v1/rpc/${name}`, {
                method: 'POST', headers: { apikey: config.serviceKey, Authorization: `Bearer ${config.serviceKey}`,
                    'Content-Type': 'application/json' }, body: JSON.stringify(args), cache: 'no-store',
                redirect: 'error', signal: AbortSignal.timeout(10000),
            });
            if (response.ok) return { ok: true, value: await response.json() };
            let message = '';
            try { message = String((await response.json())?.message || ''); } catch { /* Opaque upstream body. */ }
            return { ok: false, message };
        } catch { return { ok: false, message: '' }; }
    }
    return {
        async commit({ authorization, deviceCredential, token, operation }) {
            if (!config) return { status: 503, body: { error: 'UNAVAILABLE' } };
            const kind = operation?.kind;
            const args = buildOperationArgs(kind, operation);
            if (!args) return { status: 400, body: { error: 'INVALID_OPERATION' } };
            let scope;
            try { ({ scope } = await access.sessionScope({ authorization, deviceCredential, token })); }
            catch { return { status: 401, body: { error: 'OPERATOR_SESSION_REQUIRED' } }; }
            const result = await callRpc(OPERATION_KINDS[kind], { ...scope, p_operation_id: operation.operationId,
                p_payload_hash: operation.payloadHash, ...args });
            if (!result.ok) {
                const code = Object.entries(BUSINESS_REJECTIONS).find(([text]) => result.message.includes(text))?.[1];
                // A business rejection is permanent for this operation; anything
                // else is an outage the client should retry with the same id.
                return code ? { status: 409, body: { error: code } } : { status: 503, body: { error: 'UNAVAILABLE' } };
            }
            // A null result means the server refused the operation outright
            // (bad session, branch or shape) rather than committing it.
            if (result.value === null) return { status: 401, body: { error: 'OPERATION_NOT_AUTHORIZED' } };
            return { status: 200, body: { receipt: result.value } };
        },
    };
}
