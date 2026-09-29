import { supabaseCloud } from '../../config/supabaseCloud';
import { REMOTE_OPERATIONS_PAUSED, pausedCloudOperation } from '../../config/operationSafety.js';


// Exportado para que SettingsView pueda enviar el broadcast antes de hacer signOut
export const broadcastFactoryReset = async (userId) => {
    if (REMOTE_OPERATIONS_PAUSED) return pausedCloudOperation();
    try {
        const ch = supabaseCloud.channel(`factory-reset-${userId}`);
        await ch.subscribe();
        await ch.send({ type: 'broadcast', event: 'factory_reset', payload: {} });
        // Pequeña pausa para que el mensaje llegue antes de continuar
        await new Promise(r => setTimeout(r, 800));
        supabaseCloud.removeChannel(ch);
    } catch (e) {
        console.warn('[CloudSync] No se pudo broadcast factory_reset:', e.message);
    }
};

// Exportado para forzar la recarga remota de todos los dispositivos
export const broadcastForceReload = async (userId) => {
    if (REMOTE_OPERATIONS_PAUSED) return pausedCloudOperation();
    try {
        const ch = supabaseCloud.channel(`factory-reset-${userId}`);
        await ch.subscribe();
        await ch.send({ type: 'broadcast', event: 'force_reload', payload: {} });
        await new Promise(r => setTimeout(r, 800));
        supabaseCloud.removeChannel(ch);
    } catch (e) {
        console.warn('[CloudSync] No se pudo broadcast force_reload:', e.message);
    }
};

