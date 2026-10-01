import { X } from 'lucide-react';
import { useEscapeToClose } from '../hooks/useEscapeToClose';

// ─── Tokens visuales de modales (auditoría 2026-10-01) ───
// Backdrop y radio unificados; dos variantes de presentación:
// 'dialog' (centrado) y 'sheet' (bottom-sheet en móvil, centrado en sm+).
export const MODAL_BACKDROP = 'bg-slate-900/60 backdrop-blur-sm';
export const MODAL_VARIANT_STYLES = {
  dialog: {
    wrapper: 'items-center justify-center p-4',
    card: 'rounded-[2rem]',
  },
  sheet: {
    wrapper: 'items-end sm:items-center justify-center p-0 sm:p-4',
    card: 'rounded-t-[2rem] sm:rounded-[2rem]',
  },
};

export const Modal = ({ isOpen, onClose, title, children, className = '', variant = 'dialog' }) => {
  useEscapeToClose(onClose, isOpen);

  if (!isOpen) return null;

  const v = MODAL_VARIANT_STYLES[variant] || MODAL_VARIANT_STYLES.dialog;

  return (
    // ✅ z-[100] asegura que esté por encima de la barra de navegación (z-30)
    <div className={`fixed inset-0 z-[100] flex ${v.wrapper} animate-in fade-in duration-200`}>

      {/* Backdrop con desenfoque */}
      <div
        className={`absolute inset-0 ${MODAL_BACKDROP} transition-opacity`}
        onClick={onClose}
      />

      {/* Contenido del Modal */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`relative bg-white dark:bg-slate-900 w-full max-w-sm ${v.card} shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden animate-in zoom-in-95 duration-200 transition-all ${className}`}>

        {/* Cabecera */}
        <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
          <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">{title}</h3>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="modal-close bg-slate-200 dark:bg-slate-700 text-slate-500 hover:text-red-500 transition-colors"
          >
            <X size={16} strokeWidth={3} />
          </button>
        </div>

        {/* Body con Scroll Mejorado */}
        {/* ✅ CAMBIO: max-h-[85vh] para más espacio y pb-10 para margen inferior seguro */}
        <div className="p-6 max-h-[85vh] overflow-y-auto custom-scrollbar pb-10">
          {children}
        </div>
      </div>
    </div>
  );
};
