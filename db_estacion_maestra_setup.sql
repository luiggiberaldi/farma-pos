-- =================================================================================
-- SETUP COMPLETO: TABLAS PARA LICENCIAS Y CONTROL DE DISPOSITIVOS
-- Ejecuta esto en el SQL Editor de Supabase (proyecto fgzwmwrugerptfqfrsjd)
-- =================================================================================

-- 1. cloud_backups
CREATE TABLE IF NOT EXISTS public.cloud_backups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT,
    backup_data JSONB NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. cloud_licenses (con max_devices y active usados por el cliente)
CREATE TABLE IF NOT EXISTS public.cloud_licenses (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    device_id TEXT,
    license_type TEXT NOT NULL DEFAULT 'trial',
    days_remaining INTEGER DEFAULT 7,
    valid_until TIMESTAMP WITH TIME ZONE DEFAULT NOW() + INTERVAL '7 days',
    max_devices INTEGER NOT NULL DEFAULT 2,
    active BOOLEAN NOT NULL DEFAULT true,
    business_name TEXT,
    phone TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Migrar columnas si la tabla ya existía con nombres distintos
DO $$
BEGIN
    -- Renombrar is_active → active si existe
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cloud_licenses' AND column_name = 'is_active'
    ) AND NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cloud_licenses' AND column_name = 'active'
    ) THEN
        ALTER TABLE public.cloud_licenses RENAME COLUMN is_active TO active;
    END IF;

    -- Añadir max_devices si no existe
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cloud_licenses' AND column_name = 'max_devices'
    ) THEN
        ALTER TABLE public.cloud_licenses ADD COLUMN max_devices INTEGER NOT NULL DEFAULT 2;
    END IF;

    -- Añadir valid_until si no existe y poblarla matemáticamente
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'cloud_licenses' AND column_name = 'valid_until'
    ) THEN
        ALTER TABLE public.cloud_licenses ADD COLUMN valid_until TIMESTAMP WITH TIME ZONE;
        UPDATE public.cloud_licenses 
        SET valid_until = updated_at + (days_remaining * INTERVAL '1 day')
        WHERE valid_until IS NULL;
    END IF;
END $$;

-- 3. account_devices
CREATE TABLE IF NOT EXISTS public.account_devices (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    email TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_alias TEXT DEFAULT 'Dispositivo',
    last_seen TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(email, device_id)
);

-- 4. RLS — políticas con filtro por email del usuario autenticado
ALTER TABLE public.cloud_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_devices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Permitir todo a cloud_backups" ON public.cloud_backups;
CREATE POLICY "Acceso por email a cloud_backups"
    ON public.cloud_backups FOR ALL
    USING (auth.jwt() ->> 'email' = email)
    WITH CHECK (auth.jwt() ->> 'email' = email);

DROP POLICY IF EXISTS "Permitir todo a cloud_licenses" ON public.cloud_licenses;
CREATE POLICY "Acceso por email a cloud_licenses"
    ON public.cloud_licenses FOR ALL
    USING (auth.jwt() ->> 'email' = email)
    WITH CHECK (auth.jwt() ->> 'email' = email);

DROP POLICY IF EXISTS "Permitir todo a account_devices" ON public.account_devices;
CREATE POLICY "Acceso por email a account_devices"
    ON public.account_devices FOR ALL
    USING (auth.jwt() ->> 'email' = email)
    WITH CHECK (auth.jwt() ->> 'email' = email);

