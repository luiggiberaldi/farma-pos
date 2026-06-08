import { useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { storageService } from '../utils/storageService';
import { useAuthStore } from './store/useAuthStore';
import { useAudit } from './useAudit';
import { useSecurity } from './useSecurity';
import { showToast } from '../components/Toast';

export function useCloudAuthLogic() {
    // Tomamos businessName del localStorage directamente
    const businessName = localStorage.getItem('business_name') || '';

    const adminEmail = useAuthStore(s => s.adminEmail);
    const adminPassword = useAuthStore(s => s.adminPassword);
    const setAdminCredentials = useAuthStore(s => s.setAdminCredentials);

    const { deviceId } = useSecurity();
    const { log: auditLog } = useAudit();

    // ─── STATE ──────────────────────────────────────────
    const [inputEmail, setInputEmail] = useState(adminEmail || '');
    const [inputPassword, setInputPassword] = useState(''); // ← Siempre en blanco por seguridad
    const [inputConfirmPassword, setInputConfirmPassword] = useState('');
    const [inputBusinessName, setInputBusinessName] = useState(() => localStorage.getItem('business_name') || '');
    const isCloudConfigured = Boolean(adminEmail);
    const [isCloudLogin, setIsCloudLogin] = useState(true);

    const [localDeviceAlias, setLocalDeviceAlias] = useState(() => localStorage.getItem('pda_device_alias') || '');
    const [inputPhone, setInputPhone] = useState('');
    const [emailError, setEmailError] = useState('');
    const [passwordError, setPasswordError] = useState('');
    const [isRecoveringPassword, setIsRecoveringPassword] = useState(false);

    const [deviceLimitError, setDeviceLimitError] = useState(null);
    const [blockedDevices, setBlockedDevices] = useState([]);
    const [dataConflictPending, setDataConflictPending] = useState(null);
    
    const [importStatus, setImportStatus] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');

    // ─── HELPERS ──────────────────────────────────────────
    const applyCloudBackup = async (cloudBackup) => {
        if (!cloudBackup?.data) {
            throw new Error('El backup de la nube está vacío o es inválido.');
        }
        if (cloudBackup.version === '2.0' && cloudBackup.data.idb) {
            const idbEntries = Object.entries(cloudBackup.data.idb);
            for (const [key, value] of idbEntries) {
                await storageService.setItem(key, value);
            }
        }
        if (cloudBackup.data.ls) {
            for (const [key, value] of Object.entries(cloudBackup.data.ls)) {
                localStorage.setItem(key, value);
            }
        }
    };

    const collectLocalBackup = async () => {
        // Alineado con SYNC_KEYS de useCloudSync.js
        const idbKeys = [
            'bodega_products_v1', 'bodega_customers_v1',
            'bodega_sales_v1', 'bodega_payment_methods_v1',
            'bodega_accounts_v2', 'abasto_audit_log_v1'
        ];
        const idbData = {};
        for (const key of idbKeys) {
            const data = await storageService.getItem(key, null);
            if (data !== null) idbData[key] = data;
        }
        const lsKeys = [
            'premium_token', 'street_rate_bs', 'catalog_use_auto_usdt',
            'catalog_custom_usdt_price', 'catalog_show_cash_price',
            'monitor_rates_v12', 'business_name', 'business_phone', 'business_rif',
            'printer_paper_width', 'allow_negative_stock', 'cop_enabled',
            'auto_cop_enabled', 'tasa_cop', 'bodega_use_auto_rate',
            'bodega_custom_rate', 'bodega_inventory_view', 'abasto-auth-storage'
        ];
        const lsData = {};
        for (const key of lsKeys) {
            const val = localStorage.getItem(key);
            if (val !== null) lsData[key] = val;
        }
        return {
            timestamp: new Date().toISOString(),
            version: '2.0',
            appName: 'Listo_POS_Cloud',
            data: { idb: idbData, ls: lsData }
        };
    };

    const uploadLocalBackup = async (email, backupData) => {
        const { error } = await supabaseCloud
            .from('cloud_backups')
            .upsert({
                email: email.toLowerCase(),
                backup_data: backupData,
                updated_at: new Date().toISOString()
            }, { onConflict: 'email' });
        if (error) throw error;

        try {
            const { data: { session } } = await supabaseCloud.auth.getSession();
            if (session?.user?.id) {
                const syncPayloads = [];
                for (const [key, value] of Object.entries(backupData.data.idb || {})) {
                    syncPayloads.push({
                        user_id: session.user.id,
                        collection: 'store',
                        doc_id: key,
                        data: { payload: value },
                        updated_at: new Date().toISOString()
                    });
                }
                for (const [key, value] of Object.entries(backupData.data.ls || {})) {
                    let finalVal = value;
                    try { finalVal = JSON.parse(value); } catch(e) {}
                    syncPayloads.push({
                        user_id: session.user.id,
                        collection: 'local',
                        doc_id: key,
                        data: { payload: finalVal },
                        updated_at: new Date().toISOString()
                    });
                }
                if (syncPayloads.length > 0) {
                    await supabaseCloud.from('sync_documents').upsert(syncPayloads, { onConflict: 'user_id,collection,doc_id' });
                }
            }
        } catch(syncErr) {
            console.warn('[Realtime Sync Init] Fallo inicializando sync_documents:', syncErr);
        }
    };

    const registerDevice = async (email) => {
        const alias = localStorage.getItem('pda_device_alias') || `Dispositivo ${navigator.platform || 'Web'}`;
        const did = deviceId || 'UNKNOWN';
        const emailLower = email.toLowerCase();
        
        // Usar upsert para evitar lanzar errores 409 en la consola de red
        await supabaseCloud.from('account_devices').upsert({
            email: emailLower,
            device_id: did,
            device_alias: alias,
            last_seen: new Date().toISOString()
        }, { onConflict: 'email,device_id' });
    };

    // ─── ACTION HANDLERS ────────────────────────────────
    const handleDataConflictChoice = async (choice) => {
        if (!dataConflictPending) return;
        const { email, cloudBackup, localBackup } = dataConflictPending;
        setDataConflictPending(null);
        setImportStatus('loading');
        setStatusMessage('Aplicando elección...');
        try {
            if (choice === 'cloud') {
                await applyCloudBackup(cloudBackup);
                showToast('Datos de la nube restaurados. Reiniciando...', 'success');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                await uploadLocalBackup(email, localBackup);
                showToast('Datos locales guardados en la nube', 'success');
            }
            setAdminCredentials(email, inputPassword);
            setInputPassword('');
            auditLog('NUBE', 'CONFLICTO_RESUELTO', `Resuelto: ${choice}`);
            setImportStatus(null);
        } catch (err) {
            showToast(err.message || 'Error resolviendo', 'error');
            setImportStatus('error');
        }
    };

    const handleUnlinkSpecificDevice = async (deviceToUnlinkId) => {
        if (!inputEmail || !deviceToUnlinkId) return;
        setImportStatus('loading');
        setStatusMessage('Desvinculando equipo...');
        try {
            await supabaseCloud.from('account_devices')
                .delete()
                .eq('email', inputEmail.toLowerCase())
                .eq('device_id', deviceToUnlinkId);
            setDeviceLimitError(null);
            setBlockedDevices([]);
            showToast(`Equipo desvinculado. Volviendo a intentar...`, 'success');
            await handleSaveCloudAccount();
        } catch (err) {
            showToast(err.message || 'Error desvinculando', 'error');
            setImportStatus('error');
        }
    };

    const handleSaveCloudAccount = async () => {
        setEmailError('');
        setPasswordError('');
        setDeviceLimitError(null);
        setBlockedDevices([]);

        let hasError = false;
        if (!inputEmail.includes('@')) { setEmailError('Formato no válido'); hasError = true; }
        if (inputPassword.length < 6) { setPasswordError('Mínimo 6 caracteres'); hasError = true; }
        if (!isCloudLogin) {
            if (!inputBusinessName.trim()) { showToast('El nombre del negocio es obligatorio', 'error'); hasError = true; }
            if (inputPassword !== inputConfirmPassword) { setPasswordError('Las contraseñas no coinciden'); hasError = true; }
            if (!inputPhone.trim()) { showToast('El teléfono es obligatorio', 'error'); hasError = true; }
        }
        
        if (hasError) return;

        const emailToUse = inputEmail.trim().toLowerCase();

        try {
            setImportStatus('loading');
            setStatusMessage('Autenticando...');

            if (supabaseCloud) {
                if (isCloudLogin) {
                    const { error: err } = await supabaseCloud.auth.signInWithPassword({
                        email: emailToUse, password: inputPassword,
                    });
                    if (err) throw new Error('Error al iniciar: ' + err.message);
                } else {
                    const { data, error: err } = await supabaseCloud.auth.signUp({
                        email: emailToUse, password: inputPassword,
                        options: { data: { full_name: inputBusinessName.trim() || 'Negocio', phone: inputPhone } },
                    });
                    if (err) {
                        if (err.message.includes('already registered')) throw new Error('Ya registrado. Entrar.');
                        throw new Error('Registro falló: ' + err.message);
                    }
                    if (data?.user?.identities?.length === 0) throw new Error('Ya registrado. Entrar.');
                    if (data?.user && !data.session) {
                        // Guardar el nombre del negocio antes del redirect
                        if (inputBusinessName.trim()) localStorage.setItem('business_name', inputBusinessName.trim());
                        showToast('Revisa tu correo y confírmalo.', 'success');
                        setImportStatus('awaiting_email_confirmation');
                        return;
                    }
                }
            }

            setStatusMessage('Verificando dispositivos...');
            const finalAlias = localDeviceAlias.trim() || `Dispositivo ${navigator.platform || 'Web'}`;
            localStorage.setItem('pda_device_alias', finalAlias);
            localStorage.setItem('pda_explicit_login', 'true'); // Bandera para evitar que App.jsx tumba nuestra sesión antes de registrar

            // Jalar metadatos del usuario (nombre del negocio y teléfono) desde Supabase
            // y guardarlos en localStorage para que la estación los tenga disponibles
            if (isCloudLogin && supabaseCloud) {
                try {
                    const { data: { user } } = await supabaseCloud.auth.getUser();
                    if (user?.user_metadata) {
                        const meta = user.user_metadata;
                        if (meta.full_name && !localStorage.getItem('business_name')) {
                            localStorage.setItem('business_name', meta.full_name);
                        }
                        if (meta.phone && !localStorage.getItem('business_phone')) {
                            localStorage.setItem('business_phone', meta.phone);
                        }
                    }
                    // También intentar desde cloud_licenses (fuente más actualizada)
                    const { data: lic } = await supabaseCloud
                        .from('cloud_licenses')
                        .select('business_name, phone')
                        .eq('email', emailToUse)
                        .maybeSingle();
                    if (lic?.business_name) localStorage.setItem('business_name', lic.business_name);
                    if (lic?.phone) localStorage.setItem('business_phone', lic.phone);

                    // Sincronizar phone/business_name desde auth metadata si el registro está incompleto
                    const meta = user?.user_metadata || {};
                    if (!lic) {
                        // No existe el registro (ej: usuario confirmó email pero licencia no se creó)
                        const trialExpiry = new Date();
                        trialExpiry.setDate(trialExpiry.getDate() + 7);
                        await supabaseCloud.from('cloud_licenses').upsert({
                            email: emailToUse,
                            device_id: deviceId || 'UNKNOWN',
                            license_type: 'trial',
                            max_devices: 2,
                            valid_until: trialExpiry.toISOString(),
                            business_name: meta.full_name || '',
                            phone: meta.phone || '',
                            active: true,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'email' }).catch(e => console.warn('[Login] No se pudo crear licencia inicial:', e.message));
                        if (meta.full_name) localStorage.setItem('business_name', meta.full_name);
                        if (meta.phone) localStorage.setItem('business_phone', meta.phone);
                    } else if (!lic.phone || !lic.business_name) {
                        // El registro existe pero le faltan datos — completar desde auth metadata
                        const updateFields = {};
                        if (!lic.phone && meta.phone) updateFields.phone = meta.phone;
                        if (!lic.business_name && meta.full_name) updateFields.business_name = meta.full_name;
                        if (Object.keys(updateFields).length > 0) {
                            updateFields.updated_at = new Date().toISOString();
                            await supabaseCloud.from('cloud_licenses')
                                .update(updateFields)
                                .eq('email', emailToUse)
                                .catch(e => console.warn('[Login] No se pudo completar perfil:', e.message));
                            if (updateFields.business_name) localStorage.setItem('business_name', updateFields.business_name);
                            if (updateFields.phone) localStorage.setItem('business_phone', updateFields.phone);
                        }
                    }

                    // Sincronizar Display name y Phone en auth.users via Admin API (worker)
                    const { data: { session } } = await supabaseCloud.auth.getSession();
                    if (session?.access_token && (lic?.business_name || lic?.phone)) {
                        fetch('/api/update-profile', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                accessToken: session.access_token,
                                businessName: lic?.business_name || undefined,
                                phone: lic?.phone || undefined,
                            }),
                        }).catch(() => {}); // fire-and-forget
                    }
                } catch (e) {
                    console.warn('[Login] No se pudieron sincronizar metadatos del negocio:', e);
                }
            }

            {
                let rpcResult;
                try {
                    const { data } = await supabaseCloud.rpc('register_and_check_device', {
                        p_email: emailToUse,
                        p_device_id: deviceId || 'UNKNOWN',
                        p_device_alias: finalAlias
                    });
                    rpcResult = data;
                } catch (rpcErr) {
                    // Silenciar error si RPC aun no existe (fallback)
                    console.warn("RPC Device Check falló", rpcErr);
                }

                if (rpcResult === 'license_inactive') {
                    throw new Error('Licencia suspendida por el administrador.');
                }
                if (rpcResult === 'license_expired') {
                    // Verificar período de gracia de 5 días
                    const GRACE_DAYS = 5;
                    const { data: licRow } = await supabaseCloud
                        .from('cloud_licenses')
                        .select('valid_until')
                        .eq('email', emailToUse)
                        .maybeSingle();
                    const validUntil = licRow?.valid_until ? new Date(licRow.valid_until) : null;
                    const daysOverdue = validUntil ? Math.ceil((new Date() - validUntil) / 86400000) : 999;
                    if (!validUntil || daysOverdue > GRACE_DAYS) {
                        throw new Error(`Licencia vencida hace ${daysOverdue} días. Contacta a soporte para renovar.`);
                    }
                    // Dentro de gracia — continuar login, App.jsx mostrará el banner
                }
                if (rpcResult === 'limit_reached') {
                    const { data: licenseData } = await supabaseCloud
                        .from('cloud_licenses').select('max_devices').eq('email', emailToUse).maybeSingle();
                    const DEVICE_LIMIT = licenseData?.max_devices || 2;

                    const { data: existingDevices } = await supabaseCloud
                        .from('account_devices').select('*').eq('email', emailToUse).order('created_at', { ascending: true });

                    setDeviceLimitError({ devices: existingDevices, limit: DEVICE_LIMIT, currentId: deviceId || 'UNKNOWN' });
                    setBlockedDevices(existingDevices || []);
                    setImportStatus('error');
                    setStatusMessage(`Límite de ${DEVICE_LIMIT} equipo(s) excedido.`);
                    return;
                }
            }

            setStatusMessage('Consultando nube...');
            const { data: cloudRow } = await supabaseCloud
                .from('cloud_backups').select('backup_data').eq('email', emailToUse).maybeSingle();
            const cloudBackup = cloudRow?.backup_data || null;
            
            const localBackup = await collectLocalBackup();
            const hasLocalData = Object.keys(localBackup.data.idb).length > 0;
            const hasCloudData = cloudBackup && cloudBackup.data;

            if (isCloudLogin && hasCloudData && hasLocalData) {
                setDataConflictPending({ email: emailToUse, cloudBackup, localBackup });
                await registerDevice(emailToUse);
                setAdminCredentials(emailToUse, inputPassword);
                setInputPassword('');
                setImportStatus(null);
                setStatusMessage('');
                auditLog('NUBE', 'LOGIN_NUBE', `Conflicto a resolver: ${emailToUse}`);
                return;
            }

            if (isCloudLogin && hasCloudData && !hasLocalData) {
                setStatusMessage('Restaurando nube...');
                await applyCloudBackup(cloudBackup);
                await registerDevice(emailToUse);
                setAdminCredentials(emailToUse, inputPassword);
                setInputPassword('');
                showToast('Datos restaurados desde la nube', 'success');
                setImportStatus('success');
                setTimeout(() => window.location.reload(), 1500);
                return;
            }

            setStatusMessage('Guardando nueva cuenta...');
            if (supabaseCloud) {
                await uploadLocalBackup(emailToUse, localBackup);
                if (!isCloudLogin) {
                    try {
                        // Licencia de fábrica: 7 días, máximo 1 equipo vinculado
                        const trialExpiry = new Date();
                        trialExpiry.setDate(trialExpiry.getDate() + 7);
                        const { error: licErr } = await supabaseCloud.from('cloud_licenses').upsert({
                            email: emailToUse,
                            device_id: deviceId || 'UNKNOWN',
                            license_type: 'trial',
                            plan_tier: 'basic',
                            max_devices: 2,
                            days_remaining: 7,
                            valid_until: trialExpiry.toISOString(),
                            business_name: inputBusinessName.trim() || 'Negocio',
                            phone: inputPhone || '',
                            active: true,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'email' });
                        if (licErr) console.warn('[Registro] Error al crear licencia de fábrica:', licErr.message);
                    } catch (e) {
                        console.warn('[Registro] Excepción al crear licencia de fábrica:', e);
                    }
                }
                await registerDevice(emailToUse);
            }

            setAdminCredentials(emailToUse, inputPassword);
            setInputPassword('');
            // Guardar datos del negocio en localStorage para la estación
            if (!isCloudLogin) {
                if (inputBusinessName.trim()) localStorage.setItem('business_name', inputBusinessName.trim());
                if (inputPhone.trim()) localStorage.setItem('business_phone', inputPhone.trim());

                // Sincronizar Display name y Phone en auth.users via Admin API (worker)
                try {
                    const { data: { session } } = await supabaseCloud.auth.getSession();
                    if (session?.access_token) {
                        fetch('/api/update-profile', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                accessToken: session.access_token,
                                businessName: inputBusinessName.trim() || undefined,
                                phone: inputPhone.trim() || undefined,
                            }),
                        }).catch(() => {});
                    }
                } catch (e) { /* silencioso */ }
            }
            showToast('Sincronizado', 'success');
            setImportStatus(null);
            setStatusMessage('');

        } catch (error) {
            showToast(error.message, 'error');
            setImportStatus('error');
            setStatusMessage('');
        }
    };

    const handleResetPasswordRequest = async () => {
        setEmailError('');
        if (!inputEmail.includes('@')) { setEmailError('Correo inválido'); return; }
        
        setImportStatus('loading');
        setStatusMessage('Enviando enlace...');
        try {
            const appUrl = `${window.location.protocol}//${window.location.host}${window.location.pathname}`;
            const { error } = await supabaseCloud.auth.resetPasswordForEmail(inputEmail.toLowerCase().trim(), { redirectTo: appUrl });
            if (error) throw error;
            showToast('Enlace enviado. Revisa tu correo.', 'success');
            setIsRecoveringPassword(false);
            setImportStatus(null);
            setStatusMessage('');
        } catch (error) {
            showToast(error.message, 'error');
            setImportStatus('error');
            setStatusMessage('');
        }
    };

    return {
        inputEmail, setInputEmail,
        inputPassword, setInputPassword,
        inputConfirmPassword, setInputConfirmPassword,
        inputBusinessName, setInputBusinessName,
        inputPhone, setInputPhone,
        isCloudConfigured,
        isCloudLogin, setIsCloudLogin,
        emailError, setEmailError,
        passwordError, setPasswordError,
        isRecoveringPassword, setIsRecoveringPassword,
        deviceLimitError, setDeviceLimitError,
        blockedDevices, setBlockedDevices,
        dataConflictPending, setDataConflictPending,
        importStatus, setImportStatus,
        statusMessage, setStatusMessage,
        localDeviceAlias, setLocalDeviceAlias,
        handleDataConflictChoice,
        handleUnlinkSpecificDevice,
        handleSaveCloudAccount,
        handleResetPasswordRequest
    };
}
