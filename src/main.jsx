import React, { useState, useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import ResetPasswordView from './views/ResetPasswordView.jsx'
import EmailConfirmedView from './views/EmailConfirmedView.jsx'
import { ToastProvider } from './components/Toast.jsx'
import { supabaseCloud } from './config/supabaseCloud.js'
import './index.css'

// ── Capturar el prompt de instalación PWA lo antes posible ──
window.deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  window.deferredInstallPrompt = e;
  window.dispatchEvent(new CustomEvent('pwa_install_prompt_ready', { detail: e }));
});

// ── Service Worker: auto-reload cuando el nuevo SW toma control ──
// Evita que el usuario quede atrapado con assets desactualizados tras un deploy.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    window.location.reload();
  });
  // Comprobar actualizaciones al recuperar el foco (evita versiones obsoletas)
  navigator.serviceWorker.ready.then(reg => {
    reg.update();
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });
  });
}

// ── Evitar que la rueda del mouse cambie valores en inputs numéricos ──
document.addEventListener('wheel', (e) => {
  if (e.target?.type === 'number') {
    e.target.blur();
    e.preventDefault();
  }
}, { passive: false });

// Detectar token de recuperación en la URL al cargar (antes de React)
function detectRecovery() {
  const hash = window.location.hash;
  const params = new URLSearchParams(window.location.search);
  return hash.includes('type=recovery') || params.has('code');
}

// Detectar confirmación de email (type=signup en el hash de Supabase)
function detectEmailConfirmed() {
  return window.location.hash.includes('type=signup');
}

function AppRouter() {
  const [isRecovery, setIsRecovery] = useState(detectRecovery);
  const [isEmailConfirmed, setIsEmailConfirmed] = useState(detectEmailConfirmed);

  useEffect(() => {
    const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
    });
    return () => subscription.unsubscribe();
  }, []);

  if (isEmailConfirmed) {
    return (
      <EmailConfirmedView
        onDone={() => setIsEmailConfirmed(false)}
      />
    );
  }

  if (isRecovery) {
    return (
      <ResetPasswordView
        onDone={() => {
          window.history.replaceState({}, document.title, window.location.pathname);
          setIsRecovery(false);
        }}
      />
    );
  }

  return <App />;
}

import { ConfirmProvider } from './hooks/useConfirm.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ToastProvider>
      <ConfirmProvider>
        <AppRouter />
      </ConfirmProvider>
    </ToastProvider>
  </React.StrictMode>,
)

