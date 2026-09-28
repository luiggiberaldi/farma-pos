import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';

export default function ProfessionalSelect({ value, onChange, options, placeholder = 'Seleccionar', className = '', ariaLabel, compact = false }) {
    const [open, setOpen] = useState(false);
    const [activeIndex, setActiveIndex] = useState(() => Math.max(0, options.findIndex(option => option.value === value)));
    const rootRef = useRef(null);
    const selected = options.find(option => option.value === value);

    useEffect(() => {
        const close = event => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('mousedown', close);
        return () => document.removeEventListener('mousedown', close);
    }, []);

    const choose = option => {
        onChange(option.value);
        setOpen(false);
    };

    const handleKeyDown = event => {
        if (event.key === 'Escape') return setOpen(false);
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (open && options[activeIndex]) choose(options[activeIndex]);
            else setOpen(true);
        }
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault();
            setOpen(true);
            setActiveIndex(index => event.key === 'ArrowDown'
                ? Math.min(options.length - 1, index + 1)
                : Math.max(0, index - 1));
        }
    };

    return (
        <div ref={rootRef} className={`relative ${className}`}>
            <button
                type="button"
                aria-label={ariaLabel}
                aria-haspopup="listbox"
                aria-expanded={open}
                onClick={() => {
                    setActiveIndex(Math.max(0, options.findIndex(option => option.value === value)));
                    setOpen(current => !current);
                }}
                onKeyDown={handleKeyDown}
                className={`flex items-center justify-between rounded-xl border border-slate-200 bg-white text-left font-bold text-slate-700 shadow-sm outline-none transition-all hover:border-slate-300 focus:border-brand focus:ring-2 focus:ring-brand/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 ${compact ? 'gap-2 px-2.5 py-2 text-xs' : 'w-full gap-3 px-3 py-2.5 text-sm'}`}
            >
                <span className={selected ? '' : 'text-slate-400'}>{compact ? (selected?.label === 'Gestión' ? 'Gestión' : 'Caja') : (selected?.label || placeholder)}</span>
                <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div role="listbox" className={`absolute left-0 z-[180] mt-1 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-900 ${compact ? 'w-28' : 'right-0'}`}>
                    {options.map((option, index) => (
                        <button
                            type="button"
                            role="option"
                            aria-selected={option.value === value}
                            key={option.value}
                            onMouseEnter={() => setActiveIndex(index)}
                            onClick={() => choose(option)}
                            className={`flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${index === activeIndex ? 'bg-slate-100 text-slate-900 dark:bg-slate-800 dark:text-white' : 'text-slate-600 dark:text-slate-300'} ${option.value === value ? 'font-black text-brand' : 'font-medium'}`}
                        >
                            <span>{option.label}</span>
                            {option.value === value && <Check size={15} className="text-brand" />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
