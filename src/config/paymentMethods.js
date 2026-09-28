import { storageService } from '../utils/storageService';
import { captureStorageContext } from './storageScope.js';
import { Banknote, Smartphone, CreditCard, DollarSign, Store, ShoppingCart, Package, Coins, Key, Fingerprint } from 'lucide-react';

const PM_KEY = 'bodega_payment_methods_v1';

// ── MÉTODOS DE FÁBRICA (no editables, no eliminables) ──
export const FACTORY_PAYMENT_METHODS = [
    // Bolívares
    { id: 'efectivo_bs', label: 'Efectivo en Bolívares', icon: '💵', Icon: Banknote, currency: 'BS', isFactory: true },
    { id: 'pago_movil', label: 'Pago Móvil', icon: '📱', Icon: Smartphone, currency: 'BS', isFactory: true },
    { id: 'punto_venta', label: 'Punto de Venta', icon: '💳', Icon: CreditCard, currency: 'BS', isFactory: true },
    // Dólares
    { id: 'efectivo_usd', label: 'Efectivo en Dólares', icon: '💲', Icon: DollarSign, currency: 'USD', isFactory: true },
    // Pesos
    { id: 'efectivo_cop', label: 'Efectivo en Pesos', icon: '🟡', Icon: Coins, currency: 'COP', isFactory: true },
    { id: 'transferencia_cop', label: 'Transferencia COP', icon: '🏦', Icon: Store, currency: 'COP', isFactory: true },
];

// Alias para compatibilidad
export const DEFAULT_PAYMENT_METHODS = FACTORY_PAYMENT_METHODS;

// ── PERSISTENCIA ──

/** Obtener TODOS los métodos (activos e inactivos) */
export async function getAllPaymentMethods(context = captureStorageContext()) {
    const saved = await storageService.getItem(PM_KEY, null, context) || [];

    // Si no hay nada guardado aún, devolver los de fábrica activos
    if (saved.length === 0) {
        return [...FACTORY_PAYMENT_METHODS].map(m => ({ ...m, isEnabled: true }));
    }

    // 1. Fusionar métodos de fábrica con la config guardada
    const mergedFactory = FACTORY_PAYMENT_METHODS.map(factoryMethod => {
        const savedMethod = saved.find(m => m.id === factoryMethod.id);
        return {
            ...factoryMethod,
            isEnabled: savedMethod ? savedMethod.isEnabled !== false : true,
        };
    });

    // 2. Extraer los métodos custom guardados y rehidratar el icono
    const customMethods = saved.filter(m => !m.isFactory).map(m => ({
        ...m,
        isEnabled: m.isEnabled !== false,
        Icon: ICON_COMPONENTS[m.icon] || null,
    }));

    return [...mergedFactory, ...customMethods];
}

/** Obtener métodos activos (fábrica + custom) para el Checkout */
export async function getActivePaymentMethods(context = captureStorageContext()) {
    const all = await getAllPaymentMethods(context);
    return all.filter(m => m.isEnabled !== false);
}

/** Guardar métodos (reemplaza todo el array) */
export async function savePaymentMethods(methods) {
    // Serializar: quitar campos no-clonables (Icon, componentes React)
    const serializable = methods.map(m => {
        const { Icon, ...rest } = m;
        return rest;
    });
    await storageService.setItem(PM_KEY, serializable);
    // Refresh in-memory cache immediately
    _customMethodsCache = serializable;
}

/** Agregar un método custom */
export async function addPaymentMethod({ label, currency, icon }) {
    const methods = await getAllPaymentMethods();
    const newMethod = {
        id: 'custom_' + Date.now(),
        label,
        icon: icon || (currency === 'USD' ? '💲' : '💵'),
        currency,
        isFactory: false,
    };
    methods.push(newMethod);
    await savePaymentMethods(methods);
    return methods;
}

/** Eliminar un método (solo custom, no fábrica) */
export async function removePaymentMethod(id) {
    const methods = await getAllPaymentMethods();
    const filtered = methods.filter(m => m.id !== id || m.isFactory);
    await savePaymentMethods(filtered);
    return filtered;
}

