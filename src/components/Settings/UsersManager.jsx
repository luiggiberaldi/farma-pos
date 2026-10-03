import React, { useState } from 'react';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { showToast } from '../Toast';
import { isPinlessOptedIn, setPinlessOptIn } from '../../utils/operatorSession.js';
import { captureStorageContext } from '../../config/storageScope.js';
import { useConfirm } from '../../hooks/confirmState';
import {
    UserPlus, Trash2, KeyRound, ShoppingCart,
    Crown, X, Check, Eye, EyeOff, Edit2, Fingerprint, LockOpen
} from 'lucide-react';

const ROLE_CONFIG = {
    DUENO: {
        label: 'Dueño',
        gradient: 'from-amber-500 to-orange-500',
        bg: 'bg-amber-50 dark:bg-amber-900/20',
        text: 'text-amber-600 dark:text-amber-400',
        border: 'border-amber-200 dark:border-amber-800/40',
        icon: Crown,
    },
    CAJERO: {
        label: 'Cajero',
        gradient: 'from-emerald-500 to-teal-500',
        bg: 'bg-emerald-50 dark:bg-emerald-900/20',
        text: 'text-emerald-600 dark:text-emerald-400',
        border: 'border-emerald-200 dark:border-emerald-800/40',
        icon: ShoppingCart,
    }
};

// ─── PIN Length by role ───────────────────────────
const getPinLength = (rol) => rol === 'DUENO' ? 6 : 4;

// ─── PIN Input (4 or 6 digits) ─────────────────────────
function PinInput({ value, onChange, label, length = 4 }) {
    const digits = (value || '').padEnd(length, '').slice(0, length).split('');

    const handleChange = (index, digit) => {
        if (!/^\d?$/.test(digit)) return;
        const newDigits = [...digits];
        newDigits[index] = digit;
        onChange(newDigits.join('').replace(/ /g, ''));

        // Auto-focus next
        if (digit && index < length - 1) {
            const next = document.getElementById(`pin-${label}-${index + 1}`);
            next?.focus();
        }
    };

    const handleKeyDown = (index, e) => {
        if (e.key === 'Backspace' && !digits[index] && index > 0) {
            const prev = document.getElementById(`pin-${label}-${index - 1}`);
            prev?.focus();
        }
    };

    return (
        <div className="flex gap-2 justify-center">
            {Array.from({ length }).map((_, i) => (
                <input
                    key={i}
                    id={`pin-${label}-${i}`}
                    aria-label={`${label}: dígito ${i + 1}`}
                    type="password"
                    inputMode="numeric"
                    maxLength={1}
                    value={digits[i]?.trim() || ''}
                    onChange={e => handleChange(i, e.target.value)}
                    onKeyDown={e => handleKeyDown(i, e)}
                    className="w-12 h-14 text-center text-xl font-black bg-slate-50 dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 rounded-xl focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/30 outline-none text-slate-800 dark:text-white transition-all"
                />
            ))}
        </div>
    );
}

