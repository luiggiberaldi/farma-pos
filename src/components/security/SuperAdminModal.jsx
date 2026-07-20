import React, { useState } from 'react';
import { useAuthStore, hashPin } from '../../hooks/store/useAuthStore';
import { storageService } from '../../utils/storageService';
import { showToast } from '../Toast';
import { ShieldAlert, KeyRound, LogIn, RotateCcw, Download, X, Check } from 'lucide-react';

// SHA-256 de la clave maestra de desarrollador. Para cambiarla:
//   node -e "console.log(require('crypto').createHash('sha256').update('TU_CLAVE').digest('hex'))"
// Nota: esto es ocultación, no seguridad fuerte — cualquier clave embebida en
// una PWA puede extraerse del bundle. No proteger datos sensibles solo con esto.
const SUPER_ADMIN_KEY_HASH = '61b9237617f079e2241b2ffddec6a3bf5dd1b767ab8beab10d32050f651f0d1d';

export default function SuperAdminModal({ isOpen, onClose }) {
    const loginAsSuperAdmin = useAuthStore(s => s.loginAsSuperAdmin);
    const resetPinsToDefault = useAuthStore(s => s.resetPinsToDefault);

    const [step, setStep] = useState('auth'); // 'auth' | 'menu'
    const [keyInput, setKeyInput] = useState('');
    const [error, setError] = useState(false);
    const [checking, setChecking] = useState(false);
    const [confirmReset, setConfirmReset] = useState(false);
    const [pinsReset, setPinsReset] = useState(false);

    if (!isOpen) return null;

    const handleValidate = async (e) => {
        e?.preventDefault();
        if (!keyInput || checking) return;
        setChecking(true);
        const hashed = await hashPin(keyInput);
        setChecking(false);
        if (hashed === SUPER_ADMIN_KEY_HASH) {
            setStep('menu');
            setError(false);
        } else {
            setError(true);
            setKeyInput('');
        }
    };

    const handleEnterAsAdmin = () => {
        const ok = loginAsSuperAdmin();
        if (ok) {
            showToast('Sesión iniciada como Administrador', 'success');
            onClose();
        } else {
            showToast('No existe ningún usuario ADMIN', 'error');
        }
    };

    const handleResetPins = async () => {
        await resetPinsToDefault();
        setConfirmReset(false);
        setPinsReset(true);
        showToast('PINs restaurados: Admin 123456 · Cajero 0000', 'success');
    };

    const handleExportBackup = async () => {
        try {
            const idbKeys = [
                'bodega_products_v1', 'my_categories_v1',
                'bodega_sales_v1', 'bodega_customers_v1',
                'bodega_suppliers_v1', 'bodega_supplier_invoices_v1',
                'bodega_accounts_v2', 'bodega_pending_cart_v1',
                'payment_methods_v1', 'payment_methods_v2', 'abasto_audit_log_v1'
            ];
            const idbData = {};
            for (const key of idbKeys) {
                const data = await storageService.getItem(key, null);
                if (data !== null) idbData[key] = data;
            }
            const lsKeys = [
                'premium_token', 'street_rate_bs', 'catalog_use_auto_usdt',
                'catalog_custom_usdt_price', 'catalog_show_cash_price',
                'monitor_rates_v12', 'business_name', 'business_rif',
                'printer_paper_width', 'printer_mode', 'allow_negative_stock', 'cop_enabled',
                'auto_cop_enabled', 'tasa_cop', 'bodega_use_auto_rate',
                'bodega_custom_rate', 'bodega_inventory_view'
            ];
            const lsData = {};
            for (const key of lsKeys) {
                const val = localStorage.getItem(key);
                if (val !== null) lsData[key] = val;
            }
            const blob = new Blob([JSON.stringify({
                timestamp: new Date().toISOString(),
                version: '2.0',
                appName: 'Listo_POS',
                data: { idb: idbData, ls: lsData }
            })], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `rescate_listo_pos_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            showToast('Backup de rescate descargado', 'success');
        } catch (e) {
            showToast('Error exportando backup: ' + e.message, 'error');
        }
    };

    const deviceId = localStorage.getItem('pda_device_id') || 'SIN-ID';

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-amber-100 dark:bg-amber-900/30 text-amber-500 rounded-2xl flex items-center justify-center">
                            <ShieldAlert size={22} />
                        </div>
                        <div>
                            <h3 className="text-base font-black text-slate-800 dark:text-white leading-tight">Super Admin</h3>
                            <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">Acceso de emergencia</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                        <X size={16} />
                    </button>
                </div>

                {step === 'auth' ? (
                    <form onSubmit={handleValidate} className="space-y-3">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Clave maestra</label>
                        <div className="relative">
                            <KeyRound size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="password"
                                value={keyInput}
                                onChange={e => { setKeyInput(e.target.value); setError(false); }}
                                autoFocus
                                autoComplete="off"
                                className={`w-full bg-slate-50 dark:bg-slate-800 border rounded-xl py-3 pl-9 pr-3 text-sm font-bold text-slate-700 dark:text-white outline-none focus:ring-2 transition-all ${error ? 'border-red-300 focus:ring-red-500/30 animate-pulse' : 'border-slate-200 dark:border-slate-700 focus:ring-amber-500/30'}`}
                                placeholder="••••••••••••"
                            />
                        </div>
                        {error && (
                            <p className="text-[11px] font-bold text-red-500">Clave incorrecta</p>
                        )}
                        <button
                            type="submit"
                            disabled={!keyInput || checking}
                            className="w-full py-3 bg-amber-500 text-white font-bold text-sm rounded-xl hover:bg-amber-600 active:scale-[0.98] transition-all disabled:opacity-50 flex items-center justify-center gap-2"
                        >
                            {checking
                                ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                : <>Validar</>}
                        </button>
                    </form>
                ) : (
                    <div className="space-y-2">
                        <button
                            onClick={handleEnterAsAdmin}
                            className="w-full p-3.5 bg-sky-500 text-white rounded-xl hover:bg-sky-600 active:scale-[0.98] transition-all flex items-center gap-3"
                        >
                            <LogIn size={16} />
                            <span className="text-sm font-bold">Entrar como Administrador</span>
                        </button>

                        {confirmReset ? (
                            <div className="p-3 bg-red-50 dark:bg-red-950/40 rounded-xl border border-red-100 dark:border-red-800/30 space-y-2">
                                <p className="text-[11px] font-bold text-red-500">
                                    Se restaurarán los PINs de fábrica (Admin: 123456, resto: 0000). ¿Continuar?
                                </p>
                                <div className="flex gap-2">
                                    <button onClick={() => setConfirmReset(false)} className="flex-1 py-2 text-xs font-bold text-slate-500 bg-white dark:bg-slate-800 rounded-lg active:scale-95 transition-all">
                                        Cancelar
                                    </button>
                                    <button onClick={handleResetPins} className="flex-1 py-2 text-xs font-bold text-white bg-red-500 rounded-lg hover:bg-red-600 active:scale-95 transition-all">
                                        Sí, resetear
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <button
                                onClick={() => setConfirmReset(true)}
                                disabled={pinsReset}
                                className="w-full p-3.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] transition-all flex items-center gap-3 disabled:opacity-60"
                            >
                                {pinsReset ? <Check size={16} className="text-emerald-500" /> : <RotateCcw size={16} />}
                                <span className="text-sm font-bold">{pinsReset ? 'PINs restaurados' : 'Resetear PINs de fábrica'}</span>
                            </button>
                        )}

                        <button
                            onClick={handleExportBackup}
                            className="w-full p-3.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.98] transition-all flex items-center gap-3"
                        >
                            <Download size={16} />
                            <span className="text-sm font-bold">Exportar backup local (JSON)</span>
                        </button>

                        <p className="text-[9px] text-slate-400 font-bold text-center pt-2 tracking-wider uppercase">
                            Dispositivo: {deviceId}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
