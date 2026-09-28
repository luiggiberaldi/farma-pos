import { useState, useEffect } from 'react';
import App from './App.jsx';
import ResetPasswordView from './views/ResetPasswordView.jsx';
import EmailConfirmedView from './views/EmailConfirmedView.jsx';
import { supabaseCloud } from './config/supabaseCloud.js';

function detectRecovery() {
    const params = new URLSearchParams(window.location.search);
    return window.location.hash.includes('type=recovery') || params.has('code');
}
function detectEmailConfirmed() { return window.location.hash.includes('type=signup'); }

export default function AppRouter() {
    const [isRecovery, setIsRecovery] = useState(detectRecovery);
    const [isEmailConfirmed, setIsEmailConfirmed] = useState(detectEmailConfirmed);
    useEffect(() => {
        const { data: { subscription } } = supabaseCloud.auth.onAuthStateChange(event => {
            if (event === 'PASSWORD_RECOVERY') setIsRecovery(true);
        });
        return () => subscription.unsubscribe();
    }, []);
    if (isEmailConfirmed) return <EmailConfirmedView onDone={() => setIsEmailConfirmed(false)} />;
    if (isRecovery) return <ResetPasswordView onDone={() => {
        window.history.replaceState({}, document.title, window.location.pathname);
        setIsRecovery(false);
    }} />;
    return <App />;
}
