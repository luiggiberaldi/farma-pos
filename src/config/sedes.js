export const SEDES = [
    { id: 'central', nombre: 'C&Y 2025', color: '#0B8D63' },
    { id: 'norte', nombre: 'C&Y 2026', color: '#0066CC' },
    { id: 'sur', nombre: 'Farmacia Las 24 Horas', color: '#8B5CF6' },
];

export const DEFAULT_SEDE_ID = SEDES[0].id;


export function getVisibleSedes(usuario) {
    if (usuario?.rol === 'DUENO') return SEDES;
    return usuario?.sedeId
        ? SEDES.filter(sede => sede.id === usuario.sedeId)
        : [SEDES[0]];
}