-- 5. Función RPC: registrar dispositivo y verificar límite atómicamente
-- Retorna: 'ok' | 'limit_reached' | 'license_inactive' | 'license_expired' | 'unauthorized'
CREATE OR REPLACE FUNCTION public.register_and_check_device(
    p_email TEXT,
    p_device_id TEXT,
    p_device_alias TEXT DEFAULT 'Dispositivo'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_caller_email TEXT;
    v_max_devices INTEGER;
    v_active BOOLEAN;
    v_license_type TEXT;
    v_valid_until TIMESTAMP WITH TIME ZONE;
    v_count INTEGER;
    v_already_registered BOOLEAN;
BEGIN
    -- Validar que el caller autenticado es dueño del email solicitado
    v_caller_email := auth.jwt() ->> 'email';
    IF v_caller_email IS NULL OR lower(v_caller_email) != lower(p_email) THEN
        RETURN 'unauthorized';
    END IF;

    -- Obtener licencia
    SELECT max_devices, active, license_type, valid_until INTO v_max_devices, v_active, v_license_type, v_valid_until
    FROM public.cloud_licenses
    WHERE email = p_email;

    -- Sin licencia registrada: permitir sin restricciones
    IF NOT FOUND THEN
        RETURN 'ok';
    END IF;

    -- Licencia desactivada manualmente
    IF v_active = false THEN
        RETURN 'license_inactive';
    END IF;

    -- Licencia expirada por tiempo (Ciclo de Vida cerrado)
    IF v_license_type != 'permanent' AND v_valid_until < NOW() THEN
        RETURN 'license_expired';
    END IF;

    -- Ver cuántos dispositivos hay actualmente almacenados
    SELECT COUNT(*) INTO v_count
    FROM public.account_devices
    WHERE email = p_email;

    -- BLOQUEO ESTRICTO: Si el administrador redujo el límite (ej. de 2 a 1)
    -- y aún hay más dispositivos registrados que el límite actual, TODOS los dispositivos
    -- quedarán bloqueados hasta que el Admin expulse manualmente el exceso en la Estación Maestra.
    IF v_count > v_max_devices THEN
        RETURN 'limit_reached';
    END IF;

    -- Ver si este dispositivo PC específico ya está registrado
    SELECT EXISTS(
        SELECT 1 FROM public.account_devices
        WHERE email = p_email AND device_id = p_device_id
    ) INTO v_already_registered;

    IF v_already_registered THEN
        -- Actualizar la última vez visto y permitir su paso
        UPDATE public.account_devices
        SET last_seen = NOW()
        WHERE email = p_email AND device_id = p_device_id;
        RETURN 'ok';
    END IF;

    -- Si no está registrado y ya llegamos al tope numérico: Bloqueo de entrada
    IF v_count >= v_max_devices THEN
        RETURN 'limit_reached';
    END IF;

    -- Registrar un nuevo equipo físico a la base de datos
    INSERT INTO public.account_devices (email, device_id, device_alias, last_seen)
    VALUES (p_email, p_device_id, p_device_alias, NOW())
    ON CONFLICT (email, device_id) DO UPDATE SET last_seen = NOW();

    RETURN 'ok';
END;
$$;

-- =================================================================================
-- MIGRACIÓN v2: Tablas faltantes, RLS, índices y limpieza
-- Ejecutar en SQL Editor de Supabase después del setup inicial
-- =================================================================================

-- 6. sync_documents — Tabla principal de sincronización multi-dispositivo
CREATE TABLE IF NOT EXISTS public.sync_documents (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    collection TEXT NOT NULL,
    doc_id TEXT NOT NULL,
    data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, collection, doc_id)
);

ALTER TABLE public.sync_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Usuarios solo ven sus propios documentos" ON public.sync_documents;
CREATE POLICY "Usuarios solo ven sus propios documentos"
    ON public.sync_documents FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Índice para polling eficiente (queries con WHERE updated_at > X)
CREATE INDEX IF NOT EXISTS idx_sync_documents_updated_at
    ON public.sync_documents(user_id, updated_at);

-- 7. device_backups — Backups locales por dispositivo (acceso anónimo por diseño)
CREATE TABLE IF NOT EXISTS public.device_backups (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    device_id TEXT UNIQUE NOT NULL,
    product_id TEXT NOT NULL DEFAULT 'bodega',
    backup_data JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.device_backups ENABLE ROW LEVEL SECURITY;

-- device_backups usa acceso anónimo: dispositivos sin login cloud respaldan por device_id.
-- Aceptable porque los datos son del propio dispositivo y device_id es hash SHA-256.
DROP POLICY IF EXISTS "Dispositivos acceden su propio backup" ON public.device_backups;
CREATE POLICY "Dispositivos acceden su propio backup"
    ON public.device_backups FOR ALL
    USING (true)
    WITH CHECK (true);

-- 8. process_checkout — Stub de RPC para checkout server-side
-- TODO: Marck debe implementar la lógica real de validación de pagos.
CREATE OR REPLACE FUNCTION public.process_checkout(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- Stub: retorna sale_id generado. Implementar validación de pagos aquí.
    RETURN jsonb_build_object('sale_id', gen_random_uuid()::text);
END;
$$;

-- 9. Limpieza de columnas obsoletas
ALTER TABLE public.cloud_backups DROP COLUMN IF EXISTS password_hash;
ALTER TABLE public.cloud_licenses DROP COLUMN IF EXISTS days_remaining;
ALTER TABLE public.cloud_licenses ALTER COLUMN valid_until DROP DEFAULT;

-- Documentar columna legacy
COMMENT ON COLUMN public.cloud_licenses.device_id IS
    'LEGACY: dispositivo que creó la licencia. La relación real N:N está en account_devices.';

-- 10. Realtime para sync_documents — DESHABILITADO intencionalmente
-- La tabla sync_documents fue retirada de la publicación supabase_realtime
-- para eliminar la sobrecarga de decodificación lógica de WAL que causaba
-- timeouts de 10-13s y errores 504/522 en el Edge con payloads JSONB pesados.
--
-- La sincronización en tiempo real de tasas/config se realiza ahora mediante
-- Realtime Broadcast (cliente→cliente), que no involucra replicación lógica.
-- Ver: migrations/002_remove_realtime_logical_decoding.sql
-- ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_documents; -- REMOVIDO

