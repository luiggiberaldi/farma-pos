export const SEDES = [
    { id: 'central', nombre: 'Sede Central', color: '#0B8D63' },
    { id: 'norte', nombre: 'Sede Norte', color: '#0066CC' },
    { id: 'sur', nombre: 'Sede Sur', color: '#8B5CF6' },
];

export const DEFAULT_SEDE_ID = SEDES[0].id;

export function getSedeById(id) {
    return SEDES.find(sede => sede.id === id) || SEDES[0];
}

export function getVisibleSedes(usuario) {
    if (usuario?.rol === 'DUENO') return SEDES;
    const sede = getSedeById(usuario?.sedeId);
    return usuario?.sedeId ? [sede] : [SEDES[0]];
}
