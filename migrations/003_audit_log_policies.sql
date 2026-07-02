-- ============================================================
-- MIGRACIÓN 003: Habilitar RLS y Políticas de Seguridad en audit_log
-- Ejecutar en Supabase SQL Editor:
-- https://supabase.com/dashboard/project/fgzwmwrugerptfqfrsjd/sql
-- ============================================================

-- Crear la tabla audit_log si no existe (por seguridad)
CREATE TABLE IF NOT EXISTS public.audit_log (
    id UUID PRIMARY KEY,
    ts BIGINT NOT NULL,
    cat TEXT NOT NULL,
    action TEXT NOT NULL,
    desc TEXT,
    user_id TEXT, -- Usamos TEXT para soportar UUID locales o IDs numéricos
    user_name TEXT,
    user_role TEXT,
    email TEXT NOT NULL,
    device_id TEXT,
    meta JSONB,
    synced_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Asegurar RLS habilitado
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- Política de inserción: Permitir a usuarios autenticados insertar logs con su propio email
DROP POLICY IF EXISTS "Permitir insertar logs propios" ON public.audit_log;
CREATE POLICY "Permitir insertar logs propios"
    ON public.audit_log FOR INSERT
    WITH CHECK (
        auth.role() = 'authenticated' AND 
        lower(auth.jwt() ->> 'email') = lower(email)
    );

-- Política de lectura: Permitir a usuarios autenticados leer sus propios logs
DROP POLICY IF EXISTS "Permitir ver logs propios" ON public.audit_log;
CREATE POLICY "Permitir ver logs propios"
    ON public.audit_log FOR SELECT
    USING (
        auth.role() = 'authenticated' AND 
        lower(auth.jwt() ->> 'email') = lower(email)
    );
