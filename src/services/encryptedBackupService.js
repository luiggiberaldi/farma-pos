// Respaldo local cifrado (C6, 2026-09-28).
// Mientras la sincronización remota está pausada, la única copia de las
// ventas vive en este equipo. Este módulo permite exportar un respaldo
// cifrado con contraseña (AES-256-GCM, clave derivada con PBKDF2 200k) para
// guardarlo fuera del dispositivo (USB, correo, etc.) sin exponer los datos
// si el archivo cae en manos equivocadas.
import { collectBranchBackup } from './dataBackupService.js';

const ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

const b64encode = bytes => btoa(String.fromCharCode(...bytes));
const b64decode = str => Uint8Array.from(atob(str), c => c.charCodeAt(0));

async function deriveKey(password, salt) {
    const material = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(String(password)), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITERATIONS },
        material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function encryptPayloadBytes(payloadBytes, password) {
    if (!password || String(password).length < 8) {
        throw new Error('La contraseña debe tener al menos 8 caracteres.');
    }
    const salt = new Uint8Array(SALT_BYTES);
    const iv = new Uint8Array(IV_BYTES);
    crypto.getRandomValues(salt);
    crypto.getRandomValues(iv);
    const key = await deriveKey(password, salt);
    const ciphertext = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, key, payloadBytes);
    return {
        v: 1,
        algo: 'AES-256-GCM/PBKDF2-SHA256-200k',
        salt: b64encode(salt),
        iv: b64encode(iv),
        data: b64encode(new Uint8Array(ciphertext)),
        exportedAt: new Date().toISOString(),
    };
}

export async function encryptBackup(password) {
    const backup = await collectBranchBackup();
    return encryptPayloadBytes(new TextEncoder().encode(JSON.stringify(backup)), password);
}

export async function decryptBackup(envelope, password) {
    if (!envelope || envelope.v !== 1 || !envelope.data) throw new Error('Archivo de respaldo inválido.');
    const key = await deriveKey(password, b64decode(envelope.salt));
    let plaintext;
    try {
        plaintext = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: b64decode(envelope.iv) }, key, b64decode(envelope.data));
    } catch {
        throw new Error('Contraseña incorrecta o archivo dañado.');
    }
    return JSON.parse(new TextDecoder().decode(plaintext));
}

export async function downloadEncryptedBackup(password) {
    const envelope = await encryptBackup(password);
    const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `respaldo_cifrado_farmapos_${new Date().toISOString().slice(0, 10)}.farmapos.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    return envelope.exportedAt;
}
