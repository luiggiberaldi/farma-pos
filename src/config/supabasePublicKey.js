// Shared by Vite's preflight and the browser singleton. Never log the key.
export function assertSupabaseBrowserKey(key) {
    if (!key) return;
    if (typeof key !== 'string') throw new Error('Configura una clave pública de Supabase válida.');
    if (key.startsWith('sb_secret_')) {
        throw new Error('Una clave secreta de Supabase no puede usarse en VITE_*. Usa una clave publishable o anon.');
    }
    if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(key)) return;
    if (key.split('.').length === 3) {
        let role;
        try {
            const encoded = key.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            role = JSON.parse(globalThis.atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))).role;
        } catch {
            throw new Error('La clave pública JWT de Supabase no es válida.');
        }
        if (role !== 'anon') throw new Error('No se permite una clave privilegiada o de usuario en el cliente. Usa la clave pública del proyecto.');
        return;
    }
    throw new Error('Configura la clave publishable o anon del proyecto, no una contraseña ni un token personal.');
}
