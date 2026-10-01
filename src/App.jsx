import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Home, ShoppingCart, Store, Users, Download, FlaskConical, Moon, Sun, BarChart3, X, Settings } from 'lucide-react';

import SalesView from './views/SalesView';
import DashboardView from './views/DashboardView';
import { ProductsView } from './views/ProductsView';
import SettingsView from './views/SettingsView';
import ResetPasswordView from './views/ResetPasswordView';

// Lazy-loaded views (no se usan al inicio)
const CustomersView = lazy(() => import('./views/CustomersView'));
const ReportsView = lazy(() => import('./views/ReportsView'));
const TesterView = lazy(() => import('./views/TesterView').then(m => ({ default: m.TesterView })));

import { useRates } from './hooks/useRates';
import { useSecurity } from './hooks/useSecurity';
import { ProductProvider } from './context/ProductContext';
import { CartProvider } from './context/CartContext';

import TermsOverlay from './components/TermsOverlay';
import OnboardingOverlay from './components/OnboardingOverlay';
import ErrorBoundary from './components/ErrorBoundary';
import { useAutoBackup } from './hooks/useAutoBackup';
import CommandPalette from './components/CommandPalette';
import SpotlightTour from './components/SpotlightTour';
import LockScreen from './components/security/LockScreen';
import ClockInPrompt from './components/security/ClockInPrompt';
import FactoryPinBanner from './components/security/FactoryPinBanner';
import { isFactoryPin } from './config/userProvisioning';
import CloudAuthModal from './components/security/CloudAuthModal';
import { useAuthStore } from './hooks/store/useAuthStore';
import { useAutoLock } from './hooks/useAutoLock';
import { purgeOldEntries, syncAuditToCloud } from './services/auditService';
import { useCloudSync } from './hooks/useCloudSync';
import { supabaseCloud, isCloudConfigured as envCloudConfigured } from './config/supabaseCloud';
import { useConfirm } from './hooks/confirmState.js';
import { getActiveAccountId, setActiveAccountId, ACTIVE_ACCOUNT_STORAGE_KEY, ACTIVE_SEDE_STORAGE_KEY } from './config/storageScope';
import { applyCloudSession, signOutCloudAccount } from './services/cloudSessionLifecycle.js';
import { saveSessionBackup, readSessionBackup, clearSessionBackup, restoreSessionWithRetry } from './services/cloudSessionRestore.js';
import { OPERATOR_SESSION_KEY } from './utils/operatorSession.js';
import { useSedeStore } from './hooks/store/useSedeStore';
import { REMOTE_OPERATIONS_PAUSED } from './config/operationSafety.js';
import { SUPABASE_FREE_PROFILE } from './config/supabaseFreeTier.js';
import MonitorDashboard from './components/Monitor/MonitorDashboard';

