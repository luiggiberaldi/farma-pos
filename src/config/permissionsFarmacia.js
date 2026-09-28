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
    return canSeeCosts(usuario);
}

// Consultation does not authorize a branch switch; that requires a PIN action.
export function canSeeConsolidatedReports(usuario) {
    return canSeeCosts(usuario);
}

export function canManageUsers(usuario) {
    return usuario?.rol === FARMACIA_ROLES.DUENO;
}

