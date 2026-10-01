import React from 'react'
import ReactDOM from 'react-dom/client'
import AppRouter from './AppRouter.jsx'
import { ToastProvider } from './components/Toast.jsx'
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

import { ConfirmProvider } from './hooks/useConfirm.jsx'
// FIX 2026-10-01 (C2): ErrorBoundary global que cubre TODA la app, incluida
// la zona pre-login (CloudAuthModal, LockScreen, ClockInPrompt, Supervisión).
// Antes el boundary solo envolvía las vistas por pestaña y cualquier throw en
// login/PIN/cambio de sede/bloqueo producía pantalla blanca total. El fallback
// no depende de ningún contexto (solo localStorage + recarga).
import ErrorBoundary from './components/ErrorBoundary.jsx'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <ConfirmProvider>
          <AppRouter />
        </ConfirmProvider>
      </ToastProvider>
    </ErrorBoundary>
  </React.StrictMode>,
)

