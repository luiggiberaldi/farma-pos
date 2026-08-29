export const FARMACIA_ROLES = {
    DUENO: 'DUENO',
    ADMIN: 'ADMIN',
    CAJERO: 'CAJERO',
};

export function canSeeCosts(usuario) {
    return usuario?.rol === FARMACIA_ROLES.DUENO || usuario?.rol === FARMACIA_ROLES.ADMIN;
}

export function canManageInventory(usuario) {
    return canSeeCosts(usuario);
}

export function canSeeAllSedes(usuario) {
    return usuario?.rol === FARMACIA_ROLES.DUENO;
}

export function canManageUsers(usuario) {
    return usuario?.rol === FARMACIA_ROLES.DUENO;
}

export function canManageTransfers(usuario) {
    return usuario?.rol === FARMACIA_ROLES.DUENO || usuario?.rol === FARMACIA_ROLES.ADMIN;
}

export function canSell(usuario) {
    return Boolean(usuario);
}
