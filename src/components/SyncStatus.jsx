import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom';
import { Wifi, WifiOff, RefreshCw, AlertTriangle, X, ChevronRight, Copy, Check, RotateCcw } from 'lucide-react';
import { supabaseCloud as supabase } from '../config/supabaseCloud';
import { offlineQueueService } from '../services/offlineQueueService';

export default function SyncStatus() {
    const [isOnline, setIsOnline] = useState(navigator.onLine);
    const [pendingCount, setPendingCount] = useState(0);
    const [failedCount, setFailedCount] = useState(0);
    const [showFailedBanner, setShowFailedBanner] = useState(false);
    const [showErrorModal, setShowErrorModal] = useState(false);
    const [failedItems, setFailedItems] = useState([]);
    const [copied, setCopied] = useState(false);

    const checkHealth = async () => {
        if (!navigator.onLine) {
            setIsOnline(false);
            return;
        }
        try {
            const pingPromise = supabase.from('sync_documents').select('doc_id').limit(1);
            const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
            const result = await Promise.race([pingPromise, timeoutPromise]);
            if (result.error) throw result.error;
            setIsOnline(true);
            offlineQueueService.syncPendingSales().catch(() => {});
        } catch (err) {
            setIsOnline(false);
        }
    };

    const checkQueue = async () => {
        try {
            const queue = await offlineQueueService.getQueue();
            const pending = queue.filter(q => q.sync_status === 'pending');
            const failed = queue.filter(q => q.sync_status === 'failed');
            setPendingCount(pending.length);
            setFailedCount(failed.length);
            setFailedItems(failed);
            if (failed.length > 0) setShowFailedBanner(true);
        } catch(err) {
            console.error('[SyncStatus] Error al leer cola', err);
        }
    };

    const [isRetrying, setIsRetrying] = useState(false);

    const handleDismissFailed = async (e) => {
        e.stopPropagation();
        await offlineQueueService.dismissFailed();
        setFailedCount(0);
        setFailedItems([]);
        setShowFailedBanner(false);
        setShowErrorModal(false);
    };

    const handleRetryFailed = async (e) => {
        e.stopPropagation();
        setIsRetrying(true);
        try {
            await offlineQueueService.retryFailed();
            await checkQueue();
            setShowErrorModal(false);
        } finally {
            setIsRetrying(false);
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
        doCopy().then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }).catch(() => {
            setCopied(false);
        });
    };

    useEffect(() => {
        let mounted = true;
        const goOnline = () => checkHealth();
        const goOffline = () => { if(mounted) setIsOnline(false); };

        window.addEventListener('online', goOnline);
        window.addEventListener('offline', goOffline);

        checkHealth();
        checkQueue();

        const healthInterval = setInterval(checkHealth, 900000);
        const queueInterval = setInterval(checkQueue, 15000);

        return () => {
            mounted = false;
            window.removeEventListener('online', goOnline);
            window.removeEventListener('offline', goOffline);
            clearInterval(healthInterval);
            clearInterval(queueInterval);
        };
    }, []);

    let statusType = 'online';
    if (!isOnline) statusType = 'offline';
    else if (pendingCount > 0) statusType = 'syncing';

    const handleForceSync = () => {
        checkHealth();
        if (isOnline) {
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
                        : statusType === 'syncing'
                        ? 'bg-amber-50 border-amber-100 text-amber-600 focus:ring-amber-500 hover:bg-amber-100'
                        : 'bg-rose-50 border-rose-100 text-rose-500 animate-pulse focus:ring-rose-500'
                }`}
                title={statusType === 'online' ? 'Conectado' : statusType === 'syncing' ? `${pendingCount} transacciones pendientes` : 'Sin conexión'}
            >
                {statusType === 'online' && <><Wifi size={13} strokeWidth={2.5} /><span className="hidden sm:inline">Online</span></>}
                {statusType === 'syncing' && <><RefreshCw size={13} strokeWidth={2.5} className="animate-spin-slow" /><span className="hidden sm:inline">Sync ({pendingCount})</span><span className="sm:hidden">{pendingCount}</span></>}
                {statusType === 'offline' && <><WifiOff size={13} strokeWidth={2.5} /><span>Offline</span></>}
            </button>

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
                            <button onClick={() => setShowErrorModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
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
                                disabled={isRetrying || !isOnline}
                                className="flex-1 py-2.5 text-xs font-bold text-white bg-blue-500 hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed rounded-xl transition-all active:scale-95 flex items-center justify-center gap-1.5"
                            >
                                <RotateCcw size={13} className={isRetrying ? 'animate-spin' : ''} />
                                {isRetrying ? 'Reintentando...' : 'Reintentar todas'}
                            </button>
                            <button
                                onClick={handleDismissFailed}
                                className="py-2.5 px-3 text-xs font-bold text-white bg-red-500 hover:bg-red-600 rounded-xl transition-all active:scale-95"
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
