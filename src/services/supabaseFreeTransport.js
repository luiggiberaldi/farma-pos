import { REMOTE_OPERATIONS_PAUSED, CLOUD_PAUSE_MESSAGE } from '../config/operationSafety.js';
import { SUPABASE_FREE_PROFILE } from '../config/supabaseFreeTier.js';
import { recordSyncMetric } from '../utils/syncMetrics.js';

function serviceKey(pathname) {
    if (pathname.startsWith('/auth/v1/')) return 'sdk_auth';
    if (pathname.startsWith('/rest/v1/')) return 'sdk_rest';
    if (pathname.startsWith('/storage/v1/')) return 'sdk_storage';
    if (pathname.startsWith('/functions/v1/')) return 'sdk_functions';
    return 'sdk_other';
}

function rejected(status, code, message) {
    return new Response(JSON.stringify({ code, message }), { status, headers: { 'Content-Type': 'application/json' } });
}

async function boundedStreamSize(stream, maximum) {
    if (!stream) return 0;
    const reader = stream.getReader();
    let bytes = 0;
    try {
        while (true) {
            const chunk = await reader.read();
            if (chunk.done) return bytes;
            bytes += chunk.value.byteLength;
            if (bytes > maximum) {
                // A cloned Request tees its stream. Awaiting cancel can wait for
                // the unconsumed original branch; cancel this reader only.
                void reader.cancel().catch(() => {});
                return bytes;
            }
        }
    } finally { reader.releaseLock(); }
}

async function bodySize(input, init, maximum) {
    const body = init.body;
    if (body == null) return input instanceof Request && input.body
        ? boundedStreamSize(input.clone().body, maximum) : 0;
    if (typeof body === 'string' || body instanceof URLSearchParams) return new TextEncoder().encode(String(body)).byteLength;
    if (body instanceof Blob) return body.size;
    if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
    if (body instanceof FormData) {
        // Native multipart serialization includes boundaries and headers, not
        // just the file sizes. This disposable Request is never fetched.
        return boundedStreamSize(new Request('https://transport.invalid', { method: 'POST', body }).body, maximum);
    }
    return null; // Unknown streaming bodies must not bypass the local cap.
}

// Low-level defense for this singleton's HTTP calls, not authorization or a
// billing cap. Auth stays available. No automatic retry and no business deletion.
// The optional dependencies are for deterministic tests, never runtime switches.
export function createSupabaseFreeFetch({
    fetchImpl = (...args) => globalThis.fetch(...args),
    isPaused = () => REMOTE_OPERATIONS_PAUSED,
    record = recordSyncMetric,
} = {}) {
    const note = (...args) => { try { record(...args); } catch { /* Diagnostics never block Auth. */ } };
    return async (input, init = {}) => {
        const url = new URL(typeof input === 'string' || input instanceof URL ? String(input) : input.url);
        const key = serviceKey(url.pathname);
        if (key !== 'sdk_auth' && isPaused()) {
            note(key, 'blocked');
            return rejected(503, 'REMOTE_OPERATIONS_PAUSED', CLOUD_PAUSE_MESSAGE);
        }
        const bytes = await bodySize(input, init, SUPABASE_FREE_PROFILE.payloadMaxBytes);
        if (key !== 'sdk_auth' && bytes === null) {
            note(key, 'blocked');
            return rejected(415, 'FREE_TIER_BODY_UNMEASURABLE', 'El formato de carga debe tener tamaño verificable antes de enviarse.');
        }
        if (key !== 'sdk_auth' && bytes > SUPABASE_FREE_PROFILE.payloadMaxBytes) {
            note(key, 'oversized');
            return rejected(413, 'FREE_TIER_PAYLOAD_LIMIT', 'La carga supera 1 MiB. Conserva los datos locales y divide el envío; no se envió esta solicitud.');
        }
        note(key, 'request');
        if (bytes) note(key, 'uploadBytes', bytes);
        try {
            const response = await fetchImpl(input, init);
            const header = response.headers.get('content-length');
            const size = header === null ? NaN : Number(header);
            if (Number.isFinite(size) && size >= 0) note(key, 'downloadBytes', size);
            else note(key, 'unknownResponseSize');
            if (!response.ok) note(key, 'error');
            // Preserve the original body/headers/status for the SDK, including
            // 401/403/429 responses; never disguise an error as a successful sync.
            return response;
        } catch (error) {
            note(key, 'error');
            throw error;
        }
    };
}
