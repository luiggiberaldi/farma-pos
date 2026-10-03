import { useState } from 'react';
import { Users } from 'lucide-react';
import { useAuthStore } from '../../hooks/store/useAuthStore.js';
import { useSedeStore } from '../../hooks/store/useSedeStore.js';
import { Modal } from '../Modal.jsx';
import UserCard from './UserCard.jsx';
import LoginPinModal from './LoginPinModal.jsx';
import { showToast } from '../Toast.js';

// Hoja cuenta → PIN reutilizable (patrón JustClick). La cuenta se elige
// primero y el PIN se verifica contra ESA cuenta (verifyPin liga PIN+id).
// Sirve para:
// - cambio rápido de operador (la vista no se desmonta: el carrito se conserva)
// - override del dueño (descuento ya existía; anulación de venta es nueva)
function AccountPinSheet({ isOpen, onClose, title, subtitle, approversOnly, pinPurpose, onSubmitPin }) {
    const usuarios = useAuthStore(s => s.usuarios);
    const selectedSedeId = useSedeStore(s => s.sedeActivaId);
    const [pinUser, setPinUser] = useState(null);
    const visible = usuarios.filter(u => approversOnly
        ? (u.rol === 'DUENO' && u.pin)
        : (u.rol === 'DUENO' || u.sedeId === selectedSedeId));

    const close = () => { setPinUser(null); onClose(); };
    const handleSubmit = async (pin, userId) => {
        const result = await onSubmitPin(pin, userId);
        if (result) setPinUser(null);
        return result;
    };

    return (
        <>
            <Modal isOpen={isOpen && !pinUser} onClose={close} title={title} variant="sheet" className="max-w-md">
                {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">{subtitle}</p>}
                {visible.length === 0 && (
                    <p className="text-sm text-slate-500 text-center py-6">No hay operadores disponibles.</p>
                )}
                <div className="grid grid-cols-2 gap-3">
                    {visible.map(u => (
                        <UserCard key={u.id} user={u} onClick={() => setPinUser(u)} />
                    ))}
                </div>
            </Modal>
            <LoginPinModal
                isOpen={!!pinUser}
                onClose={() => setPinUser(null)}
                user={pinUser}
                purpose={pinPurpose}
                onSubmit={handleSubmit}
            />
        </>
    );
}

// Cambio rápido de operador: el cajero conserva sesión y carrito.
export function OperatorSwitchSheet({ isOpen, onClose }) {
    const login = useAuthStore(s => s.login);
    const handleSubmit = async (pin, userId) => {
        let ok = false;
        try {
            ok = await login(pin, userId);
        } catch (error) {
            showToast(error?.message || 'No se pudo cambiar de operador.', 'error');
            return false;
        }
        if (ok) {
            onClose();
            return true;
        }
        return false;
    };
    return (
        <AccountPinSheet
            isOpen={isOpen}
            onClose={onClose}
            title="Cambiar operador"
            subtitle="Elige tu cuenta e ingresa tu PIN. El carrito y la venta en curso se conservan."
            pinPurpose="login"
            onSubmitPin={handleSubmit}
        />
    );
}

// Override del dueño: un dueño ingresa SU pin para autorizar una acción
// del operador en curso (descuento, anulación). El operador no cambia.
export function OwnerOverrideSheet({ isOpen, onClose, action, details, onApproved, title = 'Autorización del dueño' }) {
    const issueApproval = useAuthStore(s => s.issueApproval);
    const consumeApproval = useAuthStore(s => s.consumeApproval);
    const handleSubmit = async (pin, userId) => {
        const proof = await issueApproval(pin, userId, { action, details });
        if (!proof) return false;
        try {
            const validated = consumeApproval(proof.id, action, details);
            onClose();
            onApproved(validated);
            return true;
        } catch {
            return false;
        }
    };
    return (
        <AccountPinSheet
            isOpen={isOpen}
            onClose={onClose}
            title={title}
            subtitle="Un dueño debe ingresar su PIN para autorizar esta acción. Tu sesión y tu carrito no cambian."
            approversOnly
            pinPurpose="override"
            onSubmitPin={handleSubmit}
        />
    );
}

export function OperatorChipButton({ onClick }) {
    const usuarioActivo = useAuthStore(s => s.usuarioActivo);
    if (!usuarioActivo) return null;
    return (
        <button
            type="button"
            onClick={onClick}
            title="Cambiar operador"
            aria-label={`Operador en turno: ${usuarioActivo.nombre}. Toca para cambiar.`}
            className="flex items-center gap-1.5 min-h-[44px] sm:min-h-[40px] pl-1.5 pr-2.5 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 active:scale-95 transition-transform"
        >
            <span className="w-7 h-7 rounded-full bg-teal-500 text-white text-xs font-black flex items-center justify-center shrink-0">
                {usuarioActivo.nombre?.charAt(0)?.toUpperCase() || '?'}
            </span>
            <span className="text-[11px] font-black text-slate-600 dark:text-slate-300 max-w-[90px] truncate">
                {usuarioActivo.nombre?.split(' ')[0]}
            </span>
            <Users size={12} className="text-slate-400 shrink-0" />
        </button>
    );
}
