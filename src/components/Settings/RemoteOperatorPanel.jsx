import React, { useEffect, useState } from 'react';
import { ShieldCheck, ShieldAlert, KeyRound, RefreshCw, LogOut, Link2, Link2Off, Info } from 'lucide-react';
import { SectionCard } from '../SettingsShared.jsx';
import { remoteOperatorSession, REMOTE_ROLES } from '../../services/operatorRemoteSession.js';

const ROLE_LABEL = { DUENO: 'Dueño', CAJERO: 'Cajero' };
const inputClass = 'w-full p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold text-slate-700 dark:text-slate-200 outline-none focus:ring-2 focus:ring-teal-500/40';
const buttonClass = 'w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed';

export default function RemoteOperatorPanel({ triggerHaptic }) {
    const [authority, setAuthority] = useState(() => remoteOperatorSession.getAuthority());
    const [linked, setLinked] = useState(() => remoteOperatorSession.isDeviceLinked());
    const [deviceInput, setDeviceInput] = useState('');
    const [directory, setDirectory] = useState(null);
    const [operatorId, setOperatorId] = useState('');
    const [branchId, setBranchId] = useState('');
    const [remotePin, setRemotePin] = useState('');
    const [busy, setBusy] = useState(false);
    const [message, setMessage] = useState(null);

    useEffect(() => {
        // A tab closed mid-session must not leave an expired authority on screen.
        setAuthority(remoteOperatorSession.getAuthority());
    }, []);

    const run = async (action, successText) => {
        setBusy(true); setMessage(null);
        try {
            const result = await action();
            setMessage({ ok: result.ok, text: result.ok ? (successText || result.warning || 'Listo.') : result.message });
            return result;
        } finally { setBusy(false); triggerHaptic?.(); }
    };

    const saveDevice = () => run(async () => {
        if (!remoteOperatorSession.setDeviceCredential(deviceInput.trim())) {
            return { ok: false, message: 'El identificador del equipo no tiene el formato esperado.' };
        }
        setDeviceInput(''); setLinked(true); setAuthority(null);
        return { ok: true };
    }, 'Equipo vinculado en esta pestaña.');

    const clearDevice = () => run(async () => {
        remoteOperatorSession.setDeviceCredential(null);
        setLinked(false); setDirectory(null); setAuthority(null); setRemotePin('');
        return { ok: true };
    }, 'Vínculo eliminado de esta pestaña.');

    const loadDirectory = () => run(async () => {
        const result = await remoteOperatorSession.directory();
        if (result.ok) setDirectory(result.directory);
        return result;
    }, 'Directorio remoto consultado.');

    const verify = () => run(async () => {
        const result = await remoteOperatorSession.login({ operatorId, branchId, pin: remotePin });
        setRemotePin('');
        if (result.ok) setAuthority(result.authority);
        return result;
    }, 'Operador verificado por el servidor.');

    const signOut = () => run(async () => {
        const result = await remoteOperatorSession.logout();
        setAuthority(null);
        return result;
    }, 'Sesión remota cerrada.');

    const branches = directory?.branches || [];
    const operators = (directory?.operators || []).filter(item => REMOTE_ROLES.includes(item.role));
    const branchName = id => branches.find(item => item.id === id)?.name || 'Sede desconocida';

    return (
        <SectionCard icon={ShieldCheck} title="Verificación remota de operador" subtitle="Identidad respaldada por servidor" iconColor="text-teal-600">
            <div className="p-2.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-xl mb-3 flex gap-2.5">
                <Info size={16} className="text-slate-500 shrink-0 mt-0.5" />
                <p className="text-[10px] text-slate-600 dark:text-slate-300 leading-relaxed font-bold">
                    Esta verificación <span className="font-black">no habilita</span> la sincronización ni el cobro remoto. Solo comprueba que la cuenta, la sede, el rol y este equipo coinciden con lo registrado en el servidor. La venta sigue funcionando local.
                </p>
            </div>

            <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2 min-w-0">
                    {linked ? <Link2 size={16} className="text-emerald-600 shrink-0" /> : <Link2Off size={16} className="text-slate-400 shrink-0" />}
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">
                        {linked ? 'Equipo vinculado en esta pestaña' : 'Equipo sin vincular'}
                    </p>
                </div>
                {linked && (
                    <button onClick={clearDevice} disabled={busy} className="shrink-0 text-[11px] font-bold text-red-600 dark:text-red-400 px-2 py-1 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                        Quitar
                    </button>
                )}
            </div>

            {!linked && (
                <div className="space-y-2">
                    <label className="block text-[11px] font-bold text-slate-500" htmlFor="remote-device">Identificador del equipo</label>
                    <input id="remote-device" type="password" autoComplete="off" value={deviceInput}
                        onChange={event => setDeviceInput(event.target.value)} placeholder="uuid.secreto" className={inputClass} />
                    <button onClick={saveDevice} disabled={busy || !deviceInput.trim()} className={buttonClass}>
                        <div className="p-2 bg-teal-50 dark:bg-teal-900/30 rounded-lg"><KeyRound size={18} className="text-teal-600" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Vincular equipo</p>
                            <p className="text-[10px] text-slate-400">Se guarda solo en esta pestaña</p>
                        </div>
                    </button>
                </div>
            )}

            {linked && !authority && (
                <div className="space-y-2">
                    <button onClick={loadDirectory} disabled={busy} className={buttonClass}>
                        <div className="p-2 bg-sky-50 dark:bg-sky-900/30 rounded-lg"><RefreshCw size={18} className={`text-sky-600 ${busy ? 'animate-spin' : ''}`} /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Consultar directorio</p>
                            <p className="text-[10px] text-slate-400">Operadores y sedes del servidor</p>
                        </div>
                    </button>

                    {directory && (
                        <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                            <label className="block text-[11px] font-bold text-slate-500" htmlFor="remote-operator">Operador</label>
                            <select id="remote-operator" value={operatorId} onChange={event => setOperatorId(event.target.value)} className={inputClass}>
                                <option value="">Selecciona un operador</option>
                                {operators.map(item => (
                                    <option key={item.id} value={item.id}>{item.name} · {ROLE_LABEL[item.role] || item.role}</option>
                                ))}
                            </select>
                            <label className="block text-[11px] font-bold text-slate-500" htmlFor="remote-branch">Sede</label>
                            <select id="remote-branch" value={branchId} onChange={event => setBranchId(event.target.value)} className={inputClass}>
                                <option value="">Selecciona una sede</option>
                                {branches.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
                            </select>
                            <label className="block text-[11px] font-bold text-slate-500" htmlFor="remote-pin">PIN remoto de 8 a 12 dígitos</label>
                            <input id="remote-pin" type="password" inputMode="numeric" autoComplete="off" maxLength={12}
                                value={remotePin} onChange={event => setRemotePin(event.target.value.replace(/\D/g, ''))} className={inputClass} />
                            <button onClick={verify} disabled={busy || !operatorId || !branchId || remotePin.length < 8} className={buttonClass}>
                                <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg"><ShieldCheck size={18} className="text-emerald-600" /></div>
                                <div className="text-left flex-1">
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Verificar operador</p>
                                    <p className="text-[10px] text-slate-400">El PIN remoto no es el PIN local</p>
                                </div>
                            </button>
                        </div>
                    )}
                </div>
            )}

            {authority && (
                <div className="space-y-2">
                    <div className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800/40 rounded-xl">
                        <div className="flex items-center gap-2 mb-1">
                            <ShieldCheck size={16} className="text-emerald-600" />
                            <p className="text-sm font-black text-emerald-800 dark:text-emerald-300">{authority.name}</p>
                        </div>
                        <p className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400">
                            {ROLE_LABEL[authority.role] || authority.role} · {branchName(authority.branch_id)}
                        </p>
                        <p className="text-[10px] text-emerald-600 dark:text-emerald-500 mt-0.5">
                            Vence {new Date(authority.expires_at).toLocaleTimeString('es-VE')}
                        </p>
                    </div>
                    <button onClick={signOut} disabled={busy} className={buttonClass}>
                        <div className="p-2 bg-slate-100 dark:bg-slate-700 rounded-lg"><LogOut size={18} className="text-slate-500" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Cerrar verificación remota</p>
                            <p className="text-[10px] text-slate-400">No cierra la sesión local</p>
                        </div>
                    </button>
                </div>
            )}

            {message && (
                <p role="status" className={`mt-3 p-2.5 rounded-xl text-[11px] font-bold flex items-start gap-2 ${message.ok ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300'}`}>
                    {message.ok ? <ShieldCheck size={14} className="shrink-0 mt-0.5" /> : <ShieldAlert size={14} className="shrink-0 mt-0.5" />}
                    {message.text}
                </p>
            )}
        </SectionCard>
    );
}
