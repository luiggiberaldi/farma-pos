import React, { useState, useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, X, ChevronRight, Copy, Check, RotateCcw } from 'lucide-react';
import { SUPABASE_FREE_PROFILE } from '../config/supabaseFreeTier.js';
import { ACTIVE_ACCOUNT_STORAGE_KEY, ACTIVE_SEDE_STORAGE_KEY, captureStorageContext, isStorageContextActive } from '../config/storageScope.js';
import { offlineQueueService } from '../services/offlineQueueService';
import { useEscapeToClose } from '../hooks/useEscapeToClose';
import { REMOTE_OPERATIONS_PAUSED, CLOUD_PAUSE_MESSAGE, SYNC_V2_ENABLED } from '../config/operationSafety.js';
import { getActiveAccountId } from '../config/storageScope.js';

export default function SyncStatus() {
    const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
    const [pendingCount, setPendingCount] = useState(0);
    const [failedCount, setFailedCount] = useState(0);
    const [showFailedBanner, setShowFailedBanner] = useState(false);
    const [showErrorModal, setShowErrorModal] = useState(false);
    useEscapeToClose(() => setShowErrorModal(false), showErrorModal);
    const [failedItems, setFailedItems] = useState([]);
    const [copied, setCopied] = useState(false);

    const refreshQueueRef = useRef(() => {});
    const queueReadRef = useRef(null);
    const instanceRef = useRef(null);
    const copyTimerRef = useRef(null);
    const checkQueue = () => refreshQueueRef.current();

    const [isRetrying, setIsRetrying] = useState(false);

    const handleDismissFailed = async (e) => {
        e.stopPropagation();
        if (REMOTE_OPERATIONS_PAUSED) return;
        const instance = instanceRef.current;
        const context = captureStorageContext();
        await offlineQueueService.dismissFailed();
        if (instanceRef.current !== instance || !isStorageContextActive(context)) return;
        setFailedCount(0);
        setFailedItems([]);
        setShowFailedBanner(false);
        setShowErrorModal(false);
    };

    const handleRetryFailed = async (e) => {
        e.stopPropagation();
        if (REMOTE_OPERATIONS_PAUSED) return;
        const instance = instanceRef.current;
        const context = captureStorageContext();
        setIsRetrying(true);
        try {
            await offlineQueueService.retryFailed();
            if (instanceRef.current !== instance || !isStorageContextActive(context)) return;
            await checkQueue();
            if (instanceRef.current === instance && isStorageContextActive(context)) setShowErrorModal(false);
        } finally {
            if (instanceRef.current === instance) setIsRetrying(false);
        }
    };

    const handleCopyLogs = () => {
        const text = failedItems.map((item, i) => {
            const d = new Date(item.created_at);
            const total = item.payload?.total;
            return [
                `--- Venta ${i + 1} ---`,
                `Fecha: ${d.toLocaleString('es-VE')}`,
                `Total: ${total != null ? `$${Number(total).toFixed(2)}` : 'N/A'}`,
                `Intentos: ${item.attempts || 0}`,
                `Error: ${item.last_error || 'Error desconocido'}`,
            ].join('\n');
        }).join('\n\n');
        const doCopy = () => {
            if (navigator.clipboard?.writeText) {
                return navigator.clipboard.writeText(text);
            }
            // Fallback para contextos sin Clipboard API (iframes, HTTP, etc.)
            const ta = document.createElement('textarea');
            ta.value = text;
            ta.style.cssText = 'position:fixed;opacity:0';
            document.body.appendChild(ta);
            ta.select();
            document.execCommand('copy');
            document.body.removeChild(ta);
            return Promise.resolve();
        };
        const instance = instanceRef.current;
        const context = captureStorageContext();
        doCopy().then(() => {
            if (instanceRef.current !== instance || !isStorageContextActive(context)) return;
            setCopied(true);
            clearTimeout(copyTimerRef.current);
            copyTimerRef.current = setTimeout(() => {
                if (instanceRef.current === instance && isStorageContextActive(context)) setCopied(false);
            }, 2000);
        }).catch(() => {
            if (instanceRef.current === instance && isStorageContextActive(context)) setCopied(false);
        });
    };

    useEffect(() => {
        const instance = Symbol('sync-status');
        instanceRef.current = instance;
        let requested = false;
        const active = () => instanceRef.current === instance;
        const refresh = () => {
            if (!active() || document.visibilityState !== 'visible') return Promise.resolve();
            requested = true;
            if (queueReadRef.current?.instance === instance) return queueReadRef.current.promise;
            const entry = { instance, promise: null };
            entry.promise = Promise.resolve().then(async () => {
                do {
                    requested = false;
                    const context = captureStorageContext();
                    try {
                        const queue = await offlineQueueService.getQueue();
                        if (!active() || document.visibilityState !== 'visible') return;
                        if (!isStorageContextActive(context)) { requested = true; continue; }
                        const failed = queue.filter(item => item.sync_status === 'failed');
                        setPendingCount(queue.filter(item => item.sync_status === 'pending').length);
                        setFailedCount(failed.length);
                        setFailedItems(failed);
                        setShowFailedBanner(failed.length > 0);
                    } catch (error) {
                        if (active()) console.error('[SyncStatus] Error al leer cola', error);
                    }
                } while (requested && active() && document.visibilityState === 'visible');
            }).finally(() => {
                if (queueReadRef.current === entry) queueReadRef.current = null;
            });
            queueReadRef.current = entry;
            return entry.promise;
        };
        refreshQueueRef.current = refresh;
        const connectivity = () => {
            if (!active()) return;
            setIsOnline(navigator.onLine);
            void refresh();
        };
        const storageChanged = event => {
            if (event.key === null || [ACTIVE_ACCOUNT_STORAGE_KEY, ACTIVE_SEDE_STORAGE_KEY].includes(event.key)
                || event.key?.endsWith('offline_sales_queue')) void refresh();
        };
        window.addEventListener('online', connectivity);
        window.addEventListener('offline', connectivity);
        window.addEventListener('offline_queue_update', refresh);
        window.addEventListener('storage', storageChanged);
        document.addEventListener('visibilitychange', connectivity);
        void refresh();
        // Local-only fallback for changes from another tab's IndexedDB. There
        // is no database ping, no Realtime channel, and no 15-second queue scan.
        const interval = setInterval(refresh, SUPABASE_FREE_PROFILE.queueRefreshFallbackMs);
        return () => {
            if (active()) instanceRef.current = null;
            refreshQueueRef.current = () => Promise.resolve();
            window.removeEventListener('online', connectivity);
            window.removeEventListener('offline', connectivity);
            window.removeEventListener('offline_queue_update', refresh);
            window.removeEventListener('storage', storageChanged);
            document.removeEventListener('visibilitychange', connectivity);
            clearInterval(interval);
            clearTimeout(copyTimerRef.current);
        };
    }, []);

    // El indicador refleja el motor de documentos V2 cuando está activo con una
    // cuenta nube. La cola operacional legada (REMOTE_OPERATIONS_PAUSED) solo
    // gobierna el badge si V2 no está activo; de lo contrario el "Sync pausada"
    // es engañoso porque los documentos SÍ se sincronizan.
    const v2Active = SYNC_V2_ENABLED && !!getActiveAccountId();
    let statusType = 'online';
    if (!v2Active && REMOTE_OPERATIONS_PAUSED) statusType = 'paused';
    else if (!isOnline) statusType = 'offline';
    else if (pendingCount > 0 && !v2Active) statusType = 'syncing';

    const handleForceSync = () => {
        setIsOnline(navigator.onLine);
        void checkQueue();
        if (!REMOTE_OPERATIONS_PAUSED && navigator.onLine) {
            offlineQueueService.syncPendingSales().catch(() => {});
        }
    };

    return (
        <div className="flex flex-col items-start gap-1">
            <button
                onClick={handleForceSync}
                className={`flex items-center justify-center gap-1.5 px-2 sm:px-3 py-1.5 sm:py-2 rounded-full text-[10px] sm:text-xs font-bold tracking-wider transition-all duration-300 shadow-sm border focus:outline-none focus:ring-2 focus:ring-offset-1 ${
                    statusType === 'online'
                        ? 'bg-emerald-50 border-emerald-100 text-emerald-600 focus:ring-emerald-500 hover:bg-emerald-100'
                        : statusType === 'syncing' || statusType === 'paused'
                        ? 'bg-amber-50 border-amber-100 text-amber-600 focus:ring-amber-500 hover:bg-amber-100'
                        : 'bg-rose-50 border-rose-100 text-rose-500 animate-pulse focus:ring-rose-500'
                }`}
                title={statusType === 'paused' ? CLOUD_PAUSE_MESSAGE : statusType === 'online' ? 'El navegador tiene conexión; no se ha consultado la disponibilidad de Supabase' : statusType === 'syncing' ? `${pendingCount} transacciones pendientes` : 'Sin conexión'}
            >
                {statusType === 'paused' && <><AlertTriangle size={13} strokeWidth={2.5} /><span>Sync pausada{pendingCount > 0 ? ` (${pendingCount})` : ''}</span></>}
                {statusType === 'online' && <><Wifi size={13} strokeWidth={2.5} /><span className="hidden sm:inline">Online</span></>}
                {statusType === 'syncing' && <><RefreshCw size={13} strokeWidth={2.5} className="animate-spin-slow" /><span className="hidden sm:inline">Sync ({pendingCount})</span><span className="sm:hidden">{pendingCount}</span></>}
                {statusType === 'offline' && <><WifiOff size={13} strokeWidth={2.5} /><span>Offline</span></>}
            </button>

            {!v2Active && REMOTE_OPERATIONS_PAUSED && (
                <p role="status" className="hidden sm:block max-w-xs text-[10px] text-amber-800 dark:text-amber-200">
                    Operación local; pendientes conservados en este equipo. Sin envío a la nube.
                </p>
            )}

            {/* Banner ventas fallidas */}
            {showFailedBanner && failedCount > 0 && (
                <button
                    onClick={() => setShowErrorModal(true)}
                    className="flex items-center gap-1.5 px-2 py-1 bg-red-50 border border-red-200 rounded-lg text-[10px] text-red-600 font-medium max-w-[200px] hover:bg-red-100 transition-colors text-left"
                >
                    <AlertTriangle size={11} className="shrink-0" />
                    <span className="truncate flex-1">{failedCount} venta{failedCount > 1 ? 's' : ''} no sincronizada{failedCount > 1 ? 's' : ''}</span>
                    <ChevronRight size={10} className="shrink-0" />
                </button>
            )}

            {/* Modal de errores — renderizado en body para evitar problemas de z-index */}
            {showErrorModal && ReactDOM.createPortal(
                <div
                    className="fixed inset-0 z-[200] bg-slate-950/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
                    onClick={() => setShowErrorModal(false)}
                >
                    <div
                        role="dialog"
                        aria-modal="true"
                        aria-label="Log de sincronización"
                        className="bg-white dark:bg-slate-900 w-full sm:max-w-md sm:rounded-2xl rounded-t-[2rem] p-5 shadow-2xl max-h-[80vh] flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between mb-4 shrink-0">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
                                    <AlertTriangle size={16} className="text-red-500" />
                                </div>
                                <div>
                                    <p className="text-sm font-black text-slate-800 dark:text-white">Log de Sincronización</p>
                                    <p className="text-[10px] text-slate-400">{failedCount} venta{failedCount > 1 ? 's' : ''} con error</p>
                                </div>
                            </div>
                            <button onClick={() => setShowErrorModal(false)} className="modal-close text-slate-400 hover:text-slate-600">
                                <X size={18} />
                            </button>
                        </div>

                        <div className="overflow-y-auto flex-1 space-y-2 mb-4">
                            {failedItems.map((item, i) => {
                                const d = new Date(item.created_at);
                                const totalUsd = item.payload?.total;
                                return (
                                    <div key={item.id} className="bg-red-50 dark:bg-red-900/10 border border-red-100 dark:border-red-900/30 rounded-xl p-3 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-xs font-black text-slate-700 dark:text-slate-200">
                                                {totalUsd != null ? `$${Number(totalUsd).toFixed(2)}` : 'Venta offline'}
                                            </span>
                                            <div className="flex items-center gap-2">
                                                <span className="text-[9px] bg-red-100 dark:bg-red-900/40 text-red-500 px-1.5 py-0.5 rounded font-bold uppercase">
                                                    {item.attempts || 0} intentos
                                                </span>
                                                <span className="text-[10px] text-slate-400">
                                                    {d.toLocaleString('es-VE', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                            </div>
                                        </div>
                                        <p className="text-[10px] text-red-600 dark:text-red-400 font-mono break-all leading-snug bg-red-100/50 dark:bg-red-900/20 rounded px-2 py-1.5">
                                            {item.last_error || 'Error desconocido'}
                                        </p>
                                    </div>
                                );
                            })}
                        </div>

                        <div className="flex gap-2 shrink-0">
                            <button
                                onClick={handleCopyLogs}
                                className="py-2.5 px-3 text-xs font-bold rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200"
                            >
                                {copied ? <><Check size={14} /> Copiado</> : <><Copy size={14} /></>}
                            </button>
                            <button
                                onClick={handleRetryFailed}
                                disabled={REMOTE_OPERATIONS_PAUSED || isRetrying || !isOnline}
                                className="flex-1 py-2.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                                <RotateCcw size={13} className={isRetrying ? 'animate-spin' : ''} />
                                {isRetrying ? 'Reintentando...' : 'Reintentar todas'}
                            </button>
                            <button
                                onClick={handleDismissFailed}
                                disabled={REMOTE_OPERATIONS_PAUSED}
                                title={REMOTE_OPERATIONS_PAUSED ? CLOUD_PAUSE_MESSAGE : undefined}
                                className="py-2.5 px-3 text-xs font-bold text-white bg-red-500 hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all active:scale-95"
                            >
                                Descartar
                            </button>
                        </div>
                    </div>
                </div>
            , document.body)}
        </div>
    );
}
