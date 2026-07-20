-- ============================================================
-- MIGRACIÓN 004: Retención de audit_log + índice de lectura
--                + limpieza del doc legado abasto_audit_log_v1
-- Ejecutar en Supabase SQL Editor:
-- https://supabase.com/dashboard/project/fgzwmwrugerptfqfrsjd/sql
-- Requiere la extensión pg_cron (se habilita abajo; también puede
-- activarse en Dashboard → Database → Extensions).
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- ── 1. Índice para el visor cloud y el DELETE de retención ──
-- El visor consulta audit_log ordenado por ts DESC; RLS inyecta el
-- filtro por email (migración 003), así que el índice compuesto cubre ambos.
CREATE INDEX IF NOT EXISTS idx_audit_log_email_ts
    ON public.audit_log (email, ts DESC);


-- ── 2. Limpieza one-time del documento legado ────────────────
-- El audit log ya no se sincroniza como documento completo por
-- sync_documents (era ~2-4 MB re-subidos en cada evento y el mayor
-- consumidor de Disk I/O); ahora va incremental a la tabla audit_log.
DELETE FROM public.sync_documents WHERE doc_id = 'abasto_audit_log_v1';


-- ── 3. Job semanal de retención (domingo 04:00 UTC) ──────────
-- Borra registros de auditoría con más de 90 días (ts = epoch en ms,
-- alineado con MAX_AGE_DAYS del cliente) y re-purga el doc legado
-- mientras existan dispositivos con la versión vieja de la app.
DO $do$
BEGIN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'audit_log_retention_weekly') THEN
        PERFORM cron.unschedule('audit_log_retention_weekly');
    END IF;
END $do$;

SELECT cron.schedule(
    'audit_log_retention_weekly',
    '0 4 * * 0',
    $job$
        DELETE FROM public.audit_log
            WHERE ts < (EXTRACT(EPOCH FROM now() - INTERVAL '90 days') * 1000)::BIGINT;
        DELETE FROM public.sync_documents WHERE doc_id = 'abasto_audit_log_v1';
    $job$
);
