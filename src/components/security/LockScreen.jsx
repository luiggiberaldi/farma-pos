import React, { useState } from 'react';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { useConfirm } from '../../hooks/useConfirm.jsx';
import UserCard from './UserCard';
import LoginPinModal from './LoginPinModal';

export default function LockScreen({ installPrompt, onInstall, showIOSButton, onShowIOSInstall }) {
  const { usuarios, login } = useAuthStore();
  const [selectedUser, setSelectedUser] = useState(null);
  const confirm = useConfirm();

  const handlePinSubmit = async (pin, userId) => {
    const success = await login(pin, userId);
    if (success) {
      setSelectedUser(null);
    }
    return success;
  };

  const handleCloudLogout = async () => {
    const ok = await confirm({
      title: 'Cerrar sesión',
      message: 'Se cerrará tu sesión en la nube. Deberás iniciar sesión nuevamente para continuar.',
      confirmText: 'Cerrar sesión',
      cancelText: 'Cancelar',
      variant: 'logout',
    });
    if (!ok) return;
    const { supabaseCloud } = await import('../../config/supabaseCloud');
    await supabaseCloud.auth.signOut();
    window.location.reload();
  };

  return (
    <div className="fixed inset-0 z-[250] bg-slate-50 text-slate-800 font-sans overflow-hidden flex flex-col">
      {/* Background glow */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[30%] -left-[15%] w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[15%] w-[600px] h-[600px] bg-teal-400/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col items-center justify-center flex-1 p-6">
        {/* Header */}
        <div className="text-center mb-14">
          <div className="flex justify-center mb-6">
            <img src="/logo.png" alt="Logo" className="h-24 sm:h-32 w-auto object-contain drop-shadow-md" />
          </div>
          <h1 className="text-2xl sm:text-3xl font-light tracking-[0.15em] text-slate-500">
            Quien esta{' '}
            <strong className="text-slate-800 font-bold">operando</strong>?
          </h1>
        </div>

        {/* User Grid */}
        <div className="w-full grid grid-cols-2 md:flex md:flex-row md:flex-wrap md:justify-center gap-8 sm:gap-14 max-w-[320px] md:max-w-5xl mx-auto">
          {usuarios.map(user => (
            <UserCard
              key={user.id}
              user={user}
              onClick={() => setSelectedUser(user)}
            />
          ))}
        </div>
      </div>

      {/* Footer sutil */}
      <div className="relative z-10 pb-6 text-center flex flex-col items-center gap-3">
        {/* Botón de Instalar PWA */}
        {installPrompt && (
          <button
            onClick={onInstall}
            className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white text-xs font-black rounded-xl shadow-lg shadow-sky-500/20 transition-all duration-300 animate-pulse mb-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Instalar App en este equipo
          </button>
        )}
        {showIOSButton && (
          <button
            onClick={onShowIOSInstall}
            className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white text-xs font-black rounded-xl shadow-lg shadow-sky-500/20 transition-all duration-300 animate-pulse mb-1"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Instalar App (iOS)
          </button>
        )}

        <p className="text-[10px] text-slate-600 font-medium tracking-wider">
          PIN de 4 digitos requerido
        </p>
        <div className="flex items-center gap-4">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400/70 hover:text-slate-500 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
            Recargar
          </button>
          <button
            onClick={handleCloudLogout}
            className="flex items-center gap-1.5 text-[10px] font-bold text-rose-500/60 hover:text-rose-400 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Cerrar sesión
          </button>
        </div>
      </div>

      {/* PIN Modal */}
      <LoginPinModal
        isOpen={!!selectedUser}
        onClose={() => setSelectedUser(null)}
        user={selectedUser}
        onSubmit={handlePinSubmit}
      />
    </div>
  );
}
