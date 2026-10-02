import { remoteOperatorSession } from './operatorRemoteSession.js';
import { deviceLabel } from '../utils/deviceLabel.js';
import { showToast } from '../components/toastState.js';

// Matrícula automática tras un login cloud explícito. Nunca bloquea el login:
// si falla, se reintenta en el próximo login. La sesión es inyectable para tests.
export async function autoEnrollDevice(session = remoteOperatorSession) {
    try {
        if (session.isDeviceLinked()) return { ok: true, already: true };
        const result = await session.enrollDevice(deviceLabel());
        if (result.ok && !result.already) showToast('Equipo vinculado', 'success');
        else if (result.code === 'device_limit') {
            showToast('Límite de 6 equipos — desvincula uno en Ajustes → Sistema', 'warning');
        }
        return result;
    } catch {
        return { ok: false, code: 'unavailable' };
    }
}
