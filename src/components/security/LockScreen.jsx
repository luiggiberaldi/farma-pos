import React, { useState, useRef } from 'react';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { useConfirm } from '../../hooks/confirmState.js';
import UserCard from './UserCard';
import LoginPinModal from './LoginPinModal';
import SuperAdminModal from './SuperAdminModal';
import BrandLogo from '../BrandLogo.jsx';
import ProfessionalSelect from '../ProfessionalSelect';
import SedeName from './SedeName';
import { SEDES } from '../../config/sedes';
import { isCloudConfigured } from '../../config/supabaseCloud.js';
import { useSedeStore } from '../../hooks/store/useSedeStore';
import BranchPinModal from './BranchPinModal';
import { signOutCloudAccount } from '../../services/cloudSessionLifecycle.js';
import { showToast } from '../Toast.js';
import { Eye, Lock } from 'lucide-react';

export default function LockScreen({ installPrompt, onInstall, showIOSButton, onShowIOSInstall, onEnterMonitor }) {
  const { usuarios, login } = useAuthStore();
  const sessionLocked = useAuthStore(s => s.sessionLocked);
  const unlock = useAuthStore(s => s.unlock);
  const logout = useAuthStore(s => s.logout);
  const [selectedUser, setSelectedUser] = useState(null);
  const [unlockUser, setUnlockUser] = useState(null);
  // El selector arranca en la sede activa del dispositivo (el cajero de esa
  // sede debe aparecer sin tocar nada); cambiar de sede exige PIN del dueño.
  const selectedSedeId = useSedeStore(s => s.sedeActivaId);
  const [pendingSedeId, setPendingSedeId] = useState(null);
  const [showSuperAdmin, setShowSuperAdmin] = useState(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  const secretCount = useRef(0);
  const confirm = useConfirm();

  const visibleUsers = usuarios.filter(user => user.rol === 'DUENO' || user.sedeId === selectedSedeId);

  // ── Modo bloqueado (Lock ≠ Logout): conserva operador, sesión y carrito.
  // Solo quien bloqueó puede desbloquear con su PIN.
  if (sessionLocked) {
    const lockedUser = usuarios.find(u => u.id === sessionLocked.userId);
    const handleUnlock = async (pin, userId) => {
      if (userId !== sessionLocked.userId) return false;
      const ok = await unlock(pin);
      if (ok) setUnlockUser(null);
      return ok;
    };
    const handleEndShift = async () => {
      const ok = await confirm({
        title: 'Cerrar turno',
        message: `${sessionLocked.userName} cerrará su turno por completo. Si fichó entrada, se registrará la salida.`,
        confirmText: 'Cerrar turno', cancelText: 'Cancelar', variant: 'logout',
      });
      if (ok) logout('turno cerrado');
    };
    return (
      <div className="fixed inset-0 z-[250] bg-slate-900/70 backdrop-blur-sm font-sans overflow-y-auto flex items-center justify-center p-6">
        <div className="w-full max-w-sm bg-white rounded-3xl p-8 shadow-2xl text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-amber-100 text-amber-600 flex items-center justify-center">
            <Lock size={26} />
          </div>
          <h1 className="text-xl font-black text-slate-800">Sesión bloqueada</h1>
          <p className="text-xs text-slate-500 mt-1.5">
            Bloqueada por <strong className="text-slate-700">{sessionLocked.userName}</strong>
            {sessionLocked.at && (
              <> · {new Date(sessionLocked.at).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}</>
            )}
          </p>
          <p className="text-xs text-slate-400 mt-1 mb-6">Solo {sessionLocked.userName?.split(' ')[0]} puede desbloquearla con su PIN.</p>
          {lockedUser ? (
            <div className="flex justify-center">
              <UserCard user={lockedUser} onClick={() => setUnlockUser(lockedUser)} />
            </div>
          ) : (
            <p className="text-sm text-rose-600 font-bold">No se encontró la cuenta que bloqueó la sesión.</p>
          )}
          <button onClick={handleEndShift} className="mt-6 text-[11px] font-bold text-slate-400 hover:text-slate-600 underline underline-offset-2 transition-colors">
            Cerrar turno
          </button>
        </div>
        <LoginPinModal
          isOpen={!!unlockUser}
          onClose={() => setUnlockUser(null)}
          user={unlockUser}
          purpose="login"
          onSubmit={handleUnlock}
        />
      </div>
    );
  }

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
    // Modo Monitor: verifica PIN del dueño pero no inicia sesión completa
    if (selectedUser?.isMonitorMode) {
      const success = await login(pin, userId);
      if (success) {
        // Cierra la sesión inmediatamente y entra en modo monitor (solo lectura)
        useAuthStore.getState().logout('modo monitor');
        setSelectedUser(null);
        onEnterMonitor?.();
      }
      return success;
    }
    const success = await login(pin, userId);
    if (success) setSelectedUser(null);
    return success;
  };

  // "Desconectar estación": cierra la conexión cloud DE ESTE EQUIPO
  // (scope local). No cierra turnos ni borra datos del dispositivo.
  const handleStationDisconnect = async () => {
    const ok = await confirm({
      title: 'Desconectar estación',
      message: 'Se cerrará la conexión de esta estación con la nube (no se cierra ningún turno). Deberás conectar la estación nuevamente para sincronizar.',
      confirmText: 'Desconectar', cancelText: 'Cancelar', variant: 'logout',
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

  const sedeNombre = SEDES.find(s => s.id === selectedSedeId)?.nombre;

  return (
    <div className="fixed inset-0 z-[250] bg-slate-50 text-slate-800 font-sans overflow-y-auto flex flex-col">
      <div className="fixed inset-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[30%] -left-[15%] w-[600px] h-[600px] bg-sky-500/10 rounded-full blur-[120px]" />
        <div className="absolute -bottom-[30%] -right-[15%] w-[600px] h-[600px] bg-teal-400/10 rounded-full blur-[120px]" />
      </div>

      <div className="relative z-10 flex flex-col lg:flex-row items-center justify-center flex-1 p-6 my-auto gap-10 lg:gap-20 w-full max-w-6xl mx-auto">
        {/* Panel de marca lateral (solo PC): aire de sobra, sin apilar */}
        <div className="hidden lg:flex flex-col items-center text-center max-w-xs shrink-0">
          <BrandLogo sedeId={selectedSedeId} onClick={handleLogoSecret} className="h-60 w-auto drop-shadow-lg cursor-default mb-6" />
          <SedeName nombre={sedeNombre} size="lg" className="text-slate-700" />
          <p className="text-sm text-slate-400 mt-3 leading-relaxed">Punto de venta · control de turnos por PIN.<br />Toca tu cuenta para operar.</p>
        </div>

        <div className="w-full max-w-[520px] flex flex-col items-center">
          <div className="text-center mb-8">
            <div className="flex justify-center mb-5 lg:hidden">
              <BrandLogo sedeId={selectedSedeId} onClick={handleLogoSecret} className="h-24 sm:h-28 w-auto drop-shadow-lg cursor-default" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-light text-slate-500">
              ¿Quién está <strong className="text-slate-800 font-bold">operando</strong>?
            </h1>
            <div className="mx-auto mt-5 w-64 text-left">
              <label className="mb-1.5 block text-[10px] font-black uppercase tracking-wider text-slate-400">Sede de trabajo</label>
              <ProfessionalSelect
                value={selectedSedeId}
                onChange={value => {
                  if (value !== selectedSedeId) setPendingSedeId(value);
                }}
                options={SEDES.map(sede => ({ value: sede.id, label: <SedeName nombre={sede.nombre} size="sm" /> }))}
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
      </div>

      <div className="relative z-10 pb-6 text-center flex flex-col items-center gap-2">
        {installPrompt && <button onClick={onInstall} className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white text-xs font-black rounded-xl shadow-lg shadow-sky-500/20 transition-all duration-300 animate-pulse mb-1">Instalar App en este equipo</button>}
        {showIOSButton && <button onClick={onShowIOSInstall} className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white text-xs font-black rounded-xl shadow-lg shadow-sky-500/20 transition-all duration-300 animate-pulse mb-1">Instalar App (iOS)</button>}
        <p className="text-xs text-slate-600 font-medium tracking-wider">Selecciona tu usuario para continuar</p>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowSuperAdmin(true)} className="inline-flex items-center min-h-[44px] px-3.5 text-xs font-bold text-slate-500 hover:text-slate-700 transition-colors underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 rounded-lg">Olvidé mi PIN</button>
          <span className="text-slate-300" aria-hidden>·</span>
          <button
            onClick={() => {
              const dueno = usuarios.find(u => u.rol === 'DUENO');
              if (dueno) setSelectedUser({ ...dueno, isMonitorMode: true, nombre: 'Supervisión' });
            }}
            className="inline-flex items-center gap-1 min-h-[44px] px-3.5 text-xs font-bold text-slate-500 hover:text-violet-600 transition-colors underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-violet-400 focus-visible:ring-offset-2 rounded-lg"
          >
            <Eye size={13} /> Supervisión
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => window.location.reload()} className="inline-flex items-center min-h-[44px] px-3.5 text-xs font-bold text-slate-500 hover:text-slate-600 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-2 rounded-lg">Recargar</button>
          {isCloudConfigured && <button type="button" onClick={handleStationDisconnect} disabled={isLoggingOut} aria-busy={isLoggingOut} className="inline-flex items-center min-h-[44px] px-3.5 text-xs font-bold text-rose-600 hover:text-rose-500 transition-colors disabled:opacity-50 disabled:cursor-wait outline-none focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 rounded-lg">{isLoggingOut ? 'Desconectando…' : 'Desconectar estación'}</button>}
        </div>
      </div>

      <LoginPinModal isOpen={!!selectedUser} onClose={() => setSelectedUser(null)} user={selectedUser} onSubmit={handlePinSubmit} />
      {showSuperAdmin && <SuperAdminModal isOpen onClose={() => setShowSuperAdmin(false)} />}
      {pendingSedeId && <BranchPinModal key={pendingSedeId} targetSedeId={pendingSedeId} onClose={() => setPendingSedeId(null)} />}
    </div>
  );
}
