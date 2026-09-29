export const SEDES = [
    { id: 'central', nombre: 'C&Y 2025', color: '#0B8D63', logo: '/logos/casa-medica-2025.png' },
    { id: 'norte', nombre: 'C&Y 2026', color: '#0066CC', logo: '/logos/casa-medica-2026.png' },
    { id: 'sur', nombre: 'Farmacia Las 24 Horas', color: '#8B5CF6', logo: '/logos/farmacia-24horas.png' },
];

export const DEFAULT_SEDE_ID = SEDES[0].id;


export function getVisibleSedes(usuario) {
    if (usuario?.rol === 'DUENO') return SEDES;
    return usuario?.rol === 'CAJERO' && usuario?.sedeId
        ? SEDES.filter(sede => sede.id === usuario.sedeId)
        : [];
}
