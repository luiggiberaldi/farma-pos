-- ADR-003: tabla de sincronización bidireccional multi-equipo.
-- Existía solo en el script manual db_estacion_maestra_setup.sql; nunca se
-- versionó ni se aplicó en la base live (verificado 2026-09-30: la tabla no existe).
BEGIN;

CREATE TABLE IF NOT EXISTS public.sync_documents (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    collection text NOT NULL CHECK (collection IN ('store', 'local')),
    doc_id text NOT NULL CHECK (doc_id ~ '^v2:[a-zA-Z0-9_-]{1,120}:account:[^:\s]{1,255}(:sede:(central|norte|sur))?$'),
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (user_id, collection, doc_id)
);

ALTER TABLE public.sync_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sync_documents_owner_only" ON public.sync_documents;
CREATE POLICY "sync_documents_owner_only"
    ON public.sync_documents FOR ALL
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

-- Polling eficiente: el cliente pregunta por documentos más nuevos que X.
CREATE INDEX IF NOT EXISTS idx_sync_documents_user_updated
    ON public.sync_documents (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_sync_documents_lookup
    ON public.sync_documents (user_id, collection, doc_id);

-- PostgREST necesita el rol anon/authenticated con permisos; RLS los limita
-- a sus propias filas (auth.uid() = user_id).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.sync_documents TO authenticated;
REVOKE ALL ON public.sync_documents FROM anon;

COMMIT;
