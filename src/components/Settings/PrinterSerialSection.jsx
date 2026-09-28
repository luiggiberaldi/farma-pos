/**
 * PrinterSerialSection.jsx
 * Sección de configuración de Impresora USB & Cajón (Web Serial API)
 * Se monta dentro de SettingsTabNegocio.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Usb, Plug, Zap, PackageOpen, ToggleLeft } from 'lucide-react';
import { PrinterSerial } from '../../services/PrinterSerial';
import { Toggle } from '../SettingsShared';

export default function PrinterSerialSection({ showToast, triggerHaptic }) {
    const [connected, setConnected]       = useState(false);
    const [connecting, setConnecting]     = useState(false);
    const [testing, setTesting]           = useState(false);
    const [openingDrawer, setOpeningDrawer] = useState(false);
    const [autoDrawer, setAutoDrawer]     = useState(
        () => localStorage.getItem('printer_serial_auto_drawer') === 'true'
    );

    // Sincronizar estado de conexión si el puerto se pierde externamente
    useEffect(() => {
        const check = () => setConnected(PrinterSerial.isConnected());
        const id = setInterval(check, 2000);
        return () => clearInterval(id);
    }, []);

    const handleConnect = useCallback(async () => {
        setConnecting(true);
        try {
            if (connected) {
                await PrinterSerial.disconnect();
                setConnected(false);
                showToast?.('Impresora desconectada', 'info');
                triggerHaptic?.();
                return;
            }
            const result = await PrinterSerial.connect();
            if (result.ok) { setConnected(true); showToast?.('Impresora conectada', 'success'); }
            else showToast?.(result.error || 'No se pudo conectar', 'error');
            triggerHaptic?.();
        } catch (error) { showToast?.(error.message || 'No se pudo conectar', 'error'); }
        finally { setConnecting(false); }
    }, [connected, showToast, triggerHaptic]);

    const handleTestPrint = useCallback(async () => {
        setTesting(true);
        try {
            const result = await PrinterSerial.testPrint();
            showToast?.(result.ok ? 'Test enviado a la impresora' : result.error || 'Error al imprimir', result.ok ? 'success' : 'error');
            triggerHaptic?.();
        } catch (error) { showToast?.(error.message || 'Error al imprimir', 'error'); }
        finally { setTesting(false); }
    }, [showToast, triggerHaptic]);

    const handleOpenDrawer = useCallback(async () => {
        setOpeningDrawer(true);
        try {
            const result = await PrinterSerial.openDrawer();
            showToast?.(result.ok ? 'Pulso enviado al cajón' : result.error || 'Error al abrir cajón', result.ok ? 'success' : 'error');
            triggerHaptic?.();
        } catch (error) { showToast?.(error.message || 'Error al abrir cajón', 'error'); }
        finally { setOpeningDrawer(false); }
    }, [showToast, triggerHaptic]);

    const handleAutoDrawerToggle = useCallback(() => {
        const newVal = !autoDrawer;
        setAutoDrawer(newVal);
        localStorage.setItem('printer_serial_auto_drawer', newVal.toString());
        showToast?.(newVal ? 'Apertura automática activada' : 'Apertura automática desactivada', 'success');
        triggerHaptic?.();
    }, [autoDrawer, showToast, triggerHaptic]);

    if (!PrinterSerial.isSupported()) return null;
    return (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 overflow-hidden">
            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
                <div className="w-8 h-8 rounded-xl bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shrink-0">
                    <Usb size={16} className="text-blue-500" />
                </div>
                <div>
                    <p className="text-sm font-black text-slate-700 dark:text-slate-200">Impresora USB & Cajón</p>
                    <p className="text-[10px] text-blue-500 font-bold">Conexión nativa (Web Serial API)</p>
                </div>
            </div>

            <div className="p-4 space-y-3">
                {/* Estado de conexión */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700">
                    <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${
                            connected
                                ? 'bg-emerald-100 dark:bg-emerald-900/30'
                                : 'bg-slate-200 dark:bg-slate-700'
                        }`}>
                            <Plug size={15} className={connected ? 'text-emerald-500' : 'text-slate-400'} />
                        </div>
                        <div>
                            <p className={`text-xs font-black ${connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500 dark:text-slate-400'}`}>
                                {connected ? 'Conectado' : 'No Conectado'}
                            </p>
                            <p className="text-[9px] text-slate-400 font-medium">
                                {connected ? 'Puerto serial activo' : 'Requiere autorización'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={handleConnect}
                        disabled={connecting}
                        className={`px-4 py-2 rounded-xl text-xs font-black transition-all active:scale-95 disabled:opacity-60 ${
                            connected
                                ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-300 dark:hover:bg-slate-600'
                                : 'bg-blue-500 hover:bg-blue-400 text-white shadow-md shadow-blue-500/20'
                        }`}
                    >
                        {connecting ? 'Conectando...' : connected ? 'Desconectar' : 'Conectar'}
                    </button>
                </div>

                {/* Acciones — solo disponibles si está conectado */}
                <div className={`space-y-1 transition-opacity ${connected ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
                    {/* Test de Impresión */}
                    <div className="flex items-center justify-between py-2.5 px-1">
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Test de Impresión</p>
                            <p className="text-[10px] text-slate-400">Comando bruto ESC/POS</p>
                        </div>
                        <button
                            onClick={handleTestPrint}
                            disabled={testing || !connected}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-60 border border-slate-200 dark:border-slate-700"
                        >
                            <Zap size={13} className="text-amber-500" />
                            {testing ? 'Imprimiendo...' : 'Imprimir'}
                        </button>
                    </div>

                    {/* Prueba de Cajón */}
                    <div className="flex items-center justify-between py-2.5 px-1">
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Prueba de Cajón</p>
                            <p className="text-[10px] text-slate-400">Enviar pulso 24v a la impresora</p>
                        </div>
                        <button
                            onClick={handleOpenDrawer}
                            disabled={openingDrawer || !connected}
                            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold transition-all active:scale-95 disabled:opacity-60 border border-slate-200 dark:border-slate-700"
                        >
                            <PackageOpen size={13} className="text-blue-500" />
                            {openingDrawer ? 'Abriendo...' : 'Abrir'}
                        </button>
                    </div>

                    {/* Apertura Automática */}
                    <div className="flex items-center justify-between py-2.5 px-1 border-t border-slate-100 dark:border-slate-800 mt-1 pt-3">
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Apertura Automática</p>
                            <p className="text-[10px] text-slate-400">Al cobrar una venta</p>
                        </div>
                        <Toggle
                            enabled={autoDrawer}
                            color="blue"
                            onChange={handleAutoDrawerToggle}
                        />
                    </div>
                </div>

                {/* Nota informativa */}
                <p className="text-[9px] text-slate-400 text-center font-medium pt-1">
                    Solo disponible en Chrome / Edge desktop
                </p>
            </div>
        </div>
    );
}
