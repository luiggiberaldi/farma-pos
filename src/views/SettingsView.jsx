import React, { useState, useRef } from 'react';
import localforage from 'localforage';
import {
    Store, CreditCard, Database, Users,
    AlertTriangle, Download, Upload, Share2,
    Sun, Moon, LogOut, Trash2, Copy, Check,
    ChevronRight, ShieldCheck, Package, Printer, BadgeCheck, CloudUpload
} from 'lucide-react';
import { storageService } from '../utils/storageService';
import { broadcastFactoryReset, broadcastForceReload } from '../hooks/useCloudSync';
import { showToast } from '../components/Toast';
import PaymentMethodsManager from '../components/Settings/PaymentMethodsManager';
import UsersManager from '../components/Settings/UsersManager';
import AuditLogViewer from '../components/Settings/AuditLogViewer';
import { useSecurity } from '../hooks/useSecurity';
import { useNotifications } from '../hooks/useNotifications';
import { supabaseCloud } from '../config/supabaseCloud';
import { useProductContext } from '../context/ProductContext';
import { useAuthStore } from '../hooks/store/useAuthStore';
import ShareInventoryModal from '../components/ShareInventoryModal';
import { useAudit } from '../hooks/useAudit';
import { useConfirm } from '../hooks/useConfirm.jsx';
import SettingsTabNegocio from '../components/Settings/tabs/SettingsTabNegocio';
import SettingsTabVentas from '../components/Settings/tabs/SettingsTabVentas';
import SettingsTabUsuarios from '../components/Settings/tabs/SettingsTabUsuarios';
import SettingsTabSistema from '../components/Settings/tabs/SettingsTabSistema';
import SettingsTabLicencia from '../components/Settings/tabs/SettingsTabLicencia';

// ─── Tab config ───────────────────────────────────────────────────────────────
const TABS = [
    { id: 'negocio',   label: 'Negocio',   icon: Store,        color: 'indigo' },
    { id: 'ventas',    label: 'Ventas',     icon: CreditCard,   color: 'emerald' },
    { id: 'usuarios',  label: 'Usuarios',   icon: Users,        color: 'violet', adminOnly: true },
    { id: 'licencia',  label: 'Licencia',   icon: BadgeCheck,   color: 'sky',    adminOnly: true },
    { id: 'sistema',   label: 'Sistema',    icon: Database,     color: 'amber' },
];

const COLOR_MAP = {
    indigo:  { pill: 'bg-indigo-500',  icon: 'text-indigo-500',  iconBg: 'bg-indigo-50 dark:bg-indigo-500/10',  pillText: 'text-white' },
    emerald: { pill: 'bg-emerald-500', icon: 'text-emerald-500', iconBg: 'bg-emerald-50 dark:bg-emerald-500/10', pillText: 'text-white' },
    violet:  { pill: 'bg-violet-500',  icon: 'text-violet-500',  iconBg: 'bg-violet-50 dark:bg-violet-500/10',  pillText: 'text-white' },
    sky:     { pill: 'bg-sky-500',     icon: 'text-sky-500',     iconBg: 'bg-sky-50 dark:bg-sky-500/10',       pillText: 'text-white' },
    amber:   { pill: 'bg-amber-500',   icon: 'text-amber-500',   iconBg: 'bg-amber-50 dark:bg-amber-500/10',   pillText: 'text-white' },
};

