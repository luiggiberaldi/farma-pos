import { useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { storageService } from '../utils/storageService';
import { useAuthStore } from './store/useAuthStore';
import { sanitizeForPush } from './useCloudSync';
import { useAudit } from './useAudit';
import { useSecurity } from './useSecurity';
import { showToast } from '../components/Toast';
import { setActiveAccountId } from '../config/storageScope';

// El Worker local no suele tener SUPABASE_SERVICE_KEY; no lanzar peticiones
// destinadas al despliegue desde el servidor de desarrollo.
const PROFILE_SYNC_ENABLED = import.meta.env.PROD
    && typeof window !== 'undefined'
    && !['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);

/**
 * Guarda explícitamente un backup completo en la cuenta cloud y espeja sus datos
 * en sync_documents para que la restauración sea visible en los demás equipos.
 */
export const uploadBackupToCloud = async (email, backupData, { strictSync = false } = {}) => {
    if (!email || !backupData?.data) throw new Error('Backup o cuenta cloud inválidos.');

    const { error } = await supabaseCloud
        .from('cloud_backups')
        .upsert({
            email: email.toLowerCase(),
            backup_data: backupData,
            updated_at: new Date().toISOString()
        }, { onConflict: 'email' });
    if (error) throw error;

    const { data: { session } } = await supabaseCloud.auth.getSession();
    if (!session?.user?.id) throw new Error('La sesión cloud expiró. Vuelve a iniciar sesión.');

    const syncPayloads = [];
    for (const [key, value] of Object.entries(backupData.data.idb || {})) {
        syncPayloads.push({
            user_id: session.user.id,
            collection: 'store',
            doc_id: key,
            data: { payload: sanitizeForPush(key, value) },
            updated_at: new Date().toISOString()
        });
    }
    for (const [key, value] of Object.entries(backupData.data.ls || {})) {
        let finalVal = value;
        try { finalVal = JSON.parse(value); } catch { /* valores de localStorage que no son JSON */ }
        syncPayloads.push({
            user_id: session.user.id,
            collection: 'local',
            doc_id: key,
            data: { payload: sanitizeForPush(key, finalVal) },
            updated_at: new Date().toISOString()
        });
    }
    if (syncPayloads.length > 0) {
        const { error: syncError } = await supabaseCloud
            .from('sync_documents')
            .upsert(syncPayloads, { onConflict: 'user_id,collection,doc_id' });
        if (syncError) {
            if (strictSync) throw syncError;
            console.warn('[Realtime Sync Init] Fallo inicializando sync_documents:', syncError.message);
        }
    }
};

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
    // signInWithPassword devuelve la sesión antes de que el evento de auth
    // termine de actualizar el cliente. Fijarla explícitamente evita que las
    // primeras consultas REST salgan como anon y fallen con 401/RLS.
    const ensureAuthenticatedSession = async (session) => {
        if (!session?.access_token || !session?.refresh_token) {
            throw new Error('La sesión no quedó activa. Vuelve a iniciar sesión.');
        }
        const { error: setSessionError } = await supabaseCloud.auth.setSession({
            access_token: session.access_token,
            refresh_token: session.refresh_token,
        });
        if (setSessionError) throw setSessionError;

        const { data: { session: activeSession }, error: sessionError } =
            await supabaseCloud.auth.getSession();
        if (sessionError || !activeSession?.access_token) {
            throw new Error('La sesión no quedó activa. Vuelve a iniciar sesión.');
        }
        return activeSession;
    };

    const notifyCloudLoginCompleted = async () => {
        localStorage.removeItem('pda_explicit_login');
        const { data: { session } } = await supabaseCloud.auth.getSession();
        window.dispatchEvent(new CustomEvent('cloud_login_completed', {
            detail: { session },
        }));
    };

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
        // 'abasto_audit_log_v1' excluido: la auditoría vive en la tabla audit_log
        // (sync incremental) y uploadLocalBackup espeja estas llaves a
        // sync_documents — incluirla re-crearía el documento gigante en cada login.
        const idbKeys = [
            'bodega_products_v1', 'bodega_customers_v1',
            'bodega_sales_v1', 'bodega_payment_methods_v1',
            'bodega_accounts_v2'
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

    const uploadLocalBackup = uploadBackupToCloud;

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
                localStorage.removeItem('pda_explicit_login');
                showToast('Datos de la nube restaurados. Reiniciando...', 'success');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                await uploadLocalBackup(email, localBackup);
                await notifyCloudLoginCompleted();
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
            // App.jsx escucha SIGNED_IN en paralelo. Marcar el login explícito
            // antes de llamar a Supabase evita que ese listener confunda esta
            // estación nueva con un auto-login y cierre la sesión por no verla
            // todavía en account_devices.
            localStorage.setItem('pda_explicit_login', 'true');

            if (supabaseCloud) {
                if (isCloudLogin) {
                    const { data: signInData, error: err } = await supabaseCloud.auth.signInWithPassword({
                        email: emailToUse, password: inputPassword,
                    });
                    if (err) throw new Error('Error al iniciar: ' + err.message);
                    await ensureAuthenticatedSession(signInData?.session);
                    // Fijar el namespace antes de leer backups o datos locales.
                    if (signInData?.user?.id) setActiveAccountId(signInData.user.id);
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
                    if (data?.session) await ensureAuthenticatedSession(data.session);
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
                        const { error: licenseError } = await supabaseCloud.from('cloud_licenses').upsert({
                            email: emailToUse,
                            device_id: deviceId || 'UNKNOWN',
                            license_type: 'trial',
                            max_devices: 2,
                            valid_until: trialExpiry.toISOString(),
                            business_name: meta.full_name || '',
                            phone: meta.phone || '',
                            active: true,
                            updated_at: new Date().toISOString()
                        }, { onConflict: 'email' });
                        if (licenseError) console.warn('[Login] No se pudo crear licencia inicial:', licenseError.message);
                        if (meta.full_name) localStorage.setItem('business_name', meta.full_name);
                        if (meta.phone) localStorage.setItem('business_phone', meta.phone);
                    } else if (!lic.phone || !lic.business_name) {
                        // El registro existe pero le faltan datos — completar desde auth metadata
                        const updateFields = {};
                        if (!lic.phone && meta.phone) updateFields.phone = meta.phone;
                        if (!lic.business_name && meta.full_name) updateFields.business_name = meta.full_name;
                        if (Object.keys(updateFields).length > 0) {
                            updateFields.updated_at = new Date().toISOString();
                            const { error: profileError } = await supabaseCloud.from('cloud_licenses')
                                .update(updateFields)
                                .eq('email', emailToUse);
                            if (profileError) console.warn('[Login] No se pudo completar perfil:', profileError.message);
                            if (updateFields.business_name) localStorage.setItem('business_name', updateFields.business_name);
                            if (updateFields.phone) localStorage.setItem('business_phone', updateFields.phone);
                        }
                    }

                    // Sincronizar Display name y Phone en auth.users via Admin API (worker)
                    const { data: { session } } = await supabaseCloud.auth.getSession();
                    if (PROFILE_SYNC_ENABLED && session?.access_token && (lic?.business_name || lic?.phone)) {
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
                const { data, error: rpcError } = await supabaseCloud.rpc('register_and_check_device', {
                    p_email: emailToUse,
                    p_device_id: deviceId || 'UNKNOWN',
                    p_device_alias: finalAlias
                });
                if (rpcError) {
                    const authFailure = rpcError.status === 401 || rpcError.code === '401'
                        || /JWT|permission|not authenticated/i.test(rpcError.message || '');
                    if (authFailure) throw new Error('La sesión expiró o no quedó activa. Vuelve a iniciar sesión.');
                    throw rpcError;
                }
                rpcResult = data;

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
                    // Consultar el estado mediante una función que valida el correo
                    // de la sesión. No depender de un SELECT directo que puede fallar
                    // por RLS y dejar la interfaz mostrando "0 dispositivos".
                    const { data: rpcDeviceStatus, error: deviceStatusError } = await supabaseCloud
                        .rpc('get_my_device_status');

                    // Algunas versiones de PostgREST devuelven el jsonb como texto
                    // o como una fila; normalizarlo evita mostrar una lista vacía.
                    let deviceStatus = rpcDeviceStatus;
                    if (typeof deviceStatus === 'string') {
                        try { deviceStatus = JSON.parse(deviceStatus); } catch { /* usar fallback */ }
                    }
                    if (Array.isArray(deviceStatus)) deviceStatus = deviceStatus[0] || null;

                    let existingDevices = Array.isArray(deviceStatus?.devices)
                        ? deviceStatus.devices
                        : [];
                    let DEVICE_LIMIT = Number(deviceStatus?.limit) || 0;

                    // Fallback compatible con instalaciones donde la RPC fue creada
                    // pero no puede leer filas por una política/RLS antigua. La consulta
                    // directa sigue limitada al correo autenticado por RLS.
                    if (deviceStatusError || existingDevices.length === 0) {
                        const { data: deviceRows, error: deviceRowsError } = await supabaseCloud
                            .from('account_devices')
                            .select('id, email, device_id, device_alias, last_seen, created_at')
                            .eq('email', emailToUse)
                            .order('created_at', { ascending: true });
                        if (deviceRowsError && deviceStatusError) {
                            throw new Error('No se pudieron consultar los dispositivos de la cuenta.');
                        }
                        if (Array.isArray(deviceRows)) existingDevices = deviceRows;

                        if (!DEVICE_LIMIT) {
                            const { data: licenseRow } = await supabaseCloud
                                .from('cloud_licenses')
                                .select('max_devices')
                                .eq('email', emailToUse)
                                .maybeSingle();
                            DEVICE_LIMIT = Number(licenseRow?.max_devices) || 2;
                        }
                    }

                    DEVICE_LIMIT = DEVICE_LIMIT || 2;
                    setDeviceLimitError({ devices: existingDevices, limit: DEVICE_LIMIT, currentId: deviceId || 'UNKNOWN' });
                    setBlockedDevices(existingDevices);
                    setImportStatus('error');
                    setStatusMessage(`Límite de ${DEVICE_LIMIT} equipo(s) excedido.`);
                    return;
                }
            }

            setStatusMessage('Consultando nube...');
            // El backup completo es una copia de recuperación, no la fuente
            // diaria. Consultar primero un documento operativo pequeño evita
            // descargar varios MB en cada login cuando la cuenta ya tiene sync.
            let cloudBackup = null;
            const { data: syncProbe, error: syncProbeError } = await supabaseCloud
                .from('sync_documents')
                .select('updated_at')
                .eq('user_id', (await supabaseCloud.auth.getUser()).data.user?.id || '')
                .eq('collection', 'store')
                .eq('doc_id', 'bodega_products_v1')
                .limit(1);

            if (syncProbeError || !syncProbe?.length) {
                const { data: cloudRow } = await supabaseCloud
                    .from('cloud_backups').select('backup_data').eq('email', emailToUse).maybeSingle();
                cloudBackup = cloudRow?.backup_data || null;
            }
            // La cuenta ya tiene documentos operativos en sync_documents.
            // El backup completo (cloud_backups) es solo una copia de recuperación
            // y solo se consulta si el probe falla; para cuentas sincronizadas no
            // hace falta re-subirlo en cada login.
            const cloudHasSyncData = !syncProbeError && syncProbe?.length > 0;
            
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
                // Cuenta ya sincronizada: sync_documents se mantiene solo
                // (CloudSync: push en cada cambio + catch-up al arrancar).
                // Subir aquí el backup completo —con las imágenes base64 de
                // productos— en cada login era lo que hacía la entrada lenta.
                if (!cloudHasSyncData) {
                    await uploadLocalBackup(emailToUse, localBackup);
                }
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
                    if (PROFILE_SYNC_ENABLED && session?.access_token) {
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
            await notifyCloudLoginCompleted();
            showToast('Sincronizado', 'success');
            setImportStatus(null);
            setStatusMessage('');

        } catch (error) {
            localStorage.removeItem('pda_explicit_login');
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
