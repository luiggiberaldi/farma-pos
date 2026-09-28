import React, { useState } from 'react';
import { Home, ShoppingCart, Store, Users, ChevronRight, ChevronLeft, X } from 'lucide-react';

const STEPS = [
    {
        type: 'welcome',
    },
    {
        icon: Home,
        color: 'text-emerald-500',
        bg: 'bg-emerald-100',
        title: 'Inicio',
        headline: 'Tu negocio de un vistazo',
        description: 'Dashboard con resumen de ventas del día, productos con stock bajo y accesos rápidos a todas las funciones.',
        tip: '💡 Las tasas de cambio se actualizan automáticamente para calcular precios en Bolívares.',
    },
    {
        icon: ShoppingCart,
        color: 'text-blue-500',
        bg: 'bg-blue-100',
        title: 'Vender',
        headline: 'Punto de venta rápido',
        description: 'Agrega productos al carrito, aplica descuentos y cobra en efectivo, pago móvil o transferencia. El sistema calcula automáticamente el precio en Bs.',
        tip: '💡 Toca + en un producto para agregarlo al carrito directamente.',
    },
    {
        icon: Store,
        color: 'text-indigo-500',
        bg: 'bg-indigo-100',
        title: 'Inventario',
        headline: 'Tu catálogo de productos',
        description: 'Gestiona tu inventario sin límites: crea, edita y organiza productos en categorías. Comparte tu catálogo con otros usando un código de 6 dígitos.',
        tip: '💡 Usa la búsqueda por voz para encontrar productos más rápido.',
    },
    {
        icon: Users,
        color: 'text-amber-500',
        bg: 'bg-amber-100',
        title: 'Clientes',
        headline: 'Gestiona tus clientes',
        description: 'Registra a tus clientes frecuentes, lleva control de fiados y pagos parciales. Todo offline y seguro.',
        tip: '💡 Toca un cliente para ver su historial completo de fiados.',
    },
];