/** Habilitar/deshabilitar un método */
export async function togglePaymentMethodEnabled(id) {
    const methods = await getAllPaymentMethods();
    const updated = methods.map(m => {
        if (m.id === id) {
            return { ...m, isEnabled: m.isEnabled === false ? true : false };
        }
        return m;
    });
    await savePaymentMethods(updated);
    return await getAllPaymentMethods(); // Return correctly hydrated array
}

// ── HELPERS ──

export const toTitleCase = (str) => {
    if (!str) return '';
    return str.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
};

// In-memory cache for synchronous lookups (populated from IndexedDB)
let _customMethodsCache = null;
let _cacheInitPromise = null;

async function _initCache() {
    try {
        const saved = await storageService.getItem(PM_KEY, null);
        _customMethodsCache = saved || [];
    } catch (e) {
        _customMethodsCache = [];
    }
}

// Call this early in the app lifecycle to warm up the cache
export function initPaymentMethodsCache() {
    if (!_cacheInitPromise) {
        _cacheInitPromise = _initCache();
    }
    return _cacheInitPromise;
}

// Auto-init on module load
initPaymentMethodsCache();

function _findCustom(id) {
    if (!_customMethodsCache) return null;
    return _customMethodsCache.find(m => m.id === id) || null;
}

export const getPaymentLabel = (id, fallbackLabel) => {
    // Check factory methods first
    const factory = FACTORY_PAYMENT_METHODS.find(m => m.id === id);
    if (factory) return toTitleCase(factory.label);

    // Check in-memory cache (populated from IndexedDB)
    const custom = _findCustom(id);
    if (custom && custom.label) return toTitleCase(custom.label);
    
    // Virtual categories (not selectable, display-only)
    if (id === 'fiado') return 'Fiado (Por Cobrar)';

    // Use fallback if provided and it's not a raw ID
    if (fallbackLabel && fallbackLabel !== id && !fallbackLabel.startsWith('custom_')) {
        return toTitleCase(fallbackLabel);
    }

    if (id && id.startsWith('custom_')) return 'Metodo Personalizado';

    return toTitleCase(id);
};

export const getPaymentIcon = (id) => {
    // Check factory
    const factory = FACTORY_PAYMENT_METHODS.find(m => m.id === id);
    if (factory) return factory.Icon;

    // Check in-memory cache
    const custom = _findCustom(id);
    if (custom && custom.icon) return ICON_COMPONENTS[custom.icon] || null;
    
    return null;
};

// Icon lookup for React components
export const PAYMENT_ICONS = {
    efectivo_bs: Banknote,
    pago_movil: Smartphone,
    punto_venta: CreditCard,
    efectivo_usd: DollarSign,
    fiado: ShoppingCart,
};

// Mapa para rehidratar íconos custom por su key string
export const ICON_COMPONENTS = {
    Banknote, Smartphone, CreditCard, DollarSign,
    Store, ShoppingCart, Package, Coins, Key, Fingerprint,
};

export const getPaymentMethod = (id) => {
    const factory = FACTORY_PAYMENT_METHODS.find(m => m.id === id);
    if (factory) return factory;

    // Check in-memory cache
    const custom = _findCustom(id);
    if (custom) return { ...custom, Icon: ICON_COMPONENTS[custom.icon] || null };

    return FACTORY_PAYMENT_METHODS[0];
};

// Colores por método (para dashboard/historial)
export const PAYMENT_COLORS = {
    emerald: {
        active: 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20',
        text: 'text-emerald-600 dark:text-emerald-400',
        icon: 'text-emerald-500',
        bar: 'bg-emerald-500',
    },
    indigo: {
        active: 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/20',
        text: 'text-indigo-600 dark:text-indigo-400',
        icon: 'text-indigo-500',
        bar: 'bg-indigo-500',
    },
    violet: {
        active: 'border-violet-500 bg-violet-50 dark:bg-violet-900/20',
        text: 'text-violet-600 dark:text-violet-400',
        icon: 'text-violet-500',
        bar: 'bg-violet-500',
    },
    blue: {
        active: 'border-blue-500 bg-blue-50 dark:bg-blue-900/20',
        text: 'text-blue-600 dark:text-blue-400',
        icon: 'text-blue-500',
        bar: 'bg-blue-500',
    },
};
