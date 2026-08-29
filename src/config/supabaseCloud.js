import { createClient } from '@supabase/supabase-js';

// Instancia única para toda la app (auth, sync, backups)
// Las credenciales vienen del entorno (.env / Vercel env vars) — NUNCA hardcodeadas.
// TODO: Configurar con las credenciales del NUEVO proyecto Supabase.
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

// ¿Hay proyecto cloud configurado? Sin estas variables la app corre en modo
// local 100% offline (sin login cloud ni sincronización).
export const isCloudConfigured = Boolean(supabaseUrl && supabaseKey);

// ── Stub offline ────────────────────────────────────────────────────────────
// Con Supabase sin configurar se expone un cliente inerte: cualquier cadena
// (.from().select().eq()...) resuelve vacía y auth siempre reporta "sin sesión",
// de modo que la app arranca en modo local sin lanzar errores de runtime.
const OFFLINE_ERROR = { message: 'Supabase no configurado (modo local)', code: 'CLOUD_NOT_CONFIGURED' };

function createChainStub() {
    const chain = new Proxy(function () {}, {
        get(_target, prop) {
            if (prop === 'then') {
                return (resolve) => Promise.resolve({ data: null, error: OFFLINE_ERROR }).then(resolve);
            }
            if (prop === 'catch') return () => chain;
            if (prop === 'finally') return () => chain;
            return () => chain;
        },
        apply() { return chain; },
    });
    return chain;
}

function createOfflineStub() {
    const auth = new Proxy(
        {
            getSession: async () => ({ data: { session: null }, error: null }),
            onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
        },
        {
            get(target, prop) {
                if (prop in target) return target[prop];
                return async () => ({ data: null, error: OFFLINE_ERROR });
            },
        }
    );
    return new Proxy(
        { auth },
        {
            get(target, prop) {
                if (prop in target) return target[prop];
                return () => createChainStub();
            },
        }
    );
}

// Singleton — se crea UNA sola vez para evitar múltiples GoTrueClient
let _instance = null;
function getSupabase() {
    if (!_instance) {
        _instance = isCloudConfigured ? createClient(supabaseUrl, supabaseKey) : createOfflineStub();
    }
    return _instance;
}

export const supabaseCloud = getSupabase();