// ─── User Row ──────────────────────────────────────
function UserRow({ user, currentUserId, onChangePin, onRemovePin, onDelete, onEditName, triggerHaptic }) {
    const roleConf = ROLE_CONFIG[user.rol] || ROLE_CONFIG.CAJERO;
    const RoleIcon = roleConf.icon;
    const isCurrentUser = user.id === currentUserId;
    const isOwner = user.rol === 'DUENO';
    const hasPin = !(user.sinPin === true && !user.pin);
    // A10: el acceso sin PIN requiere opt-in explícito del dueño en este equipo.
    const canOptInPinless = user.rol === 'CAJERO' && user.sinPin === true && !user.pin;
    const [pinlessOn, setPinlessOn] = useState(() => canOptInPinless && isPinlessOptedIn(user.id));
    const togglePinless = () => {
        const next = !pinlessOn;
        setPinlessOptIn(user.id, captureStorageContext(), next);
        setPinlessOn(next);
        triggerHaptic?.();
        showToast(next
            ? `Acceso sin PIN activado para ${user.nombre} en este equipo`
            : `Acceso sin PIN desactivado para ${user.nombre}`, next ? 'success' : 'info');
    };

    return (
        <div className={`flex items-center gap-2.5 sm:gap-3 p-2.5 sm:p-3 rounded-xl border transition-all ${isCurrentUser ? 'bg-indigo-50/50 dark:bg-indigo-900/10 border-indigo-200/50 dark:border-indigo-800/30' : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'}`}>
            {/* Avatar */}
            <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-gradient-to-br ${roleConf.gradient} flex items-center justify-center shrink-0 shadow-sm relative`}>
                <span className="text-white font-black text-base sm:text-lg">{(user.nombre || 'U')[0].toUpperCase()}</span>
                {isOwner && (
                    <div className="absolute -top-2 left-1/2 -translate-x-1/2">
                        <Crown size={12} className="text-yellow-400 fill-yellow-400 drop-shadow-sm" />
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                    <p className="text-[13px] sm:text-sm font-bold text-slate-800 dark:text-white line-clamp-2 leading-snug">{user.nombre}</p>
                    {isCurrentUser && (
                        <span className="text-[8px] font-black uppercase tracking-wider bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 px-1.5 py-0.5 rounded-full shrink-0">Tu</span>
                    )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                    <RoleIcon size={10} className={roleConf.text} />
                    <span className={`text-[9px] font-black uppercase tracking-wider ${roleConf.text}`}>
                        {roleConf.label}
                    </span>
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-0.5 sm:gap-1 shrink-0">
                {canOptInPinless && (
                    <button
                        onClick={togglePinless}
                        title={pinlessOn ? 'Desactivar acceso sin PIN en este equipo' : 'Permitir acceso sin PIN en este equipo (solo el dueño)'}
                        className={`p-2 rounded-lg transition-all active:scale-90 ${pinlessOn
                            ? 'text-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                            : 'text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-emerald-900/20'}`}
                    >
                        <Fingerprint size={16} />
                    </button>
                )}
                <button
                    onClick={() => { triggerHaptic?.(); onChangePin(user); }}
                    className="p-2 rounded-lg text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-all active:scale-90"
                    title="Cambiar PIN"
                >
                    <KeyRound size={16} />
                </button>
                {!isOwner && hasPin && (
                    <button
                        onClick={() => { triggerHaptic?.(); onRemovePin(user); }}
                        className="p-2 rounded-lg text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-all active:scale-90"
                        title="Quitar PIN (permitir acceso sin PIN)"
                    >
                        <LockOpen size={16} />
                    </button>
                )}
                <button
                    onClick={() => { triggerHaptic?.(); onEditName(user); }}
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all active:scale-90"
                    title="Editar Nombre"
                >
                    <Edit2 size={16} />
                </button>
                {!user.permanente && user.id !== 1 && !isCurrentUser && (
                    <button
                        onClick={() => { triggerHaptic?.(); onDelete(user); }}
                        className="p-2 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-all active:scale-90"
                        title="Eliminar"
                    >
                        <Trash2 size={16} />
                    </button>
                )}
            </div>
        </div>
    );
}

