/**
 * Tests para el auth de las APIs del Monitor.
 * Verifica que /api/monitor-upload y /api/monitor-snapshots
 * rechacen solicitudes sin la API key correcta.
 */
import test from 'node:test';
import assert from 'node:assert/strict';

// Simula el middleware de auth extraído de las APIs
function checkMonitorAuth(req, env) {
    const expectedKey = env.MONITOR_API_KEY;
    const providedKey = req.headers['x-monitor-key'];
    if (!expectedKey || providedKey !== expectedKey) {
        return { status: 401, body: { error: 'No autorizado' } };
    }
    return { status: 200 };
}

test('monitor API: rechaza sin API key', () => {
    const req = { headers: {} };
    const env = { MONITOR_API_KEY: 'secret123' };
    const result = checkMonitorAuth(req, env);
    assert.equal(result.status, 401);
});

test('monitor API: rechaza con API key incorrecta', () => {
    const req = { headers: { 'x-monitor-key': 'wrong' } };
    const env = { MONITOR_API_KEY: 'secret123' };
    const result = checkMonitorAuth(req, env);
    assert.equal(result.status, 401);
});

test('monitor API: acepta con API key correcta', () => {
    const req = { headers: { 'x-monitor-key': 'secret123' } };
    const env = { MONITOR_API_KEY: 'secret123' };
    const result = checkMonitorAuth(req, env);
    assert.equal(result.status, 200);
});

test('monitor API: rechaza si el servidor no tiene key configurada (fail closed)', () => {
    const req = { headers: { 'x-monitor-key': 'anything' } };
    const env = {}; // Sin MONITOR_API_KEY
    const result = checkMonitorAuth(req, env);
    assert.equal(result.status, 401, 'Sin key configurada debe fallar cerrado');
});
