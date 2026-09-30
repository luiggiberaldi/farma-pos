/**
 * Tests contractuales para la autenticación real de las APIs del Monitor.
 *
 * A diferencia de la versión anterior (que probaba una función duplicada),
 * estos tests importan los handlers reales (api/monitor-upload.js,
 * api/monitor-snapshots.js, src/server/monitorAuth.js) y verifican:
 *
 * - Sin Authorization → 401
 * - JWT inválido → 401
 * - JWT válido pero no es dueño → 403
 * - El tenant lo deriva el SERVIDOR (se ignora el del cliente)
 * - Payload inválido → 400
 * - Sede de otro tenant → 403
 * - Sesión válida + payload válido → 200
 * - Cero escrituras ante rechazo (el RPC jamás se llama)
 *
 * El `fetch` global se sustituye por un stub que simula Supabase Auth
 * (/auth/v1/user) y PostgREST (RPCs).
 */
import test from 'node:test';
import assert from 'node:assert/strict';

import { authenticateMonitorRequest } from '../src/server/monitorAuth.js';
import uploadHandler from '../api/monitor-upload.js';
import snapshotsHandler from '../api/monitor-snapshots.js';

// Los handlers leen process.env directamente
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key-test';
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = 'publishable-test';
process.env.APP_ORIGIN = 'https://farma-pos.vercel.app';

const OWNER_AUTH_UID = 'a21b635a-e34b-44fc-9830-9eb1d9254499';
const TENANT_ID = '17486fbd-a7c5-4b8d-94c0-71688197ad76';
const BRANCH_CENTRAL = 'ba19ea5d-1320-49b7-8579-4eb743b81993';
const BRANCH_AJENO = '00000000-0000-0000-0000-000000000000';

const ENV = {
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'service-key-test',
    VITE_SUPABASE_PUBLISHABLE_KEY: 'publishable-test',
};

function mockReq({ method = 'GET', headers = {}, body = null, query = {} } = {}) {
    return { method, headers, body, query, socket: {} };
}

function mockRes() {
    const res = {
        statusCode: 200,
        headers: {},
        body: null,
        setHeader(k, v) { this.headers[k] = v; },
        status(c) { this.statusCode = c; return this; },
        json(o) { this.body = o; return this; },
        end() { return this; },
    };
    return res;
}

/**
 * Stub de fetch que simula:
 * - /auth/v1/user: valida el Bearer token ("valid-jwt-owner", "valid-jwt-stranger")
 * - RPC pharmacy_monitor_owner_tenant: retorna tenant solo para el dueño
 * - RPC pharmacy_upsert_branch_snapshot: 409 si la sede es ajena
 * - RPC pharmacy_get_branch_snapshots: retorna lista fija
 * Registra todas las llamadas para verificar cero escrituras.
 */
function installFetchStub() {
    const calls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts = {}) => {
        calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
        const u = String(url);

        if (u.endsWith('/auth/v1/user')) {
            const auth = opts.headers?.Authorization || '';
            if (auth === 'Bearer valid-jwt-owner') {
                return { ok: true, json: async () => ({ id: OWNER_AUTH_UID }) };
            }
            if (auth === 'Bearer valid-jwt-stranger') {
                return { ok: true, json: async () => ({ id: '11111111-2222-3333-4444-555555555555' }) };
            }
            return { ok: false, status: 401, json: async () => ({}) };
        }

        if (u.includes('/rpc/pharmacy_monitor_owner_tenant')) {
            const { p_auth_uid } = JSON.parse(opts.body);
            return {
                ok: true,
                json: async () => (p_auth_uid === OWNER_AUTH_UID ? TENANT_ID : null),
            };
        }

        if (u.includes('/rpc/pharmacy_upsert_branch_snapshot')) {
            const payload = JSON.parse(opts.body);
            // La FK (tenant_id, branch_id) rechazaría una sede ajena
            if (payload.p_branch_id === BRANCH_AJENO) {
                return { ok: false, status: 409, json: async () => ({}) };
            }
            // El tenant debe ser el del servidor, nunca el del cliente
            assert.equal(payload.p_tenant_id, TENANT_ID, 'el tenant debe venir de la sesión');
            return { ok: true, json: async () => 'snapshot-id-123' };
        }

        if (u.includes('/rpc/pharmacy_get_branch_snapshots')) {
            const payload = JSON.parse(opts.body);
            assert.equal(payload.p_tenant_id, TENANT_ID, 'el tenant debe venir de la sesión');
            return { ok: true, json: async () => ([{ branch_id: BRANCH_CENTRAL }]) };
        }

        throw new Error(`URL no esperada en stub: ${u}`);
    };
    return {
        calls,
        rpcCalls: () => calls.filter(c => c.url.includes('/rpc/')),
        restore() { globalThis.fetch = realFetch; },
    };
}