export default function OnboardingOverlay() {
    const [done, setDone] = useState(
        () => localStorage.getItem('pda_onboarding_done') === 'true'
    );
    const [step, setStep] = useState(0);
    const [direction, setDirection] = useState(1);

    if (done) return null;

    const current = STEPS[step];
    const isFirst = step === 0;
    const isLast = step === STEPS.length - 1;
    const isWelcome = current.type === 'welcome';

    const finish = () => {
        localStorage.setItem('pda_onboarding_done', 'true');
        setDone(true);
    };

    const goNext = () => {
        if (isLast) { finish(); return; }
        setDirection(1);
        setStep(step + 1);
    };

    const goBack = () => {
        if (isFirst) return;
        setDirection(-1);
        setStep(step - 1);
    };

    return (
        <div className="fixed inset-0 z-[9998] bg-slate-950/95 backdrop-blur-md flex items-center justify-center p-5 animate-in fade-in duration-300 overflow-hidden">

            {/* Decorative background orbs */}
            <div className="absolute top-1/4 -left-20 w-64 h-64 bg-emerald-500/10 rounded-full blur-[100px] pointer-events-none animate-pulse" />
            <div className="absolute bottom-1/4 -right-20 w-64 h-64 bg-blue-500/10 rounded-full blur-[100px] pointer-events-none animate-pulse" style={{ animationDelay: '1s' }} />

            {/* Skip button */}
            <button
                onClick={finish}
                className="absolute top-6 right-6 text-slate-500 hover:text-white transition-colors flex items-center gap-1 text-xs font-bold uppercase tracking-wider z-10"
            >
                Omitir <X size={14} />
            </button>

            <div className="w-full max-w-sm">

                {/* Card */}
                <div
                    className="bg-white rounded-[2rem] shadow-2xl border border-slate-100 overflow-hidden"
                    key={step}
                    style={{
                        animation: `${direction > 0 ? 'slideInRight' : 'slideInLeft'} 0.3s ease-out`,
                    }}
                >
                    {isWelcome ? (
                        /* ─── WELCOME SLIDE ─── */
                        <div className="p-8 text-center relative overflow-hidden">
                            {/* Gradient header accent */}
                            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-emerald-400 via-emerald-500 to-emerald-400" />

                            {/* Logo */}
                            <div className="relative mx-auto mb-5">
                                <img
                                    src="/logos/farma-pos.png"
                                    alt="Farma POS"
                                    className="w-44 h-auto mx-auto drop-shadow-lg"
                                />
                                <div className="absolute inset-0 bg-emerald-500/15 rounded-full blur-2xl -z-10 scale-150" />
                            </div>
                            <p className="text-xs font-bold text-emerald-500 uppercase tracking-[0.2em] mb-5">
                                Tu negocio, resuelto
                            </p>

                            <p className="text-sm text-slate-500 leading-relaxed mb-6 max-w-[260px] mx-auto">
                                Inventario, ventas y gestión de clientes en una sola app, para cualquier tipo de negocio.
                            </p>

                            {/* Feature pills */}
                            <div className="flex flex-wrap justify-center gap-2 mb-2">
                                {['Inventario', 'Punto de Venta', 'Clientes', 'Reportes'].map(label => (
                                    <span key={label} className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 px-3 py-1.5 rounded-full">
                                        {label}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ) : (
                        /* ─── FEATURE SLIDES ─── */
                        <div className="p-8">
                            {/* Icon */}
                            <div className={`w-16 h-16 rounded-2xl ${current.bg} flex items-center justify-center mx-auto mb-5`}>
                                <current.icon size={32} className={current.color} strokeWidth={2} />
                            </div>

                            {/* Step label */}
                            <p className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400 text-center mb-1">
                                {current.title}
                            </p>

                            {/* Headline */}
                            <h2 className="text-xl font-black text-slate-900 text-center mb-3 leading-tight">
                                {current.headline}
                            </h2>

                            {/* Description */}
                            <p className="text-sm text-slate-500 text-center leading-relaxed mb-4">
                                {current.description}
                            </p>

                            {/* Tip */}
                            <div className="bg-slate-50 rounded-xl px-4 py-3 border border-slate-100">
                                <p className="text-xs text-slate-600 font-medium text-center">
                                    {current.tip}
                                </p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Navigation */}
                <div className="flex items-center justify-between mt-6 px-2">
                    {!isFirst ? (
                        <button
                            onClick={goBack}
                            className="flex items-center gap-1 text-slate-400 hover:text-white transition-colors px-3 py-3 rounded-full text-sm font-bold"
                        >
                            <ChevronLeft size={16} strokeWidth={3} />
                            <span>Atrás</span>
                        </button>
                    ) : (
                        <div className="w-20" />
                    )}

                    {/* Dots */}
                    <div className="flex gap-2">
                        {STEPS.map((_, i) => (
                            <div
                                key={i}
                                className={`h-2 rounded-full transition-all duration-300 ${i === step
                                    ? 'w-6 bg-emerald-500'
                                    : i < step
                                        ? 'w-2 bg-emerald-500/40'
                                        : 'w-2 bg-slate-600'
                                    }`}
                            />
                        ))}
                    </div>

                    {/* Button */}
                    <button
                        onClick={goNext}
                        className="flex items-center gap-2 bg-emerald-500 text-white px-5 py-3 rounded-full font-bold text-sm shadow-lg shadow-emerald-500/20 active:scale-95 transition-transform"
                    >
                        <span>{isLast ? '¡Empezar!' : isWelcome ? 'Inicio' : 'Siguiente'}</span>
                        {!isLast && <ChevronRight size={16} strokeWidth={3} />}
                    </button>
                </div>
            </div>

            {/* Slide animations */}
            <style>{`
                @keyframes slideInRight {
                    from { opacity: 0; transform: translateX(30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                @keyframes slideInLeft {
                    from { opacity: 0; transform: translateX(-30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
            `}</style>
        </div>
    );
}
