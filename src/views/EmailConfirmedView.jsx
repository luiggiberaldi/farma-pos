import React, { useEffect } from 'react';
import { CheckCircle, LogIn, ShieldCheck } from 'lucide-react';
import { supabaseCloud } from '../config/supabaseCloud';
import { signOutCloudAccount } from '../services/cloudSessionLifecycle.js';
import { SYSTEM_BRAND } from '../config/branding';

export default function EmailConfirmedView({ onDone }) {
    // Cerramos la sesión de confirmación para que el usuario inicie sesión manualmente
    useEffect(() => {
        signOutCloudAccount(supabaseCloud).catch(() => {});
        // Limpiar el hash de la URL sin recargar la página
        window.history.replaceState({}, document.title, window.location.pathname);
    }, []);

    return (
        <div className="fixed inset-0 z-[300] bg-white flex items-center justify-center p-6 font-sans">
            {/* Glow de fondo */}
            <div className="absolute inset-0 pointer-events-none overflow-hidden">
                <div className="absolute -top-32 -left-32 w-96 h-96 bg-sky-500/10 rounded-full blur-[100px]" />
                <div className="absolute -bottom-32 -right-32 w-96 h-96 bg-teal-400/10 rounded-full blur-[100px]" />
            </div>

            <div className="relative w-full max-w-sm animate-in slide-in-from-bottom-6 duration-300 flex flex-col items-center text-center">
                {/* Logo */}
                <img
                    src={SYSTEM_BRAND.logo}
                    alt="Farma POS"
                    className="h-24 w-auto object-contain select-none mb-8"
                    draggable={false}
                />

                {/* Ícono de éxito */}
                <div className="w-20 h-20 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-full flex items-center justify-center mb-6 shadow-xl shadow-emerald-500/20">
                    <CheckCircle size={40} className="text-white" />
                </div>

                <h1 className="text-2xl font-black text-slate-800 mb-2">
                    ¡Correo verificado!
                </h1>
                <p className="text-slate-500 text-sm leading-relaxed mb-8 max-w-xs">
                    Tu cuenta en <strong className="text-slate-700">Farma POS</strong> está activa.
                    Inicia sesión para empezar a usar tu negocio en la nube.
                </p>

                {/* Indicador de seguridad */}
                <div className="flex items-center gap-2 text-xs text-sky-600 font-semibold bg-sky-50 border border-sky-100 rounded-xl px-4 py-2.5 mb-8">
                    <ShieldCheck size={14} />
                    Cuenta protegida y lista para sincronizar
                </div>

                {/* Botón */}
                <button
                    onClick={onDone}
                    className="w-full py-4 text-white text-sm font-black rounded-2xl transition-all shadow-lg shadow-sky-500/20 active:scale-[0.98] flex items-center justify-center gap-2"
                    style={{ background: 'linear-gradient(135deg, #0B8D63, #6FD9B8)' }}
                >
                    <LogIn size={17} strokeWidth={2.5} />
                    Iniciar sesión
                </button>
            </div>
        </div>
    );
}
