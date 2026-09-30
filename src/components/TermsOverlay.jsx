import React, { useState, useRef } from 'react';
import { Check, FileText, ChevronDown } from 'lucide-react';

export default function TermsOverlay({ onAccepted }) {
    const [hasAccepted, setHasAccepted] = useState(
        () => localStorage.getItem('pda_terms_accepted') === 'true'
    );
    const [canAccept, setCanAccept] = useState(false);
    const scrollRef = useRef(null);

    const handleScroll = () => {
        const element = scrollRef.current;
        if (!element) return;
        const scrolledToBottom = Math.abs(element.scrollHeight - element.scrollTop - element.clientHeight) < 10;
        if (scrolledToBottom && !canAccept) setCanAccept(true);
    };

    const handleAccept = () => {
        localStorage.setItem('pda_terms_accepted', 'true');
        setHasAccepted(true);
        onAccepted?.();
    };

    if (hasAccepted) return null;

    return (
        <div className="fixed inset-0 z-[9999] bg-slate-950/95 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-300">
            <div className="w-full max-w-2xl bg-white rounded-[2rem] shadow-2xl overflow-hidden flex flex-col h-[85dvh] animate-in zoom-in-95 duration-500">

                {/* Header */}
                <div className="px-6 py-5 border-b border-slate-200 bg-slate-50 flex items-center gap-3">
                    <div className="p-2.5 bg-emerald-500 rounded-xl">
                        <FileText size={24} className="text-white" strokeWidth={2.5} />
                    </div>
                    <div>
                        <h2 className="text-xl font-black text-slate-900 tracking-tight">Términos y Condiciones</h2>
                        <p className="text-xs text-slate-500 font-medium">Por favor, lee y acepta para continuar</p>
                    </div>
                </div>

                {/* Scroll Indicator */}
                {!canAccept && (
                    <div className="px-6 py-3 bg-amber-50 border-b border-amber-100 flex items-center gap-2 animate-pulse">
                        <ChevronDown size={16} className="text-amber-600" />
                        <p className="text-xs font-bold text-amber-700">
                            Desplázate hasta el final para poder aceptar
                        </p>
                    </div>
                )}

                {/* Terms Content */}
                <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="flex-1 min-h-0 overflow-y-auto overscroll-contain touch-pan-y px-6 py-6 prose prose-sm max-w-none"
                    style={{ scrollbarWidth: 'thin', WebkitOverflowScrolling: 'touch' }}
                >
                    <h1 className="text-2xl font-black text-slate-900 mb-4">Términos y Condiciones de Uso - Farma POS</h1>
                    <p className="text-xs text-slate-500 font-bold mb-6">Última actualización: Febrero 2026</p>

                    <hr className="my-6" />

                    <h2 className="text-lg font-bold text-slate-900 mt-6 mb-3">1. Aceptación de los Términos</h2>
                    <p className="text-sm text-slate-700 leading-relaxed mb-4">
                        Al acceder y utilizar la aplicación <strong>Farma POS</strong> (en adelante, "la Aplicación"), usted acepta estar sujeto a estos Términos y Condiciones. Si no está de acuerdo con alguna parte de estos términos, no debe utilizar la Aplicación.
                    </p>

                    <h2 className="text-lg font-bold text-slate-900 mt-6 mb-3">2. Descripción del Servicio</h2>
                    <p className="text-sm text-slate-700 leading-relaxed mb-2">Farma POS es una aplicación web progresiva (PWA) diseñada para la gestión de bodegas y pequeños comercios que proporciona:</p>
                    <ul className="text-sm text-slate-700 space-y-1 mb-4">
                        <li><strong>Gestión de inventario</strong> con precios en múltiples monedas (USD, Bolívares)</li>
                        <li><strong>Punto de venta (POS)</strong> con carrito, checkout y recibos</li>
                        <li><strong>Dashboard de ventas</strong> con reportes y estadísticas</li>
                        <li><strong>Gestión de clientes</strong> con sistema de fiados y pagos parciales</li>                            <li><strong>Inventario por sede</strong> con ventas y reportes aislados para cada ubicación</li>
                    </ul>

                    <h2 className="text-lg font-bold text-slate-900 mt-6 mb-3">3. Descargo de Responsabilidad</h2>

                    <h3 className="text-base font-bold text-slate-800 mt-4 mb-2">3.1 Información No Vinculante</h3>
                    <p className="text-sm text-slate-700 leading-relaxed mb-4">
                        <strong className="text-red-600">TODA LA INFORMACIÓN PROPORCIONADA EN LA APLICACIÓN ES ESTRICTAMENTE INFORMATIVA Y DE REFERENCIA.</strong> Farma POS no garantiza la exactitud, integridad, vigencia o fiabilidad de las tasas de cambio, precios o cualquier otra información mostrada.
                    </p>

                    <h3 className="text-base font-bold text-slate-800 mt-4 mb-2">3.2 No Constituye Asesoría Financiera</h3>
                    <p className="text-sm text-slate-700 leading-relaxed mb-4">
                        La información provista <strong>NO constituye asesoría financiera, legal, tributaria o de inversión</strong>. Usted es responsable de verificar los precios y tasas con fuentes oficiales.
                    </p>

                    <h3 className="text-base font-bold text-slate-800 mt-4 mb-2">3.3 Limitación de Responsabilidad</h3>
                    <p className="text-sm text-slate-700 leading-relaxed mb-2"><strong>Farma POS y sus desarrolladores NO se hacen responsables por:</strong></p>
                    <ul className="text-sm text-slate-700 space-y-1 mb-4">
                        <li>Pérdidas económicas directas o indirectas derivadas del uso de la información</li>
                        <li>Errores en el cálculo de precios o conversiones de moneda</li>
                        <li>Decisiones comerciales tomadas con base en la información de la Aplicación</li>
                        <li>Pérdida de datos almacenados en el dispositivo</li>
                    </ul>

                    <h3 className="text-base font-bold text-slate-800 mt-4 mb-2">3.4 Uso Bajo Propio Riesgo</h3>
                    <p className="text-sm text-slate-700 leading-relaxed mb-4">
                        Al usar Farma POS, usted acepta que lo hace <strong>bajo su propio riesgo y responsabilidad</strong>.
                    </p>

                    <h2 className="text-lg font-bold text-slate-900 mt-6 mb-3">4. Funcionalidades Premium</h2>
                    <p className="text-sm text-slate-700 leading-relaxed mb-2">Farma POS ofrece funciones gratuitas y funciones exclusivas para usuarios con <strong>Licencia Premium</strong>:</p>
                    <ul className="text-sm text-slate-700 space-y-1 mb-2">
                        <li><strong>Gratuito:</strong> Dashboard básico, hasta 10 productos en inventario.</li>
                        <li><strong>Premium:</strong> Inventario ilimitado, sistema de ventas POS, gestión de clientes, compartir inventario, reportes completos.</li>
                    </ul>
                    <p className="text-sm text-slate-700 leading-relaxed mb-4">
                        El acceso Premium se otorga mediante código de activación único vinculado al dispositivo. La licencia es personal, intransferible y no reembolsable. Se ofrece un periodo de demostración de 7 días por dispositivo.
                    </p>

                    <h2 className="text-lg font-bold text-slate-900 mt-6 mb-3">5. Privacidad y Datos</h2>
                    <p className="text-sm text-slate-700 leading-relaxed mb-4">
                        Farma POS opera con principios de <strong>privacidad por diseño</strong>. Los datos se almacenan localmente en su dispositivo y <strong>NO se venden ni comparten con terceros</strong>.
                    </p>

                    <h2 className="text-lg font-bold text-slate-900 mt-6 mb-3">6. Legislación Aplicable</h2>
                    <p className="text-sm text-slate-700 leading-relaxed mb-4">
                        Estos Términos se rigen por las leyes de la <strong>República Bolivariana de Venezuela</strong>.
                    </p>

                    <h2 className="text-lg font-bold text-slate-900 mt-6 mb-3">7. Código de Conducta</h2>
                    <p className="text-sm text-slate-700 leading-relaxed mb-2">Al utilizar Farma POS, usted se compromete a:</p>
                    <ul className="text-sm text-slate-700 space-y-1 mb-4">
                        <li><strong>NO</strong> utilizar la Aplicación para actividades ilícitas</li>
                        <li><strong>NO</strong> intentar vulnerar la seguridad del sistema</li>
                        <li><strong>NO</strong> realizar ingeniería inversa del código</li>
                        <li><strong>NO</strong> distribuir licencias Premium de forma no autorizada</li>
                    </ul>

                    <hr className="my-6" />

                    <div className="bg-emerald-50 border-l-4 border-emerald-500 p-4 rounded-r-xl mb-6">
                        <h3 className="text-base font-black text-slate-900 mb-2">Aceptación Final</h3>
                        <p className="text-sm text-slate-700 leading-relaxed">
                            <strong>AL USAR FARMA POS, USTED DECLARA HABER LEÍDO, ENTENDIDO Y ACEPTADO ESTOS TÉRMINOS Y CONDICIONES EN SU TOTALIDAD.</strong>
                        </p>
                    </div>

                    <p className="text-center text-sm font-bold text-slate-900 mt-8 mb-4">
                        Farma POS - Gestión profesional por sede
                    </p>
                    <p className="text-center text-xs text-slate-500 mb-8">
                        Inventario, ventas, usuarios y reportes con control por sede
                    </p>

                    <div id="terms-end" className="h-1"></div>
                </div>

                {/* Footer with Accept Button */}
                <div className="px-6 py-4 border-t border-slate-200 bg-slate-50">
                    <button
                        onClick={handleAccept}
                        disabled={!canAccept}
                        className={`w-full py-4 rounded-xl font-bold text-sm transition-all shadow-lg flex items-center justify-center gap-2 ${canAccept
                            ? 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/20 active:scale-95'
                            : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            }`}
                    >
                        <Check size={20} strokeWidth={2.5} />
                        <span>{canAccept ? 'Acepto los Términos y Condiciones' : 'Lee hasta el final para aceptar'}</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
