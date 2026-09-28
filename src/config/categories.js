import {
    LayoutGrid, Package, Pill, Thermometer, HeartPulse,
    Droplets, ShieldPlus, Baby, Wind, Activity,
    Droplet, Eye, Citrus, FlaskConical, Bug, Cross
} from 'lucide-react';

// Categorías farmacéuticas predefinidas para el Inventario
export const BODEGA_CATEGORIES = [
    { id: 'todos', label: 'Todos', icon: '◉', color: 'slate' },
    // --- Farmacia ---
    { id: 'analgesicos', label: 'Analgésicos', icon: 'pill', color: 'red' },
    { id: 'antibioticos', label: 'Antibióticos', icon: 'shield-plus', color: 'blue' },
    { id: 'antipireticos', label: 'Antipiréticos', icon: 'thermometer', color: 'orange' },
    { id: 'antiinflamatorios', label: 'Antiinflamatorios', icon: 'activity', color: 'amber' },
    { id: 'antihistaminicos', label: 'Antihistamínicos', icon: 'wind', color: 'cyan' },
    { id: 'gastrointestinal', label: 'Gastrointestinal', icon: 'flask-conical', color: 'green' },
    { id: 'vitaminas', label: 'Vitaminas', icon: 'citrus', color: 'yellow' },
    { id: 'cardiovascular', label: 'Cardiovascular', icon: 'heart-pulse', color: 'red' },
    { id: 'respiratorio', label: 'Respiratorio', icon: 'wind', color: 'sky' },
    { id: 'antiparasitarios', label: 'Antiparasitarios', icon: 'bug', color: 'amber' },
    { id: 'cuidado-personal', label: 'Cuidado Personal', icon: 'droplets', color: 'cyan' },
    { id: 'primeros-auxilios', label: 'Primeros Auxilios', icon: 'cross', color: 'red' },
    { id: 'materno-infantil', label: 'Materno Infantil', icon: 'baby', color: 'pink' },
    { id: 'dermatologicos', label: 'Dermatológicos', icon: 'droplet', color: 'violet' },
    { id: 'oftalmologicos', label: 'Oftalmológicos', icon: 'eye', color: 'blue' },
    { id: 'otros', label: 'Otros', icon: 'package', color: 'gray' },
];

// Lucide icon map for factory categories
export const CATEGORY_ICONS = {
    todos: LayoutGrid,
    analgesicos: Pill,
    antibioticos: ShieldPlus,
    antipireticos: Thermometer,
    antiinflamatorios: Activity,
    antihistaminicos: Wind,
    gastrointestinal: FlaskConical,
    vitaminas: Citrus,
    cardiovascular: HeartPulse,
    respiratorio: Wind,
    antiparasitarios: Bug,
    'cuidado-personal': Droplets,
    'primeros-auxilios': Cross,
    'materno-infantil': Baby,
    dermatologicos: Droplet,
    oftalmologicos: Eye,
    otros: Package,
};

export const UNITS = [
    { id: 'unidad', label: 'Unidad', short: 'uni' },
    { id: 'paquete', label: 'Caja/Bulto', short: 'cja' },
    { id: 'kg', label: 'Kilogramo', short: 'kg' },
    { id: 'litro', label: 'Litro', short: 'lt' },
];

// Colores de Tailwind para las pastillas de categoría
export const CATEGORY_COLORS = {
    blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
    cyan: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400',
    amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',
    orange: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
    yellow: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
    slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700/30 dark:text-slate-400',
    red: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
    green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
    gray: 'bg-gray-100 text-gray-600 dark:bg-gray-800/30 dark:text-gray-400',
    sky: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400',
    pink: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400',
    violet: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400',
};
