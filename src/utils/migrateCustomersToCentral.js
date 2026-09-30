/**
 * Migración única: clientes/deudas globales → sede central.
 *
 * Contexto: `bodega_customers_v1` pasó de account-scoped a sede-scoped
 * (commit b012f03). Los clientes QA existentes quedaron bajo la clave
 * account-scoped anterior. Esta migración los copia a la sede central
 * UNA sola vez, sin borrar la clave antigua y sin tocar norte/sur.
 *
 * Reglas de seguridad:
 * - Solo copia a central, nunca a norte/sur.
 * - No sobrescribe si central ya tiene clientes.
 * - No borra la clave antigua (queda como respaldo).
 * - Idempotente: usa bandera `farmacia_customers_migrated_v1`.
 */

import { getActiveAccountId } from '../config/storageScope.js';
import { storageService } from './storageService.js';
import localforage from 'localforage';

const MIGRATION_FLAG = 'farmacia_customers_migrated_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

/**
 * Ejecuta la migración si no se ha hecho antes.
 * @returns {Promise<{migrated: boolean, count: number, reason: string}>}
 */
export async function migrateCustomersToCentral() {
    // Ya migrado: no hacer nada
    try {
        const done = localStorage.getItem(MIGRATION_FLAG);
        if (done === '1') {
            return { migrated: false, count: 0, reason: 'ya_migrado' };
        }
    } catch {
        return { migrated: false, count: 0, reason: 'sin_localstorage' };
    }

    const accountId = getActiveAccountId();
    if (!accountId) {
        return { migrated: false, count: 0, reason: 'sin_cuenta' };
    }

    // Clave antigua: account-scoped (antes del cambio a sede-scoped)
    // Se construye manualmente porque getStorageKeyForContext ahora
    // siempre genera la versión sede-scoped.
    const oldKey = `account:${accountId}:${CUSTOMERS_KEY}`;

    try {
        // Leer clave antigua directamente de localforage
        const oldData = await localforage.getItem(oldKey);

        // Si no hay datos antiguos, marcar como migrado y salir
        if (!oldData || (Array.isArray(oldData) && oldData.length === 0)) {
            localStorage.setItem(MIGRATION_FLAG, '1');
            return { migrated: false, count: 0, reason: 'sin_datos_antiguos' };
        }

        // Verificar si central ya tiene clientes (no sobrescribir)
        // Usamos storageService con contexto de central (sede-scoped)
        const centralData = await storageService.getItem(CUSTOMERS_KEY, null, {
            accountId,
            sedeId: 'central',
        }).catch(() => null);

        if (centralData && Array.isArray(centralData) && centralData.length > 0) {
            localStorage.setItem(MIGRATION_FLAG, '1');
            return { migrated: false, count: 0, reason: 'central_ya_tiene_datos' };
        }

        // Copiar a central usando storageService (genera la clave sede-scoped)
        await storageService.setItem(CUSTOMERS_KEY, oldData, {
            accountId,
            sedeId: 'central',
        });

        // Marcar como migrado (NO borrar la clave antigua)
        localStorage.setItem(MIGRATION_FLAG, '1');

        const count = Array.isArray(oldData) ? oldData.length : 1;
        console.log(`[Migración] ${count} clientes copiados a central. Clave antigua conservada en ${oldKey}.`);
        return { migrated: true, count, reason: 'ok' };
    } catch (error) {
        console.error('[Migración] Error migrando clientes:', error.message);
        return { migrated: false, count: 0, reason: 'error:' + error.message };
    }
}
