import React, { useState } from 'react';
import {
    Database, Palette, Fingerprint, Upload, Download, Share2,
    Check, Sun, Moon, ChevronRight, RotateCcw, AlertTriangle, FileText, ZoomIn, ZoomOut, Monitor
} from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';
import AuditLogViewer from '../AuditLogViewer';

export default function SettingsTabSistema({
    theme, toggleTheme,
    deviceId, idCopied, setIdCopied,
    isAdmin,
    importStatus, statusMessage,
    handleExport, handleImportClick,
    setIsShareOpen,
    setShowFactoryReset,
    triggerHaptic,
    isCloudConfigured,
    handleForceRemoteReload,
}) {
    const [screenScale, setScreenScale] = useState(() => {
        return parseInt(localStorage.getItem('app_screen_scale') || '100');
    });

    const applyScale = (newScale) => {
        const clamped = Math.max(70, Math.min(130, newScale));
        setScreenScale(clamped);
        localStorage.setItem('app_screen_scale', clamped.toString());
        document.documentElement.style.zoom = `${clamped}%`;
        triggerHaptic?.();
    };

    const resetScale = () => {
        applyScale(100);
    };
    return (
        <>
            {/* Datos y Respaldo */}
            <SectionCard icon={Database} title="Datos y Respaldo" subtitle="Exportar, importar y compartir" iconColor="text-cyan-500">
                <div className="p-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-100 dark:border-amber-800/30 rounded-xl flex gap-2.5">
                    <AlertTriangle size={18} className="text-amber-600 dark:text-amber-500 shrink-0 mt-0.5" />
                    <p className="text-[10px] text-amber-800 dark:text-amber-400 leading-relaxed font-bold">
                        PRECAUCION: Al restaurar un backup se sobrescribira por completo todo el historial de ventas, inventario, deudores y configuraciones de este dispositivo.
                    </p>
                </div>

                <div className="space-y-2">
                    <button onClick={handleExport} className="w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group active:scale-[0.98]">
                        <div className="p-2 bg-blue-50 dark:bg-blue-900/30 rounded-lg"><Download size={18} className="text-blue-500" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Exportar Backup</p>
                            <p className="text-[10px] text-slate-400">Descargar archivo .json</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>

                    <button onClick={handleImportClick} className="w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group active:scale-[0.98]">
                        <div className="p-2 bg-emerald-50 dark:bg-emerald-900/30 rounded-lg"><Upload size={18} className="text-emerald-500" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Importar Backup</p>
                            <p className="text-[10px] text-slate-400">Restaurar desde archivo</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>

                    <button onClick={() => setIsShareOpen(true)} className="w-full flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors group active:scale-[0.98]">
                        <div className="p-2 bg-indigo-50 dark:bg-indigo-900/30 rounded-lg"><Share2 size={18} className="text-indigo-500" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Compartir Base de Datos</p>
                            <p className="text-[10px] text-slate-400">Codigo de 6 digitos, 24h</p>
                        </div>
                        <ChevronRight size={16} className="text-slate-300" />
                    </button>
                </div>

                {importStatus && (
                    <div className={`p-2.5 rounded-xl text-xs font-bold text-center flex items-center justify-center gap-2 ${importStatus === 'success' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'}`}>
                        {importStatus === 'success' ? <Check size={14} /> : <AlertTriangle size={14} />}
                        {statusMessage}
                    </div>
                )}
            </SectionCard>

            {/* Apariencia */}
            <SectionCard icon={Palette} title="Apariencia" subtitle="Estilo visual de la app" iconColor="text-pink-500">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        {theme === 'dark' ? <Moon size={18} className="text-indigo-400" /> : <Sun size={18} className="text-amber-500" />}
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">{theme === 'dark' ? 'Modo Oscuro' : 'Modo Claro'}</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Toca para cambiar</p>
                        </div>
                    </div>
                    <Toggle
                        enabled={theme === 'dark'}
                        color="indigo"
                        onChange={() => { toggleTheme(); triggerHaptic?.(); }}
                    />
                </div>

                {/* Screen Scale */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3 mb-3">
                        <Monitor size={18} className="text-violet-500" />
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Escala de Pantalla</p>
                            <p className="text-[10px] text-slate-400 mt-0.5">Ajusta el tamaño de la interfaz</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => applyScale(screenScale - 5)}
                            disabled={screenScale <= 70}
                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ZoomOut size={18} />
                        </button>
                        <div className="flex-1 text-center">
                            <p className="text-lg font-black text-slate-800 dark:text-white">{screenScale}%</p>
                            <input
                                type="range"
                                min="70"
                                max="130"
                                step="5"
                                value={screenScale}
                                onChange={e => applyScale(parseInt(e.target.value))}
                                className="w-full h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full appearance-none cursor-pointer accent-violet-500 mt-1"
                            />
                        </div>
                        <button
                            onClick={() => applyScale(screenScale + 5)}
                            disabled={screenScale >= 130}
                            className="w-10 h-10 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            <ZoomIn size={18} />
                        </button>
                    </div>
                    {screenScale !== 100 && (
                        <button
                            onClick={resetScale}
                            className="mt-2 w-full py-2 text-xs font-bold text-violet-600 dark:text-violet-400 bg-violet-50 dark:bg-violet-900/20 border border-violet-200 dark:border-violet-800/50 rounded-xl hover:bg-violet-100 dark:hover:bg-violet-900/30 transition-colors active:scale-[0.98]"
                        >
                            Restaurar a 100%
                        </button>
                    )}
                </div>
            </SectionCard>

            {/* Dispositivo */}
            <SectionCard icon={Fingerprint} title="Dispositivo" subtitle="Informacion tecnica" iconColor="text-slate-500">
                <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                        <p className="text-[9px] uppercase tracking-wider font-bold text-slate-400 mb-1">ID de Instalacion</p>
                        <p className="font-mono text-xs font-black text-slate-600 dark:text-slate-300 select-all truncate">{deviceId || '...'}</p>
                    </div>
                    <button
                        onClick={() => {
                            navigator.clipboard.writeText(deviceId).then(() => {
                                setIdCopied(true);
                                setTimeout(() => setIdCopied(false), 2000);
                            });
                        }}
                        className="shrink-0 p-2 rounded-lg text-slate-400 hover:text-teal-500 hover:bg-teal-50 dark:hover:bg-teal-900/20 transition-all"
                    >
                        {idCopied ? <Check size={14} className="text-emerald-500" /> : <Fingerprint size={14} />}
                    </button>
                </div>
                <p className="text-[9px] text-slate-400">Comparte este ID si necesitas soporte tecnico.</p>
            </SectionCard>

            {/* Audit Log */}
            {isAdmin && (
                <SectionCard icon={FileText} title="Bitacora de Actividad" subtitle="Registro de todas las acciones" iconColor="text-slate-500">
                    <AuditLogViewer triggerHaptic={triggerHaptic} />
                </SectionCard>
            )}

            {/* Control de Dispositivos (Solo si la nube está activa) */}
            {isCloudConfigured && (
                <SectionCard icon={Monitor} title="Control de Dispositivos" subtitle="Comandos remotos" iconColor="text-sky-500">
                    <div className="p-2.5 bg-sky-50 dark:bg-sky-900/20 border border-sky-100 dark:border-sky-800/30 rounded-xl mb-3">
                        <p className="text-[10px] text-sky-800 dark:text-sky-400 leading-relaxed font-bold">
                            Envía una señal para forzar la recarga inmediata de la aplicación en todos los dispositivos de la cuenta. Útil tras realizar actualizaciones.
                        </p>
                    </div>
                    <button
                        onClick={handleForceRemoteReload}
                        className="w-full flex items-center gap-3 p-3 bg-sky-50 dark:bg-sky-900/20 border border-sky-200 dark:border-sky-800/30 rounded-xl hover:bg-sky-100 dark:hover:bg-sky-900/40 transition-colors group active:scale-[0.98]"
                    >
                        <div className="p-2 bg-sky-100 dark:bg-sky-900/40 rounded-lg"><RotateCcw size={18} className="text-sky-600 dark:text-sky-400" /></div>
                        <div className="text-left flex-1">
                            <p className="text-sm font-bold text-sky-700 dark:text-sky-400">Forzar Recarga Remota</p>
                            <p className="text-[10px] text-sky-500/80 dark:text-sky-400/80">Recarga todos los terminales en uso</p>
                        </div>
                    </button>
                </SectionCard>
            )}

            {/* Zona de Peligro */}
            <SectionCard icon={AlertTriangle} title="Zona de Peligro" subtitle="Acciones irreversibles" iconColor="text-red-500">
                <div className="p-2.5 bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/30 rounded-xl mb-3">
                    <p className="text-[10px] text-red-700 dark:text-red-400 leading-relaxed font-bold">
                        Esta accion eliminara TODOS los datos: inventario, ventas, clientes, cuentas, configuraciones y usuarios. El dispositivo quedara como nuevo de fabrica.
                    </p>
                </div>
                <button
                    onClick={() => setShowFactoryReset(true)}
                    className="w-full flex items-center gap-3 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors group active:scale-[0.98]"
                >
                    <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg"><RotateCcw size={18} className="text-red-600 dark:text-red-400" /></div>
                    <div className="text-left flex-1">
                        <p className="text-sm font-bold text-red-700 dark:text-red-400">Reinicio de Fábrica</p>
                        <p className="text-[10px] text-red-500/80 dark:text-red-400/80">Borra todo y deja la app como nueva</p>
                    </div>
                </button>
            </SectionCard>
        </>
    );
}

