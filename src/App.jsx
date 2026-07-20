import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { Home, ShoppingCart, Store, Users, Download, FlaskConical, Moon, Sun, BarChart3, WifiOff, X, Settings } from 'lucide-react';

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
import { useOfflineQueue } from './hooks/useOfflineQueue';
import { useAutoBackup } from './hooks/useAutoBackup';
import CommandPalette from './components/CommandPalette';
import SpotlightTour from './components/SpotlightTour';
import LockScreen from './components/security/LockScreen';
import CloudAuthModal from './components/security/CloudAuthModal';
import { useAuthStore } from './hooks/store/useAuthStore';
import { useAutoLock } from './hooks/useAutoLock';
import { purgeOldEntries, syncAuditToCloud } from './services/auditService';
import { useCloudSync } from './hooks/useCloudSync';
import { supabaseCloud } from './config/supabaseCloud';
import { useConfirm } from './hooks/useConfirm.jsx';

export default function App() {
  const [activeTab, setActiveTab] = useState('inicio');
  const [installPrompt, setInstallPrompt] = useState(() => window.deferredInstallPrompt);
  const [showIOSInstall, setShowIOSInstall] = useState(false);

  // Inicializar Sincronización Realtime con Supabase
  useCloudSync();

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
  
  // Cloud Auth Session State
  const [cloudSession, setCloudSession] = useState(null);
  const [checkingSession, setCheckingSession] = useState(true);
  const [graceInfo, setGraceInfo] = useState(null); // { daysOverdue, daysLeft } durante período de gracia

  // ── Sesión Supabase + límite de dispositivos vía RPC ─────────────────────
  useEffect(() => {
    let mounted = true;

    // ── Cache de verificación de dispositivo (15 min) ─────────────────────────
    // El RPC register_and_check_device + select account_devices se llama en cada
    // recarga y authStateChange. Con 30 clientes recargas frecuentes suman ~1-2MB/día.
    // Cache de 60 min: si el dispositivo ya fue verificado recientemente, se omite el RPC.
    const DEVICE_CHECK_CACHE_KEY = 'pda_device_check_ts';
    const DEVICE_CHECK_TTL_MS = 60 * 60 * 1000; // 60 minutos — optimizado para egress

    const isDeviceCheckCached = () => {
      const ts = localStorage.getItem(DEVICE_CHECK_CACHE_KEY);
      return ts && Date.now() - parseInt(ts, 10) < DEVICE_CHECK_TTL_MS;
    };

    const applySession = async (session) => {
      if (!mounted) return;

      if (!session?.user?.email) {
        setCloudSession(null);
        setCheckingSession(false);
        return;
      }

      const email = session.user.email.toLowerCase();
      const deviceId = localStorage.getItem('pda_device_id') || 'UNKNOWN';

      try {
        const savedAlias = localStorage.getItem('pda_device_alias');
        const defaultAlias = `Dispositivo ${navigator.platform || 'Web'}`;
        const finalAlias = savedAlias && savedAlias.trim() !== '' ? savedAlias.trim() : defaultAlias;

        const isExplicitLogin = localStorage.getItem('pda_explicit_login') === 'true';

        // Si ya verificamos el dispositivo recientemente y no es un login explícito, omitir llamadas a Supabase
        if (!isExplicitLogin && isDeviceCheckCached()) {
          if (mounted) {
            setCloudSession(session);
            setCheckingSession(false);
          }
          return;
        }

        // Si el login NO es explícito (es un auto-login normal),
        // checamos si este dispositivo ya fue expulsado.
        if (!isExplicitLogin) {
            const { data: existingDevice, error: selectErr } = await supabaseCloud
               .from('account_devices')
               .select('id')
               .eq('device_id', deviceId)
               .eq('email', email)
               .maybeSingle();

            // Tumbamos la sesión SOLO si la conexión funcionó (sin errores) y NO se encontró el dispositivo
            if (!selectErr && existingDevice === null) {
                // Fue expulsado o no existe. Tumbamos sesión.
                await supabaseCloud.auth.signOut();
                if (mounted) { setCloudSession(null); setCheckingSession(false); }
                return;
            }
        } else {
            localStorage.removeItem('pda_explicit_login');
        }

        const { data: result, error } = await supabaseCloud.rpc('register_and_check_device', {
          p_email: email,
          p_device_id: deviceId,
          p_device_alias: finalAlias,
        });

        if (!error) {
          if (result === 'license_inactive' || result === 'limit_reached') {
            localStorage.removeItem(DEVICE_CHECK_CACHE_KEY);
            await supabaseCloud.auth.signOut();
            if (mounted) { setCloudSession(null); setCheckingSession(false); }
            return;
          }
          if (result === 'license_expired') {
            // Verificar período de gracia de 5 días
            const GRACE_DAYS = 5;
            const { data: licRow } = await supabaseCloud
              .from('cloud_licenses')
              .select('valid_until')
              .eq('email', email)
              .maybeSingle();
            const validUntil = licRow?.valid_until ? new Date(licRow.valid_until) : null;
            const now = new Date();
            const daysOverdue = validUntil ? Math.ceil((now - validUntil) / 86400000) : 999;
            if (!validUntil || daysOverdue > GRACE_DAYS) {
              localStorage.removeItem(DEVICE_CHECK_CACHE_KEY);
              await supabaseCloud.auth.signOut();
              if (mounted) { setCloudSession(null); setCheckingSession(false); }
              return;
            }
            // Dentro de gracia — permitir pero mostrar banner
            if (mounted) setGraceInfo({ daysOverdue, daysLeft: GRACE_DAYS - daysOverdue });
          }
          // Verificación exitosa — guardar timestamp del cache
          localStorage.setItem(DEVICE_CHECK_CACHE_KEY, String(Date.now()));
        }
        // Si la RPC no existe aún (error), deja pasar sin bloquear
      } catch {
        // Sin conexión o RPC pendiente — dejar pasar
      }

      if (mounted) {
        setCloudSession(session);
        setCheckingSession(false);
      }
    };

    supabaseCloud.auth.getSession().then(({ data: { session } }) => {
      applySession(session);
    });

    const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange((event, session) => {
      if (!mounted) return;
      if (event === 'SIGNED_IN') applySession(session);
      else if (event === 'SIGNED_OUT') { setCloudSession(null); setCheckingSession(false); }
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);
  
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);

  const { rates, loading, isOffline, updateData } = useRates();
  const { deviceId } = useSecurity();
  const { isOnline, cacheRates } = useOfflineQueue();
  useAutoBackup(false, false, deviceId);
  useAutoLock(); // Auto-lock for ADMINs

  // Purge old audit log entries on startup
  useEffect(() => { purgeOldEntries(); }, []);

  // Cache rates whenever they update
  useEffect(() => { if (rates) cacheRates(rates); }, [rates, cacheRates]);

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
  const usuarioActivo = useAuthStore(s => s.usuarioActivo);
  const requireLogin = useAuthStore(s => s.requireLogin ?? false);
  const adminEmail = useAuthStore(s => s.adminEmail);
  const adminPassword = useAuthStore(s => s.adminPassword);

  const isCajero = usuarioActivo?.rol === 'CAJERO';
  const isCloudConfigured = Boolean(adminEmail);
  // El PIN solo bloquea si requireLogin está activado Y hay cuenta cloud registrada
  const pinLoginEnabled = requireLogin && isCloudConfigured;

  // Sync audit log to cloud periodically (every 15 min) when cloud is configured
  useEffect(() => {
    if (!adminEmail || !deviceId) return;
    syncAuditToCloud(adminEmail, deviceId);
    const interval = setInterval(() => syncAuditToCloud(adminEmail, deviceId), 15 * 60 * 1000);
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
    await supabaseCloud.auth.signOut();
    setCloudSession(null);
  };

  // Auto-login: cuando el PIN no aplica, forzar rol ADMIN.
  // Sin PIN no hay seguridad de roles, así que el usuario siempre es Admin.
  useEffect(() => {
    if (!pinLoginEnabled) {
      const admins = useAuthStore.getState().usuarios.filter(u => u.rol === 'ADMIN');
      if (admins.length > 0 && usuarioActivo?.rol !== 'ADMIN') {
        useAuthStore.setState({ usuarioActivo: admins[0] });
      } else if (!usuarioActivo && admins.length > 0) {
        useAuthStore.setState({ usuarioActivo: admins[0] });
      }
    }
  }, [pinLoginEnabled, usuarioActivo]);

  const ALL_TABS = [
    { id: 'inicio', label: 'Inicio', icon: Home },
    { id: 'ventas', label: 'Vender', icon: ShoppingCart },
    { id: 'catalogo', label: 'Inventario', icon: Store },
    { id: 'clientes', label: 'Contactos', icon: Users },
    { id: 'reportes', label: 'Reportes', icon: BarChart3, adminOnly: true },
    { id: 'ajustes', label: 'Config.', icon: Settings, adminOnly: true },
  ];
  // Solo ocultar tabs admin si el PIN está activo Y el usuario es cajero.
  // Sin PIN, todos ven todas las pestañas (no hay seguridad que justifique ocultarlas).
  const TABS = (isCajero && pinLoginEnabled) ? ALL_TABS.filter(t => !t.adminOnly) : ALL_TABS;

  // Global Hard Gate: Loading State
  if (checkingSession) {
    return (
      <div className="h-[100dvh] w-full bg-[#F8FAFC] flex items-center justify-center">
        <div className="w-8 h-8 rounded-full border-4 border-[#0EA5E9] border-t-transparent animate-spin" />
      </div>
    );
  }

  // Global Hard Gate: Must have Cloud Session
  if (!cloudSession) {
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

  // Local Guard: si el PIN local aplica y no ha desbloqueado
  if (!usuarioActivo && pinLoginEnabled) {
    return (
      <LockScreen 
        installPrompt={installPrompt} 
        onInstall={handleInstall} 
        showIOSButton={showIOSButton} 
        onShowIOSInstall={() => setShowIOSInstall(true)} 
      />
    );
  }
  if (!usuarioActivo) return (
    <div className="h-[100dvh] w-full bg-[#F8FAFC] flex items-center justify-center">
      <div className="w-8 h-8 rounded-full border-4 border-[#0EA5E9] border-t-transparent animate-spin" />
    </div>
  );

  return (
    <div className="font-sans antialiased bg-[#F8FAFC] h-[100dvh] flex flex-col overflow-clip">

      {/* Terms and Conditions Overlay (First Use) */}
      <TermsOverlay />

      {/* Tutorial Onboarding (First Use, after Terms) */}
      <OnboardingOverlay />

      {/* Offline Banner */}
      {!isOnline && (
        <div className="fixed top-0 left-0 right-0 z-[200] flex justify-center pt-[env(safe-area-inset-top)]">
          <div className="mt-2 px-4 py-2 bg-slate-900/95 backdrop-blur-md rounded-full border border-red-500/30 shadow-xl flex items-center gap-2 animate-in slide-in-from-top-4">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <WifiOff size={14} className="text-red-400" />
            <span className="text-xs font-bold text-white">Sin conexión · Modo offline</span>
          </div>
        </div>
      )}

      {/* Grace Period Banner */}
      {graceInfo && (
        <div className="w-full bg-amber-500 px-4 py-2 flex items-center justify-center gap-2 text-white text-xs font-semibold z-[190]">
          <span>⚠️ Tu licencia venció hace {graceInfo.daysOverdue} día{graceInfo.daysOverdue !== 1 ? 's' : ''}.</span>
          <span>Tienes {graceInfo.daysLeft} día{graceInfo.daysLeft !== 1 ? 's' : ''} restante{graceInfo.daysLeft !== 1 ? 's' : ''} para renovar.</span>
          <a href="https://wa.me/584124051793" target="_blank" rel="noopener noreferrer" className="underline opacity-90 hover:opacity-100">Contacta a soporte para continuar.</a>
        </div>
      )}



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


      <CartProvider>
      <ProductProvider rates={rates}>
        <main className={`flex-1 min-h-0 w-full max-w-md md:max-w-3xl lg:max-w-none lg:px-4 xl:px-6 mx-auto relative ${isKeyboardOpen ? 'pb-4' : 'pb-20 lg:pb-16'} flex flex-col overflow-y-auto`}>

          {/* Hidden Admin Trigger Area */}
        <div
          className="absolute top-0 left-0 w-20 h-20 z-50 cursor-pointer opacity-0"
          onClick={handleLogoClick}
          title="Ssshh..."
        ></div>

        {/* Eager views — always mounted, visibility toggled via CSS */}
        <div className={`flex-1 min-h-0 flex flex-col ${activeTab === 'ventas' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <SalesView rates={rates} triggerHaptic={triggerHaptic} onNavigate={setActiveTab} isActive={activeTab === 'ventas'} />
          </ErrorBoundary>
        </div>

        <div className={`flex-1 flex flex-col ${activeTab === 'catalogo' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <ProductsView rates={rates} triggerHaptic={triggerHaptic} />
          </ErrorBoundary>
        </div>

        <div className={`flex-1 flex flex-col ${activeTab === 'inicio' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <DashboardView rates={rates} triggerHaptic={triggerHaptic} onNavigate={setActiveTab} theme={theme} toggleTheme={toggleTheme} isActive={activeTab === 'inicio'} installPrompt={installPrompt} onInstall={handleInstall} showIOSButton={showIOSButton} onShowIOSInstall={() => setShowIOSInstall(true)} />
          </ErrorBoundary>
        </div>

        {/* Lazy views — mount on first access, then stay persistent */}
        <Suspense fallback={<div className="flex-1 p-4 space-y-4"><div className="skeleton h-10 w-40" /><div className="skeleton h-32" /><div className="skeleton h-48" /></div>}>
          {(activeTab === 'clientes' || document.querySelector('[data-view="clientes"]')) && (
            <div data-view="clientes" className={`flex-1 flex flex-col ${activeTab === 'clientes' ? '' : 'hidden'}`}>
              <ErrorBoundary>
                <CustomersView triggerHaptic={triggerHaptic} rates={rates} isActive={activeTab === 'clientes'} />
              </ErrorBoundary>
            </div>
          )}
          {(activeTab === 'reportes' || document.querySelector('[data-view="reportes"]')) && (
            <div data-view="reportes" className={`flex-1 flex flex-col ${activeTab === 'reportes' ? '' : 'hidden'}`}>
              <ErrorBoundary>
                <ReportsView rates={rates} triggerHaptic={triggerHaptic} onNavigate={setActiveTab} isActive={activeTab === 'reportes'} />
              </ErrorBoundary>
            </div>
          )}
        </Suspense>

        {/* Settings — mounted as tab inside providers */}
        <div className={`flex-1 flex flex-col min-h-0 ${activeTab === 'ajustes' ? '' : 'hidden'}`}>
          <ErrorBoundary>
            <SettingsView
              onClose={() => setActiveTab('inicio')}
              theme={theme}
              toggleTheme={toggleTheme}
              triggerHaptic={triggerHaptic}
            />
          </ErrorBoundary>
        </div>

      </main>

      </ProductProvider>
      </CartProvider>
      
      <CommandPalette 
          isOpen={isCommandPaletteOpen} 
          onClose={() => setIsCommandPaletteOpen(false)} 
          onToggle={() => setIsCommandPaletteOpen(p => !p)} 
          navigateTo={setActiveTab} 
      />

      {/* Bottom Nav — hidden in POS mode for full-screen selling */}
      {!isKeyboardOpen && (
        <div className="fixed bottom-0 left-0 right-0 px-4 sm:px-6 pb-[env(safe-area-inset-bottom)] pt-0 mb-2 lg:mb-2 max-w-sm sm:max-w-lg md:max-w-2xl mx-auto z-30 pointer-events-none animate-in slide-in-from-bottom-4 duration-300">
          <div className="bg-[#1E293B]/95 backdrop-blur-xl rounded-2xl p-1 flex justify-between items-center shadow-2xl shadow-slate-900/30 border border-white/10 ring-1 ring-black/5 pointer-events-auto">
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
              <button onClick={() => { setShowIOSInstall(false); localStorage.setItem('ios_install_dismissed', '1'); }} className="p-2 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-500">
                <X size={18} />
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center shrink-0 text-blue-600 font-bold text-sm">1</div>
                <p className="text-sm text-slate-600 dark:text-slate-300">Toca el botón <strong>Compartir</strong> <span className="inline-block w-5 h-5 align-middle">⬆️</span> en la barra de Safari</p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center justify-center shrink-0 text-blue-600 font-bold text-sm">2</div>
                <p className="text-sm text-slate-600 dark:text-slate-300">Busca y toca <strong>"Agregar a la pantalla de inicio"</strong></p>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/30 rounded-full flex items-center justify-center shrink-0 text-emerald-600 font-bold text-sm">✓</div>
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
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-[#1E293B] border border-slate-700 w-full max-w-sm rounded-2xl p-6 shadow-2xl">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-bold text-white flex items-center gap-2">
                <FlaskConical className="text-[#0EA5E9]" /> Panel Dev
              </h2>
              <button onClick={() => setShowAdminPanel(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <button
              onClick={() => { triggerHaptic(); setShowTester(true); setShowAdminPanel(false); }}
              className="w-full bg-[#0EA5E9] hover:bg-[#0284C7] text-white font-bold py-3 rounded-lg text-sm uppercase tracking-wider transition-colors"
            >
              🚀 Abrir Tester
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

function TabButton({ icon, label, isActive, onClick, 'data-tour': dataTour }) {
  return (
    <button data-tour={dataTour} onClick={onClick} className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 sm:py-2.5 rounded-xl transition-all duration-300 ${isActive ? 'bg-[#0EA5E9] text-white shadow-md shadow-sky-500/30' : 'text-slate-400 hover:text-white hover:bg-white/5'}`}>
      {icon}
      {isActive && <span className="text-[9px] sm:text-[10px] font-extrabold animate-in zoom-in duration-200">{label}</span>}
    </button>
  );
}
