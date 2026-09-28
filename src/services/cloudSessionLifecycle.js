import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { getActiveAccountId, setActiveAccountId } from '../config/storageScope.js';

// Auth SDK sessions authenticate the cloud account, never the local operator.
export function applyCloudSession(session, { explicit = false } = {}) {
    const accountId = typeof session?.user?.id === 'string' ? session.user.id : '';
    const isExplicitSignOut = localStorage.getItem('farmapos_cloud_signed_out') === '1';
    if (isExplicitSignOut && accountId) return null;
    if (explicit || accountId !== getActiveAccountId() || !accountId) {
        useAuthStore.getState().logout(explicit ? 'acceso cloud: selecciona operador y PIN' : 'cuenta cloud modificada');
    }
    setActiveAccountId(accountId);
    return session?.user?.id ? session : null;
}

export function beginCloudLogin() {
    useAuthStore.getState().logout('autenticación cloud');
    localStorage.removeItem('farmapos_cloud_signed_out');
}

export async function signOutCloudAccount(client) {
    // Lock locally BEFORE awaiting the network, even when signOut fails.
    useAuthStore.getState().logout('salida cloud');
    localStorage.setItem('farmapos_cloud_signed_out', '1');
    setActiveAccountId('');
    window.dispatchEvent(new CustomEvent('cloud_logout_completed'));
    // En modo local el cliente es un stub y devuelve CLOUD_NOT_CONFIGURED.
    // La salida local ya se completó; ese estado no debe bloquear ni mostrar
    // un error al usuario.
    if (!client?.auth?.signOut) return { status: 'signed_out', cloud: false };
    const result = await client.auth.signOut();
    if (result?.error && result.error.code !== 'CLOUD_NOT_CONFIGURED') throw result.error;
    return { status: 'signed_out', cloud: !result?.error };
}
