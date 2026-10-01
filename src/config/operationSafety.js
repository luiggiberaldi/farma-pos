// Phase 1 containment: legacy cloud documents and checkout lack an authorized
// operator + branch contract. Keep local data and the outbox; never migrate or
// resume remote writes from a localStorage/environment toggle.
// Remove this containment only with the reviewed phase 2/3 server contract.
export const REMOTE_OPERATIONS_PAUSED = true;
export const CLOUD_PAUSE_MESSAGE = 'Sincronización operativa pausada por seguridad. Los datos y las ventas pendientes se conservan en este equipo; aún no están confirmados en la nube.';

export function pausedCloudOperation() {
  return { status: 'paused', code: 'REMOTE_OPERATIONS_PAUSED', message: CLOUD_PAUSE_MESSAGE };
}

// ADR-003 (2026-09-30): sincronización bidireccional multi-equipo por documentos
// (public.sync_documents). Es un contrato NUEVO e independiente del track legado:
// el checkout sigue 100% local-first y REMOTE_OPERATIONS_PAUSED sigue en true
// para los RPCs operacionales (pharmacy_commit_*), la cola offline y el checkout
// remoto. Este flag solo habilita el motor de documentos de useCloudSync.
export const SYNC_V2_ENABLED = true;

export function syncV2Paused() {
  return !SYNC_V2_ENABLED;
}
