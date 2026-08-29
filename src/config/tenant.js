// src/config/tenant.js

export const TENANTS = {
    FARMACIA: 'FARMACIA',   // Farmacia multi-sede con lotes/vencimientos (activo)
    REVENDEDOR: 'REVENDEDOR',
    BODEGA: 'BODEGA',         // Maneja stock, balanzas, cobro rápido
    COMIDA: 'COMIDA',         // Modificadores, comandas, facturación rápida
    REPUESTOS: 'REPUESTOS',   // SKU complejo, número de parte, vehículos
    QUINCALLERIA: 'QUINCALLERIA' // Mayor vs Detal
};

// -------------------------------------------------------------
// [CONFIGURACIÓN ACTIVA] -> Farmacia César (multi-sede)
// -------------------------------------------------------------
export const ACTIVE_TENANT = TENANTS.FARMACIA;

// Configuración de metadatos globales de la UI dependiendo del MVP
export const getTenantTheme = () => {
    switch (ACTIVE_TENANT) {
        case TENANTS.FARMACIA:
            return {
                appName: 'Farmacia César',
                tagline: 'POS Multi-Sede',
                primaryColor: 'primary', // Verde farmacéutico definido en tailwind.config
                themeMode: 'light',
                features: {
                    hasInventoryTracking: true,   // Stock por sede
                    hasWeightScale: false,
                    hasSku: true,                 // Código de barras de medicamento
                    hasLotes: true,               // Lotes + vencimientos (FEFO)
                    hasRecetas: true,             // Productos que requieren receta
                    hasControlados: true,         // Libro de medicamentos controlados
                    hasMultiSede: true            // Central / Norte / Sur
                }
            };
        case TENANTS.BODEGA:
            return {
                appName: 'Mi Bodega Inteligente',
                primaryColor: 'emerald',
                themeMode: 'light',
                features: {
                    hasInventoryTracking: true,
                    hasWeightScale: true,
                    hasSku: false
                }
            };
        case TENANTS.COMIDA:
            return {
                appName: 'Comanda Express',
                primaryColor: 'orange',
                themeMode: 'dark',
                features: {
                    hasModifiers: true,
                    hasTables: true,
                    hasSku: false
                }
            };
        case TENANTS.REPUESTOS:
            return {
                appName: 'AutoParts Pro',
                primaryColor: 'blue',
                themeMode: 'light',
                features: {
                    hasInventoryTracking: true,
                    hasWeightScale: false,
                    hasSku: true
                }
            };
        case TENANTS.REVENDEDOR:
        default:
            return {
                appName: 'Farmacia César',
                primaryColor: 'primary',
                themeMode: 'light',
                features: {
                    hasInventoryTracking: false,
                    hasWeightScale: false,
                    hasSku: false
                }
            };
    }
};

export const tenantConfig = getTenantTheme();