export default function App() {
  const [selectedTab, setActiveTab] = useState('inicio');
  const [monitorMode, setMonitorMode] = useState(false);
  const usuarioActivo = useAuthStore(state => state.usuarioActivo);
  const sessionLocked = useAuthStore(state => state.sessionLocked);
  const usuarios = useAuthStore(state => state.usuarios);
  // A3: la marca factoryPin persiste aunque el PIN ya esté migrado a PBKDF2.
  const factoryPinUsers = (usuarios || []).filter(u => u && (u.factoryPin === true || (!u.pinHashed && isFactoryPin(u.pin))));
  const [workspace, setWorkspace] = useState({ identity: null, mode: 'gestion' });
  const workspaceIdentity = `${getActiveAccountId() || 'local'}:${usuarioActivo?.id || 'locked'}`;
  const appMode = usuarioActivo?.rol === 'CAJERO' ? 'caja' : workspace.identity === workspaceIdentity ? workspace.mode : 'gestion';
  const activeTab = appMode === 'caja' && !['inicio', 'ventas'].includes(selectedTab) ? 'ventas' : selectedTab;
  const syncSedeWithUser = useSedeStore(state => state.syncWithUser);
  const sedeActivaId = useSedeStore(state => state.sedeActivaId);
  const [installPrompt, setInstallPrompt] = useState(() => window.deferredInstallPrompt);
  const [showIOSInstall, setShowIOSInstall] = useState(false);

  // Inicializar Sincronización Realtime con Supabase
  useCloudSync();

  useEffect(() => {
    syncSedeWithUser();
  }, [usuarioActivo, syncSedeWithUser]);

  // Migración única: clientes globales → central (no borra la clave antigua)
  useEffect(() => {
    if (!usuarioActivo) return;
    import('./utils/migrateCustomersToCentral')
      .then(({ migrateCustomersToCentral }) => migrateCustomersToCentral())
      .catch(err => console.error('[Migración] No se pudo ejecutar:', err?.message));
  }, [usuarioActivo]);

  // Migración única: productos del inventario físico 2026 → central (no duplica)
  useEffect(() => {
    if (!usuarioActivo) return;
    import('./utils/migrateMissingProducts')
      .then(({ migrateMissingProducts }) => migrateMissingProducts())
      .catch(err => console.error('[Migración] No se pudo ejecutar:', err?.message));
  }, [usuarioActivo]);

  // Monitor: subida periódica de resúmenes de sede (solo upload, no toca ventas)
  useEffect(() => {
    if (!usuarioActivo) return;
    let cancelled = false;
    let stopFn = null;
    import('./services/monitorSyncService')
      .then(({ startMonitorUpload, stopMonitorUpload }) => {
        if (cancelled) return;
        startMonitorUpload();
        stopFn = stopMonitorUpload;
      })
      .catch(err => {
        console.error('[Monitor] No se pudo cargar el servicio de subida:', err?.message);
      });
    return () => {
      cancelled = true;
      if (stopFn) stopFn();
    };
  }, [usuarioActivo]);

  // Apply saved screen scale on mount
  useEffect(() => {
    const scale = localStorage.getItem('app_screen_scale');
    if (scale && scale !== '100') {
      document.documentElement.style.zoom = `${scale}%`;
    }
  }, []);

  // Detectar iOS Safari (no standalone) para mostrar instrucciones manuales
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const showIOSButton = isIOS && !isStandalone && !localStorage.getItem('ios_install_dismissed');

  // Admin Panel States
  const [adminClicks, setAdminClicks] = useState(0);
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [showTester, setShowTester] = useState(false);
  // Terms must be accepted before the onboarding tutorial is shown;
  // otherwise the Terms overlay (z-9999) covers the tutorial's Omitir button.
  const [termsAccepted, setTermsAccepted] = useState(() => {
    try { return localStorage.getItem('pda_terms_accepted') === 'true'; } catch { return false; }
  });
  
  // Cloud Auth Session State
  const [cloudSession, setCloudSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(() => envCloudConfigured || Boolean(getActiveAccountId()));

  // ── Sesión Supabase ───────────────────────────────────────────────────────
  // Sin proyecto cloud configurado la app corre en modo local (offline total):
  // se omite el gate de sesión y el acceso queda gobernado por el PIN local.
  useEffect(() => {
    let mounted = true;

    if (!envCloudConfigured) {
      if (getActiveAccountId()) useAuthStore.getState().logout('modo local sin cuenta cloud');
      setActiveAccountId(null);
      queueMicrotask(() => { if (mounted) setCheckingSession(false); });
      return () => { mounted = false; };
    }

    let sessionEventRevision = 0;
    const applySession = (session, explicit = false) => {
      if (!mounted) return;
      const blocked = localStorage.getItem('farmapos_cloud_signed_out') === '1';
      const next = applyCloudSession(blocked ? null : session, { explicit });
      setCloudSession(next);
      setCheckingSession(false);
    };
    const onCloudLoginCompleted = event => {
      sessionEventRevision += 1;
      applySession(event.detail?.session, true);
    };
    const onCloudLogoutCompleted = () => {
      sessionEventRevision += 1;
      applySession(null);
    };
    window.addEventListener('cloud_login_completed', onCloudLoginCompleted);
    window.addEventListener('cloud_logout_completed', onCloudLogoutCompleted);

    const initialRevision = sessionEventRevision;
    supabaseCloud.auth.getSession().then(async ({ data, error }) => {
      if (sessionEventRevision !== initialRevision || !mounted) return;
      const session = error ? null : data?.session;
      if (session) { applySession(session); return; }
      // Sin sesión en el SDK: intentar restaurarla con el respaldo del refresh
      // token antes de mostrar "Conectar Estación". Cubre fallos transitorios
      // de red y sesiones descartadas localmente sin confirmación del servidor.
      // El respaldo SOLO se borra si el servidor confirma que murió ('invalid').
      const backup = readSessionBackup(localStorage);
      if (!backup?.refresh_token) { applySession(null); return; }
      try {
        const result = await restoreSessionWithRetry(supabaseCloud.auth, backup, { maxAttempts: 2 });
        if (sessionEventRevision !== initialRevision || !mounted) return;
        if (result.status === 'restored' && result.session) { applySession(result.session); return; }
        if (result.status === 'invalid') clearSessionBackup(localStorage);
        // 'unreachable': se conserva el respaldo para reintentar en el próximo arranque.
        applySession(null);
      } catch {
        if (mounted && sessionEventRevision === initialRevision) applySession(null);
      }
    }).catch(() => { if (sessionEventRevision === initialRevision) applySession(null); });

    const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      sessionEventRevision += 1;
      if (event === 'SIGNED_OUT') applySession(null);
      else if (['SIGNED_IN', 'INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED'].includes(event)) {
        // Respaldo del refresh token en cada sesión válida: es lo que permite
        // recuperar la sesión al arrancar aunque el SDK la haya descartado.
        // No se borra en SIGNED_OUT: el logout explícito ya lo limpia en
        // signOutCloudAccount; un SIGNED_OUT por fallo de refresh conserva el
        // respaldo para el reintento del próximo arranque.
        if (session?.refresh_token) saveSessionBackup(localStorage, session);
        applySession(session);
      }
    });

    return () => {
      mounted = false;
      window.removeEventListener('cloud_login_completed', onCloudLoginCompleted);
      window.removeEventListener('cloud_logout_completed', onCloudLogoutCompleted);
      subscription.unsubscribe();
    };
  }, []);
  
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const { rates } = useRates();
  const { deviceId } = useSecurity();
  useAutoBackup(false, false, usuarioActivo ? deviceId : null);
  useAutoLock(); // Auto-lock tras inactividad

  // Purge old audit log entries on startup
  useEffect(() => { purgeOldEntries(); }, []);

  useEffect(() => {
    const handlePromptReady = (e) => {
      setInstallPrompt(e.detail);
    };
    window.addEventListener('pwa_install_prompt_ready', handlePromptReady);

    // Mantener también el listener nativo por si se dispara más tarde
    const nativeHandler = (e) => {
      e.preventDefault();
      setInstallPrompt(e);
      window.deferredInstallPrompt = e;
    };
    window.addEventListener('beforeinstallprompt', nativeHandler);

    return () => {
      window.removeEventListener('pwa_install_prompt_ready', handlePromptReady);
      window.removeEventListener('beforeinstallprompt', nativeHandler);
    };
  }, []);

  const handleInstall = async () => {
    const promptEvent = installPrompt || window.deferredInstallPrompt;
    if (!promptEvent) return;
    promptEvent.prompt();
    const { outcome } = await promptEvent.userChoice;
    if (outcome === 'accepted') {
      setInstallPrompt(null);
      window.deferredInstallPrompt = null;
    }
  };

  const [tourDone, setTourDone] = useState(true); // TODO: re-habilitar cuando el tour esté listo
  // const [tourDone, setTourDone] = useState(() => localStorage.getItem('pda_spotlight_done') === 'true');
  
  const SPOTLIGHT_STEPS = [
    { target: '[data-tour="tab-ventas"]', title: 'Empieza a vender', text: 'Toca aquí para ir al Punto de Venta. Podrás cobrar en Bolívares o Dólares fácilmente.' },
    { target: '[data-tour="tab-catalogo"]', title: 'Tu Inventario', text: 'Aquí podrás agregar y gestionar todos tus productos. Configura precios y cantidades.' },
    { target: null, title: 'Búsqueda Global', text: 'Usa el atajo (Ctrl + K) o presiona ESC en cualquier momento para abrir el buscador rápido.' }
  ];

  // Theme
  const [theme, setTheme] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('theme');
      if (saved) return saved;
      return 'light'; // Forced light mode by default for Bodega
    }
    return 'light';
  });

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('theme', theme);

    // Update theme-color meta for mobile browsers
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'dark' ? '#0f172a' : '#f8fafc');
  }, [theme]);

  const toggleTheme = () => setTheme(prev => prev === 'light' ? 'dark' : 'light');

  // Haptic
  const triggerHaptic = () => {
    if (typeof window !== 'undefined' && window.navigator && window.navigator.vibrate) {
      window.navigator.vibrate(10);
    }
  };

  // Admin Panel Logic (Hidden — 10 clicks on top-left corner)
  const handleLogoClick = () => {
    if (usuarioActivo?.rol !== 'DUENO') return;
    const now = Date.now();
    if (window.lastClickTime && (now - window.lastClickTime > 1000)) {
      setAdminClicks(1);
    } else {
      setAdminClicks(prev => prev + 1);
    }
    window.lastClickTime = now;

    if (adminClicks + 1 >= 10) {
      setShowAdminPanel(true);
      setAdminClicks(0);
      triggerHaptic();
    }
  };

  // Keyboard detection
  const [isKeyboardOpen, setIsKeyboardOpen] = useState(false);
  const baseHeight = useRef(0);

  useEffect(() => {
    if (!window.visualViewport) return;
    if (!baseHeight.current) baseHeight.current = window.visualViewport.height;

    const handleViewport = () => {
      setIsKeyboardOpen(window.visualViewport.height < baseHeight.current - 100);
    };
    const handleFocusBack = () => setTimeout(handleViewport, 300);

    window.visualViewport.addEventListener('resize', handleViewport);
    window.visualViewport.addEventListener('scroll', handleViewport);
    window.addEventListener('focusin', handleFocusBack);
    window.addEventListener('focusout', handleFocusBack);

    return () => {
      window.visualViewport?.removeEventListener('resize', handleViewport);
      window.visualViewport?.removeEventListener('scroll', handleViewport);
      window.removeEventListener('focusin', handleFocusBack);
      window.removeEventListener('focusout', handleFocusBack);
    };
  }, []);

  // === Auth — condiciones para mostrar pantalla de PIN ===
  const adminEmail = useAuthStore(s => s.adminEmail);
  const operatorSessionId = useAuthStore(s => s.operatorSession?.sessionId || 'locked');

  const isCajero = usuarioActivo?.rol === 'CAJERO';
  // El dueño opera siempre en Gestión (ve todo desde su perfil); el interruptor
  // Gestión/Caja queda deshabilitado (antes era solo para el rol ADMIN, eliminado).
  const canSwitchMode = false;
  const changeWorkspace = mode => {
    if (!canSwitchMode || !['caja', 'gestion'].includes(mode)) return;
    setWorkspace({ identity: workspaceIdentity, mode });
    setActiveTab(mode === 'caja' ? 'ventas' : 'inicio');
  };



  // Free profile: no cloud audit timer while containment is active. Once the
  // reviewed contract is enabled, send bounded batches only while visible.
  useEffect(() => {
    if (REMOTE_OPERATIONS_PAUSED || !adminEmail || !deviceId) return;
    const syncVisible = () => {
      if (document.visibilityState === 'visible' && navigator.onLine) void syncAuditToCloud(adminEmail, deviceId);
    };
    syncVisible();
    const interval = setInterval(syncVisible, SUPABASE_FREE_PROFILE.auditIntervalMs);
    return () => clearInterval(interval);
  }, [adminEmail, deviceId]);

  const confirm = useConfirm();

  const handleLogout = async () => {
    const ok = await confirm({
      title: 'Cerrar sesión',
      message: 'Se cerrará tu sesión en la nube. Tendrás que iniciar sesión nuevamente para acceder a la aplicación.',
      confirmText: 'Cerrar sesión',
      cancelText: 'Cancelar',
      variant: 'logout',
    });
    if (!ok) return;
    try {
      await signOutCloudAccount(supabaseCloud);
    } catch (error) {
      // El bloqueo local se aplica antes de la red; aun sin conexión la salida
      // debe terminar y no dejar la UI esperando indefinidamente.
      console.warn('[Cloud logout] Salida remota no confirmada:', error?.message || error);
    } finally {
      setCloudSession(null);
      window.location.reload();
    }
  };

  // Changes from another tab invalidate local identity. A local device session
  // cannot silently follow another account or operator selected elsewhere.
  useEffect(() => {
    const onStorage = event => {
      if ([ACTIVE_ACCOUNT_STORAGE_KEY, ACTIVE_SEDE_STORAGE_KEY, OPERATOR_SESSION_KEY, 'abasto-auth-storage', 'farmapos_cloud_signed_out'].includes(event.key)) {
        useAuthStore.getState().logout('cambio de acceso en otra pestaña', { preserveSavedSession: true });
        if (event.key === 'abasto-auth-storage') void useAuthStore.persist.rehydrate();
        syncSedeWithUser();
        if (event.key === ACTIVE_ACCOUNT_STORAGE_KEY || event.key === 'farmapos_cloud_signed_out') setCloudSession(null);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [syncSedeWithUser]);

  const ALL_TABS = [
    { id: 'inicio', label: 'Inicio', icon: Home },
    { id: 'ventas', label: 'Vender', icon: ShoppingCart },
    { id: 'catalogo', label: 'Inventario', icon: Store },
    { id: 'clientes', label: 'Contactos', icon: Users },
    { id: 'reportes', label: 'Reportes', icon: BarChart3, adminOnly: true },
    { id: 'ajustes', label: 'Config.', icon: Settings, adminOnly: true },
  ];
  // Modo cajero estricto: POS puro. Sin inventario, contactos ni config.
  // Sin PIN no hay roles reales, así que todos ven todas las pestañas.
  const TABS = appMode === 'caja'
    ? ALL_TABS.filter(t => ['ventas', 'inicio'].includes(t.id))
    : ALL_TABS;

  // Si el cajero aterrizó en una pestaña oculta, redirigir a Vender
  // (deferido con timeout para no llamar setState síncrono en el efecto)
  useEffect(() => {
    if (isCajero && !['ventas', 'inicio'].includes(activeTab)) {
      const id = setTimeout(() => setActiveTab('ventas'), 0);
      return () => clearTimeout(id);
    }
  }, [activeTab, isCajero, appMode]);

  // Global Hard Gate: Loading State
  if (checkingSession) {
    return (
      <div className="h-[100dvh] w-full bg-[#F8FAFC] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-[#0B8D63] border-t-transparent animate-spin" />
      </div>
    );
  }

  // Global Hard Gate: Must have Cloud Session (solo si hay proyecto cloud configurado)
  if (envCloudConfigured && !cloudSession) {
    return (
      <CloudAuthModal 
        forceLogin={true} 
        installPrompt={installPrompt} 
        onInstall={handleInstall} 
        showIOSButton={showIOSButton} 
        onShowIOSInstall={() => setShowIOSInstall(true)} 
      />
    );
  }

  // Every cloud login and every absent/invalid local session requires an
  // explicit operator choice. Never synthesize a privileged owner session.
  if (monitorMode) {
    return <MonitorDashboard onExit={() => setMonitorMode(false)} />;
  }
  if (!usuarioActivo) {
    return (
      <LockScreen
        installPrompt={installPrompt}
        onInstall={handleInstall}
        showIOSButton={showIOSButton}
        onShowIOSInstall={() => setShowIOSInstall(true)}
        onEnterMonitor={() => setMonitorMode(true)}
      />
    );
  }
  // NOTA 2026-10-01 (B2): aquí había un segundo gate duplicado que era
  // código muerto — el bloque anterior ya retorna siempre.

  return (
    <div className="font-sans antialiased bg-[#F8FAFC] dark:bg-slate-950 text-slate-900 dark:text-slate-100 h-[100dvh] flex flex-col overflow-clip">

      {/* Bloqueo real de sesión (Lock ≠ Logout): conserva operador, sesión y
          carrito; solo quien bloqueó desbloquea con su PIN. */}
      {sessionLocked && <LockScreen />}
      {/* Clock-in: tras el PIN, el cajero ve la opción de fichar entrada. */}
      <ClockInPrompt />

      {/* Aviso de PINs de fábrica (C3 adaptado): visible mientras algún
          usuario conserve el PIN de fábrica. Los PINs siguen funcionando. */}
      <FactoryPinBanner
        affectedNames={factoryPinUsers.map(u => u.nombre || `Usuario ${u.id}`)}
        onGoToUsers={usuarioActivo?.rol === 'DUENO' ? () => setActiveTab('ajustes') : undefined}
      />

      {/* Terms and Conditions Overlay (First Use) */}
      <TermsOverlay onAccepted={() => {
        setTermsAccepted(true);
        useAuthStore.getState().logout('términos aceptados: selecciona operador');
      }} />

      {/* Tutorial Onboarding (First Use, after Terms) */}
      {termsAccepted && <OnboardingOverlay />}


      {/* Tour Spotlight */}
      {!tourDone && (
         <SpotlightTour 
            steps={SPOTLIGHT_STEPS} 
            onComplete={() => {
                localStorage.setItem('pda_spotlight_done', 'true');
                setTourDone(true);
            }} 
         />
      )}



      {/* Golden Tester View Overlay */}
      {showTester && (
        <div className="fixed inset-0 z-[150] bg-[#F8FAFC]">
          <TesterView onBack={() => setShowTester(false)} />
        </div>
      )}


      <CartProvider key={`${getActiveAccountId() || 'local'}:${sedeActivaId}:${operatorSessionId}`}>
      {/* Remonta el inventario al cambiar de sede/cuenta: sin esta key, el contexto
          mantiene datos de la sede anterior porque captura el storage context una vez. */}
      <ProductProvider key={`${getActiveAccountId() || 'local'}:${sedeActivaId}`} rates={rates}>
        <main className={`flex-1 min-h-0 w-full max-w-md md:max-w-3xl lg:max-w-none lg:px-4 xl:px-6 mx-auto relative ${isKeyboardOpen ? 'pb-4' : 'pb-20 lg:pb-4'} flex flex-col overflow-y-auto`}>

        {canSwitchMode && <div className="shrink-0 flex justify-end px-3 py-2" role="group" aria-label="Modo de trabajo">
          <div className="inline-flex gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1">
            {['gestion', 'caja'].map(mode => <button type="button" key={mode} aria-pressed={appMode === mode} onClick={() => changeWorkspace(mode)} className={`rounded-lg px-4 py-2 text-xs font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${appMode === mode ? 'bg-primary text-white' : 'text-slate-600 dark:text-slate-200'}`}>{mode === 'gestion' ? 'Gestión' : 'Caja'}</button>)}
          </div>
        </div>}

        {/* Eager views — always mounted, visibility toggled via CSS */}
        <div className={`flex-1 min-h-0 flex flex-col ${activeTab === 'ventas' ? '' : 'hidden'}`}>
          <ErrorBoundary>                <SalesView rates={rates} triggerHaptic={triggerHaptic} onNavigate={setActiveTab} isActive={activeTab === 'ventas'} />
          </ErrorBoundary>
        </div>

        {!isCajero && <div className={`flex-1 flex flex-col ${activeTab === 'catalogo' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <ProductsView rates={rates} triggerHaptic={triggerHaptic} />
          </ErrorBoundary>
        </div>}

        <div className={`flex-1 flex flex-col ${activeTab === 'inicio' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <DashboardView rates={rates} triggerHaptic={triggerHaptic} onNavigate={setActiveTab} theme={theme} toggleTheme={toggleTheme} isActive={activeTab === 'inicio'} installPrompt={installPrompt} onInstall={handleInstall} showIOSButton={showIOSButton} onShowIOSInstall={() => setShowIOSInstall(true)} />
          </ErrorBoundary>
        </div>

        {/* Lazy views — mount on first access, then stay persistent */}
        <Suspense fallback={<div className="flex-1 p-4 space-y-4"><div className="skeleton h-10 w-40" /><div className="skeleton h-32" /><div className="skeleton h-48" /></div>}>
          {!isCajero && (activeTab === 'clientes' || document.querySelector('[data-view="clientes"]')) && (
            <div data-view="clientes" className={`flex-1 flex flex-col ${activeTab === 'clientes' ? '' : 'hidden'}`}>
              <ErrorBoundary>
                <CustomersView triggerHaptic={triggerHaptic} rates={rates} isActive={activeTab === 'clientes'} />
              </ErrorBoundary>
            </div>
          )}
          {!isCajero && (activeTab === 'reportes' || document.querySelector('[data-view="reportes"]')) && (
            <div data-view="reportes" className={`flex-1 flex flex-col ${activeTab === 'reportes' ? '' : 'hidden'}`}>
              <ErrorBoundary>
                <ReportsView rates={rates} triggerHaptic={triggerHaptic} onNavigate={setActiveTab} isActive={activeTab === 'reportes'} />
              </ErrorBoundary>
            </div>
          )}
        </Suspense>

        {/* Settings — mounted as tab inside providers */}
        {!isCajero && <div className={`flex-1 flex flex-col min-h-0 ${activeTab === 'ajustes' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <SettingsView
              onClose={() => setActiveTab('inicio')}
              theme={theme}
              toggleTheme={toggleTheme}
              triggerHaptic={triggerHaptic}
            />
          </ErrorBoundary>
        </div>}

      </main>

      </ProductProvider>
      </CartProvider>
      
      <CommandPalette 
          isOpen={isCommandPaletteOpen} 
          onClose={() => setIsCommandPaletteOpen(false)} 
          onToggle={() => setIsCommandPaletteOpen(p => !p)} 
          navigateTo={setActiveTab} 
      />

      {/* Bottom Nav — the role determines the available workspace */}
      {!isKeyboardOpen && (
        <div className="fixed bottom-0 left-0 right-0 px-4 sm:px-6 pb-[env(safe-area-inset-bottom)] pt-0 mb-2 lg:mb-2 max-w-sm sm:max-w-lg md:max-w-2xl mx-auto lg:mx-0 lg:ml-6 z-30 pointer-events-none animate-in slide-in-from-bottom-4 duration-300">
          <div className="bg-white/95 dark:bg-slate-900/95 backdrop-blur-xl rounded-2xl p-1 flex justify-between items-center shadow-lg shadow-slate-900/10 border border-slate-200 dark:border-slate-700 pointer-events-auto">
            {TABS.map(tab => (
              <TabButton
                key={tab.id}
                icon={<tab.icon size={18} strokeWidth={activeTab === tab.id ? 3 : 2} />}
                label={tab.label}
                isActive={activeTab === tab.id}
                onClick={() => { triggerHaptic(); setActiveTab(tab.id); }}
                data-tour={`tab-${tab.id}`}
              />
            ))}



          </div>
        </div>
      )}

      {/* iOS Install Instructions Modal */}
      {showIOSInstall && (
        <div className="fixed inset-0 z-[300] bg-slate-900/60 backdrop-blur-sm flex items-end justify-center p-0 animate-in fade-in duration-200">
          <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-10 duration-200">
            <div className="flex justify-between items-start mb-5">
              <div>
                <h3 className="text-lg font-black text-slate-800 dark:text-white">Instalar App</h3>
                <p className="text-xs text-slate-400 mt-1">Sigue estos pasos en Safari</p>
              </div>
              <button onClick={() => { setShowIOSInstall(false); localStorage.setItem('ios_install_dismissed', '1'); }} aria-label="Cerrar" className="modal-close bg-slate-100 dark:bg-slate-800 text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center shrink-0 text-blue-600 font-bold text-sm">1</div>
                <p className="text-sm text-slate-600 dark:text-slate-300">Toca el botón <strong>Compartir</strong> en la barra de Safari</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center shrink-0 text-blue-600 font-bold text-sm">2</div>
                <p className="text-sm text-slate-600 dark:text-slate-300">Busca y toca <strong>"Agregar a la pantalla de inicio"</strong></p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0 text-emerald-600 font-bold text-sm">OK</div>
                <p className="text-sm text-slate-600 dark:text-slate-300">¡Listo! La app aparecerá como un ícono en tu teléfono</p>
              </div>
            </div>
            <button onClick={() => { setShowIOSInstall(false); localStorage.setItem('ios_install_dismissed', '1'); }} className="w-full mt-6 py-3 bg-brand text-white font-bold rounded-xl shadow-lg active:scale-95 transition-transform">
              Entendido
            </button>
          </div>
        </div>
      )}

      {/* Admin Panel Modal */}
      {showAdminPanel && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setShowAdminPanel(false)}>
          <div role="dialog" aria-modal="true" aria-label="Panel Dev" className="bg-[#1E293B] border border-slate-700 w-full max-w-sm rounded-2xl p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <FlaskConical className="text-[#0B8D63]" /> Panel Dev
              </h2>
              <button onClick={() => setShowAdminPanel(false)} className="modal-close text-slate-400 hover:text-white hover:bg-slate-700/60" aria-label="Cerrar"><X size={18} /></button>
            </div>

            <button
              onClick={() => { triggerHaptic(); setShowTester(true); setShowAdminPanel(false); }}
              className="w-full bg-[#0B8D63] hover:bg-[#0AA577] text-white font-bold py-3 rounded-lg text-sm uppercase tracking-wider transition-colors"
            >
              Abrir Tester
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function TabButton({ icon, label, isActive, onClick, 'data-tour': dataTour }) {
  return (
    <button type="button" aria-label={label} aria-current={isActive ? 'page' : undefined} data-tour={dataTour} onClick={onClick} className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 sm:gap-1 min-h-[48px] py-2 px-0.5 rounded-xl transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary ${isActive ? 'bg-primary text-white' : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
      {icon}
      <span className="text-[9px] sm:text-[11px] font-bold leading-none truncate max-w-full">{label}</span>
    </button>
  );
}