// ─── Main ──────────────────────────────────────────────────────────────────────
export default function SettingsView({ onClose, theme, toggleTheme, triggerHaptic }) {
    const {
        products, categories, setProducts, setCategories,
        copEnabled, setCopEnabled,
        autoCopEnabled, setAutoCopEnabled,
        tasaCopManual, setTasaCopManual,
        tasaCop: calculatedTasaCop
    } = useProductContext();

    const isAdmin = useAuthStore(s => s.usuarioActivo)?.rol === 'ADMIN';
    const requireLogin = useAuthStore(s => s.requireLogin ?? false);
    const setRequireLogin = useAuthStore(s => s.setRequireLogin);
    const adminEmail = useAuthStore(s => s.adminEmail);
    const adminPassword = useAuthStore(s => s.adminPassword);
    const setAdminCredentials = useAuthStore(s => s.setAdminCredentials);

    const { deviceId, forceHeartbeat } = useSecurity();
    const { log: auditLog } = useAudit();
    const confirm = useConfirm();
    const fileInputRef = useRef(null);

    const [activeTab, setActiveTab] = useState('negocio');
    const [idCopied, setIdCopied] = useState(false);
    const [isShareOpen, setIsShareOpen] = useState(false);
    const [importStatus, setImportStatus] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
    const [deleteInput, setDeleteInput] = useState('');
    const [showFactoryReset, setShowFactoryReset] = useState(false);
    const [factoryResetInput, setFactoryResetInput] = useState('');

    const [businessName, setBusinessName] = useState(localStorage.getItem('business_name') || '');
    const [businessRif, setBusinessRif] = useState(localStorage.getItem('business_rif') || '');
    const [paperWidth, setPaperWidth] = useState(localStorage.getItem('printer_paper_width') || '58');
    const [printerMode, setPrinterMode] = useState(localStorage.getItem('printer_mode') || 'thermal');
    const [allowNegativeStock, setAllowNegativeStock] = useState(localStorage.getItem('allow_negative_stock') !== 'false');
    const [autoLockMinutes, setAutoLockMinutes] = useState(localStorage.getItem('admin_auto_lock_minutes') || '5');

    const isCloudConfigured = Boolean(adminEmail);
    // Sin PIN activo, tratar a todos como admin para mostrar todas las pestañas
    const pinLoginEnabled = requireLogin && isCloudConfigured;
    const effectiveAdmin = isAdmin || !pinLoginEnabled;
    const [showPostImportCloud, setShowPostImportCloud] = useState(false);

    const handleSaveBusinessData = () => {
        localStorage.setItem('business_name', businessName);
        localStorage.setItem('business_rif', businessRif);
        localStorage.setItem('printer_paper_width', paperWidth);
        localStorage.setItem('allow_negative_stock', allowNegativeStock.toString());
        showToast('Datos guardados correctamente', 'success');
        triggerHaptic?.('light');
    };

    const handleForceRemoteReload = async () => {
        try {
            const { data: { session } } = await supabaseCloud.auth.getSession();
            if (!session?.user?.id) {
                showToast('No hay sesión activa en la nube', 'error');
                return;
            }
            showToast('Enviando señal de actualización...', 'info');
            await broadcastForceReload(session.user.id);
            showToast('Señal de recarga enviada a los dispositivos', 'success');
            triggerHaptic?.('success');
        } catch (e) {
            showToast('Error al enviar señal: ' + e.message, 'error');
        }
    };

    const handleExport = async () => {
        try {
            setImportStatus('loading');
            setStatusMessage('Generando backup completo...');
            const idbKeys = [
                'bodega_products_v1', 'my_categories_v1',
                'bodega_sales_v1', 'bodega_customers_v1',
                'bodega_suppliers_v1', 'bodega_supplier_invoices_v1',
                'bodega_accounts_v2', 'bodega_pending_cart_v1',
                'payment_methods_v1', 'payment_methods_v2'
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
            const blob = new Blob([JSON.stringify({ timestamp: new Date().toISOString(), version: '2.0', appName: 'Listo_POS', data: { idb: idbData, ls: lsData } })], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = `backup_listo_pos_${new Date().toISOString().slice(0,10)}.json`;
            document.body.appendChild(a); a.click(); document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setImportStatus('success'); setStatusMessage('Backup descargado.');
            auditLog('SISTEMA', 'BACKUP_EXPORTADO', 'Backup completo exportado');
            setTimeout(() => setImportStatus(null), 3000);
        } catch (error) {
            setImportStatus('error'); setStatusMessage('Error al generar backup.');
        }
    };

    const handleImportClick = () => fileInputRef.current?.click();

    const handleFileChange = (event) => {
        const file = event.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                setImportStatus('loading'); setStatusMessage('Restaurando...');
                const json = JSON.parse(e.target.result);
                if (!json.data) throw new Error('Formato invalido.');
                // Bypass storageService to prevent app_storage_update events from firing.
                // If events fire, ProductContext auto-save overwrites the imported products
                // with the old in-memory state before the page reloads.
                const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                if (json.version === '2.0' && json.data.idb) {
                    for (const [key, value] of Object.entries(json.data.idb)) await lf.setItem(key, value);
                    if (json.data.ls) for (const [key, value] of Object.entries(json.data.ls)) localStorage.setItem(key, value);
                } else {
                    if (json.data.bodega_products_v1) await lf.setItem('bodega_products_v1', typeof json.data.bodega_products_v1 === 'string' ? JSON.parse(json.data.bodega_products_v1) : json.data.bodega_products_v1);
                }
                setImportStatus('success'); setStatusMessage('Restauracion finalizada.');
                auditLog('SISTEMA', 'BACKUP_IMPORTADO', 'Backup restaurado'); triggerHaptic?.();
                // Check if imported data has cloud credentials
                const importedAuth = json.data?.ls?.['abasto-auth-storage'];
                let hasCloudInBackup = false;
                try { hasCloudInBackup = importedAuth && !!JSON.parse(importedAuth)?.state?.adminEmail; } catch {}
                if (!hasCloudInBackup) {
                    setShowPostImportCloud(true);
                } else {
                    setTimeout(() => window.location.reload(), 1500);
                }
            } catch {
                setImportStatus('error'); setStatusMessage('Error: archivo corrupto o invalido.');
            }
        };
        reader.readAsText(file);
    };

    const visibleTabs = TABS.filter(t => !t.adminOnly || effectiveAdmin);
    const currentTab = visibleTabs.find(t => t.id === activeTab) || visibleTabs[0];
    const colors = COLOR_MAP[currentTab?.color] || COLOR_MAP.indigo;

    // ─── RENDER ────────────────────────────────────────────────────────────────
    return (
        <div className="flex-1 flex flex-col min-h-0 bg-slate-50 dark:bg-slate-950 overflow-hidden">

            {/* ── Header ── */}
            <div className="shrink-0 bg-white dark:bg-slate-900 border-b border-slate-100 dark:border-slate-800">
                <div className="px-4 pt-4 pb-0">
                    {/* Title row */}
                    <div className="flex items-center justify-between mb-4">
                        <div>
                            <h1 className="text-xl font-black text-slate-900 dark:text-white tracking-tight">Configuración</h1>
                            <p className="text-[11px] text-slate-400 font-medium mt-0.5">
                                {businessName || 'Tu negocio'}
                            </p>
                        </div>
                        {/* Cloud session badge + logout */}
                        {effectiveAdmin && adminEmail && (
                            <button
                                onClick={async () => {
                                    const ok = await confirm({
                                        title: 'Cerrar sesión',
                                        message: 'Se cerrará tu acceso a la nube. Deberás iniciar sesión nuevamente.',
                                        confirmText: 'Cerrar sesión',
                                        cancelText: 'Cancelar',
                                        variant: 'logout',
                                    });
                                    if (!ok) return;
                                    await supabaseCloud.auth.signOut();
                                    window.location.reload();
                                }}
                                className="flex items-center gap-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-full pl-2.5 pr-3 py-1.5 group hover:border-rose-300 dark:hover:border-rose-700 transition-colors"
                            >
                                <div className="w-5 h-5 rounded-full bg-indigo-500 flex items-center justify-center">
                                    <span className="text-[8px] font-black text-white uppercase">{adminEmail[0]}</span>
                                </div>
                                <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400 max-w-[80px] truncate group-hover:text-rose-500 transition-colors">{adminEmail}</span>
                                <LogOut size={11} className="text-slate-400 group-hover:text-rose-500 transition-colors" />
                            </button>
                        )}
                    </div>

                    {/* Pill tab navigator */}
                    <div className="flex gap-1.5 pb-3 overflow-x-auto scrollbar-hide">
                        {visibleTabs.map(tab => {
                            const Icon = tab.icon;
                            const isActive = activeTab === tab.id;
                            const c = COLOR_MAP[tab.color];
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => { setActiveTab(tab.id); triggerHaptic?.(); }}
                                    className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition-all duration-200 ${
                                        isActive
                                            ? `${c.pill} ${c.pillText} shadow-md scale-105`
                                            : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    <Icon size={14} />
                                    <span className="hidden sm:inline">{tab.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* ── Body ── */}
            <div className="flex-1 overflow-y-auto pb-20 lg:pb-14">
                <div className="max-w-lg mx-auto p-4 lg:p-3 space-y-4 lg:space-y-3">

                    {/* Section header accent */}
                    <div className={`flex items-center gap-2.5 px-4 py-3 rounded-2xl ${colors.iconBg}`}>
                        {React.createElement(currentTab?.icon || Store, { size: 16, className: colors.icon })}
                        <span className={`text-xs font-black tracking-wide uppercase ${colors.icon}`}>
                            {currentTab?.label}
                        </span>
                    </div>

                    {/* ═══ TAB NEGOCIO ═══ */}
                    {activeTab === 'negocio' && (
                        <SettingsTabNegocio
                            businessName={businessName} setBusinessName={setBusinessName}
                            businessRif={businessRif} setBusinessRif={setBusinessRif}
                            paperWidth={paperWidth} setPaperWidth={setPaperWidth}
                            printerMode={printerMode} setPrinterMode={setPrinterMode}
                            copEnabled={copEnabled} setCopEnabled={setCopEnabled}
                            autoCopEnabled={autoCopEnabled} setAutoCopEnabled={setAutoCopEnabled}
                            tasaCopManual={tasaCopManual} setTasaCopManual={setTasaCopManual}
                            calculatedTasaCop={calculatedTasaCop}
                            handleSaveBusinessData={handleSaveBusinessData}
                            forceHeartbeat={forceHeartbeat}
                            showToast={showToast}
                            triggerHaptic={triggerHaptic}
                        />
                    )}

                    {/* ═══ TAB VENTAS ═══ */}
                    {activeTab === 'ventas' && (
                        <SettingsTabVentas
                            allowNegativeStock={allowNegativeStock} setAllowNegativeStock={setAllowNegativeStock}
                            forceHeartbeat={forceHeartbeat}
                            showToast={showToast}
                            triggerHaptic={triggerHaptic}
                        />
                    )}

                    {/* ═══ TAB USUARIOS ═══ */}
                    {activeTab === 'usuarios' && effectiveAdmin && (
                        <SettingsTabUsuarios
                            isCloudConfigured={isCloudConfigured} adminEmail={adminEmail}
                            requireLogin={requireLogin} setRequireLogin={setRequireLogin}
                            autoLockMinutes={autoLockMinutes} setAutoLockMinutes={setAutoLockMinutes}
                            setAdminCredentials={setAdminCredentials} showToast={showToast}
                            triggerHaptic={triggerHaptic}
                        />
                    )}

                    {/* ═══ TAB LICENCIA ═══ */}
                    {activeTab === 'licencia' && effectiveAdmin && (
                        <SettingsTabLicencia
                            isCloudConfigured={isCloudConfigured}
                            adminEmail={adminEmail}
                        />
                    )}

                    {/* ═══ TAB SISTEMA ═══ */}
                    {activeTab === 'sistema' && (
                        <SettingsTabSistema
                            theme={theme} toggleTheme={toggleTheme}
                            deviceId={deviceId} idCopied={idCopied} setIdCopied={setIdCopied}
                            isAdmin={isAdmin}
                            importStatus={importStatus} statusMessage={statusMessage}
                            handleExport={handleExport}
                            handleImportClick={handleImportClick}
                            setIsShareOpen={() => setIsShareOpen(true)}
                            setShowFactoryReset={setShowFactoryReset}
                            triggerHaptic={triggerHaptic}
                            isCloudConfigured={isCloudConfigured}
                            handleForceRemoteReload={handleForceRemoteReload}
                        />
                    )}

                    {/* Version footer */}
                    <div className="text-center pt-2 pb-1">
                        <p className="text-[10px] text-slate-300 dark:text-slate-700 font-bold tracking-widest uppercase">
                            Listo POS Lite · v1.0
                        </p>
                    </div>
                </div>
            </div>

            {/* ── Factory Reset Modal ── */}
            {showFactoryReset && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200" onClick={() => setShowFactoryReset(false)}>
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 text-center" onClick={e => e.stopPropagation()}>
                        <div className="w-16 h-16 mx-auto bg-red-100 dark:bg-red-900/30 text-red-500 rounded-2xl flex items-center justify-center mb-4">
                            <AlertTriangle size={28} />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">Reinicio de Fábrica</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
                            Se eliminará <strong>todo</strong>: inventario, ventas, clientes, cuentas, configuraciones y usuarios. La app quedará como recién instalada. Escribe <span className="font-mono font-black text-red-500">REINICIAR</span> para confirmar:
                        </p>
                        <input
                            type="text"
                            value={factoryResetInput}
                            onChange={e => setFactoryResetInput(e.target.value.toUpperCase())}
                            placeholder="REINICIAR"
                            className="w-full bg-slate-50 dark:bg-slate-950 border-2 border-slate-200 dark:border-slate-800 focus:border-red-400 rounded-xl px-4 py-3 text-center font-mono font-bold text-slate-800 dark:text-white mb-4 outline-none uppercase transition-colors"
                            autoFocus
                        />
                        <div className="flex gap-3">
                            <button onClick={() => { setShowFactoryReset(false); setFactoryResetInput(''); }} className="flex-1 py-3.5 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all">
                                Cancelar
                            </button>
                            <button
                                disabled={factoryResetInput !== 'REINICIAR'}
                                onClick={async () => {
                                    if (factoryResetInput !== 'REINICIAR') return;
                                    triggerHaptic?.();

                                    // ── FASE 1: Operaciones de NUBE (mientras la sesión está viva) ──
                                    // Hacemos todo lo de nube ANTES de tocar localStorage para que
                                    // el token de Supabase siga activo durante el delete.
                                    let cloudSession = null;
                                    try {
                                        const { data: { session } } = await supabaseCloud.auth.getSession();
                                        cloudSession = session;
                                    } catch (e) { /* sin nube */ }

                                    if (cloudSession?.user?.id) {
                                        try {
                                            // Broadcast a otros equipos primero
                                            await broadcastFactoryReset(cloudSession.user.id);
                                            // Borrar datos de la nube (sesión activa garantizada)
                                            await supabaseCloud.from('sync_documents').delete().eq('user_id', cloudSession.user.id);
                                            await supabaseCloud.from('cloud_backups').delete().eq('email', cloudSession.user.email);
                                            await supabaseCloud.from('device_backups').delete().eq('device_id', localStorage.getItem('pda_device_id') || '');
                                            await supabaseCloud.auth.signOut();
                                        } catch (e) { /* ignorar */ }
                                    }

                                    // ── FASE 2: Limpiar TODO el almacenamiento local ──
                                    // IndexedDB principal
                                    await localforage.clear();
                                    // IndexedDB legacy (TasasAlDiaApp — fuente de migración automática)
                                    try {
                                        const oldStore = localforage.createInstance({ name: 'TasasAlDiaApp', storeName: 'app_data' });
                                        await oldStore.clear();
                                    } catch (e) { /* no existe */ }
                                    // Eliminar bases de datos IndexedDB por completo (más agresivo que .clear())
                                    try {
                                        indexedDB.deleteDatabase('BodegaApp');
                                        indexedDB.deleteDatabase('TasasAlDiaApp');
                                    } catch (e) { /* ignorar */ }
                                    // localStorage y sessionStorage
                                    localStorage.clear();
                                    sessionStorage.clear();
                                    // Cachés del service worker
                                    try {
                                        if ('caches' in window) {
                                            const cacheKeys = await caches.keys();
                                            await Promise.all(cacheKeys.map(k => caches.delete(k)));
                                        }
                                        if ('serviceWorker' in navigator) {
                                            const regs = await navigator.serviceWorker.getRegistrations();
                                            await Promise.all(regs.map(r => r.unregister()));
                                        }
                                    } catch (e) { /* ignorar */ }

                                    // ── FASE 3: Recargar ──
                                    // Flag para que el Pull Inicial de cloud sync sea skipped en este arranque
                                    sessionStorage.setItem('skip_cloud_pull', '1');
                                    window.location.reload();
                                }}
                                className="flex-1 py-3.5 text-sm font-bold text-white bg-red-500 rounded-xl hover:bg-red-600 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                Reiniciar
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* ── Post-Import: Vincular cuenta cloud ── */}
            {showPostImportCloud && (
                <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl animate-in zoom-in-95 duration-200 text-center" onClick={e => e.stopPropagation()}>
                        <div className="w-16 h-16 mx-auto bg-indigo-100 dark:bg-indigo-900/30 text-indigo-500 rounded-2xl flex items-center justify-center mb-4">
                            <CloudUpload size={28} />
                        </div>
                        <h3 className="text-lg font-black text-slate-800 dark:text-white mb-2">Backup importado</h3>
                        <p className="text-sm text-slate-500 dark:text-slate-400 mb-5 leading-relaxed">
                            El backup no tenía cuenta cloud vinculada. ¿Deseas conectar una cuenta ahora para activar la licencia y sincronización?
                        </p>
                        <div className="flex gap-3">
                            <button
                                onClick={() => {
                                    setShowPostImportCloud(false);
                                    setTimeout(() => window.location.reload(), 300);
                                }}
                                className="flex-1 py-3.5 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all"
                            >
                                Ahora no
                            </button>
                            <button
                                onClick={() => {
                                    setShowPostImportCloud(false);
                                    setActiveTab('usuarios');
                                    // Scroll to top to show the cloud login section
                                    setTimeout(() => window.scrollTo({ top: 0, behavior: 'smooth' }), 100);
                                }}
                                className="flex-1 py-3.5 text-sm font-bold text-white bg-indigo-500 rounded-xl hover:bg-indigo-600 active:scale-95 transition-all flex items-center justify-center gap-2"
                            >
                                <CloudUpload size={16} /> Vincular cuenta
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <ShareInventoryModal
                isOpen={isShareOpen}
                onClose={() => setIsShareOpen(false)}
            />

            <input ref={fileInputRef} type="file" accept=".json" className="hidden" onChange={handleFileChange} />
        </div>
    );
}
