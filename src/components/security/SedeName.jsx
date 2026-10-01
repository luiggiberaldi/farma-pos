import { parseSedeNombre } from '../../utils/operatorLockPolicy.js';

const SIZES = {
    xs: { base: 'text-[10px]', chip: 'text-[9px] px-1.5 py-px' },
    sm: { base: 'text-xs', chip: 'text-[10px] px-1.5 py-px' },
    md: { base: 'text-sm', chip: 'text-xs px-2 py-0.5' },
};

// Nombre de sede con el año siempre visible como chip enfatizado
// (ajuste 2: "C&Y 2025" vs "C&Y 2026" solo se distinguen por el año).
export default function SedeName({ nombre, size = 'md', className = '' }) {
    const { base, year } = parseSedeNombre(nombre);
    const s = SIZES[size] || SIZES.md;
    return (
        <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>
            <span className={`font-black tracking-tight ${s.base}`}>{base}</span>
            {year && (
                <span className={`font-black rounded-md bg-amber-400/90 text-amber-950 dark:bg-amber-400/20 dark:text-amber-300 border border-amber-500/40 ${s.chip}`}>
                    {year}
                </span>
            )}
        </span>
    );
}