// ─── authenticateMonitorRequest ──────────────────────────────────────────

test('monitorAuth: sin header Authorization → 401', async () => {
    const stub = installFetchStub();
    try {
        const r = await authenticateMonitorRequest(mockReq({ headers: {} }), ENV);
        assert.equal(r.ok, false);
        assert.equal(r.status, 401);
        assert.equal(stub.calls.length, 0, 'no debe llamar a Supabase sin token');
    } finally { stub.restore(); }
});

test('monitorAuth: JWT inválido → 401', async () => {
    const stub = installFetchStub();
    try {
        const r = await authenticateMonitorRequest(
            mockReq({ headers: { authorization: 'Bearer token-malo' } }), ENV);
        assert.equal(r.ok, false);
        assert.equal(r.status, 401);
        assert.equal(stub.rpcCalls().length, 0, 'no debe consultar el tenant si el JWT falla');
    } finally { stub.restore(); }
});

test('monitorAuth: JWT válido pero no es dueño → 403', async () => {
    const stub = installFetchStub();
    try {
        const r = await authenticateMonitorRequest(
            mockReq({ headers: { authorization: 'Bearer valid-jwt-stranger' } }), ENV);
        assert.equal(r.ok, false);
        assert.equal(r.status, 403);
    } finally { stub.restore(); }
});

test('monitorAuth: JWT del dueño → ok con tenant derivado del servidor', async () => {
    const stub = installFetchStub();
    try {
        const r = await authenticateMonitorRequest(
            mockReq({ headers: { Authorization: 'Bearer valid-jwt-owner' } }), ENV);
        assert.equal(r.ok, true);
        assert.equal(r.tenantId, TENANT_ID);
        assert.equal(r.userId, OWNER_AUTH_UID);
    } finally { stub.restore(); }
});

// ─── /api/monitor-upload ─────────────────────────────────────────────────

test('upload: anónimo → 401 y cero escrituras', async () => {
    const stub = installFetchStub();
    const req = mockReq({ method: 'POST', headers: {}, body: { p_branch_id: BRANCH_CENTRAL } });
    const res = mockRes();
    await uploadHandler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(stub.rpcCalls().length, 0, 'ningún RPC debe ejecutarse ante rechazo');
    stub.restore();
});

test('upload: ignora p_tenant_id del cliente y usa el de la sesión', async () => {
    const stub = installFetchStub();
    const req = mockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt-owner' },
        body: {
            p_tenant_id: 'tenant-falso-del-cliente',
            p_branch_id: BRANCH_CENTRAL,
            p_snapshot_date: '2026-09-30',
        },
    });
    const res = mockRes();
    await uploadHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.id, 'snapshot-id-123');
    // El stub ya verificó que el RPC recibió TENANT_ID del servidor
    stub.restore();
});

test('upload: payload sin branch_id → 400', async () => {
    const stub = installFetchStub();
    const req = mockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt-owner' },
        body: { p_snapshot_date: '2026-09-30' },
    });
    const res = mockRes();
    await uploadHandler(req, res);
    assert.equal(res.statusCode, 400);
    assert.equal(stub.rpcCalls().filter(c => c.url.includes('upsert')).length, 0);
    stub.restore();
});

test('upload: sede de otro tenant → 403', async () => {
    const stub = installFetchStub();
    const req = mockReq({
        method: 'POST',
        headers: { authorization: 'Bearer valid-jwt-owner' },
        body: { p_branch_id: BRANCH_AJENO, p_snapshot_date: '2026-09-30' },
    });
    const res = mockRes();
    await uploadHandler(req, res);
    assert.equal(res.statusCode, 403);
    stub.restore();
});

// ─── /api/monitor-snapshots ──────────────────────────────────────────────

test('snapshots: anónimo → 401', async () => {
    const stub = installFetchStub();
    const req = mockReq({ method: 'GET', headers: {}, query: {} });
    const res = mockRes();
    await snapshotsHandler(req, res);
    assert.equal(res.statusCode, 401);
    assert.equal(stub.rpcCalls().length, 0);
    stub.restore();
});

test('snapshots: ignora tenant_id del query y usa el de la sesión', async () => {
    const stub = installFetchStub();
    const req = mockReq({
        method: 'GET',
        headers: { authorization: 'Bearer valid-jwt-owner' },
        query: { tenant_id: 'tenant-falso', date: '2026-09-30' },
    });
    const res = mockRes();
    await snapshotsHandler(req, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.snapshots));
    stub.restore();
});

test('snapshots: usuario autenticado no dueño → 403', async () => {
    const stub = installFetchStub();
    const req = mockReq({
        method: 'GET',
        headers: { authorization: 'Bearer valid-jwt-stranger' },
        query: {},
    });
    const res = mockRes();
    await snapshotsHandler(req, res);
    assert.equal(res.statusCode, 403);
    stub.restore();
});
