import React, { useState } from 'react';
import { ShieldAlert, X } from 'lucide-react';

/**
 * Aviso persistente de PINs de fábrica (C3 adaptado — decisión 2026-09-28).
 *
 * Los PINs de fábrica ('0000' cajeros / '000000' dueño) siguen vigentes por
 * ahora para no bloquear la operación, pero este banner se muestra en cada
 * sesión mientras algún usuario activo conserve un PIN de fábrica, avisando
 * que hay que cambiarlos. Se puede ocultar por sesión; reaparece al
 * reingresar. Cuando se decida la rotación, eliminar los PINs de fábrica de
 * `src/config/userProvisioning.js` y forzar el cambio en el primer arranque.
 */
export default function FactoryPinBanner({ affectedNames = [], onGoToUsers }) {
    const [dismissed, setDismissed] = useState(false);
    if (dismissed || affectedNames.length === 0) return null;

    const names = affectedNames.slice(0, 3).join(', ');
    const extra = affectedNames.length > 3 ? ` y ${affectedNames.length - 3} más` : '';

    return (
        <div role="alert" className="shrink-0 mx-3 mt-2 rounded-2xl border-2 border-amber-400 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-600 p-3 flex items-start gap-3">
            <ShieldAlert size={22} className="shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
            <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900 dark:text-amber-200">
                    PIN de fábrica en uso — cámbialo cuanto antes
                </p>
                <p className="text-xs text-amber-800 dark:text-amber-300 mt-1">
                    {names}{extra} {affectedNames.length === 1 ? 'usa' : 'usan'} el PIN de fábrica
                    (0000 / 000000). Cualquiera que conozca la app puede entrar a tu caja.
                    Cambia los PINs en Ajustes → Usuarios.
                </p>
                {onGoToUsers && (
                    <button
                        type="button"
                        onClick={onGoToUsers}
                        className="mt-2 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-xs font-bold"
                    >
                        Cambiar PINs ahora
                    </button>
                )}
            </div>
            <button
                type="button"
                onClick={() => setDismissed(true)}
                aria-label="Ocultar aviso por esta sesión"
                className="shrink-0 p-1.5 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900 rounded-full"
            >
                <X size={16} />
            </button>
        </div>
    );
}
