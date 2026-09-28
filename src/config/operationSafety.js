// Phase 1 containment: legacy cloud documents and checkout lack an authorized
// operator + branch contract. Keep local data and the outbox; never migrate or
// resume remote writes from a localStorage/environment toggle.
// Remove this containment only with the reviewed phase 2/3 server contract.
export const REMOTE_OPERATIONS_PAUSED = true;
export const CLOUD_PAUSE_MESSAGE = 'Sincronización operativa pausada por seguridad. Los datos y las ventas pendientes se conservan en este equipo; aún no están confirmados en la nube.';

export function pausedCloudOperation() {
  return { status: 'paused', code: 'REMOTE_OPERATIONS_PAUSED', message: CLOUD_PAUSE_MESSAGE };
}
