import { SEDES } from './sedes.js';

// PIN de fábrica universal: el dueño (6 dígitos) y los cajeros (4 dígitos)
// arrancan con ceros.
//
// DECISIÓN OPERATIVA (2026-09-28): los PINs de fábrica siguen vigentes por ahora
// para no bloquear la operación. La app muestra un aviso persistente
// (FactoryPinBanner) hasta que el dueño los cambie. Cuando se decida la
// rotación, eliminar estos valores y forzar el cambio en el primer arranque.
export const CASHIER_FACTORY_PIN = '0000';

/** true si el PIN es uno de los PINs de fábrica (inseguro, debe cambiarse).
 *  OWNER_FACTORY_PIN se declara más abajo en este mismo módulo. */
export function isFactoryPin(pin) {
    return pin === CASHIER_FACTORY_PIN || pin === '000000';
}

// Catálogo base de cuentas: el Dueño (id 1) es la única cuenta permanente
// del sistema y cada sede arranca con un cajero con PIN de fábrica.
export const DEFAULT_USERS = [
    { id: 1, nombre: 'Dueño', rol: 'DUENO', sedeId: null, pin: '000000', pinHashed: false, permanente: true },
    ...SEDES.map((sede, index) => ({
        id: 3 + index,
        nombre: `Cajero ${sede.nombre}`,
        rol: 'CAJERO',
        sedeId: sede.id,
        pin: CASHIER_FACTORY_PIN,
        pinHashed: false,
        sinPin: false,
    })),
];

// Re-crea el cajero con PIN de fábrica de cada sede si falta (estado viejo)
// y migra cajeros sin PIN heredados al PIN de fábrica 0000.
export function ensureCashiersPerSede(users) {
    const existing = Array.isArray(users) ? users.filter(Boolean).map(user => ({
        ...user,
        ...(user.pin ? { sinPin: false } : {}),
    })) : [];
    const maxId = existing.reduce((max, user) => Math.max(max, Number(user.id) || 0), 0);
    let nextId = maxId + 1;
    const result = [...existing];
    SEDES.forEach(sede => {
        const cashier = result.find(user => user.rol === 'CAJERO' && user.sedeId === sede.id);
        if (!cashier) {
            result.push({
                id: nextId++,
                nombre: `Cajero ${sede.nombre}`,
                rol: 'CAJERO',
                sedeId: sede.id,
                pin: CASHIER_FACTORY_PIN,
                pinHashed: false,
                sinPin: false,
            });
        }
        // Existing credentials and the explicit sinPin choice are authoritative.
        // Provision missing users only; never erase a cashier PIN on hydration.
    });
    return result;
}

// El Dueño (id 1) siempre existe: se restaura aunque el estado persistido
// venga de una versión anterior (Dueño ausente o ADMIN heredado en id 1).
export function ensureOwner(users) {
    const list = Array.isArray(users) ? [...users] : [];
    const idx = list.findIndex(u => Number(u?.id) === 1);
    if (idx === -1) {
        list.unshift({ ...DEFAULT_USERS[0] });
        return list;
    }
    // Normaliza la cuenta en id 1: rol Dueño, permanente y con PIN usable.
    const owner = { ...list[idx], rol: 'DUENO', permanente: true };
    if (!owner.pin) { owner.pin = OWNER_FACTORY_PIN; owner.pinHashed = false; }
    if (owner.nombre === 'Administrador') owner.nombre = 'Dueño';
    list[idx] = owner;
    return list;
}

// Orden garantizado: primero el dueño (reserva id 1) y después los cajeros,
// así ningún cajero nuevo puede colisionar con el id del dueño.
// PIN de fábrica del Dueño y huella del PIN legado (123456) — mismo
// SHA-256 que produce hashPin (Web Crypto) — para migrar dispositivos.
export const OWNER_FACTORY_PIN = '000000';
export const LEGACY_OWNER_PIN = '123456';
export const LEGACY_OWNER_PIN_HASH = '8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92';

// v3: el PIN de fábrica del Dueño pasó de 123456 a 000000; los
// dispositivos que aún traen el legado (en texto o ya hasheado) se
// actualizan. Un PIN personalizado del dueño nunca se toca.
export function migrateOwnerPinToFactory(users) {
    const list = (Array.isArray(users) ? users : []).map(u => {
        if (Number(u?.id) !== 1 || u.rol !== 'DUENO') return u;
        const legacy = !u.pin || u.pin === LEGACY_OWNER_PIN || u.pin === LEGACY_OWNER_PIN_HASH;
        return legacy ? { ...u, pin: OWNER_FACTORY_PIN, pinHashed: false } : u;
    });
    // v4: los cajeros sin PIN (acceso directo heredado) reciben el PIN de
    // fábrica 0000; un PIN personalizado del cajero nunca se toca.
    return list.map(u => u?.rol === 'CAJERO' && !u.pin
        ? { ...u, pin: CASHIER_FACTORY_PIN, pinHashed: false, sinPin: false }
        : u);
}

// Normalización de fábrica: dueño con 000000, cajeros siempre con PIN
// (0000 si no tenían) y un cajero por sede.
export const normalizeUsers = users =>
    migrateOwnerPinToFactory(ensureCashiersPerSede(ensureOwner(users)));

