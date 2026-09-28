import { SEDES } from './sedes.js';

export const SYSTEM_BRAND = {
    name: 'Farma POS',
    logo: '/logos/farma-pos.png',
};

export function getBranding(sedeId) {
    const sede = SEDES.find(item => item.id === sedeId);
    return sede ? { name: sede.nombre, logo: sede.logo } : SYSTEM_BRAND;
}