// ═══════════════════════════════════════════════════ MAIN
export default function UsersManager({ triggerHaptic }) {
    const { usuarios, usuarioActivo, agregarUsuario, eliminarUsuario, cambiarPin, quitarPin, editarUsuario, requireLogin } = useAuthStore();
    const confirm = useConfirm();

    // States
    const [showAddForm, setShowAddForm] = useState(false);
    const [newName, setNewName] = useState('');
    const [newRole, setNewRole] = useState('CAJERO');
    const [newPin, setNewPin] = useState('');
    const [newSedeId, setNewSedeId] = useState('central');

    const [changePinUser, setChangePinUser] = useState(null);
    const [pinValue, setPinValue] = useState('');
    const [showPin, setShowPin] = useState(false);

    const [editNameUser, setEditNameUser] = useState(null);
    const [editNameValue, setEditNameValue] = useState('');

    // ─── Handlers ────────────────────────────────────
    const handleAdd = async () => {
        if (!newName.trim()) return showToast('Ingresa un nombre', 'error');
        try {
            await agregarUsuario(newName.trim(), newRole, newPin, newSedeId);
            showToast(`Usuario "${newName.trim()}" creado`, 'success');
            triggerHaptic?.();
            setNewName(''); setNewRole('CAJERO'); setNewPin(''); setNewSedeId('central'); setShowAddForm(false);
        } catch (error) { showToast(error.message || 'No se pudo crear el usuario.', 'error'); }
    };

    const handleChangePin = async () => {
        if (!changePinUser) return;
        try {
            await cambiarPin(changePinUser.id, pinValue);
            showToast(`PIN de ${changePinUser.nombre} actualizado`, 'success');
            triggerHaptic?.(); setChangePinUser(null); setPinValue('');
        } catch (error) { showToast(error.message || 'No se pudo cambiar el PIN.', 'error'); }
    };

    const handleDeleteRequest = async (user) => {
        if (!user) return;
        const ok = await confirm({
            title: 'Eliminar Usuario',
            message: `¿Seguro que deseas eliminar a "${user.nombre}"? Esta acción no se puede deshacer.`,
            confirmText: 'Sí, eliminar',
            variant: 'danger',
        });
        if (!ok) return;
        try {
            const result = eliminarUsuario(user.id);
            if (result === false) showToast('No se puede eliminar este usuario', 'error');
            else { showToast(`"${user.nombre}" eliminado`, 'success'); triggerHaptic?.(); }
        } catch (error) { showToast(error.message || 'No se pudo eliminar el usuario.', 'error'); }
    };

    const handleRemovePinRequest = async (user) => {
        if (!user) return;
        const ok = await confirm({
            title: 'Quitar PIN',
            message: `"${user.nombre}" quedará sin PIN. Para que pueda entrar sin PIN debes además autorizarlo en este equipo con el botón de huella.` +
                (requireLogin ? '\n\n"Pedir PIN al iniciar" está activado: aunque le quites el PIN, este cajero no podrá entrar hasta desactivarlo.' : ''),
            confirmText: 'Quitar PIN',
            variant: 'warning',
        });
        if (!ok) return;
        try {
            await quitarPin(user.id);
            showToast(`PIN eliminado: ${user.nombre} quedó sin PIN`, 'success');
            triggerHaptic?.();
        } catch (error) { showToast(error.message || 'No se pudo quitar el PIN.', 'error'); }
    };

    const handleEditName = () => {
        if (!editNameValue.trim()) return showToast('Ingresa un nombre válido', 'error');
        try {
            editarUsuario(editNameUser.id, { nombre: editNameValue.trim() });
            showToast(`Nombre actualizado a ${editNameValue.trim()}`, 'success');
            triggerHaptic?.(); setEditNameUser(null); setEditNameValue('');
        } catch (error) { showToast(error.message || 'No se pudo actualizar el nombre.', 'error'); }
    };

    if (usuarioActivo?.rol !== 'DUENO') return <p className="p-3 text-sm text-slate-500">Solo el dueño administra usuarios y sus PIN.</p>;
    return (
        <div className="space-y-4">
            {/* User List */}
            <div className="space-y-2">
                {usuarios.map(user => (
                    <UserRow
                        key={user.id}
                        user={user}
                        currentUserId={usuarioActivo?.id}
                        onChangePin={u => { setChangePinUser(u); setPinValue(''); setShowPin(false); }}
                        onRemovePin={u => handleRemovePinRequest(u)}
                        onEditName={u => { setEditNameUser(u); setEditNameValue(u.nombre); }}
                        onDelete={u => handleDeleteRequest(u)}
                        triggerHaptic={triggerHaptic}
                    />
                ))}
            </div>

            {/* Add Button / Form */}
            {!showAddForm ? (
                <button
                    onClick={() => { triggerHaptic?.(); setShowAddForm(true); }}
                    className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-50 dark:bg-indigo-900/20 text-indigo-600 dark:text-indigo-400 font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-indigo-100 dark:hover:bg-indigo-900/40 transition-colors active:scale-[0.98] border border-dashed border-indigo-300 dark:border-indigo-700"
                >
                    <UserPlus size={16} /> Agregar Usuario
                </button>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-2xl border border-indigo-200 dark:border-indigo-800/40 p-4 space-y-4 animate-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between">
                        <h4 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                            <UserPlus size={16} className="text-indigo-500" /> Nuevo Usuario
                        </h4>
                        <button onClick={() => setShowAddForm(false)} className="p-1 text-slate-400 hover:text-slate-600 transition-colors">
                            <X size={16} />
                        </button>
                    </div>

                    {/* Name */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Nombre</label>
                        <input
                            type="text"
                            placeholder="Ej: Maria, Juan"
                            value={newName}
                            onChange={e => setNewName(e.target.value)}
                            className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-indigo-500/30 transition-all"
                            autoFocus
                        />
                    </div>

                    {/* Role Selector */}
                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Rol</label>
                        <div className="grid grid-cols-2 gap-2">
                            {Object.entries(ROLE_CONFIG).map(([key, conf]) => {
                                const Icon = conf.icon;
                                return (
                                    <button
                                        key={key}
                                        onClick={() => setNewRole(key)}
                                        className={`py-2.5 px-3 text-xs font-bold rounded-xl transition-all border flex items-center justify-center gap-2 ${newRole === key
                                            ? `${conf.bg} ${conf.border} ${conf.text} shadow-sm`
                                            : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <Icon size={14} /> {conf.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>                    {newRole !== 'DUENO' && (
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Sede de trabajo</label>
                            <select value={newSedeId} onChange={e => setNewSedeId(e.target.value)} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-bold text-slate-700">
                                <option value="central">C&Y 2025</option>
                                <option value="norte">C&Y 2026</option>
                                <option value="sur">Farmacia Las 24 Horas</option>
                            </select>
                        </div>
                    )}

                    {/* PIN: de fábrica los cajeros se crean sin PIN */}
                    {newRole === 'CAJERO' ? (
                        <p className="text-xs text-slate-500 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5">
                            Los cajeros se crean sin PIN. El dueño lo configura después con "Cambiar PIN" en su fila, o permite el acceso sin PIN con el ícono de huella.
                        </p>
                    ) : (
                        <div>
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-2">PIN de {getPinLength(newRole)} dígitos</label>
                            <PinInput value={newPin} onChange={setNewPin} label="new" length={getPinLength(newRole)} />
                        </div>
                    )}

                    {/* Submit */}
                    <button
                        onClick={handleAdd}
                        disabled={!newName.trim() || (newRole !== 'CAJERO' && newPin.length !== getPinLength(newRole))}
                        className="w-full flex items-center justify-center gap-2 py-3 bg-indigo-500 hover:bg-indigo-600 disabled:bg-slate-300 dark:disabled:bg-slate-700 text-white font-bold text-xs uppercase tracking-wider rounded-xl transition-all active:scale-[0.98] shadow-md shadow-indigo-500/20 disabled:shadow-none"
                    >
                        <Check size={16} /> Crear Usuario
                    </button>
                </div>
            )}

            {/* ─── Change PIN Modal ────────────────────── */}
            {changePinUser && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setChangePinUser(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="text-center mb-6">
                            <div className={`w-14 h-14 mx-auto rounded-xl bg-gradient-to-br ${ROLE_CONFIG[changePinUser.rol]?.gradient || 'from-slate-500 to-slate-600'} flex items-center justify-center mb-3`}>
                                <span className="text-white font-black text-2xl">{(changePinUser.nombre || 'U')[0].toUpperCase()}</span>
                            </div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">Cambiar PIN</h3>
                            <p className="text-xs text-slate-400 mt-1">{changePinUser.nombre}</p>
                        </div>

                        <div className="mb-4">
                            <PinInput value={pinValue} onChange={setPinValue} label="change" length={getPinLength(changePinUser.rol)} />
                        </div>

                        <div className="flex items-center justify-center gap-2 mb-5">
                            <button
                                onClick={() => setShowPin(!showPin)}
                                className="text-[10px] text-slate-400 flex items-center gap-1 hover:text-slate-600 transition-colors"
                            >
                                {showPin ? <EyeOff size={12} /> : <Eye size={12} />}
                                {showPin ? `PIN: ${pinValue || '----'}` : 'Mostrar PIN'}
                            </button>
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setChangePinUser(null)}
                                className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleChangePin}
                                disabled={pinValue.length !== getPinLength(changePinUser.rol)}
                                className="flex-1 py-3 text-sm font-bold text-white bg-indigo-500 rounded-xl hover:bg-indigo-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ─── Edit Name Modal ────────────────────── */}
            {editNameUser && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setEditNameUser(null)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-xs shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                        <div className="text-center mb-6">
                            <div className={`w-14 h-14 mx-auto rounded-xl bg-gradient-to-br ${ROLE_CONFIG[editNameUser.rol]?.gradient || 'from-slate-500 to-slate-600'} flex items-center justify-center mb-3`}>
                                <span className="text-white font-black text-2xl">{(editNameUser.nombre || 'U')[0].toUpperCase()}</span>
                            </div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">Cambiar Nombre</h3>
                            <p className="text-xs text-slate-400 mt-1">{editNameUser.rol}</p>
                        </div>

                        <div className="mb-6">
                            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5 ml-1">Nuevo Nombre</label>
                            <input
                                autoFocus
                                type="text"
                                value={editNameValue}
                                onChange={e => setEditNameValue(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold focus:ring-2 focus:ring-indigo-500/30 outline-none text-slate-800 dark:text-white transition-all text-center"
                                placeholder="..."
                            />
                        </div>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setEditNameUser(null)}
                                className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleEditName}
                                disabled={!editNameValue.trim()}
                                className="flex-1 py-3 text-sm font-bold text-white bg-indigo-500 rounded-xl hover:bg-indigo-600 active:scale-95 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Guardar
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
