import React, { useState, useRef } from 'react';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { useConfirm } from '../../hooks/confirmState.js';
import UserCard from './UserCard';
import LoginPinModal from './LoginPinModal';
import SuperAdminModal from './SuperAdminModal';
import BrandLogo from '../BrandLogo.jsx';
import ProfessionalSelect from '../ProfessionalSelect';
import { SEDES } from '../../config/sedes';
import { isCloudConfigured } from '../../config/supabaseCloud.js';
import { useSedeStore } from '../../hooks/store/useSedeStore';
import BranchPinModal from './BranchPinModal';
import { signOutCloudAccount } from '../../services/cloudSessionLifecycle.js';
import { showToast } from '../Toast.js';

export default function LockScreen({ installPrompt, onInstall, showIOSButton, onShowIOSInstall }) {
  const { usuarios, login } = useAuthStore();
  const [selectedUser, setSelectedUser] = useState(null);
  // El selector arranca en la sede activa del dispositivo (el cajero de esa
  // sede debe aparecer sin tocar nada); cambiar de sede exige PIN del dueño.
  const selectedSedeId = useSedeStore(s => s.sedeActivaId);
  const [pendingSedeId, setPendingSedeId] = useState(null);
  const [showSuperAdmin, setShowSuperAdmin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const secretCount = useRef(0);
  const confirm = useConfirm();

  const visibleUsers = usuarios.filter(user => ['DUENO', 'ADMIN'].includes(user.rol) || user.sedeId === selectedSedeId);

  const handleLogoSecret = () => {
    secretCount.current += 1;
    if (secretCount.current === 7) {
      secretCount.current = 0;
      setShowSuperAdmin(true);
    }
    if (secretCount.current === 1) setTimeout(() => { secretCount.current = 0; }, 4000);
  };

  // La recuperación permanece montada para no perder la ventana concedida
  // (request/confirm viven en el store; el modal solo orquesta la UI).
  const handlePinSubmit = async (pin, userId) => {
    const selected = usuarios.find(user => user.id === userId);
    if (!selected) return false;
    if (selected.rol === 'CAJERO' && selected.sedeId !== selectedSedeId) return false;
    const success = await login(pin, userId);
    if (success) setSelectedUser(null);
    return success;
  };

  const handleCloudLogout = async () => {
    const ok = await confirm({
      title: 'Cerrar sesión',
      message: 'Se cerrará tu sesión en la nube. Deberás iniciar sesión nuevamente para continuar.',
      confirmText: 'Cerrar sesión', cancelText: 'Cancelar', variant: 'logout',
    });
    if (!ok) return;
    setIsLoggingOut(true);
    try {
      const { supabaseCloud } = await import('../../config/supabaseCloud');
      await signOutCloudAccount(supabaseCloud);
    } catch (error) {
      // El bloqueo local ya ocurrió antes de la petición remota. No dejamos al
      // usuario atrapado en un estado intermedio si la red/cloud falla.
      showToast(error?.message || 'La sesión local se cerró; no se pudo confirmar la salida cloud.', 'warning');
    } finally {
      window.location.reload();
    }
  };

  return (
    <div className="fixed inset-0 z-[250] bg-slate-50 text-slate-800 font-sans overflow-hidden flex flex-col">
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[30%] -left-[15%] w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[15%] w-[600px] h-[600px] bg-teal-400/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center flex-1 p-6">
        <div className="text-center mb-10">
          <div className="flex justify-center mb-6">
            <BrandLogo sedeId={selectedSedeId} onClick={handleLogoSecret} className="h-28 sm:h-36 w-auto drop-shadow-lg cursor-default" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-[0.15em] text-slate-500">
            Quien esta <strong className="text-slate-800 font-bold">operando</strong>?
          </h1>
          <div className="mx-auto mt-5 w-56 text-left">
            <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Sede de trabajo</label>
            <ProfessionalSelect
              value={selectedSedeId}
              onChange={value => {
                if (value !== selectedSedeId) setPendingSedeId(value);
              }}
              options={SEDES.map(sede => ({ value: sede.id, label: sede.nombre }))}
              ariaLabel="Sede de trabajo"
              className="w-full"
            />
          </div>
        </div>

        <div className="w-full grid grid-cols-2 md:flex md:flex-row md:flex-wrap md:justify-center gap-8 sm:gap-14 max-w-[320px] md:max-w-5xl mx-auto">
          {visibleUsers.map(user => (
            <UserCard key={user.id} user={user} onClick={() => setSelectedUser(user)} />
          ))}
        </div>
      </div>

      <div className="relative z-10 pb-6 text-center flex flex-col items-center gap-3">
        {installPrompt && <button onClick={onInstall} className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white text-xs font-black rounded-xl shadow-lg shadow-sky-500/20 transition-all duration-300 animate-pulse mb-1">Instalar App en este equipo</button>}
        {showIOSButton && <button onClick={onShowIOSInstall} className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white text-xs font-black rounded-xl shadow-lg shadow-sky-500/20 transition-all duration-300 animate-pulse mb-1">Instalar App (iOS)</button>}
        <p className="text-[10px] text-slate-600 font-medium tracking-wider">Selecciona tu usuario para continuar</p>
        <button onClick={() => setShowSuperAdmin(true)} className="text-[10px] font-bold text-slate-400/80 hover:text-slate-600 dark:hover:text-slate-300 transition-colors underline underline-offset-2">Olvidé mi PIN</button>
        <div className="flex items-center gap-4">
          <button onClick={() => window.location.reload()} className="text-[10px] font-bold text-slate-400/70 hover:text-slate-500 transition-colors">Recargar</button>
          {isCloudConfigured && <button type="button" onClick={handleCloudLogout} disabled={isLoggingOut} aria-busy={isLoggingOut} className="text-[10px] font-bold text-rose-500/60 hover:text-rose-400 transition-colors disabled:opacity-50 disabled:cursor-wait">{isLoggingOut ? 'Cerrando sesión…' : 'Cerrar sesión'}</button>}
        </div>
      </div>

      <LoginPinModal isOpen={!!selectedUser} onClose={() => setSelectedUser(null)} user={selectedUser} onSubmit={handlePinSubmit} />
      {showSuperAdmin && <SuperAdminModal isOpen onClose={() => setShowSuperAdmin(false)} />}
      {pendingSedeId && <BranchPinModal key={pendingSedeId} targetSedeId={pendingSedeId} onClose={() => setPendingSedeId(null)} />}
    </div>
  );
}
