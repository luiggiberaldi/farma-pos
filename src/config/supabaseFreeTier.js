// Supabase Free reference quotas checked against official docs on 2026-09-13.
// These are provider quotas, not a promise of application capacity. Usage across
// projects is pooled per organization except database size (per project).
export const SUPABASE_FREE_LIMITS = Object.freeze({
    verifiedOn: '2026-09-13',
    databaseBytesPerProject: 500_000_000,
    storageBytesPerOrganization: 1_000_000_000,
    uncachedEgressBytesPerCycle: 5_000_000_000,
    cachedEgressBytesPerCycle: 5_000_000_000,
    monthlyActiveUsers: 50_000,
    realtimeMessagesPerCycle: 2_000_000,
    realtimePeakConnections: 200,
    edgeInvocationsPerCycle: 500_000,
    activeFreeProjects: 2,
});

// Conservative application defaults, NOT Supabase's service limits. Keep one
// project for the three branches. This profile never enables operational sync.
export const SUPABASE_FREE_PROFILE = Object.freeze({
    name: 'Supabase Free · local-first',
    heavyDebounceMs: 30 * 60 * 1000,
    lightDebounceMs: 3000,
    pollIntervalMs: 60 * 60 * 1000,
    visibilityCooldownMs: 10 * 60 * 1000,
    catchUpSpacingMs: 1000,
    auditIntervalMs: 60 * 60 * 1000,
    queueRefreshFallbackMs: 60 * 1000,
    realtimeEnabled: false,
    remoteHealthChecksEnabled: false,
    automaticCloudBackupsEnabled: false,
    payloadWarningBytes: 250 * 1024,
    payloadMaxBytes: 1024 * 1024,
    metricsDays: 14,
});

export function inspectSyncPayload(value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    if (typeof serialized !== 'string') throw new TypeError('El contenido de sincronización no es serializable.');
    const bytes = new TextEncoder().encode(serialized).byteLength;
    return {
        serialized, bytes,
        warning: bytes >= SUPABASE_FREE_PROFILE.payloadWarningBytes,
        allowed: bytes <= SUPABASE_FREE_PROFILE.payloadMaxBytes,
    };
}

export async function fingerprintSyncPayload(serialized) {
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(serialized));
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}
