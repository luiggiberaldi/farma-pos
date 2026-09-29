// Hash de PIN en cliente (A3, 2026-09-28).
// Antes: SHA-256 sin salt — un PIN de 4-6 dígitos se revienta offline en
// milisegundos desde un dump de localStorage. Ahora: PBKDF2-SHA256 con salt
// aleatorio por usuario (100k iteraciones; el servidor usa 210k).
// Los registros viejos (SHA-256 o texto plano) se migran automáticamente al
// primer login exitoso (ver useAuthStore.verifyPin/login).
const ITERATIONS = 100_000;
const SALT_BYTES = 16;
const HASH_BYTES = 32;

const b64encode = bytes => btoa(String.fromCharCode(...bytes));
const b64decode = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

export async function generatePinSalt() {
    const salt = new Uint8Array(SALT_BYTES);
    crypto.getRandomValues(salt);
    return b64encode(salt);
}

export async function hashPinPbkdf2(pin, saltB64) {
    const keyMaterial = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
        { name: 'PBKDF2', hash: 'SHA-256', salt: b64decode(saltB64), iterations: ITERATIONS },
        keyMaterial, HASH_BYTES * 8);
    return Array.from(new Uint8Array(bits)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// true si el registro ya usa el formato fuerte.
export const isStrongPinRecord = user => user?.pinKdf === 'pbkdf2' && typeof user?.pinSalt === 'string';
